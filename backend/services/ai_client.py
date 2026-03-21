import json
import os
from pathlib import Path

import google.generativeai as genai

from models.schemas import CarListing

# Load prompt template once at module level
_PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "verdict_prompt.txt"
_PROMPT_TEMPLATE = _PROMPT_PATH.read_text(encoding="utf-8")


def get_verdict(listing: CarListing) -> dict:
    """
    Send car listing data to Gemini and return a structured verdict.

    Requires GEMINI_API_KEY environment variable.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set.")

    genai.configure(api_key=api_key)

    prompt = _PROMPT_TEMPLATE.format(**listing.to_prompt_dict())

    model = genai.GenerativeModel("gemini-2.0-flash")

    # Disable the library's internal retries so we don't burn quota
    response = model.generate_content(
        prompt,
        request_options={"retry": None},
    )
    return _parse_response(response.text)


def _parse_response(text: str) -> dict:
    """Extract the JSON object from the model's response text."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [l for l in lines[1:] if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)

    result = json.loads(cleaned)

    return {
        "verdict": str(result.get("verdict", "Unknown")),
        "confidence": int(result.get("confidence", 50)),
        "positives": list(result.get("positives", [])),
        "risks": list(result.get("risks", [])),
        "car_specific_notes": list(result.get("car_specific_notes", [])),
        "summary": str(result.get("summary", "")),
    }
