BEGIN;

CREATE TABLE IF NOT EXISTS incident (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  keywords TEXT,
  region TEXT,
  platform TEXT
);

CREATE INDEX IF NOT EXISTS idx_incident_category ON incident(category);
CREATE INDEX IF NOT EXISTS idx_incident_severity ON incident(severity);
CREATE INDEX IF NOT EXISTS idx_incident_region ON incident(region);
CREATE INDEX IF NOT EXISTS idx_incident_platform ON incident(platform);

COMMIT;
