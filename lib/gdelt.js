'use strict';

const DEFAULT_DOC_API = 'https://api.gdeltproject.org/api/v2/doc/doc';
const DEFAULT_GEO_API = 'https://api.gdeltproject.org/api/v2/geo/geo';
const MAX_RESPONSE_BYTES = 750_000;
const USER_AGENT = 'GDELT-MCP/1.0 (+https://github.com/mjtahir02-alt/GDELT_MCP)';

class GdeltApiError extends Error {
  constructor(message, { status = null, url = null, details = null } = {}) {
    super(message);
    this.name = 'GdeltApiError';
    this.status = status;
    this.url = url;
    this.details = details;
  }
}

function assertObject(value, name = 'arguments') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
}

function boundedInteger(value, name, min, max, fallback) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function optionalString(value, name, maxLength = 500) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) {
    throw new TypeError(`${name} must be ${maxLength} characters or fewer.`);
  }
  return trimmed;
}

function requiredString(value, name, maxLength = 500) {
  const result = optionalString(value, name, maxLength);
  if (!result) throw new TypeError(`${name} is required.`);
  return result;
}

function quoteOperatorValue(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function normalizeDomain(value) {
  const domain = optionalString(value, 'domain', 253);
  if (!domain) return undefined;
  const normalized = domain.toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (!/^[a-z0-9.-]+$/.test(normalized) || !normalized.includes('.')) {
    throw new TypeError('domain must be a valid hostname such as example.com.');
  }
  return normalized;
}

function normalizeDateTime(value, name) {
  const input = optionalString(value, name, 40);
  if (!input) return undefined;

  if (/^\d{14}$/.test(input)) return input;

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${name} must be ISO 8601 or YYYYMMDDHHMMSS.`);
  }

  const pad = (number) => String(number).padStart(2, '0');
  return [
    parsed.getUTCFullYear(),
    pad(parsed.getUTCMonth() + 1),
    pad(parsed.getUTCDate()),
    pad(parsed.getUTCHours()),
    pad(parsed.getUTCMinutes()),
    pad(parsed.getUTCSeconds()),
  ].join('');
}

function normalizeDocTimespan(value) {
  const timespan = optionalString(value, 'timespan', 24);
  if (!timespan) return undefined;
  if (!/^\d+(min|h|hours|d|days|w|weeks|m|months)$/i.test(timespan)) {
    throw new TypeError('timespan must look like 15min, 6h, 7d, 1w or 3months.');
  }
  return timespan.toLowerCase();
}

function normalizeGeoTimespan(value) {
  const timespan = optionalString(value, 'timespan', 16) || '24h';
  if (/^\d+$/.test(timespan)) {
    const minutes = Number(timespan);
    if (minutes < 15 || minutes > 1440) {
      throw new TypeError('A numeric GEO timespan must be between 15 and 1440 minutes.');
    }
    return timespan;
  }
  if (!/^(?:\d+h|[1-7]d|1w)$/i.test(timespan)) {
    throw new TypeError('GEO timespan must be 15-1440 minutes, hours (for example 6h), up to 7d, or 1w.');
  }
  return timespan.toLowerCase();
}

function buildSearchQuery(args) {
  assertObject(args);
  const parts = [requiredString(args.query, 'query', 500)];

  const sourceCountry = optionalString(args.sourceCountry, 'sourceCountry', 80);
  if (sourceCountry) parts.push(`sourcecountry:${sourceCountry.replaceAll(' ', '')}`);

  const sourceLanguage = optionalString(args.sourceLanguage, 'sourceLanguage', 80);
  if (sourceLanguage) parts.push(`sourcelang:${sourceLanguage.replaceAll(' ', '')}`);

  const domain = normalizeDomain(args.domain);
  if (domain) parts.push(`domainis:${domain}`);

  const theme = optionalString(args.theme, 'theme', 100);
  if (theme) parts.push(`theme:${theme.replaceAll(' ', '_')}`);

  if (args.minTone !== undefined) {
    if (typeof args.minTone !== 'number' || !Number.isFinite(args.minTone) || args.minTone < -100 || args.minTone > 100) {
      throw new TypeError('minTone must be a number between -100 and 100.');
    }
    parts.push(`tone>${args.minTone}`);
  }

  if (args.maxTone !== undefined) {
    if (typeof args.maxTone !== 'number' || !Number.isFinite(args.maxTone) || args.maxTone < -100 || args.maxTone > 100) {
      throw new TypeError('maxTone must be a number between -100 and 100.');
    }
    parts.push(`tone<${args.maxTone}`);
  }

  if (args.minTone !== undefined && args.maxTone !== undefined && args.minTone > args.maxTone) {
    throw new TypeError('minTone cannot be greater than maxTone.');
  }

  return parts.join(' ');
}

function applyDocTime(url, args) {
  const timespan = normalizeDocTimespan(args.timespan);
  const start = normalizeDateTime(args.startDateTime, 'startDateTime');
  const end = normalizeDateTime(args.endDateTime, 'endDateTime');

  if (timespan && (start || end)) {
    throw new TypeError('Use timespan or startDateTime/endDateTime, not both.');
  }
  if (start && end && start > end) {
    throw new TypeError('startDateTime must be before endDateTime.');
  }

  if (timespan) url.searchParams.set('timespan', timespan);
  if (start) url.searchParams.set('startdatetime', start);
  if (end) url.searchParams.set('enddatetime', end);
}

function buildDocUrl(mode, args) {
  assertObject(args);
  const base = process.env.GDELT_DOC_API_BASE || DEFAULT_DOC_API;
  const url = new URL(base);
  url.searchParams.set('query', buildSearchQuery(args));
  url.searchParams.set('mode', mode);
  url.searchParams.set('format', 'json');
  applyDocTime(url, args);

  if (mode === 'artlist') {
    const maxRecords = boundedInteger(args.maxRecords, 'maxRecords', 1, 250, 25);
    url.searchParams.set('maxrecords', String(maxRecords));
    const allowedSorts = new Set(['datedesc', 'dateasc', 'tonedesc', 'toneasc', 'hybridrel']);
    const sort = optionalString(args.sort, 'sort', 20) || 'datedesc';
    if (!allowedSorts.has(sort.toLowerCase())) {
      throw new TypeError('sort must be datedesc, dateasc, tonedesc, toneasc or hybridrel.');
    }
    url.searchParams.set('sort', sort.toLowerCase());
  }

  if (mode.startsWith('timeline')) {
    const smooth = boundedInteger(args.smooth, 'smooth', 0, 30, 0);
    if (smooth > 0) url.searchParams.set('timelinesmooth', String(smooth));
  }

  return url;
}

function buildGeoUrl(args) {
  assertObject(args);
  const base = process.env.GDELT_GEO_API_BASE || DEFAULT_GEO_API;
  const url = new URL(base);
  url.searchParams.set('query', buildSearchQuery(args));
  url.searchParams.set('mode', 'pointdata');
  url.searchParams.set('format', 'geojson');
  url.searchParams.set('timespan', normalizeGeoTimespan(args.timespan));
  url.searchParams.set('maxpoints', String(boundedInteger(args.maxPoints, 'maxPoints', 1, 1000, 100)));
  url.searchParams.set('geores', String(boundedInteger(args.geoResolution, 'geoResolution', 0, 2, 1)));

  const allowedSorts = new Set(['date', 'tonedesc', 'toneasc']);
  const sortBy = optionalString(args.sortBy, 'sortBy', 20) || 'date';
  if (!allowedSorts.has(sortBy.toLowerCase())) {
    throw new TypeError('sortBy must be date, tonedesc or toneasc.');
  }
  url.searchParams.set('sortby', sortBy.toLowerCase());
  return url;
}

function truncateDetails(text, max = 500) {
  return String(text || '').replace(/\s+/g, ' ').slice(0, max);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Global fetch is unavailable.');
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json, application/geo+json, text/plain;q=0.8',
          'User-Agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(25_000),
      });

      const declaredLength = Number(response.headers?.get?.('content-length') || 0);
      if (declaredLength > MAX_RESPONSE_BYTES) {
        throw new GdeltApiError('GDELT response exceeded the safe size limit.', {
          status: response.status,
          url: String(url),
        });
      }

      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new GdeltApiError('GDELT response exceeded the safe size limit.', {
          status: response.status,
          url: String(url),
        });
      }

      if (!response.ok) {
        const error = new GdeltApiError(`GDELT request failed with HTTP ${response.status}.`, {
          status: response.status,
          url: String(url),
          details: truncateDetails(text),
        });
        if ((response.status === 429 || response.status >= 500) && attempt === 0) {
          lastError = error;
          await sleep(600);
          continue;
        }
        throw error;
      }

      try {
        return JSON.parse(text);
      } catch {
        throw new GdeltApiError('GDELT returned a non-JSON response.', {
          status: response.status,
          url: String(url),
          details: truncateDetails(text),
        });
      }
    } catch (error) {
      if (error instanceof GdeltApiError) throw error;
      lastError = error;
      if (attempt === 0) {
        await sleep(600);
        continue;
      }
    }
  }

  throw new GdeltApiError(`GDELT request failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`, {
    url: String(url),
  });
}

function resultEnvelope(data, url) {
  return {
    provider: 'GDELT Project',
    retrievedAt: new Date().toISOString(),
    requestUrl: String(url),
    caveat: 'GDELT measures global media coverage using automated translation, tone analysis and geocoding. Treat results as media-intelligence signals, not independently verified ground truth.',
    data,
  };
}

async function searchArticles(args, fetchImpl) {
  const url = buildDocUrl('artlist', args);
  return resultEnvelope(await fetchJson(url, fetchImpl), url);
}

async function getCoverageTimeline(args, fetchImpl) {
  assertObject(args);
  const mode = args.rawCounts === true ? 'timelinevolraw' : 'timelinevol';
  const url = buildDocUrl(mode, args);
  return resultEnvelope(await fetchJson(url, fetchImpl), url);
}

async function getToneTimeline(args, fetchImpl) {
  const url = buildDocUrl('timelinetone', args);
  return resultEnvelope(await fetchJson(url, fetchImpl), url);
}

async function getSourceCountryTimeline(args, fetchImpl) {
  const url = buildDocUrl('timelinesourcecountry', args);
  return resultEnvelope(await fetchJson(url, fetchImpl), url);
}

async function mapNewsLocations(args, fetchImpl) {
  const url = buildGeoUrl(args);
  return resultEnvelope(await fetchJson(url, fetchImpl), url);
}

module.exports = {
  DEFAULT_DOC_API,
  DEFAULT_GEO_API,
  GdeltApiError,
  MAX_RESPONSE_BYTES,
  buildDocUrl,
  buildGeoUrl,
  buildSearchQuery,
  fetchJson,
  getCoverageTimeline,
  getSourceCountryTimeline,
  getToneTimeline,
  mapNewsLocations,
  normalizeDateTime,
  searchArticles,
};
