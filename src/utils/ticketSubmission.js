export function normalizeTicketSubmission(input, { createId = defaultTicketId } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Ticket submission must be a JSON object.');
  }

  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';

  if (!subject) {
    throw new TypeError('A valid string Ticket Subject is required.');
  }
  if (!description) {
    throw new TypeError('A valid string Ticket Description is required.');
  }

  return {
    id: createId(),
    subject,
    description,
    attachments: normalizeAttachments(input.attachments),
    status: 'pending'
  };
}

const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime'
]);
const ALLOWED_FRAME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_FRAME_BYTES = 1024 * 1024;

export function normalizeAttachments(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError('Attachments must be an array.');
  if (value.length > MAX_ATTACHMENTS) {
    throw new TypeError(`A maximum of ${MAX_ATTACHMENTS} image or video attachments is allowed.`);
  }

  let totalBytes = 0;
  return value.map((attachment, index) => {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
      throw new TypeError(`Attachment ${index + 1} is invalid.`);
    }

    const name = normalizeFilename(attachment.name, index);
    const parsed = parseDataUrl(attachment.dataUrl, ALLOWED_MEDIA_TYPES, `Attachment "${name}"`);
    if (parsed.bytes > MAX_ATTACHMENT_BYTES) {
      throw new TypeError(`Attachment "${name}" exceeds the 8 MB file limit.`);
    }
    totalBytes += parsed.bytes;

    const frames = parsed.type.startsWith('video/')
      ? normalizeVideoFrames(attachment.frames, name)
      : [];
    totalBytes += frames.reduce((sum, frame) => sum + frame.bytes, 0);
    if (parsed.type.startsWith('video/') && frames.length === 0) {
      throw new TypeError(`Video "${name}" must include preview frames for AI analysis.`);
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new TypeError('Attachments and video previews exceed the 20 MB total limit.');
    }

    return {
      name,
      type: parsed.type,
      size: parsed.bytes,
      dataUrl: attachment.dataUrl,
      ...(frames.length ? {
        frames: frames.map(({ timestamp, dataUrl }) => ({ timestamp, dataUrl }))
      } : {})
    };
  });
}

function normalizeVideoFrames(value, filename) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).map((frame, index) => {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
      throw new TypeError(`Preview frame ${index + 1} for "${filename}" is invalid.`);
    }
    const parsed = parseDataUrl(
      frame.dataUrl,
      ALLOWED_FRAME_TYPES,
      `Preview frame ${index + 1} for "${filename}"`
    );
    if (parsed.bytes > MAX_FRAME_BYTES) {
      throw new TypeError(`Preview frame ${index + 1} for "${filename}" exceeds 1 MB.`);
    }
    const timestamp = Number(frame.timestamp);
    return {
      timestamp: Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : 0,
      dataUrl: frame.dataUrl,
      bytes: parsed.bytes
    };
  });
}

function parseDataUrl(value, allowedTypes, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} has no media data.`);
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new TypeError(`${label} must be a base64-encoded media file.`);
  const type = match[1].toLowerCase();
  if (!allowedTypes.has(type)) throw new TypeError(`${label} uses unsupported type "${type}".`);
  const bytes = Buffer.from(match[2], 'base64').length;
  if (!bytes) throw new TypeError(`${label} is empty.`);
  return { type, bytes };
}

function normalizeFilename(value, index) {
  const name = typeof value === 'string' ? value.trim().split(/[\\/]/).pop() : '';
  if (!name) return `attachment-${index + 1}`;
  return name.slice(0, 120);
}

function defaultTicketId() {
  return `T-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}
