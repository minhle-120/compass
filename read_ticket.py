"""Show exactly what the local ticket hub returns for the current ticket."""

from ticket_reader import read_ticket_from_hub


if __name__ == "__main__":
    try:
        ticket = read_ticket_from_hub()
        print("=== read_ticket() returned ===")
        for field, value in ticket.items():
            print(f"{field}: {value}")
    except RuntimeError as error:
        print(f"Error: {error}")
        raise SystemExit(1)
