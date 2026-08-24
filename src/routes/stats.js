'use strict';

// The site's only live data. GET /stats returns the fields the spacecat.meme
// telemetry panel reads:
//
//   { "marketCap": 4189702, "holders": 12879, "totalRewarded": 826700 }
//
// The extra fields alongside them are ignored by the current frontend (it picks
// fields by name) and are there so the site can show price or liquidity later
// without a backend change. A field that cannot be sourced is null, never 0 —
// the frontend hides a null tile, but would render a 0 as a real number.

const express = require('express');
const config = require('../config');
const { getMarketData } = require('../services/marketdata');
const { getTokenInfo } = require('../services/holders');
const { getRewards } = require('../services/rewards');
const { getCurveMarket } = require('../services/curvemarket');
const { getQuotePrice } = require('../services/quoteprice');

const router = express.Router();

/** Pure: USD value of the SPCX paid to holders, or null if either leg is missing. */
function rewardedUsd(rewards, quote) {
  if (typeof rewards.totalRewarded !== 'number' || typeof quote.priceUsd !== 'number') return null;
  return rewards.totalRewarded * quote.priceUsd;
}

/**
 * Pure: market cap computed from the bonding-curve price and the explorer's
 * total supply, for the window before the token graduates to a real pool.
 * Needs both halves — a price with no supply (or vice versa) is null.
 */
function curveMarketCap(curve, token) {
  if (typeof curve.priceUsd !== 'number') return null;
  if (token.totalSupply == null || token.decimals == null) return null;
  return (Number(BigInt(token.totalSupply)) / 10 ** token.decimals) * curve.priceUsd;
}

/**
 * Pure: merge the five upstreams into the response body.
 *
 * Market cap prefers DexScreener (live pool pricing, exists only after the
 * token graduates), then Blockscout's circulating_market_cap (populated only
 * once the explorer has an exchange rate), then the bonding-curve computation
 * — so the tile shows a real number at every stage of the token's life.
 */
function buildStats({ market, token, rewards = {}, curve = {}, quote = {}, symbol, tokenAddress }) {
  return {
    marketCap: market.marketCap ?? token.circulatingMarketCap ?? curveMarketCap(curve, token),
    holders: token.holders ?? null,
    totalRewarded: rewards.totalRewarded ?? null,
    totalRewardedUsd: rewardedUsd(rewards, quote),
    priceUsd: market.priceUsd ?? curve.priceUsd ?? null,
    liquidityUsd: market.liquidityUsd ?? null,
    symbol,
    tokenAddress: tokenAddress ?? null,
    updatedAt: new Date().toISOString(),
  };
}

router.get('/stats', async (req, res, next) => {
  try {
    // Independent upstreams — one being down must not delay or fail the other,
    // so all settle and a rejection degrades to nulls for its own fields only.
    const [marketResult, tokenResult, rewardsResult, curveResult, quoteResult] = await Promise.allSettled([
      getMarketData(),
      getTokenInfo(),
      getRewards(),
      getCurveMarket(),
      getQuotePrice(),
    ]);

    const market = marketResult.status === 'fulfilled' ? marketResult.value : {};
    const token = tokenResult.status === 'fulfilled' ? tokenResult.value : {};
    const rewards = rewardsResult.status === 'fulfilled' ? rewardsResult.value : {};
    const curve = curveResult.status === 'fulfilled' ? curveResult.value : {};
    const quote = quoteResult.status === 'fulfilled' ? quoteResult.value : {};

    if (marketResult.status === 'rejected') {
      console.warn('[spacecat] market data unavailable:', marketResult.reason?.message);
    }
    if (tokenResult.status === 'rejected') {
      console.warn('[spacecat] holder count unavailable:', tokenResult.reason?.message);
    }
    if (rewardsResult.status === 'rejected') {
      console.warn('[spacecat] rewards unavailable:', rewardsResult.reason?.message);
    }
    if (curveResult.status === 'rejected') {
      console.warn('[spacecat] curve price unavailable:', curveResult.reason?.message);
    }
    if (quoteResult.status === 'rejected') {
      console.warn('[spacecat] SPCX price unavailable:', quoteResult.reason?.message);
    }

    res.json(
      buildStats({
        market,
        token,
        rewards,
        curve,
        quote,
        symbol: config.tokenSymbol,
        tokenAddress: config.tokenAddress,
      })
    );
  } catch (err) {
    next(err);
  }
});

module.exports = { router, buildStats };
