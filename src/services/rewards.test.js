'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  encodeCall,
  decodeAddress,
  decodeAmount,
  SELECTOR_VAULT_OF,
  SELECTOR_TOTAL_RWA_DISTRIBUTED,
} = require('./rewards');

const TOKEN = '0xabc0000000000000000000000000000000000001';
const WORD = (hex40) => '0x' + hex40.padStart(64, '0');

test('selectors are the validated keccak-256 values', () => {
  assert.strictEqual(SELECTOR_VAULT_OF, '0x0709df45');
  assert.strictEqual(SELECTOR_TOTAL_RWA_DISTRIBUTED, '0x24d6e13e');
});

test('encodeCall pads an address argument to one 32-byte word', () => {
  assert.strictEqual(
    encodeCall(SELECTOR_VAULT_OF, TOKEN),
    '0x0709df45' + '000000000000000000000000' + 'abc0000000000000000000000000000000000001'
  );
});

test('encodeCall lowercases mixed-case addresses', () => {
  assert.strictEqual(
    encodeCall('0x0709df45', '0xABC0000000000000000000000000000000000001'),
    encodeCall('0x0709df45', TOKEN)
  );
});

test('encodeCall with no argument is the bare selector', () => {
  assert.strictEqual(encodeCall(SELECTOR_TOTAL_RWA_DISTRIBUTED), '0x24d6e13e');
});

test('decodeAddress extracts the low 20 bytes, lowercased', () => {
  assert.strictEqual(decodeAddress(WORD('ABC0000000000000000000000000000000000001')), TOKEN);
});

test('decodeAddress turns the zero address into null (token has no vault)', () => {
  assert.strictEqual(decodeAddress(WORD('')), null);
});

test('decodeAddress throws on a malformed word', () => {
  assert.throws(() => decodeAddress('0x1234'), /malformed/);
  assert.throws(() => decodeAddress(undefined), /malformed/);
  assert.throws(() => decodeAddress('not hex'), /malformed/);
});

test('decodeAmount scales a uint256 word by the given decimals', () => {
  const five = '0x' + (5n * 10n ** 18n).toString(16).padStart(64, '0');
  assert.strictEqual(decodeAmount(five, 18), 5);
});

test('decodeAmount with 0 decimals returns the integer amount', () => {
  const n = '0x' + (826_700n).toString(16).padStart(64, '0');
  assert.strictEqual(decodeAmount(n, 0), 826_700);
});

test('decodeAmount of zero is 0, not null (a real on-chain zero)', () => {
  assert.strictEqual(decodeAmount(WORD(''), 18), 0);
});

test('decodeAmount throws on a malformed word', () => {
  assert.throws(() => decodeAmount('0xzz', 18), /malformed/);
  assert.throws(() => decodeAmount(null, 18), /malformed/);
});
