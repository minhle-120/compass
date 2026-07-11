CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  severity TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  platforms TEXT NOT NULL DEFAULT '[]',
  regions TEXT NOT NULL DEFAULT '[]',
  services TEXT NOT NULL DEFAULT '[]',
  symptoms TEXT NOT NULL,
  summary TEXT NOT NULL,
  category TEXT,
  keywords TEXT NOT NULL DEFAULT '[]',
  impact TEXT,
  understanding TEXT,
  guidance TEXT,
  workaround TEXT,
  resolution TEXT,
  approved_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_updated_at ON incidents(updated_at);
