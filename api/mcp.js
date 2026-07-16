'use strict';

const {
  GdeltApiError,
  getCoverageTimeline,
  getSourceCountryTimeline,
  getToneTimeline,
  searchArticles,
} = require('../lib/gdelt');

const SERVER_INFO = {
  name: 'gdelt-mcp',
  title: 'GDELT Global News Intelligence',
  version: '1.0.0',
};
const SUPPORTED_PROTOCOLS = new Set(['2025-06-18', '2025-03-26']);
const DEFAULT_PROTOCOL = '2025-06-18';
const NO_AUTH = [{ type: 'noauth' }];
const RATE_BUCKETS = new Map();

const COMMON_FILTERS = {
  query: {
    type: 'string',
    minLength: 1,
    maxLength: 500,
    description: 'GDELT search expression. Supports keywords, quoted phrases, Boolean OR blocks and advanced operators.',
  },
  timespan: {
    type: 'string',
    description: 'Relative lookback such as 15min, 6h, 7d, 1w or 3months. Do not combine with precise dates.',
  },
  startDateTime: {
    type: 'string',
    description: 'Optional ISO 8601 timestamp or YYYYMMDDHHMMSS. DOC searches are limited to GDELT\'s available rolling window.',
  },
  endDateTime: {
    type: 'string',
    description: 'Optional ISO 8601 timestamp or YYYYMMDDHHMMSS. Do not combine precise dates with timespan.',
  },
  sourceCountry: {
    type: 'string',
    maxLength: 80,
    description: 'Limit to outlets based in a source country, for example UnitedArabEmirates, France or a supported country code.',
  },
  sourceLanguage: {
    type: 'string',
    maxLength: 80,
    description: 'Limit to the article\'s original language, for example English, Arabic or Spanish.',
  },
  domain: {
    type: 'string',
    maxLength: 253,
    description: 'Limit to one exact news domain, for example reuters.com.',
  },
  theme: {
    type: 'string',
    maxLength: 100,
    description: 'Optional GDELT GKG theme, for example TERROR, ENV_CLIMATECHANGE or ECON_INFLATION.',
  },
  minTone: {
    type: 'number',
    minimum: -100,
    maximum: 100,
    description: 'Only return coverage with tone above this threshold.',
  },
  maxTone: {
    type: 'number',
    minimum: -100,
    maximum: 100,
    description: 'Only return coverage with tone below this threshold.',
  },
};

function toolDefinition(name, title, description, properties, required = ['query']) {
  return {
    name,
    title,
    description,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties,
      required,
    },
    securitySchemes: NO_AUTH,
    _meta: { securitySchemes: NO_AUTH },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  };
}

const TOOLS = [
  toolDefinition(
    'search_articles',
    'Search global news articles',
    'Search GDELT\'s multilingual global news index and return structured article results. Use source filters to compare local media narratives.',
    {
      ...COMMON_FILTERS,
      maxRecords: {
        type: 'integer',
        minimum: 1,
        maximum: 250,
        default: 25,
        description: 'Maximum articles to return. Keep this small unless broad coverage is necessary.',
      },
      sort: {
        type: 'string',
        enum: ['datedesc', 'dateasc', 'tonedesc', 'toneasc', 'hybridrel'],
        default: 'datedesc',
        description: 'Sort by publication date, tone or hybrid relevance.',
      },
    },
  ),
  toolDefinition(
    'get_coverage_timeline',
    'Track news coverage volume',
    'Return a GDELT timeline showing normalized global coverage intensity or raw matching article counts.',
    {
      ...COMMON_FILTERS,
      rawCounts: {
        type: 'boolean',
        default: false,
        description: 'When true, return raw article counts; otherwise return share of all monitored coverage.',
      },
      smooth: {
        type: 'integer',
        minimum: 0,
        maximum: 30,
        default: 0,
        description: 'Optional moving-average window in timeline steps.',
      },
    },
  ),
  toolDefinition(
    'get_tone_timeline',
    'Track news tone over time',
    'Return the average GDELT tone of matching coverage over time, from more negative to more positive framing.',
    {
      ...COMMON_FILTERS,
      smooth: {
        type: 'integer',
        minimum: 0,
        maximum: 30,
        default: 0,
        description: 'Optional moving-average window in timeline steps.',
      },
    },
  ),
  toolDefinition(
    'get_source_country_timeline',
    'Compare attention by publishing country',
    'Return a timeline breaking matching coverage down by the country where each publishing outlet is based.',
    {
      ...COMMON_FILTERS,
      smooth: {
        type: 'integer',
        minimum: 0,
        maximum: 30,
        default: 0,
        description: 'Optional moving-average window in timeline steps.',
      },
    },
  ),
];

const TOOL_HANDLERS = {
  search_articles: searchArticles,
  get_coverage_timeline: getCoverageTimeline,
  get_tone_timeline: getToneTimeline,
  get_source_country_timeline: getSourceCountryTimeline,
};

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id ?? null, error };
}

function safeJson(value) {
  return JSON.stringify(value, null, 2);
}

function toolResult(payload, summary) {
  return {
    content: [{ type: 'text', text: `${summary}\n\n${safeJson(payload)}` }],
    structuredContent: payload,
    isError: false,
  };
}

function toolFailure(error) {
  let message = error instanceof Error ? error.message : String(error);
  const details = {};
  if (error instanceof GdeltApiError) {
    if (error.status) details.status = error.status;
    if (error.details) details.details = error.details;
  }
  if (Object.keys(details).length) message += `\n${safeJson(details)}`;
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

function validateProtocolHeader(req, body) {
  if (body?.method === 'initialize') return null;
  const protocol = req.headers?.['mcp-protocol-version'];
  if (protocol && !SUPPORTED_PROTOCOLS.has(String(protocol))) {
    return `Unsupported MCP protocol version: ${protocol}`;
  }
  return null;
}

function selectedProtocol(requested) {
  if (SUPPORTED_PROTOCOLS.has(requested)) return requested;
  return DEFAULT_PROTOCOL;
}

async function handleRpc(message, dependencies = {}) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return rpcError(null, -32600, 'Invalid JSON-RPC request.');
  }

  const { id, method, params } = message;

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: selectedProtocol(params?.protocolVersion),
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: 'Use this server for media-intelligence research across global news. GDELT results are automated signals and should be corroborated for high-stakes conclusions.',
    });
  }

  if (method === 'ping') return rpcResult(id, {});
  if (method === 'tools/list') return rpcResult(id, { tools: TOOLS });

  if (method === 'tools/call') {
    const toolName = params?.name;
    const handler = TOOL_HANDLERS[toolName];
    if (!handler) return rpcError(id, -32602, `Unknown tool: ${toolName || '(missing)'}`);

    try {
      const payload = await handler(params?.arguments || {}, dependencies.fetchImpl);
      const summaries = {
        search_articles: 'GDELT articles retrieved.',
        get_coverage_timeline: 'GDELT coverage timeline retrieved.',
        get_tone_timeline: 'GDELT tone timeline retrieved.',
        get_source_country_timeline: 'GDELT source-country timeline retrieved.',
      };
      return rpcResult(id, toolResult(payload, summaries[toolName]));
    } catch (error) {
      return rpcResult(id, toolFailure(error));
    }
  }

  if (typeof method === 'string' && method.startsWith('notifications/')) return null;
  return rpcError(id, -32601, `Method not found: ${method || '(missing)'}`);
}

function allowedOrigins() {
  const configured = process.env.MCP_ALLOWED_ORIGINS;
  const values = configured
    ? configured.split(',').map((value) => value.trim()).filter(Boolean)
    : ['https://chatgpt.com', 'https://claude.ai', 'https://claude.com'];
  return new Set(values);
}

function validateOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  if (allowedOrigins().has(origin)) return true;
  try {
    const parsed = new URL(origin);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function corsHeaders(req) {
  const origin = req.headers?.origin;
  const headers = {
    'Access-Control-Allow-Headers': 'content-type, accept, mcp-protocol-version, mcp-session-id, authorization',
    'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
  };
  if (origin && validateOrigin(req)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function clientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
}

function rateLimit(req) {
  const now = Date.now();
  const windowMs = 60_000;
  const limit = Math.max(1, Math.min(300, Number(process.env.MCP_RATE_LIMIT_PER_MINUTE || 30)));
  const key = clientIp(req);
  const current = RATE_BUCKETS.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    RATE_BUCKETS.set(key, { startedAt: now, count: 1 });
    return { allowed: true, retryAfter: 0 };
  }
  current.count += 1;
  if (current.count > limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - current.startedAt)) / 1000)) };
  }
  return { allowed: true, retryAfter: 0 };
}

function sendJson(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);

  if (typeof req[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > 1_000_000) throw new Error('Request body is too large.');
      chunks.push(buffer);
    }
    const text = Buffer.concat(chunks).toString('utf8').trim();
    return text ? JSON.parse(text) : null;
  }

  return null;
}

async function handler(req, res) {
  const headers = corsHeaders(req);

  if (!validateOrigin(req)) {
    return sendJson(res, 403, rpcError(null, -32000, 'Origin not allowed.'), headers);
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    return res.end();
  }

  if (req.method === 'GET') {
    return sendJson(res, 405, rpcError(null, -32000, 'Use POST for MCP Streamable HTTP.'), {
      ...headers,
      Allow: 'POST, OPTIONS',
    });
  }

  if (req.method === 'DELETE') {
    return sendJson(res, 405, rpcError(null, -32000, 'This stateless MCP server does not manage sessions.'), {
      ...headers,
      Allow: 'POST, OPTIONS',
    });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, rpcError(null, -32000, 'Method not allowed.'), headers);
  }

  const throttled = rateLimit(req);
  if (!throttled.allowed) {
    return sendJson(res, 429, rpcError(null, -32000, 'Rate limit exceeded.'), {
      ...headers,
      'Retry-After': String(throttled.retryAfter),
    });
  }

  let body;
  try {
    body = await parseBody(req);
  } catch {
    return sendJson(res, 400, rpcError(null, -32700, 'Invalid JSON.'), headers);
  }

  const protocolError = validateProtocolHeader(req, body);
  if (protocolError) return sendJson(res, 400, rpcError(body?.id, -32602, protocolError), headers);

  const response = await handleRpc(body);
  if (response === null || body?.id === undefined || body?.id === null) {
    res.statusCode = 202;
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    return res.end();
  }
  return sendJson(res, 200, response, headers);
}

module.exports = handler;
module.exports._test = {
  SERVER_INFO,
  TOOLS,
  handleRpc,
  rateLimit,
  selectedProtocol,
  validateOrigin,
};
