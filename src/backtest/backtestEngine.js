/**
 * backtestEngine.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY BACKTEST — for the HFT interview
 * ─────────────────────────────────────────────────────────────────────────────
 * A backtest answers: "If I had run this strategy on historical data, what
 * would have happened?" It's how quants validate (or reject) ideas before
 * risking real capital.
 *
 * COMMON BACKTEST PITFALLS you should know:
 *
 *   1. LOOK-AHEAD BIAS
 *      Using data from the future to make a past decision.
 *      Example: using tomorrow's closing price to decide today's trade.
 *      We avoid this by only using data available at tick T when deciding
 *      whether to trade at tick T.
 *
 *   2. OVERFITTING
 *      Tuning parameters (like imbalanceThreshold) to fit historical data
 *      so perfectly that the model has no predictive power on NEW data.
 *      Fix: out-of-sample testing, walk-forward analysis.
 *
 *   3. MARKET IMPACT
 *      Large orders move the price. We assume our orders are small enough
 *      not to move the market. In real HFT, sizing and impact are critical.
 *
 *   4. FILL ASSUMPTIONS
 *      We assume our orders fill instantly at the quoted price. In reality,
 *      you may not get filled (queue position), or get a worse price
 *      (slippage). This is a known source of backtest optimism.
 *
 * Our backtest is deliberately simple: one position at a time, market orders,
 * no market impact. The goal is to isolate the SPREAD + LATENCY effect.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { computeFeatures, computeOFI, computeFutureReturn } = require('../features/microstructure');
const { generateSignal, SIGNAL_HOLD }                      = require('../signal/signalGenerator');
const { runExecution }                                     = require('../execution/executionSimulator');

/**
 * Full backtest pipeline: raw tick data → PnL results at multiple latencies.
 *
 * @param {Array}  rawTicks - Raw order book snapshots (NDJSON lines, parsed)
 * @param {Object} [config]
 * @param {number} [config.imbalanceThreshold=0.3]
 * @param {number} [config.holdTicks=5]
 * @param {number[]} [config.latencyValues=[0,10,50,100]]
 * @param {number} [config.featureLevels=5]
 * @returns {Object}
 */
function runBacktest(rawTicks, config = {}) {
  const {
    imbalanceThreshold = 0.3,
    holdTicks          = 5,
    latencyValues      = [0, 10, 50, 100],
    featureLevels      = 5,
  } = config;

  console.log(`\n[Backtest] Processing ${rawTicks.length} raw ticks...`);

  // ─────────────────────────────────────────────────────────
  // PHASE 1: Compute features for every tick
  // ─────────────────────────────────────────────────────────
  const ticks       = [];
  let prevFeatures  = null;

  for (const raw of rawTicks) {
    const features = computeFeatures(raw, featureLevels);
    if (!features) continue;

    const ofi = computeOFI(prevFeatures, features);
    ticks.push({ ...features, ofi });
    prevFeatures = features;
  }

  console.log(`[Backtest] Features computed: ${ticks.length} valid ticks`);

  // ─────────────────────────────────────────────────────────
  // PHASE 2: Compute future returns at multiple horizons
  //
  // For every tick, pre-compute "what did mid price do over the
  // next 1 / 5 / 10 / 20 ticks?" — the ground truth labels.
  // ─────────────────────────────────────────────────────────
  const horizons = [1, 5, 10, 20];
  for (let i = 0; i < ticks.length; i++) {
    ticks[i].futureReturns = {};
    for (const h of horizons) {
      ticks[i].futureReturns[h] = computeFutureReturn(ticks, i, h);
    }
  }

  // ─────────────────────────────────────────────────────────
  // PHASE 3: Generate signals
  // ─────────────────────────────────────────────────────────
  const signals = [];
  for (let i = 0; i < ticks.length; i++) {
    const { signal } = generateSignal(ticks[i], { imbalanceThreshold });
    if (signal !== SIGNAL_HOLD) {
      signals.push({ index: i, direction: signal });
    }
  }

  console.log(`[Backtest] Signals generated: ${signals.length} (${((signals.length / ticks.length) * 100).toFixed(1)}% of ticks)`);

  // ─────────────────────────────────────────────────────────
  // PHASE 4: Run execution at each latency value
  //
  // This is the KEY demonstration: the same signals, same hold period,
  // but different latencies → dramatically different profitability.
  // ─────────────────────────────────────────────────────────
  const resultsByLatency = {};
  for (const latencyMs of latencyValues) {
    const trades   = runExecution(ticks, signals, latencyMs, holdTicks);
    const totalPnL = trades.reduce((s, t) => s + t.rawPnL, 0);
    const wins     = trades.filter(t => t.profitable).length;
    const winRate  = trades.length > 0 ? wins / trades.length : 0;
    const avgPnL   = trades.length > 0 ? totalPnL / trades.length : 0;

    resultsByLatency[latencyMs] = { latencyMs, tradeCount: trades.length, totalPnL, avgPnL, winRate, trades };

    console.log(
      `[Backtest] Latency=${String(latencyMs + 'ms').padEnd(6)}` +
      ` trades=${String(trades.length).padEnd(6)}` +
      ` totalPnL=${totalPnL.toFixed(4).padStart(10)}` +
      ` winRate=${(winRate * 100).toFixed(1)}%`,
    );
  }

  // ─────────────────────────────────────────────────────────
  // PHASE 5: Imbalance vs Future Return analysis
  //
  // Bucket ticks by imbalance value and compute the average future
  // return per bucket. This chart should show a clear monotone
  // relationship: higher imbalance → higher future return.
  //
  // If it DOESN'T, our signal has no predictive value whatsoever.
  // ─────────────────────────────────────────────────────────
  const imbalanceBuckets = computeImbalanceBuckets(ticks);

  // ─────────────────────────────────────────────────────────
  // PHASE 6: Signal decay
  //
  // Compute the signal's "edge" (average return conditional on signal
  // direction) at horizons 1, 5, 10, 20 ticks.
  //
  // You should see edge shrink as horizon grows → the signal is
  // SHORT-TERM only. By horizon=20 it should be near zero.
  // ─────────────────────────────────────────────────────────
  const signalDecay = computeSignalDecay(ticks, imbalanceThreshold, horizons);

  return {
    tickCount:   ticks.length,
    signalCount: signals.length,
    ticks,
    resultsByLatency,
    imbalanceBuckets,
    signalDecay,
    config: { imbalanceThreshold, holdTicks, latencyValues, featureLevels },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Buckets imbalance values and computes the average future return per bucket.
 *
 * If the signal is valid, you'll see a monotone relationship:
 *   bucket[-1.0] → large negative average return
 *   bucket[ 0.0] → average return near zero
 *   bucket[+1.0] → large positive average return
 */
function computeImbalanceBuckets(ticks, horizon = 5, numBuckets = 10) {
  // Pre-allocate buckets uniformly from -1 to +1
  const buckets = Array.from({ length: numBuckets }, (_, i) => ({
    low:     -1 + (2 * i / numBuckets),
    high:    -1 + (2 * (i + 1) / numBuckets),
    mid:     parseFloat((-1 + (2 * (i + 0.5) / numBuckets)).toFixed(2)),
    returns: [],
    count:   0,
  }));

  for (const tick of ticks) {
    const ret = tick.futureReturns[horizon];
    if (ret === null || ret === undefined) continue;

    // Map imbalance ∈ [-1, 1] → bucket index ∈ [0, numBuckets-1]
    const bi = Math.min(
      Math.floor(((tick.imbalance + 1) / 2) * numBuckets),
      numBuckets - 1,
    );
    buckets[bi].returns.push(ret);
    buckets[bi].count++;
  }

  return buckets.map(b => ({
    imbalanceMid: b.mid,
    avgReturn:    b.count > 0 ? b.returns.reduce((a, c) => a + c, 0) / b.count : 0,
    count:        b.count,
  }));
}

/**
 * Measures the signal's predictive power across multiple time horizons.
 *
 * Edge = (average return on BUY signals) - (average return on SELL signals)
 * A high edge at horizon=1 but low edge at horizon=20 confirms this is a
 * SHORT-HORIZON signal — exactly what you want to demonstrate.
 */
function computeSignalDecay(ticks, threshold, horizons) {
  return horizons.map(horizon => {
    const buySignals  = ticks.filter(t => t.imbalance >  threshold && t.futureReturns[horizon] != null);
    const sellSignals = ticks.filter(t => t.imbalance < -threshold && t.futureReturns[horizon] != null);

    const mean = (arr, key) =>
      arr.length > 0 ? arr.reduce((s, t) => s + t.futureReturns[key], 0) / arr.length : 0;

    const buyAvgReturn  = mean(buySignals,  horizon);
    const sellAvgReturn = mean(sellSignals, horizon);
    const edge          = buyAvgReturn - sellAvgReturn;

    return {
      horizon,
      buyAvgReturn,
      sellAvgReturn,
      edge,
      buyCount:  buySignals.length,
      sellCount: sellSignals.length,
    };
  });
}

module.exports = { runBacktest };
