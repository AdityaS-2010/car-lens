# ai_client.py
# Placeholder for the AI / LLM client that will evaluate car listings.
#
# Future implementation notes:
#   - Load the prompt template from prompts/verdict_prompt.txt
#   - Format the prompt with structured car data
#   - Call the chosen LLM API (OpenAI, Anthropic, etc.)
#   - Parse and return a structured verdict


def get_verdict(car_data: dict):
    """
    Send car listing data to an AI model and return a structured verdict.

    Args:
        car_data: Parsed car listing information (see models/schemas.py).

    Returns:
        A dict containing the AI-generated verdict and confidence score.

    Note:
        Placeholder only – raises NotImplementedError until implemented.
    """
    # TODO: implement real LLM call
    raise NotImplementedError("AI client is not yet implemented.")
