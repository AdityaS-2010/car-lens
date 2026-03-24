import json
import re
import os
from pathlib import Path

from google import genai

from models.schemas import CarListing

# Load prompt templates once at module level
_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
_BRIEF_TEMPLATE = (_PROMPTS_DIR / "verdict_prompt.txt").read_text(encoding="utf-8")
_DETAILED_TEMPLATE = (_PROMPTS_DIR / "verdict_detailed_prompt.txt").read_text(encoding="utf-8")


def get_verdict(listing: CarListing, mode: str = "brief") -> dict:
    """
    Send car listing data to Gemini and return a structured verdict.

    mode: "brief" for quick overview, "detailed" for in-depth analysis.
    Requires GEMINI_API_KEY environment variable.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set.")

    client = genai.Client(api_key=api_key)

    template = _DETAILED_TEMPLATE if mode == "detailed" else _BRIEF_TEMPLATE
    prompt = template.format(**listing.to_prompt_dict())

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
    )
    return _parse_response(response.text, mode)


def _parse_response(text: str, mode: str = "brief") -> dict:
    """Extract the JSON object from the model's response text."""
    cleaned = text.strip()

    # Strip markdown code fences
    cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
    cleaned = re.sub(r"\n?```\s*$", "", cleaned)
    cleaned = cleaned.strip()

    # Find the JSON object boundaries if there's extra text around it
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        cleaned = cleaned[start:end + 1]

    # Try parsing directly first
    try:
        result = json.loads(cleaned)
    except json.JSONDecodeError:
        # Gemini sometimes puts unescaped newlines or quotes inside strings.
        # Try to fix common issues: replace literal newlines inside strings,
        # remove trailing commas before } or ]
        fixed = re.sub(r",\s*([}\]])", r"\1", cleaned)  # trailing commas
        try:
            result = json.loads(fixed)
        except json.JSONDecodeError:
            # Last resort: ask for just the fields we need
            print(f"[CarLens] Failed to parse Gemini response, raw text:\n{text[:500]}")
            result = {
                "verdict": "Error",
                "confidence": 0,
                "summary": "The AI returned a malformed response. Please try again.",
            }

    parsed = {
        "verdict": str(result.get("verdict", "Unknown")),
        "confidence": int(result.get("confidence", 50)),
        "positives": list(result.get("positives", [])),
        "risks": list(result.get("risks", [])),
        "car_specific_notes": list(result.get("car_specific_notes", [])),
        "summary": str(result.get("summary", "")),
        "mode": mode,
    }

    if mode == "detailed":
        parsed["damage_analysis"] = str(result.get("damage_analysis", ""))
        parsed["ownership_costs"] = str(result.get("ownership_costs", ""))
        parsed["market_comparison"] = str(result.get("market_comparison", ""))

    return parsed
