from dataclasses import dataclass, field
from typing import Optional


@dataclass
class CarListing:
    """Normalized car listing data extracted from the page."""

    year: Optional[int] = None
    make: Optional[str] = None
    model: Optional[str] = None
    trim: Optional[str] = None
    price: Optional[float] = None
    mileage: Optional[float] = None
    accident_status: str = "Unknown"
    owners: Optional[int] = None
    commercial_use: bool = False
    vin: Optional[str] = None
    service_history: list[str] = field(default_factory=list)
    location: Optional[str] = None
    value_delta: Optional[str] = None
    source_url: Optional[str] = None

    def to_prompt_dict(self) -> dict:
        """Return a dict formatted for the AI prompt template."""
        return {
            "year": self.year or "Unknown",
            "make": self.make or "Unknown",
            "model": self.model or "Unknown",
            "trim": self.trim or "N/A",
            "price": f"${self.price:,.0f}" if self.price else "Unknown",
            "mileage": f"{self.mileage:,.0f}" if self.mileage else "Unknown",
            "accident_status": self.accident_status,
            "owners": self.owners if self.owners else "Unknown",
            "commercial_use": "Yes" if self.commercial_use else "No",
            "vin": self.vin or "N/A",
            "service_history": "\n".join(f"  - {s}" for s in self.service_history) if self.service_history else "None available",
            "location": self.location or "Unknown",
            "value_delta": self.value_delta or "N/A",
        }


@dataclass
class AnalysisResponse:
    """Structured response returned by the /analyze endpoint."""

    verdict: str
    confidence: int
    positives: list[str] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)
    car_specific_notes: list[str] = field(default_factory=list)
    summary: str = ""
