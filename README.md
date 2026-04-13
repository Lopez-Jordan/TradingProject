# HFT Order Book Signal — Execution Realism Demo

A production-quality Node.js project demonstrating a short-horizon trading signal
using **Order Book Imbalance**, and proving that its profitability collapses under
realistic execution constraints (spread cost + latency).

---

## Hypothesis

> **Order book imbalance is a statistically significant predictor of short-term
> mid-price movements — but it is NOT a tradable edge at typical latency levels.**

The distinction between *signal* and *edge* is the central insight:

```
Edge = Signal − Spread Cost − Latency Slippage
```

This project proves both halves:
1. ✅ The raw signal *does* have predictive power
2. ✅ Adding realistic execution costs erases that power

---

## Core Concepts Explained

### Order Book (L2 Data)
The exchange's live list of all resting buy orders (bids) and sell orders (asks),
sorted by price. L2 shows multiple price levels and their quantities.
Unlike candle data, the order book reveals market *intent* before price moves happen.

### Mid Price
```
mid = (bestBid + bestAsk) / 2
```
The fair-value proxy between buyers and sellers. More stable than last-trade price,
which bounces between bid and ask.

### Spread
```
spread = bestAsk - bestBid
```
The minimum transaction cost when crossing the market. Every round-trip trade
(enter + exit) costs **one full spread**. If expected profit per trade < spread,
the strategy loses money even with a perfect signal.

### Order Book Imbalance (OBI)
```
imbalance = (bid_volume − ask_volume) / (bid_volume + ask_volume)  ∈ [−1, +1]
```
Measures supply vs. demand pressure at the top of the book.
- `+1` → only bids, no asks → strong buy pressure → price likely **↑**
- `−1` → only asks, no bids → strong sell pressure → price likely **↓**
- ` 0` → balanced book → no directional signal

Why does it work? When one side of the book is depleted, market makers must
reprice to attract new liquidity — which moves the mid price.

### Order Flow Imbalance (OFI)
A dynamic version of OBI: measures the *change* in order flow between two
consecutive snapshots. Captures new order arrivals and cancellations before
they affect the mid price.

### Latency (The Critical Concept)
The delay between *seeing* a signal and *executing* a trade:

```
Signal observed → decision → order sent → exchange receives → fill
  ≈ 1–10ms          ≈0.1ms    ≈1–10ms       ≈0.1ms
                                                 ↑
                               By here, faster traders have already acted
```

This project simulates **0ms, 10ms, 50ms, and 100ms** latency to show
how each step erodes profitability.

---

## Project Structure

```
TradingProject/
├── src/
│   ├── data/
│   │   └── binanceStream.js      ← Binance WebSocket (L2, 100ms)
│   ├── features/
│   │   └── microstructure.js     ← mid price, spread, OBI, OFI, WMID
│   ├── signal/
│   │   └── signalGenerator.js    ← threshold rule: |imbalance| > 0.3
│   ├── execution/
│   │   └── executionSimulator.js ← spread cost + latency delay
│   ├── backtest/
│   │   └── backtestEngine.js     ← full pipeline, imbalance buckets, signal decay
│   └── analysis/
│       ├── metrics.js            ← PnL, Sharpe, drawdown, win rate
│       └── csvExporter.js        ← CSV output to /output/
├── scripts/
│   ├── liveMonitor.js            ← live terminal dashboard
│   ├── collectData.js            ← collect real Binance ticks
│   ├── generateSyntheticData.js  ← generate synthetic ticks (no internet needed)
│   └── runBacktest.js            ← full backtest runner
├── data/                         ← collected/generated tick data (gitignored)
├── output/                       ← CSV results (gitignored)
└── package.json
```

---

## Quick Start

### 1. Install
```bash
npm install
```

### 2. Option A — Synthetic data (instant, no internet)
```bash
npm run generate        # creates data/orderbook_ticks.json with 5,000 ticks
npm run backtest        # runs analysis, prints results, exports CSVs
```

### 3. Option B — Real Binance data (requires internet)
```bash
npm run collect         # collects 5 min of real BTC/USDT order book data
npm run backtest
```

### 4. Live monitor (watch the order book in real-time)
```bash
npm run monitor
```

---

## Expected Results

### PnL vs Latency
| Latency | Expected behaviour |
|---------|-------------------|
| 0ms     | Positive total PnL (the "ideal" baseline) |
| 10ms    | PnL declines — signal partially stale |
| 50ms    | Near-zero or slightly negative |
| 100ms   | Clearly negative — edge fully eroded |

### Signal Decay
| Horizon | Expected behaviour |
|---------|-------------------|
| 1 tick  | Strongest edge (signal is freshest) |
| 5 ticks | Noticeable decay |
| 10 ticks | Weak signal |
| 20 ticks | Near-zero edge |

### Imbalance vs Return
`output/imbalance_vs_return.csv` should show a clear monotone relationship:
- Most negative bucket → most negative average future return
- Most positive bucket → most positive average future return

This confirms the signal has predictive power *in isolation*.

---

## Output Files (`/output/`)

| File | Contents |
|------|----------|
| `pnl_vs_latency.csv` | Headline result: PnL, trade count, win rate at each latency |
| `imbalance_vs_return.csv` | Imbalance bucket → average future return (signal validation) |
| `signal_decay.csv` | Signal edge at horizons 1, 5, 10, 20 ticks |
| `tick_features.csv` | Full per-tick feature log (mid, spread, imbalance, OFI) |
| `trades_Xms.csv` | Per-trade log at each latency level |

---

## References

- Cont, Kukanov, Stoikov (2014) — *The Price Impact of Order Book Events*
- Gould et al. (2013) — *Limit Order Books*
- Avellaneda & Stoikov (2008) — *High-frequency trading in a limit order book*
