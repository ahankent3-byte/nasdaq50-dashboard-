"""Fetch NASDAQ-50 data from Yahoo Finance and rebuild docs/index.html.

Run this monthly (via a scheduled cloud Routine, or manually):
    python3 scripts/build.py

Requires: yfinance, pandas, numpy (pip install -r scripts/requirements.txt)
Output: docs/index.html (the dashboard GitHub Pages serves) + data/nasdaq50_data.json
"""

import json
import os
import time

import yfinance as yf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA_DIR = os.path.join(ROOT, "data")
DOCS_DIR = os.path.join(ROOT, "docs")

TICKERS = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "COST", "NFLX",
    "AMD", "PEP", "ADBE", "CSCO", "TMUS", "INTC", "QCOM", "INTU", "CMCSA", "TXN",
    "AMGN", "HON", "AMAT", "BKNG", "SBUX", "ISRG", "VRTX", "GILD", "ADI", "MU",
    "LRCX", "REGN", "MDLZ", "PANW", "PYPL", "SNPS", "KLAC", "CDNS", "MAR", "ORLY",
    "CSX", "ABNB", "CRWD", "FTNT", "MRVL", "ADP", "MELI", "NXPI", "PCAR", "ROP",
]
BENCHMARK = "^IXIC"


def fetch():
    os.makedirs(DATA_DIR, exist_ok=True)
    all_symbols = TICKERS + [BENCHMARK]
    print(f"Downloading 5y price history for {len(TICKERS)} tickers + benchmark...")
    raw = yf.download(all_symbols, period="5y", group_by="ticker", auto_adjust=False, threads=True)

    price_data = {}
    for t in all_symbols:
        df = raw[t].dropna(how="all").copy()
        df.index = df.index.strftime("%Y-%m-%d")
        price_data[t] = df

    print("Fetching fundamentals (sector, P/E, beta, market cap, 52w range)...")
    fundamentals = {}
    for i, t in enumerate(TICKERS):
        for attempt in range(3):
            try:
                info = yf.Ticker(t).info
                fundamentals[t] = {
                    "name": info.get("shortName") or t,
                    "sector": info.get("sector") or "Other",
                    "industry": info.get("industry") or "",
                    "marketCap": info.get("marketCap") or 0,
                    "trailingPE": info.get("trailingPE"),
                    "beta": info.get("beta"),
                    "fiftyTwoWeekHigh": info.get("fiftyTwoWeekHigh"),
                    "fiftyTwoWeekLow": info.get("fiftyTwoWeekLow"),
                    "dividendYield": info.get("dividendYield"),
                    "averageVolume": info.get("averageVolume"),
                }
                break
            except Exception as e:
                if attempt == 2:
                    print(f"  failed {t}: {e}")
                    fundamentals[t] = {"name": t, "sector": "Other", "industry": "", "marketCap": 0,
                                        "trailingPE": None, "beta": None, "fiftyTwoWeekHigh": None,
                                        "fiftyTwoWeekLow": None, "dividendYield": None, "averageVolume": None}
                else:
                    time.sleep(1)
        if (i + 1) % 10 == 0:
            print(f"  {i+1}/{len(TICKERS)} done")

    return price_data, fundamentals


def build_compact_dataset(price_data, fundamentals):
    dates = price_data["AAPL"]["Date"].tolist() if hasattr(price_data["AAPL"]["Date"], "tolist") else list(price_data["AAPL"]["Date"])
    # price_data[t] is a DataFrame with a "Date" column already reset? Ensure list form.
    stocks = {}
    for t, info in fundamentals.items():
        df = price_data[t]
        d_dates = list(df["Date"]) if "Date" in df.columns else list(df.index)
        assert d_dates == dates, f"date mismatch for {t}"
        stocks[t] = {
            "name": info["name"],
            "sector": info["sector"],
            "industry": info["industry"],
            "marketCap": info["marketCap"],
            "trailingPE": round(info["trailingPE"], 2) if info["trailingPE"] else None,
            "beta": round(info["beta"], 2) if info["beta"] else None,
            "fiftyTwoWeekHigh": info["fiftyTwoWeekHigh"],
            "fiftyTwoWeekLow": info["fiftyTwoWeekLow"],
            "dividendYield": info["dividendYield"],
            "averageVolume": info["averageVolume"],
            "close": [round(float(c), 2) for c in df["Close"]],
            "volume": [int(v) for v in df["Volume"]],
        }
    bench_df = price_data[BENCHMARK]
    out = {
        "asOf": dates[-1],
        "dates": dates,
        "benchmark": {"close": [round(float(c), 2) for c in bench_df["Close"]]},
        "stocks": stocks,
    }
    return out


def assemble_html(data):
    with open(os.path.join(HERE, "template.html")) as f:
        tpl = f.read()
    with open(os.path.join(HERE, "part2.js")) as f:
        part2 = f.read()
    out = tpl.replace("__DATA_JSON__", json.dumps(data, separators=(",", ":"))).replace("__PART2__", part2)
    os.makedirs(DOCS_DIR, exist_ok=True)
    out_path = os.path.join(DOCS_DIR, "index.html")
    with open(out_path, "w") as f:
        f.write(out)
    print(f"Wrote {out_path} ({len(out)/1e6:.2f} MB)")
    return out_path


def main():
    price_data_raw, fundamentals = fetch()
    # yf.download returns numpy/pandas objects; normalize each df to have a "Date" column of strings.
    price_data = {}
    for t, df in price_data_raw.items():
        df = df.reset_index().rename(columns={"index": "Date", "Date": "Date"})
        price_data[t] = df
    data = build_compact_dataset(price_data, fundamentals)
    with open(os.path.join(DATA_DIR, "nasdaq50_data.json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
    assemble_html(data)
    print(f"As of: {data['asOf']}")


if __name__ == "__main__":
    main()
