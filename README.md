# ShutterStacker V2 VPS

A powerful "Local SaaS" application for automating stock photography processing. It leverages **Google Gemini** for intelligent metadata generation and **ExifTool** for standard-compliant metadata embedding, all wrapped in a modern **React** interface and deployable via **Docker**.

## 🚀 Features

*   **Drag & Drop Batch Upload**: Easily upload multiple images for processing.
*   **Context-Aware AI Analysis**: Uses **Google Gemini 2.0 Flash** to generate Titles, Descriptions, Keywords, and Categories. You can provide optional context hints (e.g., "Aerial shot of downtown") to guide the AI.
*   **Interactive Review**: Review and edit the generated metadata before finalizing.
*   **Embedded Metadata**: Writes metadata directly into the image header (IPTC/XMP standards) using ExifTool, ensuring compatibility with all stock agencies.
*   **Auto-FTP**: Automatically uploads processed files to Shutterstock (or other FTP-enabled agencies) in the background.
*   **Browser-Based Storage**: API keys and FTP credentials are stored securely in your browser's local storage—no complex backend config required.

## 🛠️ Tech Stack

*   **Frontend**: React, Vite, Tailwind CSS, Lucide React
*   **Backend**: Python, FastAPI
*   **Tools**: Google Gemini API, ExifTool, ftplib
*   **Deployment**: Docker, Docker Compose, Nginx

## 📦 Setup & Installation

### Prerequisites
*   [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.
*   A **Google Gemini API Key** (Get it from [Google AI Studio](https://aistudio.google.com/)).
*   FTP Credentials for your stock agency (e.g., Shutterstock).

### Running the App

1.  **Clone the repository**:
    ```bash
    git clone <repository_url>
    cd "ShutterStacker V2"
    ```

2.  **Start with Docker Compose**:
    ```bash
    docker-compose up --build
    ```

3.  **Access the Application**:
    Open your browser and navigate to:
    > **http://localhost:3000**

## ⚙️ Configuration

No `.env` files are strictly required for the initial startup. All user-specific credentials are configured directly in the UI:

1.  Click the **Settings** (gear icon) in the top right corner.
2.  Enter your **Gemini API Key**.
3.  Enter your **FTP Username** and **Password**.
4.  Click **Save Credentials**.

## 🏗️ Architecture

-   **Frontend Service**: Serves the React SPA via Nginx on port `3000`.
-   **Backend Service**: Runs FastAPI on port `8000`. Handles file uploads, communicates with Gemini, executes ExifTool commands, and manages FTP uploads.
-   **Shared Volume**: A `temp_data` Docker volume is shared between services to allow the frontend to display uploaded images while the backend processes them.

## 📝 License

[MIT](LICENSE)
