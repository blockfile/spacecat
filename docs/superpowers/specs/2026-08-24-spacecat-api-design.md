# spacecat-api — Design

Date: 2026-08-24
Status: approved (rewards section superseded — see Addendum at the bottom)

## Purpose

Backend stats API for **spacecat.meme** (served at `api.spacecat.meme`), feeding the
site's "Mission Telemetry" panel. It is a rebranded copy of `mooncat-api`
(`d:\projects\mooncat`) with one new stat.

The site polls `GET /stats` every 30s per browser tab and renders three tiles:

| Tile                  | Field           | Source                                      |
| --------------------- | --------------- | ------------------------------------------- |
| Market Cap            | `marketCap`     | DexScreener (fallback: Blockscout)          |
| Total SpaceX Rewarded | `totalRewarded` | Pons V2 RWA vault on Robinhood Chain (new)  |
| Total Holders         | `holders`       | Blockscout                                  |

Token: **$SPC** on **Robinhood Chain**, launching via the Pons V2 launchpad with a
PonsVault **RWA Dividend** vault whose reward asset is tokenized SpaceX stock.
Contract address is not yet known ("CA coming soon") — every stat must resolve to
`null` (never `0`) until `TOKEN_ADDRESS` is set, matching the mooncat pre-launch rule.

## What is copied unchanged from mooncat-api

- Express app shape: `server.js`, root + `/health` endpoints, router mounted at `/`
  and `/api`, JSON 404, quiet per-origin CORS-rejection logging.
- CORS allowlist behavior (env `CORS_ORIGINS`; non-browser requests always pass).
- `src/services/fetchJson.js`, `src/services/cache.js` (stale-while-error TTL cache,
  shared in-flight request).
- `src/services/marketdata.js` (DexScreener) and `src/services/holders.js`
  (Blockscout) — only branding/defaults change.
- Test setup (`node --test`), `scripts/check.js` preflight pattern, `.env.example`,
  `.gitignore`. `node_modules` is NOT copied; `npm install` regenerates it.

## Rebranding

- Package name `spacecat-api`; description mentions spacecat.meme.
- `TOKEN_SYMBOL` default `SPC`.
- Root endpoint `name`/`description` updated; log prefix `[spacecat]`.
- `.env.example` shows `CORS_ORIGINS=https://spacecat.meme,https://www.spacecat.meme`.
- Explorer/DexScreener defaults unchanged (same chain as mooncat):
  `https://robinhoodchain.blockscout.com`, chain slug `robinhood`.

## New: rewards service (`src/services/rewards.js`)

Reads the cumulative amount of tokenized SpaceX distributed to holders. Raw token
amount only — **no USD conversion** (explicit user decision).

Mechanism — two `eth_call`s over plain JSON-RPC `fetch` POST (no web3 dependency):

1. `vaultOf(address)` on the Pons vault launcher → the token's vault address.
   Launcher: `0xD948EDCDB832529bB3458B0463F5E02Bb448888e` (confirmed:
   `function vaultOf(address token) external view returns (address)`; falls back to
   its registry internally). Zero address ⇒ no vault ⇒ `null`.
2. `totalRwaDistributed()` on the vault. `PonsRwaVault.sol` declares
   `uint256 public totalRwaDistributed` — cumulative RWA (SpaceX) distributed.

Parsing: hex → `BigInt` → scale by `10^REWARD_DECIMALS` (default 18) → JS number.
Pure functions (selector encoding, address encoding, hex decoding, scaling) are
exported for unit tests.

Caching/degradation: wrapped in the same `cached()` stale-while-error TTL cache
(`REWARDS_TTL_MS`, default 60s). Failure of this upstream nulls only
`totalRewarded` — `/stats` uses `Promise.allSettled` over all three services.
The resolved vault address is memoized inside the cached producer (re-resolved only
when unset), and `VAULT_ADDRESS` env skips the lookup entirely.

## Config additions (`src/config.js`)

| Env               | Default                                              | Meaning                              |
| ----------------- | ---------------------------------------------------- | ------------------------------------ |
| `RPC_URL`         | `{EXPLORER_API}/api/eth-rpc`                         | JSON-RPC endpoint for `eth_call`     |
| `PONS_LAUNCHER`   | `0xD948EDCDB832529bB3458B0463F5E02Bb448888e`         | Pons vault launcher                  |
| `VAULT_ADDRESS`   | (blank)                                              | Optional: skip `vaultOf` lookup      |
| `REWARD_DECIMALS` | `18`                                                 | Decimals of the SpaceX RWA token     |
| `REWARDS_TTL_MS`  | `60000`                                              | Rewards cache TTL                    |

`TOKEN_ADDRESS` blank ⇒ rewards service returns `null` without any network call.

## `GET /stats` response

```json
{
  "marketCap": 4189702,
  "holders": 12879,
  "totalRewarded": 826700.12,
  "priceUsd": 0.0000042,
  "liquidityUsd": 120000,
  "symbol": "SPC",
  "tokenAddress": "0x…",
  "updatedAt": "2026-08-24T12:00:00.000Z"
}
```

`totalRewarded` is the SPACEX token amount (not USD). Any unsourceable field is
`null`. Frontend picks fields by name; extra fields are harmless.

## Error handling

Same rules as mooncat-api: independent upstreams degrade independently; cache serves
last good value on refresh failure and retries next call; `null` never `0`; CORS
rejections get a terse 403 and one log line per origin.

## Testing

- Carry over rebranded copies of `cache.test.js`, `marketdata.test.js`,
  `holders.test.js`, `stats.test.js` (stats test asserts `totalRewarded` present).
- New `rewards.test.js`: calldata encoding (`vaultOf` selector + padded address,
  `totalRwaDistributed()` selector), result decoding (hex uint256 → scaled number),
  zero-address vault ⇒ null, blank `TOKEN_ADDRESS` ⇒ null. A malformed or error RPC
  response makes the producer THROW (so the cache serves the last good value and
  `/stats` degrades to null) — the decoder test asserts the throw. Pure functions
  only — no network in tests.
- `scripts/check.js` additionally prints the resolved vault address and
  `totalRewarded`.

## Delivery

New repo at `d:\projects\spacecat`, initial commit, remote
`https://github.com/blockfile/spacecat.git`, push `main`.

## Addendum (2026-08-24, post-launch): rewards source replaced

SPC launched at `0xd16e7422336e75fb995eaf14ea9f8f473968105f` on Pons V2, paired
with SPCX (tokenized SpaceX, `0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa`) —
**without a PonsVault**. The real rewards mechanism is Pons's fee routing: the
2% creator tax accrues in SPCX and routes, with no creator claim, to a
per-token fee distributor (a BeaconProxy; for this launch
`0x5AA38e88d15677781b00821fdBc2Cdbb3409Aeb2`) that pushes epoch-based payouts
to holder wallets.

The distributor contract exposes `epochCount()` / `getEpoch(i)` / merkle
`claim(...)` but **no single cumulative counter** — Pons computes the total
server-side. The rewards service therefore no longer does eth_calls; it reads
the same public API the Pons token page uses:

    GET {PONS_API}/api/pons-v2-market/{TOKEN_ADDRESS}/distributor
    -> { state, distributor, distributedQuote, distributedCoin,
         unallocatedQuote, epochCount, latestEpoch, ... }   (wei strings)

`totalRewarded = distributedQuote / 10^REWARD_DECIMALS`. Config keys `RPC_URL`,
`PONS_LAUNCHER`, `VAULT_ADDRESS` are replaced by `PONS_API` (default
`https://www.ponsfamily.com`). Null rules unchanged, with one refinement: an
active distributor reporting `"0"` is a REAL zero (no payout epoch has run
yet) and is served as `0`; `null` remains reserved for "no token address" or
"no distributor". The service returns `{ totalRewarded, distributor }`.

### Addendum 2 (2026-08-24): pre-graduation market cap from the bonding curve

DexScreener cannot price SPC until it graduates off the Pons V2 bonding curve,
so `src/services/curvemarket.js` computes a fallback: the Pons chart API
(`/api/pons-v2-market/{token}/chart?range=1d`) gives the latest curve price in
SPCX, and SPCX itself (`REWARD_TOKEN_ADDRESS`, tokenized SpaceX) is already
listed on DexScreener with deep USDG pools, giving the USD conversion.
`priceUsd = curvePrice × SPCX_USD`; `marketCap = priceUsd × totalSupply`
(supply and decimals from the existing Blockscout token info). Merge order in
`/stats`: DexScreener pair → explorer circulating mcap → curve computation →
null, so the DexScreener pair takes over automatically at graduation. The
`priceUsd` field falls back to the curve price the same way.
