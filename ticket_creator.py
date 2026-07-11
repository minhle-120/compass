"""Interactive local game-ticket creator for the ticket reader demo."""

import json
from datetime import datetime, timezone
from pathlib import Path


TICKETS_FILE = Path(__file__).with_name("tickets.json")
TICKET_TYPES = (
    "account", "bug", "player_report", "payment_issue", "connection_issue",
    "crash_or_freeze", "missing_item", "gameplay_issue", "cheating_or_exploit",
    "harassment_or_safety", "ban_or_appeal", "feedback",
)


def load_tickets():
    if not TICKETS_FILE.exists():
        return []
    return json.loads(TICKETS_FILE.read_text(encoding="utf-8"))


def next_ticket_id(tickets):
    numbers = []
    for ticket in tickets:
        ticket_id = ticket.get("id", "")
        if ticket_id.startswith("GAME-") and ticket_id[5:].isdigit():
            numbers.append(int(ticket_id[5:]))
    return f"GAME-{max(numbers, default=0) + 1:04d}"


def choose_ticket_type():
    print("\nChoose a ticket type:")
    for number, ticket_type in enumerate(TICKET_TYPES, start=1):
        print(f"  {number}. {ticket_type}")
    while True:
        choice = input("Type number: ").strip()
        if choice.isdigit() and 1 <= int(choice) <= len(TICKET_TYPES):
            return TICKET_TYPES[int(choice) - 1]
        print(f"Please enter a number from 1 to {len(TICKET_TYPES)}.")


def required_input(label):
    while True:
        value = input(label).strip()
        if value:
            return value
        print("This field cannot be empty.")


def create_ticket():
    tickets = load_tickets()
    print("=== Create game ticket ===")
    ticket = {
        "id": next_ticket_id(tickets),
        "title": required_input("Title: "),
        "description": required_input("Description: "),
        "requester": required_input("Requester name: "),
        "ticket_type": choose_ticket_type(),
        "status": "open",
        "creation_time": datetime.now(timezone.utc).isoformat(),
    }
    tickets.append(ticket)
    TICKETS_FILE.write_text(json.dumps(tickets, indent=2), encoding="utf-8")
    print(f"\nCreated {ticket['id']} ({ticket['ticket_type']}).")
    print("It is now the current ticket read by ticket_reader.py.")


if __name__ == "__main__":
    create_ticket()
