'use strict';

const { buildDocUrl, fetchJson } = require('../lib/gdelt');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = async function health(req, res) {
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
    const url = buildDocUrl('timelinevolraw', { query: 'GDELT', timespan: '1h' });
    await fetchJson(url);
    return send(res, 200, { ...response, upstream: 'reachable' });
  } catch (error) {
    return send(res, 503, {
      ...response,
      status: 'degraded',
      upstream: 'unreachable',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
