# CarLens

A Chrome extension that gives you AI-powered verdicts on used car listings. Browse CARFAX, and CarLens automatically extracts vehicle data, reads the full CARFAX report, finds comparable listings, and delivers a clear buy/pass recommendation — right in your browser.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.10+-green?logo=python&logoColor=white)
![Gemini AI](https://img.shields.io/badge/Gemini-2.5_Flash-orange?logo=google&logoColor=white)

## What It Does

- **Instant Analysis** — One click to get a verdict (Good Deal, Fair Deal, Overpriced, Proceed with Caution, or Insufficient Data) with a confidence score
- **Quick Mode** — Opens the full CARFAX report in a background tab, extracts service history, damage records, title events, and ownership timeline, then sends it all to Gemini for analysis
- **Deep Dive Mode** — Everything in Quick mode, plus automatically searches CARFAX for comparable listings, scrapes prices from similar vehicles, and feeds them to Gemini so it can tell you if the car is competitively priced
- **Smart Extraction** — Pulls data from JSON-LD, `data-testid` attributes, and page text with multi-layer fallbacks
- **Live Progress** — Animated loading screen with progress steps showing exactly what's happening
- **Minigame** — Lane-based pixel car dodging game to play while waiting for analysis
- **Pixel Art UI** — Kenney pixel vehicle sprites for loading animations and section icons

## How It Works

```
CARFAX Listing Page
        |
        v
+-- Chrome Extension -----------------------------------------+
|  content/extract.js — Pull price, mileage, VIN, accidents,  |
|                        owners, service history from DOM      |
|  content/main.js    — Orchestrate analysis flow              |
|  content/ui.js      — Render overlay, progress, results      |
|  content/game.js    — Minigame during loading                |
+--------------------------------------------------------------+
        |                           |
        v                           v
+-- background.js (service worker, routes messages) -----------+
|  bg/report.js  — Open report tab, scroll, expand,            |
|                  extract detailed history, close tab          |
|  bg/comps.js   — Open CARFAX search, fill make/model form,   |
|                  scrape comparable listings, filter & sort    |
|  bg/utils.js   — Tab load waiting, sleep, safe tab close     |
+--------------------------------------------------------------+
        |
        v
+-- Flask Backend (app.py) ------------------------------------+
|  1. Validate & normalize listing data                        |
|  2. Build prompt from template (Quick or Deep Dive)          |
|  3. Send to Gemini 2.5 Flash                                 |
|  4. Parse JSON response (with fallback handling)             |
|  5. Return structured verdict                                |
+--------------------------------------------------------------+
        |
        v
   Verdict overlay in browser
   (strengths, risks, damage analysis,
    market comparison, ownership costs)
```

## Quick Start

### 1. Backend

From the repo root:

```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r backend/requirements.txt
```

Create a `.env` file in the `backend/` directory:

```
GEMINI_API_KEY=your_gemini_api_key_here
```

Run the server:

```bash
cd backend
python app.py
```

The backend runs at **http://localhost:5000**. Verify with:

```bash
curl http://localhost:5000/health
# -> {"service":"CarLens backend","status":"ok"}
```

### 2. Chrome Extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** -> select the `extension/` folder
4. Navigate to any CARFAX listing page — the CarLens panel appears automatically

### 3. Usage

1. Make sure the Flask backend is running
2. Go to a car listing on [carfax.com](https://www.carfax.com/cars-for-sale)
3. Choose **Quick** or **Deep Dive** mode
4. Click **Analyze This Listing**
5. Play the pixel car dodging minigame while AI analyzes your vehicle

## Project Structure

```
car-lens/
├── extension/                    # Chrome Extension (Manifest V3)
│   ├── manifest.json             # Permissions, content scripts, resources
│   ├── background.js             # Service worker — thin message router
│   ├── bg/
│   │   ├── utils.js              # Shared utilities (tab load, sleep, close)
│   │   ├── report.js             # CARFAX report extraction logic
│   │   └── comps.js              # Comparable listings search & scraping
│   ├── content/
│   │   ├── main.js               # Analysis orchestration & flow control
│   │   ├── extract.js            # DOM data extraction & backend communication
│   │   ├── ui.js                 # Overlay UI rendering & progress display
│   │   └── game.js               # Lane-based pixel car dodging minigame
│   ├── overlay.css               # Panel styling, animations, pixel art
│   └── assets/
│       ├── cars/                  # Kenney pixel vehicle sprites
│       └── props/                 # Street props (lights, signs)
│
├── backend/                      # Python Flask API
│   ├── app.py                    # /health and /analyze endpoints
│   ├── requirements.txt          # Flask, google-genai, python-dotenv
│   ├── services/
│   │   ├── ai_client.py          # Gemini API integration + response parsing
│   │   └── parser.py             # Listing data normalization
│   ├── models/
│   │   └── schemas.py            # CarListing data model + prompt formatting
│   └── prompts/
│       ├── verdict_prompt.txt          # Quick mode prompt template
│       └── verdict_detailed_prompt.txt # Deep Dive prompt template
│
└── .gitignore
```

## API

### `GET /health`

```json
{ "status": "ok", "service": "CarLens backend" }
```

### `POST /analyze`

**Request:**

`mode` is either `"brief"` (Quick mode) or `"detailed"` (Deep Dive mode). `comparable_prices` is only sent in Deep Dive mode.

```json
{
  "year": 2024,
  "make": "Toyota",
  "model": "Tacoma",
  "trim": "TRD Pro",
  "price": 45985,
  "mileage": 12000,
  "accident_status": "No accidents reported",
  "owners": 1,
  "commercial_use": false,
  "vin": "5TFCZ5AN0RX123456",
  "service_history": ["Oil change", "Tire rotation"],
  "location": "San Diego, CA",
  "value_delta": "$1,154 below CARFAX Value",
  "source_url": "https://www.carfax.com/vehicle/...",
  "damage_report": "=== DETAILED HISTORY === ...",
  "comparable_prices": {
    "tier": 1,
    "tier_label": "nearby",
    "count": 5,
    "avg": 44200,
    "min": 41000,
    "max": 48500,
    "listings": [
      {
        "title": "2023 Toyota Tacoma",
        "year": 2023,
        "price": 43500,
        "mileage": 15000,
        "url": "https://www.carfax.com/vehicle/..."
      }
    ]
  },
  "mode": "detailed"
}
```

**Response:**

```json
{
  "verdict": "Good Deal",
  "confidence": 82,
  "positives": ["Low mileage for year", "Clean title history"],
  "risks": ["Warranty may be expiring soon"],
  "car_specific_notes": ["TRD Pro holds value well"],
  "summary": "Well-maintained Tacoma with clean history...",
  "damage_analysis": "No damage or accidents reported...",
  "market_comparison": "Priced competitively — $1,785 below average of 5 comparable listings...",
  "ownership_costs": "Expected annual maintenance around $400...",
  "mode": "detailed"
}
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Extension | Chrome Manifest V3, vanilla JS, CSS |
| Backend | Python 3.10+, Flask, Flask-CORS |
| AI | Google Gemini 2.5 Flash |
| Data | CARFAX DOM scraping, JSON-LD, React form automation |
| Art | [Kenney Pixel Vehicle Pack](https://kenney.nl/assets/pixel-vehicle-pack) |

## License

MIT
