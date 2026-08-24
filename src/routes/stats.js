'use strict';

// The site's only live data. GET /stats returns the fields the spacecat.meme
// telemetry panel reads:
//
//   { "marketCap": 4189702, "holders": 12879 }
//
// The extra fields alongside them are ignored by the current frontend (it picks
// fields by name) and are there so the site can show price or liquidity later
// without a backend change. A field that cannot be sourced is null, never 0 —
// the frontend hides a null tile, but would render a 0 as a real number.

const express = require('express');
const config = require('../config');
const { getMarketData } = require('../services/marketdata');
const { getTokenInfo } = require('../services/holders');

const router = express.Router();

/**
 * Pure: merge the two upstreams into the response body.
 *
 * Market cap prefers DexScreener (live pool pricing) and falls back to
 * Blockscout's circulating_market_cap, which is populated only once the
 * explorer has an exchange rate for the token — often not at all on a young
 * chain, hence the ordering.
 */
function buildStats({ market, token, symbol, tokenAddress }) {
  return {
    marketCap: market.marketCap ?? token.circulatingMarketCap ?? null,
    holders: token.holders ?? null,
    priceUsd: market.priceUsd ?? null,
    liquidityUsd: market.liquidityUsd ?? null,
    symbol,
    tokenAddress: tokenAddress ?? null,
    updatedAt: new Date().toISOString(),
  };
}

router.get('/stats', async (req, res, next) => {
  try {
    // Independent upstreams — one being down must not delay or fail the other,
    // so both settle and a rejection degrades to nulls for its own fields only.
    const [marketResult, tokenResult] = await Promise.allSettled([getMarketData(), getTokenInfo()]);

    const market = marketResult.status === 'fulfilled' ? marketResult.value : {};
    const token = tokenResult.status === 'fulfilled' ? tokenResult.value : {};

    if (marketResult.status === 'rejected') {
      console.warn('[spacecat] market data unavailable:', marketResult.reason?.message);
    }
    if (tokenResult.status === 'rejected') {
      console.warn('[spacecat] holder count unavailable:', tokenResult.reason?.message);
    }

    res.json(
      buildStats({
        market,
        token,
        symbol: config.tokenSymbol,
        tokenAddress: config.tokenAddress,
      })
    );
  } catch (err) {
    next(err);
  }
});

module.exports = { router, buildStats };
