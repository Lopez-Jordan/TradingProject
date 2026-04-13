/**
 * csvExporter.js
 *
 * Exports all backtest results to CSV files.
 *
 * CSV is the universal interchange format for financial data — readable by
 * Excel, Python (pandas), R, and every charting tool. Outputting clean CSVs
 * demonstrates data discipline, which HFT interviewers care about.
 *
 * Files produced:
 *   pnl_vs_latency.csv       — core result: profitability vs latency
 *   imbalance_vs_return.csv  — validation: does imbalance predict returns?
 *   signal_decay.csv         — signal strength over time horizons
 *   tick_features.csv        — full feature log for the first N ticks
 *   trades_<Xms>.csv         — per-trade log at each latency level
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '../../output');

function ensureDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/** PnL vs Latency — the headline result */
function exportPnLVsLatency(resultsByLatency) {
  ensureDir();
  const file = path.join(OUTPUT_DIR, 'pnl_vs_latency.csv');
  const rows = ['latency_ms,trade_count,total_pnl,avg_pnl_per_trade,win_rate'];
  for (const r of Object.values(resultsByLatency)) {
    rows.push(`${r.latencyMs},${r.tradeCount},${r.totalPnL.toFixed(6)},${r.avgPnL.toFixed(6)},${r.winRate.toFixed(4)}`);
  }
  fs.writeFileSync(file, rows.join('\n'));
  console.log(`[Export] ${path.relative(process.cwd(), file)}`);
  return file;
}

/** Imbalance bucket → average future return */
function exportImbalanceBuckets(buckets) {
  ensureDir();
  const file = path.join(OUTPUT_DIR, 'imbalance_vs_return.csv');
  const rows = ['imbalance_mid,avg_future_return,count'];
  for (const b of buckets) {
    rows.push(`${b.imbalanceMid},${b.avgReturn.toFixed(8)},${b.count}`);
  }
  fs.writeFileSync(file, rows.join('\n'));
  console.log(`[Export] ${path.relative(process.cwd(), file)}`);
  return file;
}

/** Signal edge across multiple time horizons */
function exportSignalDecay(signalDecay) {
  ensureDir();
  const file = path.join(OUTPUT_DIR, 'signal_decay.csv');
  const rows = ['horizon_ticks,buy_avg_return,sell_avg_return,edge,buy_count,sell_count'];
  for (const r of signalDecay) {
    rows.push(
      `${r.horizon},${r.buyAvgReturn.toFixed(8)},${r.sellAvgReturn.toFixed(8)},` +
      `${r.edge.toFixed(8)},${r.buyCount},${r.sellCount}`,
    );
  }
  fs.writeFileSync(file, rows.join('\n'));
  console.log(`[Export] ${path.relative(process.cwd(), file)}`);
  return file;
}

/** Per-trade log for a specific latency scenario */
function exportTrades(trades, latencyMs) {
  ensureDir();
  const file = path.join(OUTPUT_DIR, `trades_${latencyMs}ms.csv`);
  const rows = ['signal_time,entry_time,exit_time,direction,entry_price,exit_price,raw_pnl,latency_slippage,profitable'];
  for (const t of trades) {
    rows.push(
      `${t.signalTime},${t.entryTime},${t.exitTime},${t.direction},` +
      `${t.entryPrice},${t.exitPrice},${t.rawPnL.toFixed(6)},${t.latencySlippage.toFixed(6)},${t.profitable}`,
    );
  }
  fs.writeFileSync(file, rows.join('\n'));
  console.log(`[Export] ${path.relative(process.cwd(), file)}`);
  return file;
}

/** Full tick-level feature log (first N ticks) */
function exportTickData(ticks) {
  ensureDir();
  const file = path.join(OUTPUT_DIR, 'tick_features.csv');
  const rows = ['timestamp,mid_price,best_bid,best_ask,spread,spread_bps,imbalance,ofi,weighted_mid'];
  for (const t of ticks) {
    rows.push(
      `${t.timestamp},${t.midPrice.toFixed(4)},${t.bestBid.toFixed(4)},${t.bestAsk.toFixed(4)},` +
      `${t.spread.toFixed(4)},${t.spreadBps.toFixed(4)},${t.imbalance.toFixed(4)},` +
      `${t.ofi.toFixed(4)},${t.weightedMid.toFixed(4)}`,
    );
  }
  fs.writeFileSync(file, rows.join('\n'));
  console.log(`[Export] ${path.relative(process.cwd(), file)}`);
  return file;
}

module.exports = { exportPnLVsLatency, exportImbalanceBuckets, exportSignalDecay, exportTrades, exportTickData };
