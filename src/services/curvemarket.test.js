'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseCurvePrice, EMPTY } = require('./curvemarket');

// Shape returned by GET {ponsApi}/api/pons-v2-market/{token}/chart?range=1d
const chart = (points) => ({ token: '0xd16e', range: '1d', intervalSeconds: 300, points });

test('returns the latest point\'s price (SPCX per SPC)', () => {
  const data = chart([
    { t: 1, price: 3.1e-8, tradeCount: 3 },
    { t: 2, price: 1.25e-7, tradeCount: 5 },
  ]);
  assert.strictEqual(parseCurvePrice(data), 1.25e-7);
});

test('no trades yet (empty points) is null, not zero', () => {
  assert.strictEqual(parseCurvePrice(chart([])), null);
  assert.strictEqual(parseCurvePrice({ token: '0xd16e', points: undefined }), null);
});

test('a malformed response throws so the cache keeps the last good value', () => {
  assert.throws(() => parseCurvePrice(null), /malformed/);
  assert.throws(() => parseCurvePrice('nope'), /malformed/);
  assert.throws(() => parseCurvePrice(chart([{ t: 1, price: 'broken' }])), /malformed/);
});
