'use strict';

// Fetch JSON with retry on transient upstream failures.
//
// Blockscout sits behind Cloudflare and intermittently returns 520/5xx/429, and
// DexScreener rate-limits. A single blip must not blank the site's stats panel,
// so those statuses are retried with backoff; genuinely non-retryable responses
// (e.g. 404 for an unlisted token) and network errors past the retry budget throw.

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET `url` and parse JSON, retrying transient failures.
 * @param {string} url
 * @param {{headers?: object, retries?: number, delayMs?: number,
 *          sleepFn?: (ms:number)=>Promise<void>, fetchFn?: typeof fetch}} [opts]
 */
async function fetchJson(url, { headers, retries = 3, delayMs = 1000, sleepFn = sleep, fetchFn = fetch } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let res;
    try {
      res = await fetchFn(url, { headers });
    } catch (err) {
      lastErr = err; // network / DNS / socket error — retryable
      if (attempt === retries) throw err;
      await sleepFn(delayMs);
      continue;
    }

    if (res.ok) return res.json();

    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    if (!RETRYABLE_STATUS.has(res.status) || attempt === retries) throw err;
    lastErr = err;
    await sleepFn(delayMs);
  }
  throw lastErr; // unreachable (loop returns or throws), kept for clarity
}

module.exports = { fetchJson, RETRYABLE_STATUS };
