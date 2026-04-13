/**
 * microstructure.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE FEATURES — for the HFT interview
 * ─────────────────────────────────────────────────────────────────────────────
 * Market microstructure is the study of HOW trading actually happens at a
 * microscopic level. HFT firms care about this because the order book contains
 * predictive information about SHORT-TERM price moves BEFORE they appear in
 * any candle or trade feed.
 *
 * Think of it this way: if Amazon is about to raise its prices, you'd want to
 * know BEFORE the price changes. The order book is the market's "intent" — it
 * shows what participants are WILLING to do, not just what's already happened.
 *
 * The features we compute here are the building blocks of most real HFT signals.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/**
 * Computes all microstructure features from a single order book snapshot.
 *
 * @param {Object} snapshot - Raw Binance depth snapshot
 *   snapshot.bids → array of [priceStr, qtyStr] sorted best → worst
 *   snapshot.asks → array of [priceStr, qtyStr] sorted best → worst
 * @param {number} N - Number of book levels to use (top N bids and asks)
 * @returns {Object|null}
 */
function computeFeatures(snapshot, N = 5) {
  // Parse the top N levels
  const bids = snapshot.bids.slice(0, N).map(([p, q]) => [parseFloat(p), parseFloat(q)]);
  const asks = snapshot.asks.slice(0, N).map(([p, q]) => [parseFloat(p), parseFloat(q)]);

  if (bids.length === 0 || asks.length === 0) return null;

  const bestBid = bids[0][0];
  const bestAsk = asks[0][0];

  // ───────────────────────────────────────────────────────────
  // MID PRICE
  // The arithmetic average of the best bid and best ask.
  // This is the standard proxy for the asset's "true" price.
  //
  // We use mid price instead of the last trade price because:
  //   - Last trade bounces between bid and ask (bid-ask bounce)
  //   - Mid is smoother and less noisy for measuring returns
  // ───────────────────────────────────────────────────────────
  const midPrice = (bestBid + bestAsk) / 2;

  // ───────────────────────────────────────────────────────────
  // SPREAD
  // The gap between the best ask and the best bid.
  // This is the MINIMUM cost to immediately buy AND sell.
  //
  // If spread = $10 on a $50,000 BTC:
  //   - Spread in bps = (10 / 50000) * 10000 = 2 bps
  //   - Every round-trip trade costs you 2 bps in spread alone
  //
  // Key insight: your signal must be right ENOUGH to overcome this cost.
  // If average edge per trade < spread, you lose money even with a
  // perfect signal.
  // ───────────────────────────────────────────────────────────
  const spread    = bestAsk - bestBid;
  const spreadBps = (spread / midPrice) * 10000;  // basis points

  // ───────────────────────────────────────────────────────────
  // ORDER BOOK IMBALANCE (OBI) — THE KEY SIGNAL
  //
  // Formula: (bid_vol - ask_vol) / (bid_vol + ask_vol)
  // Range:   [-1, +1]
  //
  //   +1 = only bids, no asks → pure buy pressure → price likely ↑
  //   -1 = only asks, no bids → pure sell pressure → price likely ↓
  //    0 = perfectly balanced → no directional signal
  //
  // WHY DOES IT WORK?
  //   Market makers continuously quote both sides. If one side gets
  //   consumed faster (imbalanced), the price must shift to attract
  //   new liquidity on the depleted side. Imbalance is essentially
  //   the market's short-term supply/demand signal.
  //
  //   Academic reference: Cont, Kukanov, Stoikov (2014)
  //   "The Price Impact of Order Book Events"
  // ───────────────────────────────────────────────────────────
  const bidVolume  = bids.reduce((sum, [, q]) => sum + q, 0);
  const askVolume  = asks.reduce((sum, [, q]) => sum + q, 0);
  const totalVolume = bidVolume + askVolume;
  const imbalance  = (bidVolume - askVolume) / totalVolume;

  // ───────────────────────────────────────────────────────────
  // WEIGHTED MID PRICE (WMID)
  // A smarter version of mid price that accounts for imbalance.
  //
  // Formula: ask * (bid_vol/total) + bid * (ask_vol/total)
  //
  // Intuition: if there's 3x more bid volume than ask volume,
  // the "true" price is closer to the ask (buyers are pushing it up).
  // WMID captures this. It's used in many real HFT strategies as a
  // better proxy for fair value than plain mid price.
  // ───────────────────────────────────────────────────────────
  const weightedMid = bestAsk * (bidVolume / totalVolume) + bestBid * (askVolume / totalVolume);

  return {
    timestamp:   snapshot.timestamp,
    bestBid,
    bestAsk,
    midPrice,
    weightedMid,
    spread,
    spreadBps,
    bidVolume,
    askVolume,
    imbalance,
    rawBids: bids,
    rawAsks: asks,
  };
}

/**
 * Computes Order Flow Imbalance (OFI) between two consecutive snapshots.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY OFI IS BETTER THAN STATIC OBI
 * ───────────────────────────────────────────────────────────────────────────
 * OBI is a STATIC measure — it's a snapshot of the book right now.
 * OFI is a DYNAMIC measure — it measures the CHANGE in order flow.
 *
 * Specifically, OFI tracks ORDER ARRIVALS and CANCELLATIONS at the best
 * bid and ask. These events cause price moves BEFORE the mid price changes.
 *
 * Example:
 *   At time T:   best bid = $50,000 with volume 5 BTC
 *   At time T+1: best bid = $50,000 with volume 8 BTC (someone added 3 BTC)
 *   → bidOFI = +3 (more buying interest arrived)
 *
 * A large positive OFI means buyers are piling in → price pressure upward.
 *
 * @param {Object|null} prevFeatures
 * @param {Object}      currFeatures
 * @returns {number}
 */
function computeOFI(prevFeatures, currFeatures) {
  if (!prevFeatures || !currFeatures) return 0;

  // OFI contribution from the best bid side
  let bidOFI = 0;
  if (currFeatures.bestBid >= prevFeatures.bestBid) {
    // Best bid held or improved → count current best bid volume
    bidOFI = currFeatures.rawBids[0][1];
  } else {
    // Best bid retreated (buyers withdrew) → subtract previous volume
    bidOFI = -prevFeatures.rawBids[0][1];
  }

  // OFI contribution from the best ask side
  let askOFI = 0;
  if (currFeatures.bestAsk <= prevFeatures.bestAsk) {
    // Best ask held or improved (more aggressive sellers) → subtract
    askOFI = -currFeatures.rawAsks[0][1];
  } else {
    // Best ask retreated (sellers withdrew) → add back
    askOFI = prevFeatures.rawAsks[0][1];
  }

  return bidOFI + askOFI;
}

/**
 * Computes the realized mid-price return over a future horizon.
 *
 * This is the GROUND TRUTH used in backtesting:
 * "Given a signal at time T, how much did the price ACTUALLY move
 * over the next `horizon` ticks?"
 *
 * Expressed as a fractional return (e.g. 0.00002 = 0.002% = 0.2 bps)
 *
 * @param {Array}  ticks    - Array of feature objects with .midPrice
 * @param {number} index    - Current tick index
 * @param {number} horizon  - How many ticks forward to measure
 * @returns {number|null}
 */
function computeFutureReturn(ticks, index, horizon = 5) {
  const futureIndex = index + horizon;
  if (futureIndex >= ticks.length) return null;
  const curr   = ticks[index].midPrice;
  const future = ticks[futureIndex].midPrice;
  return (future - curr) / curr;
}

module.exports = { computeFeatures, computeOFI, computeFutureReturn };
