'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const health = require('../api/health');
const { probeDocApi } = health._test;

function mockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value = '') { this.body = value; },
  };
}

test('deep health probe accepts a successful JSON response', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ timeline: [] }), { status: 200 });
  await assert.doesNotReject(() => probeDocApi(fakeFetch));
});

test('deep health probe surfaces GDELT rate limiting without retrying', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    return new Response('Please limit requests to one every 5 seconds.', { status: 429 });
  };
  await assert.rejects(() => probeDocApi(fakeFetch), /HTTP 429/);
  assert.equal(calls, 1);
});

test('deep health endpoint returns a controlled degraded response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('rate limited', { status: 429 });
  try {
    const res = mockResponse();
    await health({ query: { deep: '1' } }, res);
    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'degraded');
    assert.match(body.error, /HTTP 429/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
