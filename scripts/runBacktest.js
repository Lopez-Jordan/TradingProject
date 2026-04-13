/**
 * runBacktest.js
 *
 * Main backtest runner. Loads tick data, runs the full pipeline, prints
 * a formatted results table, and exports CSV files to /output/.
 *
 * USAGE:
 *   npm run backtest
 *
 * EXPECTED RESULTS (with synthetic data at 10ms ticks):
 *   Latency=0ms   → positive total PnL  (signal captured before it decays)
 *   Latency=10ms  → PnL declines        (1 tick = signal partially stale)
 *   Latency=50ms  → PnL near zero       (5 ticks = most edge gone)
 *   Latency=100ms → negative PnL        (10 ticks = fully stale signal)
 *
 * Note: with real Binance data (100ms ticks) all latencies below 100ms
 * will appear identical since the tick resolution is the limiting factor.
 * The synthetic data uses 10ms ticks specifically to demonstrate this decay.
 *
 * This demonstrates the core HFT thesis:
 *   "The signal has predictive power, but it only exists for fast traders."
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { runBacktest }          = require('../src/backtest/backtestEngine');
const { computeMetrics }       = require('../src/analysis/metrics');
const {
  exportPnLVsLatency,
  exportImbalanceBuckets,
  exportSignalDecay,
  exportTrades,
  exportTickData,
} = require('../src/analysis/csvExporter');

// ANSI
const R      = '\x1b[0m';
const B      = '\x1b[1m';
const DIM    = '\x1b[2m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';

// ─────────────────────────────────────────────────────────────────────────────
// Load tick data
// ─────────────────────────────────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, '../data/orderbook_ticks.json');

if (!fs.existsSync(DATA_FILE)) {
  console.error(`\n${RED}[Error] No data file found at: ${DATA_FILE}${R}`);
  console.error(`\nRun one of these first:`);
  console.error(`  ${GREEN}npm run generate${R}   ← use synthetic data (instant, good for testing)`);
  console.error(`  ${GREEN}npm run collect${R}    ← collect real Binance data (5 min)\n`);
  process.exit(1);
}

console.log(`\n[Backtest] Loading ${DATA_FILE}...`);
const rawLines = fs.readFileSync(DATA_FILE, 'utf8').trim().split('\n');
const rawTicks = rawLines
  .filter(l => l.trim())
  .map(line => JSON.parse(line));

console.log(`[Backtest] Loaded ${rawTicks.length} raw ticks\n`);

// ─────────────────────────────────────────────────────────────────────────────
// Backtest configuration
// Change these to explore sensitivity:
//   - Lower threshold → more signals (noisier)
//   - Higher threshold → fewer signals (higher quality but smaller sample)
//   - More holdTicks → hold longer (signal decays; generally worse)
// ─────────────────────────────────────────────────────────────────────────────
const config = {
  imbalanceThreshold: 0.3,         // Signal fires when |imbalance| > 0.3
  holdTicks:          5,           // Hold for 5 ticks (~500ms at 100ms/tick)
  latencyValues:      [0, 10, 50, 100],  // ms
  featureLevels:      5,           // Use top 5 price levels
};

const results = runBacktest(rawTicks, config);

// ─────────────────────────────────────────────────────────────────────────────
// Print results table
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${B}${'═'.repeat(62)}${R}`);
console.log(`${B}  BACKTEST RESULTS — Order Book Imbalance Signal${R}`);
console.log(`${B}${'═'.repeat(62)}${R}`);
console.log(`  ${DIM}Ticks: ${results.tickCount}  |  Signals: ${results.signalCount}  |  Threshold: ${config.imbalanceThreshold}  |  Hold: ${config.holdTicks} ticks${R}\n`);

// ── PnL vs Latency ───────────────────────────────────────────────────────────
console.log(`${B}  PnL vs Latency  ${YELLOW}(the key result)${R}`);
console.log(`  ${'─'.repeat(58)}`);
console.log(`  ${'Latency'.padEnd(10)} ${'Trades'.padEnd(8)} ${'Total PnL ($)'.padEnd(16)} ${'Avg PnL ($)'.padEnd(14)} ${'Win %'}`);
console.log(`  ${'─'.repeat(58)}`);

for (const [lat, res] of Object.entries(results.resultsByLatency)) {
  const m       = computeMetrics(res.trades);
  const pnlSign = res.totalPnL >= 0 ? GREEN : RED;
  const avgSign = res.avgPnL   >= 0 ? GREEN : RED;
  const arrow   = res.totalPnL >= 0 ? '▲' : '▼';

  const latStr  = (lat + 'ms').padEnd(10);
  const cntStr  = String(res.tradeCount).padEnd(8);
  const pnlStr  = `${pnlSign}${arrow} ${Math.abs(res.totalPnL).toFixed(4)}${R}`.padEnd(28);
  const avgStr  = `${avgSign}${res.avgPnL >= 0 ? '+' : '-'}${Math.abs(res.avgPnL).toFixed(6)}${R}`.padEnd(26);
  const winStr  = `${(res.winRate * 100).toFixed(1)}%`;

  console.log(`  ${latStr}${cntStr}${pnlStr}${avgStr}${winStr}`);
}

// ── Signal Decay ──────────────────────────────────────────────────────────────
console.log(`\n${B}  Signal Decay  ${YELLOW}(how fast predictive power fades)${R}`);
console.log(`  ${'─'.repeat(58)}`);
console.log(`  ${'Horizon'.padEnd(14)} ${'Buy Avg Ret'.padEnd(16)} ${'Sell Avg Ret'.padEnd(16)} ${'Edge (bps)'.padEnd(12)} Counts`);
console.log(`  ${'─'.repeat(58)}`);

for (const row of results.signalDecay) {
  const edgeBps  = (row.edge * 10000).toFixed(3);
  const eColor   = row.edge > 0 ? GREEN : RED;
  console.log(
    `  ${(row.horizon + ' ticks').padEnd(14)}` +
    `${(row.buyAvgReturn  * 10000).toFixed(3).padStart(8)} bps    ` +
    `${(row.sellAvgReturn * 10000).toFixed(3).padStart(8)} bps    ` +
    `${eColor}${String(edgeBps).padStart(8)} bps${R}    ` +
    `${DIM}${row.buyCount}B / ${row.sellCount}S${R}`,
  );
}

// ── Key Insight ───────────────────────────────────────────────────────────────
console.log(`\n${B}  KEY INSIGHTS${R}`);
console.log(`  ${'─'.repeat(58)}`);

const r0  = results.resultsByLatency[0];
const r10 = results.resultsByLatency[10];
const r100 = results.resultsByLatency[100];

if (r0 && r100) {
  const direction = r0.totalPnL > 0 && r100.totalPnL < r0.totalPnL ? '✓' : '~';
  console.log(`  ${GREEN}${direction}${R} At 0ms  latency: PnL = ${r0.totalPnL  >= 0 ? GREEN : RED}${r0.totalPnL.toFixed(4)}${R}`);
  console.log(`  ${GREEN}${direction}${R} At 100ms latency: PnL = ${r100.totalPnL >= 0 ? GREEN : RED}${r100.totalPnL.toFixed(4)}${R}`);
}
console.log(`\n  ${YELLOW}Order book imbalance has real predictive power,${R}`);
console.log(`  ${YELLOW}but profitability collapses under realistic latency.${R}`);
console.log(`  ${YELLOW}This is why HFT is an arms race in speed.${R}`);
console.log(`  ${YELLOW}Signal ≠ Edge. Edge = Signal − Cost − Latency.${R}`);

// ─────────────────────────────────────────────────────────────────────────────
// Export CSVs
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B}  Exporting CSV files → /output/${R}`);
console.log(`  ${'─'.repeat(58)}`);

exportPnLVsLatency(results.resultsByLatency);
exportImbalanceBuckets(results.imbalanceBuckets);
exportSignalDecay(results.signalDecay);
exportTickData(results.ticks.slice(0, 10000));

for (const [lat, res] of Object.entries(results.resultsByLatency)) {
  if (res.trades.length > 0) exportTrades(res.trades, lat);
}

console.log(`\n${B}  Done.${R} Open /output/ to view CSVs.\n`);
