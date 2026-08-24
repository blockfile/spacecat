'use strict';

/**
 * Stale-while-error TTL cache around a single async producer.
 *
 * Three properties matter here, and all three exist because this sits in front
 * of the only network call the site makes:
 *   - concurrent callers share one in-flight request (no thundering herd);
 *   - a value is served from memory until it is `ttlMs` old;
 *   - if a refresh throws, the LAST GOOD value keeps being served rather than
 *     propagating the error, so a Blockscout blip cannot blank a working panel.
 *
 * @param {number} ttlMs
 * @param {() => Promise<any>} fn
 * @returns {() => Promise<any>}
 */
function cached(ttlMs, fn) {
  let value;
  let hasValue = false;
  let expires = 0;
  let inflight = null;

  return async () => {
    if (hasValue && Date.now() < expires) return value;
    if (inflight) return inflight;

    inflight = (async () => {
      try {
        value = await fn();
        hasValue = true;
        expires = Date.now() + ttlMs;
        return value;
      } catch (err) {
        if (hasValue) {
          // Keep serving the last good value, but retry on the next call
          // instead of pinning a stale number for a whole TTL.
          expires = 0;
          return value;
        }
        throw err;
      } finally {
        inflight = null;
      }
    })();

    return inflight;
  };
}

module.exports = { cached };
