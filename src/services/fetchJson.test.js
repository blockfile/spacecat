'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { fetchJson } = require('./fetchJson');

const okResponse = (data) => ({ ok: true, json: async () => data });

test('passes method and body through to fetch (for JSON-RPC POSTs)', async () => {
  let seen;
  const fetchFn = async (url, init) => {
    seen = { url, init };
    return okResponse({ result: '0x1' });
  };
  const out = await fetchJson('https://rpc.example', {
    method: 'POST',
    body: '{"jsonrpc":"2.0"}',
    headers: { 'content-type': 'application/json' },
    fetchFn,
  });
  assert.deepStrictEqual(out, { result: '0x1' });
  assert.strictEqual(seen.init.method, 'POST');
  assert.strictEqual(seen.init.body, '{"jsonrpc":"2.0"}');
  assert.strictEqual(seen.init.headers['content-type'], 'application/json');
});

test('a plain GET still works with no method/body given', async () => {
  const fetchFn = async () => okResponse({ ok: 1 });
  assert.deepStrictEqual(await fetchJson('https://x', { fetchFn }), { ok: 1 });
});

test('retries a transient failure and then succeeds', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 503 };
    return okResponse({ ok: 1 });
  };
  const out = await fetchJson('https://x', { fetchFn, sleepFn: async () => {} });
  assert.deepStrictEqual(out, { ok: 1 });
  assert.strictEqual(calls, 2);
});

test('does not retry a non-retryable status', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return { ok: false, status: 404 };
  };
  await assert.rejects(fetchJson('https://x', { fetchFn, sleepFn: async () => {} }), /HTTP 404/);
  assert.strictEqual(calls, 1);
});
