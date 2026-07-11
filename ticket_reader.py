"""Read the current support ticket through a model tool call and summarize it.

Requires Python 3.9+ and an OPENAI_API_KEY environment variable. No packages needed.
"""

import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


OPENAI_URL = "https://api.openai.com/v1/responses"
HUB_URL = os.environ.get("TICKET_HUB_URL", "http://127.0.0.1:8787/api/current-ticket")
GAME_TICKET_TYPES = (
    "account", "bug", "player_report", "payment_issue", "connection_issue",
    "crash_or_freeze", "missing_item", "gameplay_issue", "cheating_or_exploit",
    "harassment_or_safety", "ban_or_appeal", "feedback",
)

READ_TICKET_TOOL = {
    "type": "function",
    "name": "read_ticket",
    "description": "Read the current ticket being processed. Returns ticket content, metadata, and status.",
    "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    "strict": True,
}


def read_ticket_from_hub():
    """Your tool implementation: fetch one current ticket from the trusted hub."""
    headers = {"Accept": "application/json"}
    token = os.environ.get("TICKET_HUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = Request(HUB_URL, headers=headers, method="GET")
    try:
        with urlopen(request, timeout=10) as response:
            if response.status != 200:
                raise RuntimeError(f"Ticket hub returned HTTP {response.status}")
            return json.load(response)
    except HTTPError as error:
        raise RuntimeError(f"Ticket hub returned HTTP {error.code}") from error
    except URLError as error:
        raise RuntimeError(f"Could not reach ticket hub at {HUB_URL}: {error.reason}") from error


def call_openai(payload):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Set OPENAI_API_KEY before running this program.")
    request = Request(
        OPENAI_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=60) as response:
            return json.load(response)
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI API returned HTTP {error.code}: {detail}") from error


def response_text(response):
    """Extract assistant text from the Responses API JSON returned over raw HTTP."""
    # SDKs expose an output_text convenience property. This program uses raw HTTP,
    # so read the equivalent message/content structure returned by the API.
    if response.get("output_text"):
        return response["output_text"]

    parts = []
    for item in response.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                parts.append(content["text"])
    return "\n".join(parts)


def summarize_current_ticket():
    ticket_types = ", ".join(GAME_TICKET_TYPES)
    first_response = call_openai({
        "model": os.environ.get("OPENAI_MODEL", "gpt-5-mini"),
        "instructions": (
            "You are a careful support-ticket triage assistant. Always call read_ticket "
            "before answering. Then provide: a short summary, ticket type, missing "
            "information, and the next three safe support actions. Do not invent facts. "
            f"Use these game ticket types when classifying: {ticket_types}."
        ),
        "input": "Please triage the current ticket.",
        "tools": [READ_TICKET_TOOL],
        "tool_choice": {"type": "function", "name": "read_ticket"},
    })

    tool_calls = [item for item in first_response.get("output", []) if item.get("type") == "function_call" and item.get("name") == "read_ticket"]
    if not tool_calls:
        raise RuntimeError("The model did not request read_ticket.")

    ticket = read_ticket_from_hub()
    tool_outputs = [{
        "type": "function_call_output",
        "call_id": call["call_id"],
        "output": json.dumps(ticket),
    } for call in tool_calls]

    final_response = call_openai({
        "model": os.environ.get("OPENAI_MODEL", "gpt-5-mini"),
        "previous_response_id": first_response["id"],
        "input": tool_outputs,
    })
    return response_text(final_response) or "No text response returned."


if __name__ == "__main__":
    try:
        print(summarize_current_ticket())
    except RuntimeError as error:
        print(f"Error: {error}")
        raise SystemExit(1)
