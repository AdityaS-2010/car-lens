# parser.py
# Placeholder for the listing parser that normalizes raw scraped data.
#
# Future implementation notes:
#   - Accept raw HTML or JSON scraped from a car listing page
#   - Extract key fields: make, model, year, mileage, price, VIN, etc.
#   - Return a normalized dict conforming to the schema in models/schemas.py


def parse_listing(raw_data: dict):
    """
    Normalize raw car listing data into a structured format.

    Args:
        raw_data: Arbitrary dict of fields scraped from the listing page.

    Returns:
        A normalized dict ready for the AI client.

    Note:
        Placeholder only – raises NotImplementedError until implemented.
    """
    # TODO: implement real field extraction and normalization
    raise NotImplementedError("Listing parser is not yet implemented.")
