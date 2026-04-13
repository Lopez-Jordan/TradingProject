/**
 * executionSimulator.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS THE MOST IMPORTANT MODULE — for the HFT interview
 * ─────────────────────────────────────────────────────────────────────────────
 * Most naive backtests assume you trade at the mid price, instantly.
 * This is completely unrealistic. Here's what actually happens:
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  COST 1: SPREAD CROSSING                                             │
 * │                                                                      │
 * │  You NEVER trade at the mid price. In reality:                       │
 * │    - To BUY:  you pay the ASK  (mid + half spread)                  │
 * │    - To SELL: you receive BID  (mid - half spread)                  │
 * │                                                                      │
 * │  Round-trip cost = full spread (you pay half-spread twice)           │
 * │                                                                      │
 * │  Example: BTC at $50,000, spread = $10 (2 bps)                      │
 * │    Entry: buy at $50,005 (ask)                                       │
 * │    Exit:  sell at $49,995 (bid)                                      │
 * │    You need BTC to move > $10 just to break even.                   │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  COST 2: LATENCY — THE KEY INSIGHT OF THIS PROJECT                  │
 * │                                                                      │
 * │  When you see an imbalance signal, you cannot trade instantly.       │
 * │  Real pipeline:                                                      │
 * │                                                                      │
 * │    (1) Exchange sends data over the network   → ~1–10ms             │
 * │    (2) Your system receives and parses it     → ~0.1ms              │
 * │    (3) Signal computation and decision logic  → ~0.1ms              │
 * │    (4) Order sent back to exchange            → ~1–10ms             │
 * │    (5) Exchange processes and matches order   → ~0.1ms              │
 * │                                               ────────              │
 * │    Total "round-trip latency"                 → ~5–50ms             │
 * │                                                                      │
 * │  During that delay, FASTER TRADERS have already acted on the signal │
 * │  and the price has partially (or fully) moved.                      │
 * │                                                                      │
 * │  This is why HFT firms spend $100M+ on:                             │
 * │    - Co-location (servers physically next to the exchange)           │
 * │    - Microwave / laser towers (faster than fibre)                   │
 * │    - FPGAs (hardware-level decision making, not software)           │
 * │                                                                      │
 * │  Our simulation: test at 0ms, 10ms, 50ms, 100ms latency.           │
 * │  You will see profitability collapse as latency increases.          │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/**
 * Simulates a single trade with realistic spread cost and latency.
 *
 * @param {Array}  ticks        - Array of feature objects sorted by timestamp
 * @param {number} signalIndex  - Index of the tick where the signal fired
 * @param {number} direction    - +1 = BUY, -1 = SELL
 * @param {Object} [opts]
 * @param {number} [opts.latencyMs=0]    - Simulated round-trip latency (ms)
 * @param {number} [opts.holdTicks=5]    - How many ticks to hold the position
 * @returns {Object|null}  Trade result, or null if insufficient data
 */
function simulateTrade(ticks, signalIndex, direction, opts = {}) {
  const { latencyMs = 0, holdTicks = 5 } = opts;

  // ─────────────────────────────────────────────────────────────
  // STEP 1: Find the ENTRY tick, accounting for latency
  //
  // The signal fires at ticks[signalIndex].timestamp.
  // We can't trade until `latencyMs` milliseconds later.
  // Find the first tick with timestamp >= signalTime + latencyMs.
  //
  // This is the "adverse selection" effect of latency:
  // the price may have already moved against you by the time you get in.
  // ─────────────────────────────────────────────────────────────
  const signalTime      = ticks[signalIndex].timestamp;
  const targetEntryTime = signalTime + latencyMs;

  let entryIndex = signalIndex;
  while (entryIndex < ticks.length - 1 &&
         ticks[entryIndex].timestamp < targetEntryTime) {
    entryIndex++;
  }

  const exitIndex = entryIndex + holdTicks;
  if (exitIndex >= ticks.length) return null;

  const entryTick = ticks[entryIndex];
  const exitTick  = ticks[exitIndex];

  // ─────────────────────────────────────────────────────────────
  // STEP 2: Entry price — crossing the spread
  //
  //   BUY:  you take the BEST ASK (you're the aggressor; you take liquidity)
  //   SELL: you hit the BEST BID
  //
  // In limit-order-book parlance, we are "market orders" or "takers".
  // Takers always cross the spread. Makers (who post limit orders) earn
  // the spread, but face inventory risk and queue uncertainty.
  // ─────────────────────────────────────────────────────────────
  const entryPrice = direction === 1 ? entryTick.bestAsk : entryTick.bestBid;

  // ─────────────────────────────────────────────────────────────
  // STEP 3: Exit price — crossing the spread AGAIN
  //
  //   After a BUY:  we exit by selling at the BID
  //   After a SELL: we exit by buying back at the ASK
  //
  // So we pay the spread TWICE per round-trip trade.
  // ─────────────────────────────────────────────────────────────
  const exitPrice = direction === 1 ? exitTick.bestBid : exitTick.bestAsk;

  // ─────────────────────────────────────────────────────────────
  // STEP 4: Compute PnL
  //
  //   BUY trade:  PnL = exitBid - entryAsk
  //               (positive if price moved up enough to cover spread)
  //
  //   SELL trade: PnL = entryBid - exitAsk
  //               (positive if price moved down enough to cover spread)
  // ─────────────────────────────────────────────────────────────
  const rawPnL = direction === 1
    ? exitPrice - entryPrice
    : entryPrice - exitPrice;

  // How much did the mid price drift DURING the latency window?
  // Negative slippage means price moved against us while we waited.
  const signalMid      = ticks[signalIndex].midPrice;
  const entryMid       = entryTick.midPrice;
  const latencySlippage = direction * (entryMid - signalMid);

  return {
    signalIndex,
    entryIndex,
    exitIndex,
    direction,
    signalTime,
    entryTime:       entryTick.timestamp,
    exitTime:        exitTick.timestamp,
    signalMid,
    entryMid,
    entryPrice,
    exitPrice,
    rawPnL,
    latencySlippage,
    latencyMs,
    holdTicks,
    entrySpread:     entryTick.spread,
    exitSpread:      exitTick.spread,
    profitable:      rawPnL > 0,
  };
}

/**
 * Runs all signals through the execution model for a given latency value.
 * Prevents overlapping positions (one trade at a time — conservative).
 *
 * @param {Array}  ticks       - Feature objects
 * @param {Array}  signals     - Array of { index, direction }
 * @param {number} latencyMs   - Latency to simulate
 * @param {number} holdTicks   - Hold period in ticks
 * @returns {Array}  Array of trade results
 */
function runExecution(ticks, signals, latencyMs, holdTicks = 5) {
  const trades      = [];
  let lastExitIndex = -1;

  for (const { index, direction } of signals) {
    // Don't enter while we're still in a trade
    if (index <= lastExitIndex) continue;

    const trade = simulateTrade(ticks, index, direction, { latencyMs, holdTicks });
    if (trade) {
      trades.push(trade);
      lastExitIndex = trade.exitIndex;
    }
  }

  return trades;
}

module.exports = { simulateTrade, runExecution };
