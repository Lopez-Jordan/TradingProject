/**
 * liveMonitor.js
 *
 * Real-time order book terminal dashboard.
 *
 * Connects to Binance, computes features on every tick, and prints a live
 * updating display.
 *
 * USAGE: npm run monitor
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT TO WATCH FOR
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Imbalance spikes toward +1 or -1 → a signal fires
 * 2. After a BUY signal, watch whether the mid price actually moves up
 *    over the next few prints — that's the signal working in real-time
 * 3. Notice how often the signal fires WITHOUT a subsequent price move —
 *    that's noise, and why simple threshold strategies don't scale
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { createOrderBookStream } = require('../src/data/binanceStream');
const { computeFeatures, computeOFI } = require('../src/features/microstructure');
const { generateSignal, SIGNAL_BUY, SIGNAL_SELL } = require('../src/signal/signalGenerator');

// ANSI codes
const R = '\x1b[0m';
const B = '\x1b[1m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';

let prevFeatures = null;
let tickCount    = 0;
let signalCount  = 0;
const startTime  = Date.now();

// Track the last few mid prices for a mini trend line
const midHistory = [];

console.clear();
console.log(`${B}══════════════════════════════════════════════════════${R}`);
console.log(`${B}  HFT Order Book Monitor  ·  BTC/USDT  ·  Binance     ${R}`);
console.log(`${B}  Connecting...                                         ${R}`);
console.log(`${B}══════════════════════════════════════════════════════${R}\n`);

createOrderBookStream('btcusdt', 20, '100ms', (snapshot) => {
  const features = computeFeatures(snapshot, 5);
  if (!features) return;

  const ofi              = computeOFI(prevFeatures, features);
  const { signal, reason } = generateSignal(features, { imbalanceThreshold: 0.3 });

  tickCount++;
  if (signal !== 0) signalCount++;

  midHistory.push(features.midPrice);
  if (midHistory.length > 20) midHistory.shift();

  // Redraw every 3 ticks (~300ms) to keep the terminal readable
  if (tickCount % 3 !== 0) {
    prevFeatures = features;
    return;
  }

  const elapsed    = ((Date.now() - startTime) / 1000).toFixed(0);
  const signalStr  = signal === SIGNAL_BUY
    ? `${GREEN}${B}▲  BUY${R}`
    : signal === SIGNAL_SELL
      ? `${RED}${B}▼  SELL${R}`
      : `${DIM}─  HOLD${R}`;

  const imbColor   = features.imbalance > 0.1 ? GREEN : features.imbalance < -0.1 ? RED : YELLOW;
  const ofiColor   = ofi > 0 ? GREEN : ofi < 0 ? RED : YELLOW;
  const trendStr   = renderSparkline(midHistory);

  // Overwrite previous block (13 lines)
  if (tickCount > 3) process.stdout.write('\x1b[13A\x1b[0J');

  console.log(`${CYAN}[+${elapsed}s]${R} Tick #${tickCount}  ·  Signals: ${signalCount}`);
  console.log(`${'─'.repeat(54)}`);
  console.log(`  ${B}Mid Price  ${R}  ${B}$${features.midPrice.toFixed(2)}${R}`);
  console.log(`  ${B}Best Bid   ${R}  ${GREEN}$${features.bestBid.toFixed(2)}${R}   vol: ${features.bidVolume.toFixed(3)}`);
  console.log(`  ${B}Best Ask   ${R}  ${RED}$${features.bestAsk.toFixed(2)}${R}   vol: ${features.askVolume.toFixed(3)}`);
  console.log(`  ${B}Spread     ${R}  $${features.spread.toFixed(2)} (${features.spreadBps.toFixed(2)} bps)`);
  console.log(`  ${B}Imbalance  ${R}  ${imbColor}${renderBar(features.imbalance, 18)} ${features.imbalance.toFixed(3)}${R}`);
  console.log(`  ${B}OFI        ${R}  ${ofiColor}${ofi >= 0 ? '+' : ''}${ofi.toFixed(3)}${R}`);
  console.log(`  ${B}Signal     ${R}  ${signalStr}`);
  console.log(`  ${B}Reason     ${R}  ${DIM}${reason}${R}`);
  console.log(`  ${B}Trend      ${R}  ${trendStr}`);
  console.log(`${'─'.repeat(54)}`);

  prevFeatures = features;
});

/** Renders an imbalance bar from -1 to +1, centred at 0 */
function renderBar(value, width) {
  const half   = Math.floor(width / 2);
  const filled = Math.round(Math.abs(value) * half);
  const color  = value >= 0 ? GREEN : RED;

  if (value >= 0) {
    return `[${DIM}${'░'.repeat(half)}${R}${color}${'█'.repeat(filled)}${R}${DIM}${'░'.repeat(half - filled)}${R}]`;
  } else {
    return `[${DIM}${'░'.repeat(half - filled)}${R}${color}${'█'.repeat(filled)}${R}${DIM}${'░'.repeat(half)}${R}]`;
  }
}

/** Tiny ASCII sparkline of recent mid prices */
function renderSparkline(prices) {
  if (prices.length < 2) return '...';
  const chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const min   = Math.min(...prices);
  const max   = Math.max(...prices);
  const range = max - min || 1;
  return prices.map(p => chars[Math.round(((p - min) / range) * (chars.length - 1))]).join('');
}
