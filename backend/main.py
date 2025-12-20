import os

import base64
import json
import subprocess
import shutil
import uuid
import logging
import asyncio
import time
import random
from typing import List, Optional, Dict
import concurrent.futures
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import requests
from ftplib import FTP_TLS
from PIL import Image
import io
from groq import Groq

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for Coolify/dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directories
# Directories
# Use a relative directory for wider compatibility (Windows local dev vs Docker)
TEMP_DIR = os.path.join(os.getcwd(), "temp")
os.makedirs(TEMP_DIR, exist_ok=True)

# Mount temp dir for serving images to frontend
app.mount("/temp", StaticFiles(directory=TEMP_DIR), name="temp")

# --- In-Memory Job Store (Simple for single instance) ---
JOBS = {} # {session_id: {"status": "processing"|"completed"|"failed", "results": [], "error": None}}

# --- Pydantic Models ---

class AnalyzeRequest(BaseModel):
    session_id: str
    api_key: str
    context_map: Optional[Dict[str, str]] = {}

class MetadataItem(BaseModel):
    filename: str
    title: str
    description: str
    keywords: str
    category: str

class EmbedUploadRequest(BaseModel):
    session_id: str
    project_name: str # kept for compatibility/folder naming if needed, though session_id is primary
    metadata: List[MetadataItem]
    ftp_user: str
    ftp_pass: str
    ftp_host: str = "ftp.shutterstock.com"

# --- Helper Functions ---

def cleanup_session(session_id: str):
    """Deletes the session directory."""
    session_path = os.path.join(TEMP_DIR, session_id)
    if os.path.exists(session_path):
        try:
            shutil.rmtree(session_path)
            logger.info(f"Cleaned up session: {session_id}")
        except Exception as e:
            logger.error(f"Error cleaning up session {session_id}: {e}")

# --- Endpoints ---

@app.post("/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    """
    Accepts list of files. Creates a new session ID.
    Saves files to /app/temp/{session_id}/.
    Returns session_id and list of filenames.
    """
    session_id = str(uuid.uuid4())
    session_path = os.path.join(TEMP_DIR, session_id)
    originals_path = os.path.join(session_path, "originals")
    proxies_path = os.path.join(session_path, "proxies")
    
    os.makedirs(originals_path, exist_ok=True)
    os.makedirs(proxies_path, exist_ok=True)

    file_list = []

    for file in files:
        try:
            # 1. Save Master
            master_location = os.path.join(originals_path, file.filename)
            content = await file.read()
            with open(master_location, 'wb') as f:
                f.write(content)
            
            # 2. Generate Proxy
            try:
                # Open image from memory or file
                with Image.open(master_location) as img:
                    # Convert to RGB if necessary (e.g. for PNGs with transparency)
                    if img.mode in ('RGBA', 'P'): 
                        img = img.convert('RGB')
                        
                    # Calculate new size (max 1024px)
                    img.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
                    
                    # Save Proxy
                    proxy_filename = os.path.splitext(file.filename)[0] + ".jpg"
                    proxy_location = os.path.join(proxies_path, proxy_filename)
                    
                    img.save(proxy_location, "JPEG", quality=80)
                    
                    # Store only the filename
                    # Returning both master and proxy filenames to maintain mapping
                    file_list.append({
                        "original": file.filename,
                        "proxy": proxy_filename
                    })
            except Exception as e:
                logger.error(f"Failed to create proxy for {file.filename}: {e}")
                pass

        except Exception as e:
            logger.error(f"Failed to upload {file.filename}: {e}")

    return {"session_id": session_id, "files": file_list}

# --- Helper for Background Analysis ---
def process_analysis_job(session_id: str, api_key: str, context_map: dict, image_files: list, session_path: str):
    logger.info(f"Starting analysis job for session {session_id} with {len(image_files)} images")
    
    try:
        client = Groq(api_key=api_key)
    except Exception as e:
        logger.error(f"Failed to initialize Groq client: {e}")
        JOBS[session_id]["status"] = "failed"
        JOBS[session_id]["error"] = "Invalid API Configuration"
        return

    def process_single_image(filename):
        # Target Proxie
        filepath = os.path.join(session_path, "proxies", filename)
        if not os.path.exists(filepath):
             return {
                "filename": filename,
                "title": "Error Processing",
                "description": "Proxy file not found",
                "keywords": "",
                "category": ""
            }

        user_context = context_map.get(filename, "")
        
        system_prompt = (
            "Analyze this image for stock photography. "
            "Return PURE JSON (no markdown formatting) with keys: Title, Description, Keywords (comma separated string), Category (Choose from standard stock categories). "
            f"Additional Context provided by user: '{user_context}'. Override visual inferences if this context contradicts them."
        )

        try:
             with open(filepath, "rb") as image_file:
                encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
             
             # Retry logic
             max_retries = 3
             for attempt in range(max_retries + 1):
                 try:
                     chat_completion = client.chat.completions.create(
                        messages=[
                            {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": system_prompt},
                                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded_string}"}}
                                ]
                            }
                        ],
                        model="meta-llama/llama-4-scout-17b-16e-instruct",
                        temperature=0,
                        response_format={"type": "json_object"}
                     )

                     content = chat_completion.choices[0].message.content
                     break # Success
                 except Exception as e:
                     if "429" in str(e) and attempt < max_retries:
                         sleep_time = (2 ** attempt) + random.uniform(0, 1)
                         logger.warning(f"Rate limit hit for {filename}. Retrying in {sleep_time:.2f}s...")
                         time.sleep(sleep_time)
                         continue
                     elif attempt == max_retries:
                         logger.error(f"Max retries reached for {filename}")
                         return { "filename": filename, "title": "Error", "description": "Rate limit exceeded", "keywords": "", "category": "" }
                     else:
                         raise e

             # Cleanup json
             clean_json = content.replace("```json", "").replace("```", "").strip()
             try:
                metadata = json.loads(clean_json)
             except json.JSONDecodeError:
                return {
                     "filename": filename,
                     "title": "Error Processing",
                     "description": "Failed to parse JSON response",
                     "keywords": "",
                     "category": ""
                 }
             
             return {
                 "filename": filename,
                 "title": metadata.get("Title", ""),
                 "description": metadata.get("Description", ""),
                 "keywords": metadata.get("Keywords", ""),
                 "category": metadata.get("Category", "")
             }

        except Exception as e:
            logger.error(f"Error processing {filename}: {e}")
            return {
                "filename": filename,
                "title": "Error Processing",
                "description": str(e),
                "keywords": "",
                "category": ""
            }

    try:
        # Reduced max_workers to 3 to avoid hitting Groq rate limits too hard (though they are generous)
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            results = list(executor.map(process_single_image, image_files))
        
        JOBS[session_id]["status"] = "completed"
        JOBS[session_id]["results"] = results
        logger.info(f"Job {session_id} completed successfully")
        
    except Exception as e:
        logger.error(f"Job {session_id} failed: {e}")
        JOBS[session_id]["status"] = "failed"
        JOBS[session_id]["error"] = str(e)


@app.post("/analyze")
def analyze_images(request: AnalyzeRequest, background_tasks: BackgroundTasks):
    """
    Starts background analysis job.
    """
    session_path = os.path.join(TEMP_DIR, request.session_id)
    if not os.path.exists(session_path):
        raise HTTPException(status_code=404, detail="Session not found")

    # Get list of image files from PROXIES directory
    proxies_path = os.path.join(session_path, "proxies")
    try:
        image_files = [f for f in os.listdir(proxies_path) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    except Exception as e:
         raise HTTPException(status_code=500, detail=f"Error reading session dir: {e}")
    
    # Initialize Job
    JOBS[request.session_id] = {
        "status": "processing",
        "results": [],
        "error": None
    }
    
    # Start Background Task
    background_tasks.add_task(
        process_analysis_job, 
        request.session_id, 
        request.api_key, 
        request.context_map, 
        image_files, 
        session_path
    )

    return {"status": "processing", "message": "Analysis started in background"}


@app.get("/analyze/{session_id}")
def get_analysis_status(session_id: str):
    job = JOBS.get(session_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@app.post("/embed-and-upload")
def embed_and_upload(request: EmbedUploadRequest, background_tasks: BackgroundTasks):
    """
    1. Embed metadata via ExifTool.
    2. Upload to FTP.
    3. Trigger cleanup.
    """
    session_path = os.path.join(TEMP_DIR, request.session_id)
    if not os.path.exists(session_path):
        raise HTTPException(status_code=404, detail="Session not found")

    embed_errors = []
    
    # --- Embedding ---
    for item in request.metadata:
        # Target Master File
        image_path = os.path.join(session_path, "originals", item.filename)
        if not os.path.exists(image_path):
            continue

        cmd = [
            "exiftool",
            "-overwrite_original",
            f"-Title={item.title}",
            f"-Description={item.description}",
            f"-Keywords={item.keywords}",
            f"-Category={item.category}", 
            f"-IPTC:Caption-Abstract={item.description}",
            f"-IPTC:Keywords={item.keywords}",
            f"-XMP:Title={item.title}",
            f"-XMP:Description={item.description}",
            f"-XMP:Subject={item.keywords}",
            image_path
        ]
        
        try:
            subprocess.run(cmd, capture_output=True, text=True, check=True)
        except subprocess.CalledProcessError as e:
            embed_errors.append(f"ExifTool failed for {item.filename}: {e.stderr}")

    if embed_errors:
        logger.warning(f"Embedding errors: {embed_errors}")
        # We continue to upload what we can, or return error? 
        # Requirement says "execute embedding... return logs". We will return logs but proceed.

    # --- FTP Upload ---
    uploaded_files = []
    upload_errors = []

    try:
        ftp = FTP_TLS()
        try:
            ftp.connect(request.ftp_host)
            ftp.auth()
            ftp.prot_p()
            ftp.login(user=request.ftp_user, passwd=request.ftp_pass)
            
            for item in request.metadata:
                filename = item.filename
                # Target Master File
                file_path = os.path.join(session_path, "originals", filename)
                
                if not os.path.exists(file_path): 
                    continue

                try:
                    with open(file_path, "rb") as f:
                        ftp.storbinary(f"STOR {filename}", f)
                    uploaded_files.append(filename)
                except Exception as e:
                    upload_errors.append(f"FTP Upload failed for {filename}: {e}")
        finally:
            try:
                ftp.quit()
            except:
                ftp.close()
                    
    except Exception as e:
         return {"status": "failed", "error": f"FTP Connection failed: {str(e)}", "embed_errors": embed_errors}

    # Queue Cleanup
    background_tasks.add_task(cleanup_session, request.session_id)

    return {
        "status": "completed",
        "uploaded": uploaded_files,
        "upload_errors": upload_errors,
        "embed_errors": embed_errors
    }
