"""Local ticket-hub simulator. It returns the newest ticket from tickets.json."""

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path


TICKETS_FILE = Path(__file__).with_name("tickets.json")


def read_current_ticket():
    if not TICKETS_FILE.exists():
        return None
    tickets = json.loads(TICKETS_FILE.read_text(encoding="utf-8"))
    return tickets[-1] if tickets else None


class TicketHubHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/api/current-ticket":
            self.send_error(404, "Use /api/current-ticket")
            return

        ticket = read_current_ticket()
        if ticket is None:
            self.send_error(404, "No tickets yet. Run ticket_creator.py first.")
            return

        payload = json.dumps(ticket).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    print("Ticket hub running at http://127.0.0.1:8787/api/current-ticket")
    print("Create a ticket in another terminal with: python ticket_creator.py")
    HTTPServer(("127.0.0.1", 8787), TicketHubHandler).serve_forever()
