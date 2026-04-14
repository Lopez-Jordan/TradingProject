/**
 * collectData.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY COLLECT REAL DATA
 * ─────────────────────────────────────────────────────────────────────────────
 * Synthetic data proves your code is correct. Real data proves your strategy
 * is relevant to actual markets. The differences matter:
 *
 *   - Real spreads fluctuate (wider during news, tighter in calm markets)
 *   - Real imbalance has fat tails (sudden spikes during liquidations)
 *   - Real prices have micro-structure patterns (clustering at round numbers)
 *   - Real books have spoofing, layering, and quote stuffing you can't model
 *
 * Run this for 5–15 minutes to collect enough ticks for a meaningful backtest.
 * The Binance stream sends ~600 snapshots/minute at 100ms intervals.
 * 10 minutes ≈ 6,000 ticks, which gives ~300–500 signals to backtest.
 *
 * Data is saved as NDJSON (Newline-Delimited JSON):
 *   - One JSON object per line
 *   - Can be streamed/parsed without loading the whole file into memory
 *   - Industry standard format for high-frequency tick logs
 *
 * USAGE:
 *   npm run collect              → collect for 5 minutes (default)
 *   node scripts/collectData.js 120000  → collect for 2 minutes
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { createOrderBookStream } = require('../src/data/binanceStream');
const { computeFeatures }       = require('../src/features/microstructure');

const DATA_DIR    = path.join(__dirname, '../data');
const DURATION_MS = parseInt(process.argv[2], 10) || 5 * 60 * 1000;  // 5 min default

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const outFile = path.join(DATA_DIR, 'orderbook_ticks.json');
const stream  = fs.createWriteStream(outFile, { flags: 'w' });

let tickCount = 0;
let lastPrint = Date.now();

const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

console.log(`\n${BOLD}Order Book Data Collector — BTC/USDT${RESET}`);
console.log(`Duration : ${DURATION_MS / 1000}s`);
console.log(`Output   : ${outFile}`);
console.log(`\nPress Ctrl+C to stop early.\n`);

const ws = createOrderBookStream('btcusdt', 20, '100ms', (snapshot) => {
  const features = computeFeatures(snapshot);
  if (!features) return;

  // Save the raw snapshot — we recompute features during backtest so we can
  // change parameters (e.g. featureLevels) without re-collecting data.
  stream.write(JSON.stringify(snapshot) + '\n');
  tickCount++;

  // Print a live status line every 5 seconds
  if (Date.now() - lastPrint > 5000) {
    const imbColor = features.imbalance > 0 ? GREEN : RED;
    process.stdout.write(
      `\r[${new Date().toISOString().slice(11, 19)}] ` +
      `Ticks: ${String(tickCount).padEnd(5)} | ` +
      `Mid: ${BOLD}$${features.midPrice.toFixed(2)}${RESET} | ` +
      `Spread: $${features.spread.toFixed(2)} (${features.spreadBps.toFixed(1)} bps) | ` +
      `Imb: ${imbColor}${features.imbalance.toFixed(3)}${RESET}  `,
    );
    lastPrint = Date.now();
  }
});

function shutdown(reason) {
  ws.close();
  stream.end(() => {
    const kb = (fs.statSync(outFile).size / 1024).toFixed(1);
    console.log(`\n\n[Collect] ${reason}`);
    console.log(`[Collect] Ticks: ${tickCount} | File: ${kb} KB`);
    console.log(`\n  Next step: npm run backtest\n`);
    process.exit(0);
  });
}

setTimeout(() => shutdown(`Time limit reached (${DURATION_MS / 1000}s).`), DURATION_MS);
process.on('SIGINT',  () => shutdown('Stopped by user.'));
process.on('SIGTERM', () => shutdown('Process terminated.'));
