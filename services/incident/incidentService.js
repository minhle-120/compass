import { getIncidentDb } from './db.js';

const SEARCH_FIELDS = [
  'id', 'title', 'status', 'severity', 'summary', 'category', 'symptoms',
  'keywords', 'regions', 'platforms', 'services', 'impact', 'guidance',
  'workaround', 'resolution'
];

const ARRAY_FIELDS = ['platforms', 'regions', 'services', 'keywords'];

const SEVERITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'for', 'game', 'i', 'in', 'is', 'it', 'my',
  'of', 'on', 'or', 'player', 'players', 'the', 'to', 'with'
]);

const SEARCH_WEIGHTS = {
  id: 12,
  title: 6,
  keywords: 5,
  symptoms: 4,
  category: 3,
  services: 3,
  platforms: 3,
  regions: 3,
  summary: 2,
  impact: 1,
  guidance: 1,
  workaround: 1,
  resolution: 1,
  status: 1,
  severity: 1
};

function requireText(value, fieldName) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return normalized;
}

function optionalFilter(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${fieldName} must be a non-empty string when provided`);
  }
  return value.trim().toLowerCase();
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

export function listUnresolvedIncidents({ limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);
  return getIncidentDb().prepare(`
    SELECT * FROM incidents
    WHERE status IN ('active', 'monitoring')
  `).all()
    .map(mapIncident)
    .sort((a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
      || String(b.updated_at).localeCompare(String(a.updated_at))
      || a.id.localeCompare(b.id)
    )
    .slice(0, safeLimit);
}


export function searchIncidents(query, {
  limit = 10,
  platform,
  region,
  status
} = {}) {
  const normalizedQuery = requireText(query, 'query');
  const platformFilter = optionalFilter(platform, 'platform');
  const regionFilter = optionalFilter(region, 'region');
  const statusFilter = optionalFilter(status, 'status');
  const extractedTerms = [...new Set(normalizedQuery.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [])];
  if (extractedTerms.length === 0) {
    throw new TypeError('query must contain searchable letters or numbers');
  }
  const meaningfulTerms = extractedTerms.filter((term) => !STOP_WORDS.has(term));
  const terms = meaningfulTerms.length > 0 ? meaningfulTerms : extractedTerms;
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 10, 1), 50);
  const minimumMatches = Math.max(1, Math.ceil(terms.length * 0.6));

  const ranked = getIncidentDb().prepare('SELECT * FROM incidents').all()
    .map(mapIncident)
    .filter((incident) => !platformFilter
      || incident.platforms.some((value) => value.toLowerCase() === platformFilter))
    .filter((incident) => !regionFilter
      || incident.regions.some((value) => value.toLowerCase() === regionFilter))
    .filter((incident) => !statusFilter
      || String(incident.status).toLowerCase() === statusFilter)
    .map((incident) => {
      const matchedTerms = [];
      let score = 0;
      for (const term of terms) {
        let bestWeight = 0;
        for (const field of SEARCH_FIELDS) {
          const value = Array.isArray(incident[field])
            ? incident[field].join(' ')
            : String(incident[field] || '');
          if (value.toLowerCase().includes(term)) {
            bestWeight = Math.max(bestWeight, SEARCH_WEIGHTS[field] || 1);
          }
        }
        if (bestWeight > 0) {
          matchedTerms.push(term);
          score += bestWeight;
        }
      }
      return { ...incident, score, matched_terms: matchedTerms, source: 'incident_service' };
    })
    .filter((incident) => incident.matched_terms.length >= minimumMatches)
    .sort((a, b) =>
      b.score - a.score
      || statusRank(a.status) - statusRank(b.status)
      || String(b.updated_at).localeCompare(String(a.updated_at))
      || a.id.localeCompare(b.id)
    )
    .slice(0, safeLimit);

  return { incidents: ranked };
}

function statusRank(status) {
  if (status === 'active') return 0;
  if (status === 'monitoring') return 1;
  return 2;
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
