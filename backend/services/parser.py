from models.schemas import CarListing


def parse_listing(raw_data: dict) -> CarListing:
    """
    Normalize raw car listing data from the extension into a CarListing.

    Handles missing fields gracefully — the extension may not always
    extract every field from the page.
    """
    return CarListing(
        year=_int_or_none(raw_data.get("year")),
        make=_str_or_none(raw_data.get("make")),
        model=_str_or_none(raw_data.get("model")),
        trim=_str_or_none(raw_data.get("trim")),
        price=_float_or_none(raw_data.get("price")),
        mileage=_float_or_none(raw_data.get("mileage")),
        accident_status=raw_data.get("accident_status", "Unknown"),
        owners=_int_or_none(raw_data.get("owners")),
        commercial_use=bool(raw_data.get("commercial_use", False)),
        vin=_str_or_none(raw_data.get("vin")),
        service_history=raw_data.get("service_history", []),
        location=_str_or_none(raw_data.get("location")),
        value_delta=_str_or_none(raw_data.get("value_delta")),
        source_url=_str_or_none(raw_data.get("source_url")),
        damage_report=_str_or_none(raw_data.get("damage_report")),
        comparable_prices=raw_data.get("comparable_prices"),
    )


def _int_or_none(val) -> int | None:
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def _float_or_none(val) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _str_or_none(val) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None
