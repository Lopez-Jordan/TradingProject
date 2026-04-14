/**
 * signalGenerator.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SIGNAL LAYER
 * ─────────────────────────────────────────────────────────────────────────────
 * Raw features (imbalance, OFI) are just numbers. A SIGNAL is a DECISION:
 * buy, sell, or do nothing.
 *
 * In this model we use a simple THRESHOLD RULE:
 *   imbalance > +threshold  → expect price UP → BUY
 *   imbalance < -threshold  → expect price DOWN → SELL
 *   otherwise               → no conviction → HOLD (flat)
 *
 * This is NOT a machine learning model. It's a rule-based system, and that's
 * intentional. Many real HFT signals at very short horizons (< 1 second) are
 * essentially this: a carefully chosen threshold on a microstructure feature.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const SIGNAL_BUY  =  1;
const SIGNAL_SELL = -1;
const SIGNAL_HOLD =  0;

/**
 * Generates a directional signal from microstructure features.
 *
 * @param {Object} features              - Output of computeFeatures()
 * @param {Object} [opts]
 * @param {number} [opts.imbalanceThreshold=0.3]  - |imbalance| cutoff for a signal
 * @returns {{ signal: number, reason: string }}
 */
function generateSignal(features, opts = {}) {
  const { imbalanceThreshold = 0.3 } = opts;

  if (!features) return { signal: SIGNAL_HOLD, reason: 'No data' };

  const { imbalance } = features;

  if (imbalance > imbalanceThreshold) {
    return {
      signal: SIGNAL_BUY,
      reason: `Strong bid pressure — imbalance=${imbalance.toFixed(3)}`,
    };
  }

  if (imbalance < -imbalanceThreshold) {
    return {
      signal: SIGNAL_SELL,
      reason: `Strong ask pressure — imbalance=${imbalance.toFixed(3)}`,
    };
  }

  return {
    signal: SIGNAL_HOLD,
    reason: `Weak signal — imbalance=${imbalance.toFixed(3)}`,
  };
}

/**
 * Higher-confidence signal: requires BOTH OBI and OFI to agree.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY COMBINE OBI + OFI?
 * ───────────────────────────────────────────────────────────────────────────
 * OBI alone can give false signals — the book might LOOK imbalanced but
 * nothing is actually happening (large passive orders sitting there).
 *
 * OFI tells us whether order flow is ACTIVELY moving in that direction.
 * Requiring both to agree is a basic form of signal confirmation and
 * reduces the false-positive rate (at the cost of fewer total signals).
 *
 * In HFT, fewer higher-quality signals often beat many noisy ones.
 *
 * @param {Object} features
 * @param {number} ofi
 * @param {Object} [opts]
 * @param {number} [opts.imbalanceThreshold=0.3]
 * @param {number} [opts.ofiThreshold=0]       - OFI must be strictly above this
 * @returns {{ signal: number, reason: string }}
 */
function generateSignalWithOFI(features, ofi, opts = {}) {
  const { imbalanceThreshold = 0.3, ofiThreshold = 0 } = opts;

  if (!features) return { signal: SIGNAL_HOLD, reason: 'No data' };

  const { imbalance } = features;

  if (imbalance > imbalanceThreshold && ofi > ofiThreshold) {
    return {
      signal: SIGNAL_BUY,
      reason: `OBI+OFI BUY — imb=${imbalance.toFixed(3)}, ofi=${ofi.toFixed(2)}`,
    };
  }

  if (imbalance < -imbalanceThreshold && ofi < -ofiThreshold) {
    return {
      signal: SIGNAL_SELL,
      reason: `OBI+OFI SELL — imb=${imbalance.toFixed(3)}, ofi=${ofi.toFixed(2)}`,
    };
  }

  return { signal: SIGNAL_HOLD, reason: 'No confirmed signal' };
}

module.exports = {
  SIGNAL_BUY,
  SIGNAL_SELL,
  SIGNAL_HOLD,
  generateSignal,
  generateSignalWithOFI,
};
