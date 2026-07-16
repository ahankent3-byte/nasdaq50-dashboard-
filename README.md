# NASDAQ 50 — Market Intelligence Dashboard

A self-contained, single-file analyst dashboard covering the 50 largest NASDAQ-listed
companies by market cap: KPIs, gainers/losers, a market-cap heatmap, sector breakdown,
risk metrics (volatility, beta, Sharpe, max drawdown), a P/E-vs-market-cap valuation
scatter, trading activity, a 50x50 correlation matrix, returns distribution, and a
per-company drill-through (price chart with moving averages, RSI, MACD, Bollinger Bands).

Data comes from Yahoo Finance via [`yfinance`](https://pypi.org/project/yfinance/).
Everything else — including every statistic — is computed client-side in the page's
own JavaScript from raw price/volume history, so the only thing `scripts/build.py`
does is fetch data and fill in a template.

**Live dashboard:** enable GitHub Pages on this repo (Settings → Pages → deploy from
`main` branch, `/docs` folder) and it will be served at
`https://<your-username>.github.io/<repo-name>/`.

## Rebuilding

```
pip install -r scripts/requirements.txt
python3 scripts/build.py
```

This fetches 5 years of daily history + fundamentals for all 50 tickers, writes
`data/nasdaq50_data.json`, and rebuilds `docs/index.html` (the page GitHub Pages serves).

## Structure

- `scripts/build.py` — fetch + rebuild pipeline
- `scripts/template.html` — dashboard shell, CSS, chart-rendering primitives, analytics engine (all in JS)
- `scripts/part2.js` — section render functions, filters, spliced into the template at build time
- `docs/index.html` — the generated, deployable dashboard (committed so GitHub Pages can serve it)
- `data/nasdaq50_data.json` — the compact dataset embedded in the page (committed for reference/diffing)

## Reporting period

The dashboard has a **Reporting period** control (Latest day / Last month / 3M / YTD /
1Y / 5Y / Custom) that recomputes returns, gainers/losers, the heatmap, sector
performance, trading activity, and the company table over the selected window.
Volatility, beta, Sharpe, max drawdown, CAGR, and the correlation matrix intentionally
stay on fixed trailing windows (1Y or 5Y) as stable risk context regardless of the
period selected.

## Automation

This repo is set up to be rebuilt by a scheduled cloud agent (a Claude "Routine") on
the 1st of each month, which commits the refreshed `docs/index.html` and drafts an
email with the dashboard link. See the repo's connected Routine for the schedule.
