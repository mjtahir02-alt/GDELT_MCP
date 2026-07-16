'use strict';

const { buildDocUrl } = require('../lib/gdelt');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function probeDocApi(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Global fetch is unavailable.');
  const url = buildDocUrl('artlist', { query: '"artificial intelligence"', timespan: '1h', maxRecords: 1, sort: 'datedesc' });
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Accept: 'application/json, text/plain;q=0.8' },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (!response.ok) {
    const detail = text.replace(/\s+/g, ' ').slice(0, 240);
    throw new Error(`GDELT DOC API returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  try {
    JSON.parse(text);
  } catch {
    throw new Error('GDELT DOC API returned a non-JSON response.');
  }
}

async function health(req, res) {
  const response = {
    status: 'ok',
    service: 'gdelt-mcp',
    version: '1.0.0',
    mcpEndpoint: '/mcp',
    alternateMcpEndpoint: '/api/mcp',
    authentication: 'none (read-only public data)',
    timestamp: new Date().toISOString(),
  };

  if (String(req.query?.deep || '') !== '1') return send(res, 200, response);

  try {
    await probeDocApi();
    return send(res, 200, { ...response, upstream: 'reachable' });
  } catch (error) {
    return send(res, 503, {
      ...response,
      status: 'degraded',
      upstream: 'unreachable',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

module.exports = health;
module.exports._test = { probeDocApi };
