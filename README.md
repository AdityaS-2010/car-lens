# CarLens

A Chrome extension that gives you AI-powered verdicts on used car listings. Browse CARFAX, and CarLens automatically extracts vehicle data, reads the full CARFAX report, and delivers a clear buy/pass recommendation — right in your browser.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.10+-green?logo=python&logoColor=white)
![Gemini AI](https://img.shields.io/badge/Gemini-2.5_Flash-orange?logo=google&logoColor=white)

## What It Does

- **Instant Analysis** — One click to get a verdict (Good Deal, Fair, Overpriced, Caution) with a confidence score
- **Quick Mode** — Evaluates based on listing data: price, mileage, accident history, ownership, and more
- **Deep Dive Mode** — Opens the full CARFAX report in a background tab, extracts detailed service history, damage records, title events, and ownership timeline, then feeds it all to Gemini for thorough analysis
- **Smart Extraction** — Pulls data from JSON-LD, `data-testid` attributes, and page text with multi-layer fallbacks
- **Live Progress** — Animated loading screen with progress steps showing exactly what's happening
- **Pixel Art UI** — Kenney pixel vehicle sprites for loading animations and section icons

## How It Works

```
CARFAX Listing Page
        │
        ▼
┌─ Chrome Extension (content.js) ─────────────────┐
│  1. Extract: price, mileage, VIN, accidents,     │
│     owners, service history from DOM              │
│  2. (Deep Dive) Send message to background.js     │
│     → Opens report tab → Scrolls & expands page   │
│     → Extracts detailed history → Closes tab       │
│  3. Send all data to Flask backend                 │
└──────────────────────────────────────────────────┘
        │
        ▼
┌─ Flask Backend (app.py) ─────────────────────────┐
│  1. Validate & normalize listing data             │
│  2. Build prompt from template + car data         │
│  3. Send to Gemini 2.5 Flash                      │
│  4. Parse JSON response (with fallback handling)   │
│  5. Return structured verdict                      │
└──────────────────────────────────────────────────┘
        │
        ▼
   Verdict overlay in browser
   (strengths, risks, damage analysis,
    market comparison, ownership costs)
```

## Quick Start

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file in the `backend/` directory:

```
GEMINI_API_KEY=your_gemini_api_key_here
```

Run the server:

```bash
python app.py
```

The backend runs at **http://localhost:5000**. Verify with:

```bash
curl http://localhost:5000/health
# → {"service":"CarLens backend","status":"ok"}
```

### 2. Chrome Extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** → select the `extension/` folder
4. Navigate to any CARFAX listing page — the CarLens panel appears automatically

### 3. Usage

1. Make sure the Flask backend is running
2. Go to a car listing on [carfax.com](https://www.carfax.com/cars-for-sale)
3. Choose **Quick** or **Deep Dive** mode
4. Click **Analyze This Listing**
5. Watch the pixel car drive while AI analyzes your vehicle

## Project Structure

```
car-lens/
├── extension/                    # Chrome Extension (Manifest V3)
│   ├── manifest.json             # Permissions, content scripts, resources
│   ├── content.js                # DOM extraction, UI overlay, analysis flow
│   ├── background.js             # Service worker — opens report tabs, extracts data
│   ├── overlay.css               # Panel styling, animations, pixel art integration
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
│   │   └── schemas.py            # CarListing data model
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
  "vin": "5TFCZ5AN0RX123456",
  "service_history": ["Oil change", "Tire rotation"],
  "damage_report": "=== DETAILED HISTORY === ...",
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
  "market_comparison": "Priced competitively for the trim...",
  "ownership_costs": "Expected annual maintenance around $400..."
}
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Extension | Chrome Manifest V3, vanilla JS, CSS |
| Backend | Python 3.10+, Flask, Flask-CORS |
| AI | Google Gemini 2.5 Flash |
| Data | CARFAX DOM scraping, JSON-LD, React hydration |
| Art | [Kenney Pixel Vehicle Pack](https://kenney.nl/assets/pixel-vehicle-pack) |

## License

MIT
