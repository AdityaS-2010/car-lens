# app.py
# Flask backend for CarLens.
# Exposes two endpoints:
#   GET  /health  – liveness probe
#   POST /analyze – receives car listing data and returns a placeholder verdict

import os

from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)

# Allow requests from any origin so the Chrome extension can reach the backend.
CORS(app)


# ── Health check ───────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    """Simple liveness probe."""
    return jsonify({"status": "ok", "service": "CarLens backend"}), 200


# ── Analyze endpoint ──────────────────────────────────────────────────────────

@app.route("/analyze", methods=["POST"])
def analyze():
    """
    Accepts a JSON payload describing a car listing and returns a
    placeholder verdict.  Real AI/valuation logic will be added later.
    """
    data = request.get_json(silent=True)

    if not data:
        return jsonify({"error": "Request body must be valid JSON."}), 400

    # TODO: pass `data` through parser.py → ai_client.py for real analysis.
    placeholder_response = {
        "verdict": "PLACEHOLDER – analysis not yet implemented",
        "received": data,
        "score": None,
        "notes": "Backend scaffold only. Integrate AI client in ai_client.py.",
    }

    return jsonify(placeholder_response), 200


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Enable debug mode only when explicitly requested via the environment.
    # Never set FLASK_DEBUG=1 in production.
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=5000, debug=debug)
