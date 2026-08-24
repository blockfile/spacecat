'use strict';
require('dotenv').config();

function num(v, d) {
  if (v === undefined || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
const lowerOrNull = (v) => (v ? String(v).trim().toLowerCase() : null);

// Blockscout instance for Robinhood Chain — the holder count comes from here.
const explorerApi = (process.env.EXPLORER_API || 'https://robinhoodchain.blockscout.com').replace(/\/$/, '');

const config = {
  port: num(process.env.PORT, 3000),

  // SPC's contract address. Blank until the token is launched — every stat
  // then resolves to null, which the site renders as "—" rather than a zero.
  tokenAddress: lowerOrNull(process.env.TOKEN_ADDRESS),
  tokenSymbol: process.env.TOKEN_SYMBOL || 'SPC',

  explorerApi,
  // DexScreener's slug for the chain — the market cap comes from here.
  dexscreenerChainId: process.env.DEXSCREENER_CHAIN_ID || 'robinhood',

  // How long a fetched value is served before refreshing. The site polls /stats
  // every 30s per browser tab, so without this the upstreams would see one
  // request per visitor per 30s.
  marketTtlMs: num(process.env.MARKET_TTL_MS, 30_000),
  holdersTtlMs: num(process.env.HOLDERS_TTL_MS, 120_000),

  // ── Pons V2 rewards ("Total SpaceX Rewarded") ──────────────────────────────
  // SpaceCat launches on the Pons V2 launchpad with an RWA-dividend vault:
  // creator fees buy tokenized SpaceX which holders claim pro rata. The vault's
  // cumulative counter is read with raw eth_calls over this JSON-RPC endpoint —
  // Blockscout proxies the chain's RPC, so the default needs no extra setup.
  rpcUrl: (process.env.RPC_URL || `${explorerApi}/api/eth-rpc`).replace(/\/$/, ''),
  // The Pons vault launcher; vaultOf(token) resolves the token's vault.
  ponsLauncher: lowerOrNull(process.env.PONS_LAUNCHER) || '0xd948edcdb832529bb3458b0463f5e02bb448888e',
  // Optional: the vault address directly — skips the vaultOf lookup.
  vaultAddress: lowerOrNull(process.env.VAULT_ADDRESS),
  // Decimals of the tokenized-SpaceX reward asset.
  rewardDecimals: num(process.env.REWARD_DECIMALS, 18),
  rewardsTtlMs: num(process.env.REWARDS_TTL_MS, 60_000),

  // Comma-separated allowlist of browser origins. Non-browser requests (no
  // Origin header) always pass; "*" allows any origin.
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

module.exports = config;
