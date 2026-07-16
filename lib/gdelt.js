'use strict';

const DEFAULT_DOC_API = 'https://api.gdeltproject.org/api/v2/doc/doc';
const MAX_RESPONSE_BYTES = 750_000;
const CACHE_TTL_MS = 5 * 60_000;
const MIN_REQUEST_INTERVAL_MS = 5_500;
const UPSTREAM_TIMEOUT_MS = 15_000;
const USER_AGENT = 'GDELT-MCP/1.0 (+https://github.com/mjtahir02-alt/GDELT_MCP)';

const RESPONSE_CACHE = new Map();
let requestQueue = Promise.resolve();
let nextRequestAt = 0;

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

function truncateDetails(text, max = 500) {
  return String(text || '').replace(/\s+/g, ' ').slice(0, max);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function cachedValue(key) {
  const entry = RESPONSE_CACHE.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    RESPONSE_CACHE.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheValue(key, value) {
  RESPONSE_CACHE.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  if (RESPONSE_CACHE.size > 100) {
    const oldestKey = RESPONSE_CACHE.keys().next().value;
    RESPONSE_CACHE.delete(oldestKey);
  }
}

async function scheduledRequest(task) {
  const previous = requestQueue;
  let release;
  requestQueue = new Promise((resolve) => { release = resolve; });
  await previous;

  try {
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    return await task();
  } finally {
    nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
    release();
  }
}

function retryDelay(response) {
  const retryAfter = Number(response.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.max(5_500, retryAfter * 1_000);
  return 6_000;
}

async function fetchJson(url, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Global fetch is unavailable.');
  const key = String(url);
  const cached = cachedValue(key);
  if (cached !== undefined) return cached;

  const executeRequest = async () => {
    const secondCached = cachedValue(key);
    if (secondCached !== undefined) return secondCached;

    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json, text/plain;q=0.8',
            'User-Agent': USER_AGENT,
          },
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });

        const declaredLength = Number(response.headers?.get?.('content-length') || 0);
        if (declaredLength > MAX_RESPONSE_BYTES) {
          throw new GdeltApiError('GDELT response exceeded the safe size limit.', {
            status: response.status,
            url: key,
          });
        }

        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
          throw new GdeltApiError('GDELT response exceeded the safe size limit.', {
            status: response.status,
            url: key,
          });
        }

        if (!response.ok) {
          const error = new GdeltApiError(`GDELT request failed with HTTP ${response.status}.`, {
            status: response.status,
            url: key,
            details: truncateDetails(text),
          });
          if (response.status === 429 && attempt === 0) {
            lastError = error;
            await sleep(retryDelay(response));
            continue;
          }
          if (response.status >= 500 && attempt === 0) {
            lastError = error;
            await sleep(2_000);
            continue;
          }
          throw error;
        }

        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new GdeltApiError('GDELT returned a non-JSON response.', {
            status: response.status,
            url: key,
            details: truncateDetails(text),
          });
        }

        cacheValue(key, parsed);
        return parsed;
      } catch (error) {
        if (error instanceof GdeltApiError) throw error;
        lastError = error;
        if (attempt === 0) {
          await sleep(2_000);
          continue;
        }
      }
    }

    throw new GdeltApiError(`GDELT request failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`, {
      url: key,
    });
  };

  if (fetchImpl !== globalThis.fetch) return executeRequest();
  return scheduledRequest(executeRequest);
}

function resultEnvelope(data, url) {
  return {
    provider: 'GDELT Project',
    retrievedAt: new Date().toISOString(),
    requestUrl: String(url),
    cacheTtlSeconds: CACHE_TTL_MS / 1_000,
    caveat: 'GDELT measures global media coverage using automated translation and tone analysis. Treat results as media-intelligence signals, not independently verified ground truth.',
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

module.exports = {
  CACHE_TTL_MS,
  DEFAULT_DOC_API,
  GdeltApiError,
  MAX_RESPONSE_BYTES,
  MIN_REQUEST_INTERVAL_MS,
  UPSTREAM_TIMEOUT_MS,
  buildDocUrl,
  buildSearchQuery,
  fetchJson,
  getCoverageTimeline,
  getSourceCountryTimeline,
  getToneTimeline,
  normalizeDateTime,
  searchArticles,
};
