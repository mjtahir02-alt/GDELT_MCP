'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDocUrl,
  buildSearchQuery,
  fetchJson,
  normalizeDateTime,
  searchArticles,
  UPSTREAM_TIMEOUT_MS,
} = require('../lib/gdelt');

test('upstream attempts use a bounded 15-second timeout', () => {
  assert.equal(UPSTREAM_TIMEOUT_MS, 15_000);
});

test('normalizeDateTime converts ISO timestamps to GDELT format', () => {
  assert.equal(normalizeDateTime('2026-07-16T08:30:45Z', 'startDateTime'), '20260716083045');
  assert.equal(normalizeDateTime('20260716083045', 'startDateTime'), '20260716083045');
});

test('buildSearchQuery combines structured GDELT filters', () => {
  assert.equal(
    buildSearchQuery({
      query: 'artificial intelligence',
      sourceCountry: 'United Arab Emirates',
      sourceLanguage: 'Arabic',
      domain: 'https://example.com/news',
      theme: 'ECON INFLATION',
      minTone: -5,
      maxTone: 10,
    }),
    'artificial intelligence sourcecountry:UnitedArabEmirates sourcelang:Arabic domainis:example.com theme:ECON_INFLATION tone>-5 tone<10',
  );
});

test('buildDocUrl creates a bounded article-list request', () => {
  const url = buildDocUrl('artlist', {
    query: 'semiconductors',
    timespan: '7d',
    maxRecords: 50,
    sort: 'hybridrel',
  });
  assert.equal(url.hostname, 'api.gdeltproject.org');
  assert.equal(url.searchParams.get('mode'), 'artlist');
  assert.equal(url.searchParams.get('format'), 'json');
  assert.equal(url.searchParams.get('timespan'), '7d');
  assert.equal(url.searchParams.get('maxrecords'), '50');
  assert.equal(url.searchParams.get('sort'), 'hybridrel');
});

test('buildDocUrl rejects ambiguous relative and precise time ranges', () => {
  assert.throws(
    () => buildDocUrl('artlist', {
      query: 'energy',
      timespan: '1d',
      startDateTime: '2026-07-15T00:00:00Z',
    }),
    /timespan or startDateTime\/endDateTime/,
  );
});

test('fetchJson parses successful GDELT responses', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ articles: [{ title: 'Example' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  assert.deepEqual(await fetchJson(new URL('https://example.test/query'), fakeFetch), {
    articles: [{ title: 'Example' }],
  });
});

test('searchArticles returns source metadata and structured data', async () => {
  const fakeFetch = async (url) => new Response(JSON.stringify({ articles: [], requested: String(url) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const result = await searchArticles({ query: 'G42', timespan: '24h' }, fakeFetch);
  assert.equal(result.provider, 'GDELT Project');
  assert.match(result.requestUrl, /mode=artlist/);
  assert.deepEqual(result.data.articles, []);
});
