# ⚡ CRASH DASH

**When the Market Breaks, You Don't.**

A professional crash signal dashboard for LSE AIM market stocks, displaying AI-detected crash bottom signals with comprehensive metadata and historical performance analysis.

![Crash Dash](assets/logo.svg)

---

## 🎯 Features

- **3,568 Crash Signals** across 217 LSE AIM tickers
- **Signal Color System:**
  - 🟣 **PURPLE** - Enhanced Combo (Crash + Accumulation) - Strongest
  - 🔴 **RED** - Ultra Crash (95%+ drawdown)
  - 🟠 **ORANGE** - Extreme Crash (90%+ drawdown)
  - 🟢 **GREEN** - Deep Crash (85%+ drawdown)
  - 🟡 **YELLOW** - Crash Zone (80%+ drawdown)

- **Advanced Filtering:**
  - Search by ticker or company name
  - Filter by signal color, sector, industry
  - Date range filtering
  - Sortable columns

- **Comprehensive Metadata:**
  - Company information (industry, sector, market cap)
  - Price action (ATH, ATL, current drawdown)
  - Latest signal performance (current P&L, holding period)
  - Historical statistics (win rate, average rally)
  - Risk flags (reverse splits, penny stocks, frequent crashes)

- **Expandable Detail Rows:**
  - Click any signal to see full metadata
  - Historical best performance
  - Stock split history
  - Risk factor analysis

---

## 🚀 Live Demo

**Visit:** [https://arbtraderlabs.github.io/CrashDash/](https://arbtraderlabs.github.io/CrashDash/)

---

## 📊 Data

- **Signals:** 3,568 crash bottom signals detected
- **Tickers:** 217 LSE AIM stocks tracked
- **Purple Combo:** 213 signals (crash + accumulation)
- **Ultra Crash (Red):** 84 signals (95%+ drawdown)
- **Historical Data:** 20+ years of price history analyzed

---

## 🛠️ Technology Stack

- **Frontend:** Pure HTML5, CSS3, Vanilla JavaScript (no frameworks)
- **CSV Parsing:** Papa Parse 5.4.1
- **Deployment:** GitHub Pages (static hosting)
- **Data Format:** CSV + JSON

---

## 📁 Project Structure

```
CrashDash/
├── index.html              # Main dashboard
├── app.js                  # Application logic
├── styles.css              # Crash Dash branding
├── papaparse.min.js        # CSV parser
├── assets/
│   └── logo.svg            # Crash Dash logo
└── data/
    ├── signals.csv         # 3,568 crash signals
    ├── metadata_index.json # Ticker summaries
    ├── ticker_lookup.json  # Company info
    ├── dashboard_stats.json # Statistics
    └── tickers/            # Individual metadata files
        ├── ALBA.L.json
        ├── ...
```

---

## 🔧 Local Development

**1. Clone the repository:**
```bash
git clone https://github.com/arbtraderlabs/CrashDash.git
cd CrashDash
```

**2. Start a local server:**
```bash
python3 -m http.server 8000
```

**3. Open in browser:**
```
http://localhost:8000/
```

---

## 📈 How It Works

### Signal Detection
Crash signals are generated using a proprietary AI algorithm that analyzes:
- Drawdown from all-time high
- RSI (Relative Strength Index)
- Cycle position (price relative to historical range)
- Volume patterns
- Accumulation detection (institutional buying)

### Signal Colors
- **PURPLE (Enhanced Combo):** Crash signal + accumulation pattern = highest probability reversal
- **RED (Ultra Crash):** 95%+ drawdown + RSI < 30 = maximum risk/reward
- **ORANGE (Extreme Crash):** 90%+ drawdown + RSI < 35 = high probability reversal
- **GREEN (Deep Crash):** 85%+ drawdown + RSI < 40 = AI-validated crash bottom
- **YELLOW (Crash Zone):** 80%+ drawdown + RSI < 45 = early accumulation phase

### Metadata Enrichment
Each signal includes:
- Company fundamentals (name, industry, sector, market cap)
- Price metrics (ATH, ATL, current price, drawdown)
- Signal performance (entry price, current P&L, holding period)
- Historical context (best rally, win rate, average returns)
- Risk assessment (splits, penny stock warnings, crash frequency)

---

## ⚠️ Disclaimer

**This is NOT financial advice.** Crash Dash is a research tool providing historical signal analysis. All investments carry risk. Past performance does not guarantee future results. Always conduct your own due diligence and consult with a qualified financial advisor before making investment decisions.

**Data Source:** London Stock Exchange (LSE) AIM market. Signals generated using proprietary AI crash detection algorithm analyzing 20+ years of historical data.

---

## 📄 License

MIT License - See LICENSE file for details

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

---

## 📧 Contact

**Author:** Arb Trader Labs  
**Repository:** [github.com/arbtraderlabs/CrashDash](https://github.com/arbtraderlabs/CrashDash)

---

## ⚡ "When the Market Breaks, You Don't."

Built with ❤️ by traders, for traders.
