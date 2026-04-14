/**
 * metrics.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE METRICS
 * ─────────────────────────────────────────────────────────────────────────────
 * HFT metrics differ from traditional portfolio metrics. Key ones:
 *
 *   SHARPE RATIO
 *     Risk-adjusted return = avgPnL / stdDev(PnL)
 *     HFT strategies typically need Sharpe > 2–3 annualized to be viable
 *     after infrastructure and technology costs.
 *
 *   WIN RATE
 *     % of trades that are profitable.
 *     HFT strategies often have win rates between 50–65%.
 *     A 55% win rate sounds modest but is enormously profitable at scale
 *     (millions of trades/day × tiny positive expected value).
 *
 *   AVERAGE TRADE PnL
 *     The expected profit per trade. Even fractions of a basis point
 *     × millions of trades = significant profit.
 *
 *   MAX DRAWDOWN
 *     Worst peak-to-trough cumulative loss. Determines capital reserves.
 *     HFT firms are extremely sensitive to drawdown — a strategy that
 *     occasionally loses $1M in a day is very different from one that
 *     loses steadily and predictably.
 *
 *   TRADE COUNT
 *     HFT firms make money through VOLUME × EDGE, not large per-trade gains.
 *     A strategy with 0.1 bps edge × 100,000 trades/day = substantial profit.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/**
 * Computes summary performance metrics from a list of trades.
 *
 * @param {Array} trades - Trade result objects from executionSimulator
 * @returns {Object}
 */
function computeMetrics(trades) {
  if (!trades || trades.length === 0) {
    return { tradeCount: 0, totalPnL: 0, avgPnL: 0, winRate: 0, sharpe: 0, maxDrawdown: 0, stdDev: 0, cumPnLSeries: [] };
  }

  const pnls    = trades.map(t => t.rawPnL);
  const totalPnL = pnls.reduce((s, p) => s + p, 0);
  const avgPnL  = totalPnL / pnls.length;
  const wins    = pnls.filter(p => p > 0).length;
  const winRate = wins / pnls.length;

  // Standard deviation of per-trade PnL
  const variance = pnls.reduce((s, p) => s + (p - avgPnL) ** 2, 0) / pnls.length;
  const stdDev   = Math.sqrt(variance);

  // Per-trade Sharpe (avgPnL / stdDev)
  // Note: annualizing requires knowing trades-per-year; we leave that to context.
  const sharpe = stdDev > 0 ? avgPnL / stdDev : 0;

  // Max drawdown (largest peak-to-trough in cumulative PnL)
  let peak = 0;
  let cumPnL = 0;
  let maxDrawdown = 0;
  const cumPnLSeries = [];

  for (const p of pnls) {
    cumPnL += p;
    cumPnLSeries.push(cumPnL);
    if (cumPnL > peak) peak = cumPnL;
    const dd = peak - cumPnL;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return { tradeCount: trades.length, totalPnL, avgPnL, winRate, sharpe, maxDrawdown, stdDev, cumPnLSeries };
}

module.exports = { computeMetrics };
