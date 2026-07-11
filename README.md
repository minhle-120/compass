# AI ticket reader

This starter lets an OpenAI model call a `read_ticket` function. The function gets the ticket from your internal hub, then the model returns a concise support-engineer summary.

## 1. Create an API key

Set your API key in PowerShell (for the current terminal only):

```powershell
$env:OPENAI_API_KEY = "your_api_key_here"
```

## 2. Create a simulated game ticket

```powershell
cd "C:\Users\ACER\Documents\New project\ticket-ai"
python ticket_creator.py
```

Enter its title, description, requester name, then select a type from the numbered list. It creates a new ID each time (`GAME-0001`, `GAME-0002`, ...), and saves all simulated tickets in `tickets.json`.

## 3. Try it with the included local ticket hub

Use two PowerShell windows.

Window 1 (leave running):

```powershell
cd "C:\Users\ACER\Documents\New project\ticket-ai"
python hub_mock.py
```

Window 2 (after creating at least one ticket):

```powershell
cd "C:\Users\ACER\Documents\New project\ticket-ai"
$env:OPENAI_API_KEY = "your_api_key_here"
python ticket_reader.py
```

To see the exact ticket data returned by the hub, without calling the AI:

```powershell
python read_ticket.py
```

## Connect your real ticket hub

Set `TICKET_HUB_URL` to an endpoint that returns one ticket as JSON. For example:

```powershell
$env:TICKET_HUB_URL = "https://your-company.example/api/current-ticket"
$env:TICKET_HUB_TOKEN = "your_hub_access_token"
```

The expected ticket response is:

```json
{
  "id": "SUP-1842",
  "title": "Cannot reset password",
  "description": "Customer says the reset email never arrives.",
  "status": "open",
  "ticket_type": "bug",
  "requester": "Avery",
  "creation_time": "2026-07-11T08:20:00+00:00"
}
```

Adapt only `read_ticket_from_hub()` in `ticket_reader.py` if your hub uses a different URL, headers, or JSON shape. Keep API keys and hub tokens in environment variables, never in source code.

## Game ticket types

Set the hub's `ticket_type` to one of these values:

| Type | Use for |
| --- | --- |
| `account` | Login, password, linked account, or profile issues |
| `bug` | A feature does not work as intended |
| `player_report` | Reporting another player |
| `payment_issue` | Purchases, refunds, billing, or currency charges |
| `connection_issue` | Lag, matchmaking, disconnects, or server access |
| `crash_or_freeze` | The game crashes, freezes, or will not launch |
| `missing_item` | Missing skins, rewards, currency, or purchased items |
| `gameplay_issue` | Stuck progress, quest, match, controls, or game mechanics |
| `cheating_or_exploit` | Cheating, hacks, exploits, or suspicious behavior |
| `harassment_or_safety` | Abuse, threats, inappropriate content, or child-safety concerns |
| `ban_or_appeal` | Ban, suspension, warning, or an appeal request |
| `feedback` | Suggestions and general feedback |

The OpenAI function-calling flow is documented in the [official guide](https://developers.openai.com/api/docs/guides/function-calling).
