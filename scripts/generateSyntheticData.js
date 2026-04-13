/**
 * generateSyntheticData.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY SYNTHETIC DATA — for the HFT interview
 * ─────────────────────────────────────────────────────────────────────────────
 * Before testing on real markets, quants ALWAYS test on synthetic data with
 * KNOWN properties. This serves two purposes:
 *
 *   1. CORRECTNESS CHECK
 *      If you can't recover a known relationship on synthetic data, your code
 *      is wrong. Synthetic data is your unit test for the entire pipeline.
 *
 *   2. PARAMETER SENSITIVITY
 *      You can dial up/down the signal strength, spread, or volatility to
 *      understand how the strategy behaves in different market regimes.
 *
 * Our synthetic data:
 *   - Mid price follows a random walk (log returns ~ N(0, σ²))
 *   - Order book imbalance is autocorrelated with a small (but real)
 *     signal embedded: high imbalance slightly nudges the price upward
 *   - Spread is set to a realistic BTC/USDT level (~2 bps)
 *   - Book volumes reflect the embedded imbalance (so OBI is computable)
 *
 * This means the backtest SHOULD show:
 *   ✓ Positive edge at 0ms latency
 *   ✓ Shrinking / negative edge as latency increases
 *   ✓ OBI positively correlated with 1-tick future returns
 *   ✓ Signal decay over longer horizons
 *
 * USAGE: npm run generate [numTicks]
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');

/**
 * Generates synthetic order book snapshots.
 *
 * @param {number} numTicks - Number of snapshots to generate
 * @param {Object} [opts]
 * @param {number} [opts.startPrice=50000]
 * @param {number} [opts.spreadBps=2]          - Spread as basis points of mid
 * @param {number} [opts.volPerTick=0.0002]    - Std dev of log return per tick
 * @param {number} [opts.signalStrength=0.15]  - How much imbalance shifts price
 * @param {number} [opts.tickIntervalMs=100]   - Milliseconds between ticks
 * @param {number} [opts.levels=20]            - Book depth (levels per side)
 * @returns {Array} Array of raw order book snapshots
 */
function generateSyntheticOrderBook(numTicks = 20000, opts = {}) {
  const {
    startPrice     = 50000,
    // Spread of 0.5 bps is realistic for top-tier crypto venues.
    spreadBps      = 0.5,
    volPerTick     = 0.0003,
    // signalStrength = 5.0 means imbalance meaningfully moves the price each
    // tick. This is intentionally strong for the demo — it means:
    //   • At 0ms latency: you catch the signal → PROFITABLE
    //   • At 10ms latency: autocorrelation decays → still slightly positive
    //   • At 50ms latency: most of the signal has been priced in → LOSS
    //   • At 100ms latency: signal is fully stale → clear LOSS
    // This is the exact "latency collapse" story we want to demonstrate.
    signalStrength = 5.0,
    // 10ms ticks so that each of our latency values (10/50/100 ms) corresponds
    // to exactly 1/5/10 tick delays — giving visible granular decay.
    tickIntervalMs = 10,
    levels         = 20,
  } = opts;

  const ticks      = [];
  let   midPrice   = startPrice;
  let   timestamp  = Date.now() - numTicks * tickIntervalMs;
  let   prevImb    = 0;

  for (let i = 0; i < numTicks; i++) {
    // ── Generate imbalance (autocorrelated, range [-1, 1]) ───────────────
    // Persistence of 0.6 means imbalance "remembers" its past value.
    // This creates a realistic cluster effect: imbalance doesn't jump
    // randomly each tick but trends for a short burst.
    // Higher persistence = signal survives longer → clearer latency demo.
    const imbNoise   = (Math.random() * 2 - 1) * 0.6;
    const trueImb    = Math.max(-1, Math.min(1, prevImb * 0.6 + imbNoise * 0.4));

    // ── Price update: random walk + weak imbalance signal ────────────────
    const randReturn = (Math.random() * 2 - 1) * volPerTick;
    const sigReturn  = trueImb * signalStrength * (spreadBps / 10000);
    midPrice         = midPrice * (1 + randReturn + sigReturn);
    midPrice         = Math.max(startPrice * 0.5, midPrice);

    const spread  = midPrice * (spreadBps / 10000);
    const bestBid = midPrice - spread / 2;
    const bestAsk = midPrice + spread / 2;

    // ── Build book levels ─────────────────────────────────────────────────
    // Volume per level: more volume on the side that matches imbalance
    const bids = [];
    const asks = [];

    for (let lvl = 0; lvl < levels; lvl++) {
      const levelDecay  = Math.exp(-lvl * 0.25);

      // Imbalance is encoded in how much volume sits at each level
      const bidMult     = 1 + trueImb;       // > 1 when bullish
      const askMult     = 1 - trueImb;       // > 1 when bearish

      const baseVol     = 0.5 + Math.random() * 2;

      const bidPrice    = (bestBid - lvl * spread * 0.5).toFixed(2);
      const askPrice    = (bestAsk + lvl * spread * 0.5).toFixed(2);
      const bidQty      = (baseVol * bidMult * levelDecay * (0.8 + Math.random() * 0.4)).toFixed(4);
      const askQty      = (baseVol * askMult * levelDecay * (0.8 + Math.random() * 0.4)).toFixed(4);

      bids.push([bidPrice, bidQty]);
      asks.push([askPrice, askQty]);
    }

    ticks.push({
      timestamp,
      lastUpdateId: i,
      bids,
      asks,
      _trueImbalance: trueImb,   // hidden ground truth (for validation only)
    });

    prevImb    = trueImb;
    timestamp += tickIntervalMs;
  }

  return ticks;
}

// ─── Main ───────────────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const numTicks = parseInt(process.argv[2], 10) || 20000;

console.log(`[Synthetic] Generating ${numTicks} ticks...`);
const ticks = generateSyntheticOrderBook(numTicks);

const outFile = path.join(DATA_DIR, 'orderbook_ticks.json');
fs.writeFileSync(outFile, ticks.map(t => JSON.stringify(t)).join('\n'));

const prices  = ticks.map(t => parseFloat(t.bids[0][0]));
const minP    = Math.min(...prices).toFixed(2);
const maxP    = Math.max(...prices).toFixed(2);
const start   = new Date(ticks[0].timestamp).toISOString();
const end     = new Date(ticks[ticks.length - 1].timestamp).toISOString();

console.log(`[Synthetic] Saved ${ticks.length} ticks → ${outFile}`);
console.log(`[Synthetic] Time range : ${start} → ${end}`);
console.log(`[Synthetic] Price range: $${minP} – $${maxP}`);
console.log(`[Synthetic] Duration   : ${((ticks.length * 100) / 60000).toFixed(1)} minutes at 100ms/tick`);
console.log(`\n  Next step: npm run backtest\n`);

module.exports = { generateSyntheticOrderBook };
