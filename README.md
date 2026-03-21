# CarLens

> A Chrome browser extension that evaluates used car listings with AI-powered insights.

## Project Structure

```
car-lens/
├── extension/               # Chrome Extension (Manifest V3)
│   ├── manifest.json        # Extension manifest
│   ├── content.js           # Injected into every page; renders badge & sends data
│   ├── background.js        # Service worker / event hub
│   └── overlay.css          # Floating badge & button styles
│
├── backend/                 # Python Flask backend
│   ├── app.py               # Entry point – Flask app with /health and /analyze
│   ├── requirements.txt     # Python dependencies
│   ├── services/
│   │   ├── ai_client.py     # (placeholder) LLM integration
│   │   └── parser.py        # (placeholder) listing normaliser
│   ├── models/
│   │   └── schemas.py       # (placeholder) data models
│   └── prompts/
│       └── verdict_prompt.txt  # (placeholder) LLM prompt template
│
├── .gitignore
└── README.md
```

---

## Quick Start

### 1 – Run the Flask backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

The backend will be available at **http://localhost:5000**.

Verify it is running:

```bash
curl http://localhost:5000/health
# → {"service":"CarLens backend","status":"ok"}
```

Send mock data:

```bash
curl -X POST http://localhost:5000/analyze \
  -H "Content-Type: application/json" \
  -d '{"make":"Toyota","model":"Camry","year":2019,"mileage":45000,"price":18500}'
```

### 2 – Load the Chrome extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `extension/` folder
4. The **CarLens Active** badge should appear in the top-right corner of any page

### 3 – Test the integration

1. Make sure the Flask backend is running (`python app.py`)
2. Open any webpage in Chrome
3. Click the **Analyze Listing** button that appears below the badge
4. Open the browser console (`F12 → Console`) to see the backend response

---

## API Reference

### `GET /health`

Returns a simple liveness response.

```json
{"status": "ok", "service": "CarLens backend"}
```

### `POST /analyze`

Accepts a JSON body with car listing fields and returns a placeholder verdict.

**Request body (example):**

```json
{
  "make": "Toyota",
  "model": "Camry",
  "year": 2019,
  "mileage": 45000,
  "price": 18500,
  "vin": "4T1BF1FK5KU123456",
  "condition": "Good",
  "source_url": "https://example.com/listing/123"
}
```

**Response (placeholder):**

```json
{
  "verdict": "PLACEHOLDER – analysis not yet implemented",
  "received": { "...": "your input echoed back" },
  "score": null,
  "notes": "Backend scaffold only. Integrate AI client in ai_client.py."
}
```

---

## Roadmap

- [ ] Implement `parser.py` – scrape & normalize real listing data from the DOM
- [ ] Implement `ai_client.py` – call an LLM with `verdict_prompt.txt`
- [ ] Define Pydantic schemas in `models/schemas.py`
- [ ] Display the AI verdict in the extension overlay instead of just the console
- [ ] Add unit tests for parser and AI client
