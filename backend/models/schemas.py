# schemas.py
# Placeholder data models / schemas for CarLens.
#
# Future implementation notes:
#   - Define Pydantic models (or dataclasses) for:
#       CarListing       – normalized listing fields
#       AnalysisRequest  – payload accepted by POST /analyze
#       AnalysisResponse – payload returned by POST /analyze
#   - Add field validation, defaults, and documentation strings


# Example skeleton (not yet enforced):
#
# class CarListing:
#     make: str
#     model: str
#     year: int
#     mileage: int
#     price: float
#     vin: str | None = None
#     condition: str | None = None
#     source_url: str | None = None
#
# class AnalysisResponse:
#     verdict: str        # e.g. "GOOD_DEAL" | "FAIR" | "OVERPRICED"
#     score: float | None # 0.0 – 1.0
#     notes: str | None

# TODO: replace the above skeleton with real Pydantic models.
