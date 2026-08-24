'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { cached } = require('./cache');

test('serves from cache within the TTL', async () => {
  let calls = 0;
  const get = cached(10_000, async () => ++calls);
  assert.strictEqual(await get(), 1);
  assert.strictEqual(await get(), 1);
  assert.strictEqual(calls, 1);
});

test('refetches once the TTL has expired', async () => {
  let calls = 0;
  const get = cached(0, async () => ++calls);
  assert.strictEqual(await get(), 1);
  assert.strictEqual(await get(), 2);
});

test('concurrent callers share one in-flight request', async () => {
  let calls = 0;
  const get = cached(10_000, async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 10));
    return calls;
  });
  const [a, b, c] = await Promise.all([get(), get(), get()]);
  assert.deepStrictEqual([a, b, c], [1, 1, 1]);
  assert.strictEqual(calls, 1);
});

test('a failed refresh keeps serving the last good value', async () => {
  let mode = 'ok';
  const get = cached(0, async () => {
    if (mode === 'boom') throw new Error('upstream down');
    return 'good';
  });
  assert.strictEqual(await get(), 'good');
  mode = 'boom';
  assert.strictEqual(await get(), 'good'); // not an error, not null
});

test('with no value ever cached, a failure propagates', async () => {
  const get = cached(1000, async () => {
    throw new Error('upstream down');
  });
  await assert.rejects(get(), /upstream down/);
});
