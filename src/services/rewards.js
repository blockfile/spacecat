'use strict';

// Total SpaceX rewarded to holders, from the token's Pons V2 RWA vault.
//
// SpaceCat launches on the Pons V2 launchpad (Robinhood Chain) with a PonsVault
// "RWA Dividend" vault: creator fees buy tokenized SpaceX stock, holders claim
// pro rata. The vault keeps a cumulative counter — `uint256 public
// totalRwaDistributed` — and this service reads it with two raw eth_calls (no
// web3 dependency):
//
//   1. vaultOf(token) on the vault launcher  -> the token's vault address
//   2. totalRwaDistributed() on that vault   -> raw amount in reward-token units
//
// The value is exposed as a TOKEN amount, deliberately not converted to USD.
// Pre-launch (no token address) or no vault: null, never 0 — the site hides a
// null tile. A malformed RPC response throws so the cache keeps serving the
// last good value (see cache.js) and /stats degrades this field to null.

const config = require('./../config');
const { fetchJson } = require('./fetchJson');
const { cached } = require('./cache');

// keccak-256 selectors, precomputed and validated against known selectors.
const SELECTOR_VAULT_OF = '0x0709df45'; // vaultOf(address)
const SELECTOR_TOTAL_RWA_DISTRIBUTED = '0x24d6e13e'; // totalRwaDistributed()

const ZERO_ADDRESS = '0x' + '0'.repeat(40);
const WORD_RE = /^0x[0-9a-fA-F]{64}$/;
const EMPTY = { totalRewarded: null, vaultAddress: null };

/** Pure: selector + optional address argument, ABI-encoded as calldata hex. */
function encodeCall(selector, address) {
  if (!address) return selector;
  return selector + address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

/** Pure: 32-byte ABI word -> lowercased 0x address, or null for the zero address. */
function decodeAddress(word) {
  if (typeof word !== 'string' || !WORD_RE.test(word)) {
    throw new Error(`malformed eth_call result: ${String(word).slice(0, 80)}`);
  }
  const addr = '0x' + word.slice(-40).toLowerCase();
  return addr === ZERO_ADDRESS ? null : addr;
}

/** Pure: 32-byte ABI uint256 word -> token amount scaled by `decimals`. */
function decodeAmount(word, decimals) {
  if (typeof word !== 'string' || !WORD_RE.test(word)) {
    throw new Error(`malformed eth_call result: ${String(word).slice(0, 80)}`);
  }
  return Number(BigInt(word)) / 10 ** decimals;
}

async function ethCall(to, data) {
  const res = await fetchJson(config.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
  });
  if (!res || typeof res.result !== 'string') {
    const detail = res && res.error ? JSON.stringify(res.error) : JSON.stringify(res);
    throw new Error(`eth_call to ${to} failed: ${detail}`);
  }
  return res.result;
}

// The vault address never changes once launched, so remember it across cache
// refreshes; re-resolve only while it is still unknown (pre-vault).
let knownVault = null;

async function resolveVault() {
  if (config.vaultAddress) return config.vaultAddress;
  if (knownVault) return knownVault;
  const word = await ethCall(config.ponsLauncher, encodeCall(SELECTOR_VAULT_OF, config.tokenAddress));
  knownVault = decodeAddress(word);
  return knownVault;
}

async function fetchRewards() {
  if (!config.tokenAddress && !config.vaultAddress) return EMPTY; // pre-launch
  const vault = await resolveVault();
  if (!vault) return EMPTY; // launched, but no vault attached (yet)
  const word = await ethCall(vault, encodeCall(SELECTOR_TOTAL_RWA_DISTRIBUTED));
  return { totalRewarded: decodeAmount(word, config.rewardDecimals), vaultAddress: vault };
}

// Cached read. On failure the last good value keeps being served (see cache.js).
const getRewards = cached(config.rewardsTtlMs, fetchRewards);

module.exports = {
  getRewards,
  encodeCall,
  decodeAddress,
  decodeAmount,
  EMPTY,
  SELECTOR_VAULT_OF,
  SELECTOR_TOTAL_RWA_DISTRIBUTED,
};
