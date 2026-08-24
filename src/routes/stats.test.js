'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildStats } = require('./stats');

const build = (market, token, rewards = {}) =>
  buildStats({ market, token, rewards, symbol: 'SPC', tokenAddress: '0xabc' });

test('returns the two fields the site reads', () => {
  const out = build({ marketCap: 4_206_900 }, { holders: 6942 });
  assert.strictEqual(out.marketCap, 4_206_900);
  assert.strictEqual(out.holders, 6942);
});

test('falls back to the explorer market cap when DexScreener has none', () => {
  const out = build({ marketCap: null }, { circulatingMarketCap: 555 });
  assert.strictEqual(out.marketCap, 555);
});

test('prefers DexScreener over the explorer fallback', () => {
  const out = build({ marketCap: 1 }, { circulatingMarketCap: 999 });
  assert.strictEqual(out.marketCap, 1);
});

test('a dead upstream yields nulls, never zeros', () => {
  const out = build({}, {});
  assert.strictEqual(out.marketCap, null);
  assert.strictEqual(out.holders, null);
});

test('a real zero market cap is preserved, not treated as missing', () => {
  const out = build({ marketCap: 0 }, { circulatingMarketCap: 999 });
  assert.strictEqual(out.marketCap, 0);
});

test('includes the total SpaceX rewarded from the vault service', () => {
  const out = build({}, {}, { totalRewarded: 826_700.5 });
  assert.strictEqual(out.totalRewarded, 826_700.5);
});

test('a dead rewards upstream yields null, and a real zero is preserved', () => {
  assert.strictEqual(build({}, {}).totalRewarded, null);
  assert.strictEqual(build({}, {}, { totalRewarded: 0 }).totalRewarded, 0);
});
