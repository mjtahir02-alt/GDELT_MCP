'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const handler = require('../api/mcp');
const { handleRpc, TOOLS, validateOrigin } = handler._test;

test('initialize negotiates a supported protocol and declares tools', async () => {
  const response = await handleRpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  });
  assert.equal(response.result.protocolVersion, '2025-03-26');
  assert.deepEqual(response.result.capabilities, { tools: { listChanged: false } });
});

test('tools/list exposes four read-only noauth tools', async () => {
  const response = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal(response.result.tools.length, 4);
  assert.equal(TOOLS[0].annotations.readOnlyHint, true);
  assert.equal(TOOLS[0]._meta.securitySchemes[0].type, 'noauth');
});

test('tools/call returns text and structured content', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ articles: [{ title: 'AI story' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const response = await handleRpc({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'search_articles',
      arguments: { query: 'artificial intelligence', timespan: '1d', maxRecords: 5 },
    },
  }, { fetchImpl: fakeFetch });
  assert.equal(response.result.isError, false);
  assert.deepEqual(response.result.structuredContent.data.articles, [{ title: 'AI story' }]);
  assert.match(response.result.content[0].text, /GDELT articles retrieved/);
});

test('tools/call reports invalid arguments as a tool error', async () => {
  const response = await handleRpc({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'search_articles', arguments: { query: '', maxRecords: 999 } },
  });
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /query is required/);
});

test('unknown tools return a JSON-RPC invalid-params error', async () => {
  const response = await handleRpc({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'unknown_tool', arguments: {} },
  });
  assert.equal(response.error.code, -32602);
});

test('origin validation allows official clients, localhost and server-to-server requests', () => {
  assert.equal(validateOrigin({ headers: {} }), true);
  assert.equal(validateOrigin({ headers: { origin: 'https://chatgpt.com' } }), true);
  assert.equal(validateOrigin({ headers: { origin: 'http://localhost:3000' } }), true);
  assert.equal(validateOrigin({ headers: { origin: 'https://untrusted.example' } }), false);
});

function mockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value = '') { this.body = value; },
  };
}

test('GET on the MCP endpoint returns the expected Streamable HTTP guidance', async () => {
  const req = { method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.9' } };
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 405);
  assert.match(res.body, /Use POST for MCP Streamable HTTP/);
});
