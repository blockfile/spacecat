# spacecat-api Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `spacecat-api` — the stats backend for spacecat.meme (served at api.spacecat.meme) — as a rebranded copy of `mooncat-api` plus one new stat: `totalRewarded`, the cumulative tokenized-SpaceX distributed to holders by the token's Pons V2 RWA vault on Robinhood Chain.

**Architecture:** Express app with three independent upstream services (DexScreener market data, Blockscout holder count, Pons vault rewards via raw JSON-RPC `eth_call`), each behind a stale-while-error TTL cache, merged by a pure `buildStats()` into `GET /stats`. Spec: `docs/superpowers/specs/2026-08-24-spacecat-api-design.md`.

**Tech Stack:** Node >= 20 (built-in `fetch`, `node:test`), CommonJS, Express 4, cors, dotenv. No other runtime dependencies — the `eth_call`s are hand-encoded hex over `fetch`, no web3 library.

## Global Constraints

- Source project to copy from: `d:\projects\mooncat` (never modify it; copy only).
- Target repo: `d:\projects\spacecat` (already exists, git-initialized on `main`, contains the spec under `docs/`).
- Runtime dependencies exactly `cors@^2.8.5`, `dotenv@^16.4.7`, `express@^4.21.2` — do not add any.
- `"engines": { "node": ">=20" }`, `"type": "commonjs"`.
- A stat that cannot be sourced is `null`, NEVER `0` (the frontend hides a null tile but would render 0).
- Log prefix is `[spacecat]` in every console line.
- Token symbol default `SPC`; site domain spacecat.meme; API domain api.spacecat.meme.
- Addresses in config are lowercased (`lowerOrNull` helper).
- Function selectors (keccak-256, validated against known selectors `transfer/balanceOf/totalSupply` and the 4byte registry): `vaultOf(address)` = `0x0709df45`, `totalRwaDistributed()` = `0x24d6e13e`. Pons V2 vault launcher: `0xD948EDCDB832529bB3458B0463F5E02Bb448888e`.
- Tests run with `npm test` (`node --test`) from `d:\projects\spacecat`. All shell commands below are Git Bash syntax with absolute paths.

---

### Task 1: Copy mooncat-api and rebrand to spacecat

**Files:**
- Create (copy verbatim from `d:\projects\mooncat`): `.gitignore`, `src/services/fetchJson.js`, `src/services/cache.js`, `src/services/cache.test.js`, `src/services/marketdata.test.js`, `src/services/holders.test.js`, `scripts/check.js`
- Create (rebranded content given below): `package.json`, `.env.example`, `server.js`, `src/config.js`, `src/routes/stats.js`, `src/routes/stats.test.js`, `src/services/marketdata.js`, `src/services/holders.js`

**Interfaces:**
- Consumes: mooncat-api source tree.
- Produces: a working rebranded API. Later tasks rely on: `config` keys (`port`, `tokenAddress`, `tokenSymbol`, `explorerApi`, `dexscreenerChainId`, `marketTtlMs`, `holdersTtlMs`, `corsOrigins`), `fetchJson(url, opts)`, `cached(ttlMs, fn)`, `getMarketData()`, `getTokenInfo()`, `buildStats({market, token, symbol, tokenAddress})`, and the `/stats` route mounted at `/` and `/api`.

- [ ] **Step 1: Copy the unchanged files**

```bash
cd /d/projects/spacecat
mkdir -p src/services src/routes scripts
cp /d/projects/mooncat/.gitignore .
cp /d/projects/mooncat/src/services/fetchJson.js src/services/
cp /d/projects/mooncat/src/services/cache.js src/services/
cp /d/projects/mooncat/src/services/cache.test.js src/services/
cp /d/projects/mooncat/src/services/marketdata.test.js src/services/
cp /d/projects/mooncat/src/services/holders.test.js src/services/
cp /d/projects/mooncat/scripts/check.js scripts/
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "spacecat-api",
  "version": "1.0.0",
  "private": true,
  "description": "Stats API for spacecat.meme — serves SPC market cap, holder count and total SpaceX rewarded to the site.",
  "type": "commonjs",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "test": "node --test",
    "check": "node scripts/check.js"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^4.21.2"
  }
}
```

- [ ] **Step 3: Write `src/config.js`** (rebrand of mooncat's; `explorerApi` is hoisted to a const so Task 3 can default `rpcUrl` from it)

```js
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

  // Comma-separated allowlist of browser origins. Non-browser requests (no
  // Origin header) always pass; "*" allows any origin.
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

module.exports = config;
```

- [ ] **Step 4: Write `server.js`** (mooncat's with `[spacecat]` prefix, new name/description)

```js
'use strict';

const express = require('express');
const cors = require('cors');

const config = require('./src/config');
const { router: statsRouter } = require('./src/routes/stats');

const app = express();
app.disable('x-powered-by');
// Behind nginx — trust its X-Forwarded-* headers so req.ip is the real client.
app.set('trust proxy', 1);

// CORS allowlist — non-browser requests (no Origin) always pass; browsers are
// restricted to config.corsOrigins (or any origin if it contains "*").
const allowAll = config.corsOrigins.includes('*');
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowAll || config.corsOrigins.includes(origin)) return cb(null, true);
      const err = new Error(`origin ${origin} not allowed by CORS`);
      err.corsRejected = true; // handled quietly below — copycat sites spam this
      return cb(err);
    },
  })
);

app.get('/', (req, res) => {
  res.json({
    name: 'spacecat-api',
    description: 'SPC market cap, holder count and total SpaceX rewarded for spacecat.meme',
    token: { symbol: config.tokenSymbol, address: config.tokenAddress },
    endpoints: ['GET /stats', 'GET /health'],
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, uptimeSec: Math.round(process.uptime()) });
});

// Mounted twice so the site works whether VITE_API_BASE_URL is set to
// https://api.spacecat.meme or https://api.spacecat.meme/api.
app.use('/', statsRouter);
app.use('/api', statsRouter);

app.use((req, res) => res.status(404).json({ error: 'not found' }));

// Disallowed origins (copycat sites embedding this API) get a terse 403 and at
// most ONE log line per origin — not a stack trace per request.
const loggedBlockedOrigins = new Set();

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.corsRejected) {
    const origin = req.get('origin') || 'unknown';
    if (!loggedBlockedOrigins.has(origin)) {
      loggedBlockedOrigins.add(origin);
      console.warn(`[spacecat] blocking CORS origin: ${origin}`);
    }
    return res.status(403).json({ error: 'origin not allowed' });
  }
  console.error('[spacecat] request error:', err);
  res.status(500).json({ error: err.message });
});

let server;

if (require.main === module) {
  server = app.listen(config.port, () => {
    console.log(`[spacecat] listening on http://localhost:${config.port}`);
    console.log(
      `[spacecat] token=${config.tokenSymbol} address=${config.tokenAddress || '(not set — stats will be null)'}`
    );
    console.log(`[spacecat] cors=${config.corsOrigins.join(', ')}`);
  });

  const shutdown = (signal) => {
    console.log(`\n[spacecat] ${signal} received, shutting down`);
    if (server) server.close(() => process.exit(0));
    else process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = app;
```

- [ ] **Step 5: Write `src/services/marketdata.js` and `src/services/holders.js`** — copy mooncat's files, then change ONLY the first comment line of each:

`src/services/marketdata.js` line 3: `// Market cap for MOONCAT, from DexScreener's public API (no key required).` → `// Market cap for SPC, from DexScreener's public API (no key required).`

`src/services/holders.js` line 3: `// Holder count for MOONCAT, from the Blockscout REST API on Robinhood Chain.` → `// Holder count for SPC, from the Blockscout REST API on Robinhood Chain.`

```bash
cp /d/projects/mooncat/src/services/marketdata.js /d/projects/spacecat/src/services/
cp /d/projects/mooncat/src/services/holders.js /d/projects/spacecat/src/services/
# then apply the two one-line comment edits above with the Edit tool
```

- [ ] **Step 6: Write `src/routes/stats.js`** — copy mooncat's `src/routes/stats.js` verbatim, then update only the header comment (lines 3–11) to:

```js
// The site's only live data. GET /stats returns the fields the spacecat.meme
// telemetry panel reads:
//
//   { "marketCap": 4189702, "holders": 12879 }
//
// The extra fields alongside them are ignored by the current frontend (it picks
// fields by name) and are there so the site can show price or liquidity later
// without a backend change. A field that cannot be sourced is null, never 0 —
// the frontend hides a null tile, but would render a 0 as a real number.
```

(The `totalRewarded` field is wired in Task 4 — do not add it here.)

- [ ] **Step 7: Write `src/routes/stats.test.js`** — copy mooncat's verbatim, then change the helper's symbol:

```js
const build = (market, token) =>
  buildStats({ market, token, symbol: 'SPC', tokenAddress: '0xabc' });
```

- [ ] **Step 8: Write `.env.example`**

```bash
# ── Server ───────────────────────────────────────────────────────────────────
PORT=3000

# ── Token ────────────────────────────────────────────────────────────────────
# SPC's contract address on Robinhood Chain. Leave BLANK until launch — the
# API then answers with nulls, which the site renders as "—" rather than a zero.
# Fill this in the moment the CA is known; no code change or redeploy needed
# beyond restarting the process.
TOKEN_ADDRESS=
TOKEN_SYMBOL=SPC

# ── Upstreams (no API keys needed) ───────────────────────────────────────────
# Blockscout instance for Robinhood Chain — source of the holder count.
EXPLORER_API=https://robinhoodchain.blockscout.com
# DexScreener's slug for the chain — source of the market cap.
DEXSCREENER_CHAIN_ID=robinhood

# ── Caching ──────────────────────────────────────────────────────────────────
# How long a fetched value is served before refreshing, in ms. Every visitor's
# browser polls /stats every 30s, so these are what keep the upstreams from
# seeing one request per visitor.
MARKET_TTL_MS=30000
HOLDERS_TTL_MS=120000

# ── Frontend / CORS ──────────────────────────────────────────────────────────
# Comma-separated allowlist of browser origins that may call the API. Must
# include the scheme. Use "*" to allow any origin (not recommended).
# Non-browser calls (curl, uptime checks) always pass.
CORS_ORIGINS=https://spacecat.meme,https://www.spacecat.meme
```

- [ ] **Step 9: Install and run the test suite**

```bash
cd /d/projects/spacecat && npm install && npm test
```

Expected: 19 tests pass (5 cache, 4 marketdata, 5 holders, 5 stats), 0 fail.

- [ ] **Step 10: Sanity-boot the server**

```bash
cd /d/projects/spacecat && node -e "
const app = require('./server');
const s = app.listen(0, async () => {
  const port = s.address().port;
  const root = await (await fetch('http://localhost:' + port + '/')).json();
  const stats = await (await fetch('http://localhost:' + port + '/stats')).json();
  console.log(JSON.stringify(root), JSON.stringify(stats));
  s.close();
});"
```

Expected: root shows `"name":"spacecat-api"` and `"symbol":"SPC"`; stats shows all-null fields (no TOKEN_ADDRESS set).

- [ ] **Step 11: Commit**

```bash
cd /d/projects/spacecat && git add -A && git commit -m "Add spacecat-api: rebranded copy of mooncat-api

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: POST support in fetchJson (TDD)

The rewards service needs JSON-RPC `eth_call`, which is an HTTP POST. `fetchJson` currently only GETs. Extend it to pass `method` and `body` through to `fetch`, keeping the retry behavior.

**Files:**
- Modify: `src/services/fetchJson.js` (line 19 area: options destructuring and the `fetchFn` call)
- Test: `src/services/fetchJson.test.js` (new)

**Interfaces:**
- Consumes: existing `fetchJson(url, {headers, retries, delayMs, sleepFn, fetchFn})`.
- Produces: `fetchJson(url, {headers, method, body, retries, delayMs, sleepFn, fetchFn})` — `method`/`body` forwarded verbatim to `fetchFn(url, {headers, method, body})`. Task 3 relies on this exact signature.

- [ ] **Step 1: Write the failing test** — create `src/services/fetchJson.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify the new behavior fails**

```bash
cd /d/projects/spacecat && node --test src/services/fetchJson.test.js
```

Expected: the first test FAILS (`seen.init.method` is `undefined` — current code passes only `{ headers }` to fetch). The other three pass (existing behavior).

- [ ] **Step 3: Implement** — in `src/services/fetchJson.js`, change the signature line and the fetch call:

```js
async function fetchJson(
  url,
  { headers, method, body, retries = 3, delayMs = 1000, sleepFn = sleep, fetchFn = fetch } = {}
) {
```

and inside the loop:

```js
      res = await fetchFn(url, { headers, method, body });
```

Also update the JSDoc `@param` line to include `method?: string, body?: string`.

- [ ] **Step 4: Run the full suite**

```bash
cd /d/projects/spacecat && npm test
```

Expected: 23 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
cd /d/projects/spacecat && git add src/services/fetchJson.js src/services/fetchJson.test.js && git commit -m "Support POST bodies in fetchJson for JSON-RPC calls

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Rewards service — Pons V2 RWA vault via eth_call (TDD)

**Files:**
- Modify: `src/config.js` (add rewards keys), `.env.example` (add rewards section)
- Create: `src/services/rewards.js`
- Test: `src/services/rewards.test.js` (new)

**Interfaces:**
- Consumes: `fetchJson(url, {method, body, headers})` from Task 2; `cached(ttlMs, fn)`; config keys.
- Produces: `getRewards(): Promise<{totalRewarded: number|null, vaultAddress: string|null}>` plus pure helpers `encodeCall(selector, address?)`, `decodeAddress(word)`, `decodeAmount(word, decimals)`, constants `EMPTY`, `SELECTOR_VAULT_OF`, `SELECTOR_TOTAL_RWA_DISTRIBUTED`. New config keys: `rpcUrl`, `ponsLauncher`, `vaultAddress`, `rewardDecimals`, `rewardsTtlMs`. Task 4 consumes `getRewards`; Task 5 consumes `getRewards` and the config keys.

- [ ] **Step 1: Write the failing tests** — create `src/services/rewards.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /d/projects/spacecat && node --test src/services/rewards.test.js
```

Expected: FAIL — `Cannot find module './rewards'`.

- [ ] **Step 3: Add the config keys** — in `src/config.js`, insert after the `holdersTtlMs` line:

```js
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
```

- [ ] **Step 4: Implement `src/services/rewards.js`**

```js
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
```

- [ ] **Step 5: Run the full suite**

```bash
cd /d/projects/spacecat && npm test
```

Expected: 34 tests pass (23 prior + 11 new), 0 fail.

- [ ] **Step 6: Add the rewards section to `.env.example`** — append after the Caching section (before Frontend/CORS):

```bash
# ── Rewards: "Total SpaceX Rewarded" (Pons V2 RWA vault) ─────────────────────
# JSON-RPC endpoint used for the vault eth_calls. Blank = the Blockscout RPC
# proxy ({EXPLORER_API}/api/eth-rpc), which needs no extra setup.
RPC_URL=
# The Pons V2 vault launcher — vaultOf(token) resolves the token's vault.
PONS_LAUNCHER=0xD948EDCDB832529bB3458B0463F5E02Bb448888e
# Optional: the token's vault address directly, skipping the vaultOf lookup.
VAULT_ADDRESS=
# Decimals of the tokenized-SpaceX reward asset.
REWARD_DECIMALS=18
REWARDS_TTL_MS=60000
```

- [ ] **Step 7: Commit**

```bash
cd /d/projects/spacecat && git add src/services/rewards.js src/services/rewards.test.js src/config.js .env.example && git commit -m "Read total SpaceX rewarded from the Pons V2 RWA vault

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire totalRewarded into GET /stats (TDD)

**Files:**
- Modify: `src/routes/stats.js`
- Test: `src/routes/stats.test.js`

**Interfaces:**
- Consumes: `getRewards()` from Task 3.
- Produces: `buildStats({market, token, rewards = {}, symbol, tokenAddress})` returning the previous shape plus `totalRewarded: number|null`. `/stats` settles all three services independently.

- [ ] **Step 1: Extend the tests** — in `src/routes/stats.test.js`, change the helper to accept rewards and add two tests:

```js
const build = (market, token, rewards = {}) =>
  buildStats({ market, token, rewards, symbol: 'SPC', tokenAddress: '0xabc' });
```

```js
test('includes the total SpaceX rewarded from the vault service', () => {
  const out = build({}, {}, { totalRewarded: 826_700.5 });
  assert.strictEqual(out.totalRewarded, 826_700.5);
});

test('a dead rewards upstream yields null, and a real zero is preserved', () => {
  assert.strictEqual(build({}, {}).totalRewarded, null);
  assert.strictEqual(build({}, {}, { totalRewarded: 0 }).totalRewarded, 0);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

```bash
cd /d/projects/spacecat && node --test src/routes/stats.test.js
```

Expected: the two new tests FAIL (`out.totalRewarded` is `undefined`); the five old ones pass.

- [ ] **Step 3: Implement** — in `src/routes/stats.js`:

Add the import:

```js
const { getRewards } = require('../services/rewards');
```

Replace `buildStats` with:

```js
function buildStats({ market, token, rewards = {}, symbol, tokenAddress }) {
  return {
    marketCap: market.marketCap ?? token.circulatingMarketCap ?? null,
    holders: token.holders ?? null,
    totalRewarded: rewards.totalRewarded ?? null,
    priceUsd: market.priceUsd ?? null,
    liquidityUsd: market.liquidityUsd ?? null,
    symbol,
    tokenAddress: tokenAddress ?? null,
    updatedAt: new Date().toISOString(),
  };
}
```

Replace the route body's settle/merge with the three-service version:

```js
    const [marketResult, tokenResult, rewardsResult] = await Promise.allSettled([
      getMarketData(),
      getTokenInfo(),
      getRewards(),
    ]);

    const market = marketResult.status === 'fulfilled' ? marketResult.value : {};
    const token = tokenResult.status === 'fulfilled' ? tokenResult.value : {};
    const rewards = rewardsResult.status === 'fulfilled' ? rewardsResult.value : {};

    if (marketResult.status === 'rejected') {
      console.warn('[spacecat] market data unavailable:', marketResult.reason?.message);
    }
    if (tokenResult.status === 'rejected') {
      console.warn('[spacecat] holder count unavailable:', tokenResult.reason?.message);
    }
    if (rewardsResult.status === 'rejected') {
      console.warn('[spacecat] rewards unavailable:', rewardsResult.reason?.message);
    }

    res.json(
      buildStats({
        market,
        token,
        rewards,
        symbol: config.tokenSymbol,
        tokenAddress: config.tokenAddress,
      })
    );
```

Also update the example in the header comment to include the new field:

```js
//   { "marketCap": 4189702, "holders": 12879, "totalRewarded": 826700 }
```

- [ ] **Step 4: Run the full suite**

```bash
cd /d/projects/spacecat && npm test
```

Expected: 36 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
cd /d/projects/spacecat && git add src/routes/stats.js src/routes/stats.test.js && git commit -m "Expose totalRewarded in GET /stats

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Extend the preflight check script

**Files:**
- Modify: `scripts/check.js`

**Interfaces:**
- Consumes: `getRewards()` and config keys `rpcUrl`, `ponsLauncher`, `vaultAddress` from Task 3; `buildStats` from Task 4.

- [ ] **Step 1: Extend `scripts/check.js`:**

Add the import next to the other service imports:

```js
const { getRewards } = require('../src/services/rewards');
```

In the config block, after the `dexscreener` line, add:

```js
  console.log(`  rpc        : ${config.rpcUrl}`);
  console.log(`  launcher   : ${config.ponsLauncher}${config.vaultAddress ? ` (vault override: ${config.vaultAddress})` : ''}`);
```

Replace the two-service settle with three:

```js
  const [market, token, rewards] = await Promise.allSettled([getMarketData(), getTokenInfo(), getRewards()]);
```

After the blockscout section, add:

```js
  console.log('pons rwa vault (total SpaceX rewarded)');
  if (rewards.status === 'rejected') console.log(`  FAILED: ${rewards.reason.message}`);
  else if (rewards.value.vaultAddress === null) console.log('  no vault found for this token yet');
  else {
    console.log(`  vault        : ${rewards.value.vaultAddress}`);
    console.log(`  totalRewarded: ${show(rewards.value.totalRewarded)}`);
  }
  console.log('');
```

And pass rewards into the final `buildStats` call:

```js
      buildStats({
        market: market.status === 'fulfilled' ? market.value : {},
        token: token.status === 'fulfilled' ? token.value : {},
        rewards: rewards.status === 'fulfilled' ? rewards.value : {},
        symbol: config.tokenSymbol,
        tokenAddress: config.tokenAddress,
      }),
```

- [ ] **Step 2: Run it (pre-launch state)**

```bash
cd /d/projects/spacecat && node scripts/check.js
```

Expected: prints the resolved config including `rpc` and `launcher` lines, then the blank-TOKEN_ADDRESS early-exit message. No crash.

- [ ] **Step 3: Run the full suite one more time**

```bash
cd /d/projects/spacecat && npm test
```

Expected: 36 tests pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
cd /d/projects/spacecat && git add scripts/check.js && git commit -m "Show vault + totalRewarded in the preflight check

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Push to GitHub

**Files:** none (git only)

- [ ] **Step 1: Final verification**

```bash
cd /d/projects/spacecat && npm test && git status --short
```

Expected: 36 tests pass; working tree clean (spec + plan docs already committed).

- [ ] **Step 2: Add the remote and push**

```bash
cd /d/projects/spacecat && git remote add origin https://github.com/blockfile/spacecat.git && git push -u origin main
```

Expected: push succeeds. If authentication fails or the remote already has commits, STOP and report to the user — do not force-push.
