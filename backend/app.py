import os
import traceback

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, request, jsonify
from flask_cors import CORS

from services.parser import parse_listing
from services.ai_client import get_verdict

app = Flask(__name__)
CORS(app)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "CarLens backend"}), 200


@app.route("/analyze", methods=["POST"])
def analyze():
    data = request.get_json(silent=True)

    if not data:
        return jsonify({"error": "Request body must be valid JSON."}), 400

    mode = data.pop("mode", "brief")
    if mode not in ("brief", "detailed"):
        mode = "brief"

    try:
        listing = parse_listing(data)
        result = get_verdict(listing, mode=mode)
        return jsonify(result), 200
    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "error": f"Analysis failed: {str(e)}",
            "verdict": "Error",
            "confidence": 0,
            "positives": [],
            "risks": [],
            "car_specific_notes": [],
            "summary": "The analysis could not be completed. Please try again.",
            "mode": mode,
        }), 500


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=5000, debug=debug)
