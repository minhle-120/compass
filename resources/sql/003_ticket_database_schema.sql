BEGIN;

CREATE TABLE IF NOT EXISTS ticket (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  ticket_type TEXT NOT NULL CHECK (
    ticket_type IN (
      'account',
      'bug',
      'player_report',
      'payment_issue',
      'connection_issue',
      'crash_or_freeze',
      'missing_item',
      'gameplay_issue',
      'cheating_or_exploit',
      'harrassment_or_safety',
      'ban_or_appeal',
      'feedback'
    )
  ),
  requester TEXT NOT NULL,
  creation_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ticket_status ON ticket(status);
CREATE INDEX IF NOT EXISTS idx_ticket_type ON ticket(ticket_type);
CREATE INDEX IF NOT EXISTS idx_ticket_creation_time ON ticket(creation_time);

COMMIT;
