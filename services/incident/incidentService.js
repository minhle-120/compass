import { getIncidentDb } from './db.js';

const SEARCH_FIELDS = [
  'id', 'title', 'status', 'severity', 'summary', 'category', 'symptoms',
  'keywords', 'regions', 'platforms', 'services', 'impact', 'guidance',
  'workaround', 'resolution'
];

const ARRAY_FIELDS = ['platforms', 'regions', 'services', 'keywords'];

function requireText(value, fieldName) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return normalized;
}

function parseArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeArray(value) {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function mapIncident(row) {
  if (!row) return null;
  const incident = { ...row };
  for (const field of ARRAY_FIELDS) {
    incident[field] = parseArray(incident[field]);
  }
  return incident;
}

export function searchIncidents(query, { limit = 10 } = {}) {
  const normalizedQuery = requireText(query, 'query');
  const terms = [...new Set(normalizedQuery.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [])];
  if (terms.length === 0) {
    throw new TypeError('query must contain searchable letters or numbers');
  }

  const fieldMatch = SEARCH_FIELDS
    .map((field) => `instr(lower(COALESCE(${field}, '')), ?) > 0`)
    .join(' OR ');
  const where = terms.map(() => `(${fieldMatch})`).join(' AND ');
  const parameters = terms.flatMap((term) => SEARCH_FIELDS.map(() => term));
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 10, 1), 50);

  const rows = getIncidentDb().prepare(`
    SELECT * FROM incidents
    WHERE ${where}
    ORDER BY
      CASE status WHEN 'active' THEN 0 WHEN 'monitoring' THEN 1 ELSE 2 END,
      updated_at DESC,
      id ASC
    LIMIT ?
  `).all(...parameters, safeLimit);

  return { incidents: rows.map(mapIncident) };
}

export function getIncidentDetails(incidentId) {
  const normalizedId = requireText(incidentId, 'incident_id');
  const row = getIncidentDb().prepare(`
    SELECT * FROM incidents
    WHERE lower(id) = lower(?)
    LIMIT 1
  `).get(normalizedId);

  if (!row) {
    return { error: `Incident "${normalizedId}" not found`, incident: null };
  }
  return { incident: mapIncident(row) };
}

export function upsertIncident(incident) {
  if (!incident || typeof incident !== 'object') {
    throw new TypeError('incident must be an object');
  }

  const record = {
    id: requireText(incident.id, 'incident.id'),
    title: requireText(incident.title, 'incident.title'),
    status: requireText(incident.status, 'incident.status'),
    severity: requireText(incident.severity, 'incident.severity'),
    started_at: requireText(incident.started_at, 'incident.started_at'),
    updated_at: requireText(incident.updated_at, 'incident.updated_at'),
    platforms: serializeArray(incident.platforms),
    regions: serializeArray(incident.regions),
    services: serializeArray(incident.services),
    symptoms: requireText(incident.symptoms, 'incident.symptoms'),
    summary: requireText(incident.summary, 'incident.summary'),
    category: incident.category || null,
    keywords: serializeArray(incident.keywords),
    impact: incident.impact || null,
    understanding: incident.understanding || null,
    guidance: incident.guidance || null,
    workaround: incident.workaround || null,
    resolution: incident.resolution || null,
    approved_message: incident.approved_message || null
  };

  getIncidentDb().prepare(`
    INSERT INTO incidents (
      id, title, status, severity, started_at, updated_at, platforms, regions,
      services, symptoms, summary, category, keywords, impact, understanding,
      guidance, workaround, resolution, approved_message
    ) VALUES (
      @id, @title, @status, @severity, @started_at, @updated_at, @platforms,
      @regions, @services, @symptoms, @summary, @category, @keywords, @impact,
      @understanding, @guidance, @workaround, @resolution, @approved_message
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      status = excluded.status,
      severity = excluded.severity,
      updated_at = excluded.updated_at,
      platforms = excluded.platforms,
      regions = excluded.regions,
      services = excluded.services,
      symptoms = excluded.symptoms,
      summary = excluded.summary,
      category = excluded.category,
      keywords = excluded.keywords,
      impact = excluded.impact,
      understanding = excluded.understanding,
      guidance = excluded.guidance,
      workaround = excluded.workaround,
      resolution = excluded.resolution,
      approved_message = excluded.approved_message
  `).run(record);

  return getIncidentDetails(record.id).incident;
}
