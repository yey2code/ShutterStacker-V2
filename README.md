# ShutterStacker V2

A Local SaaS application for automating stock photography processing with Google Gemini and Exiftool.

## Setup

1.  **Map your Pictures folder**:
    Open `docker-compose.yml` and find the `backend` service volumes.
    Change `C:/Users/YourName/Pictures` to the actual path of your stock photos on your machine.
    ```yaml
    volumes:
      - C:/Users/ActualUser/Pictures:/mnt/pictures
    ```

2.  **Build and Run**:
    ```bash
    docker-compose up --build
    ```

3.  **Access the App**:
    Open your browser to `http://localhost:3000`.

## Features

- **Local File Access**: Browse your mapped local folders.
- **AI Analysis**: Uses Google Gemini 1.5 Flash to generate metadata.
- **Metadata Embedding**: Writes Title, Description, and Keywords directly into image files (IPTC/XMP).
- **FTP Upload**: Uploads processed images directly to Shutterstock.

## Configuration

- **Gemini API Key**: You will need a valid API key from Google AI Studio.
- **FTP Credentials**: Your Shutterstock contributor FTP details.
