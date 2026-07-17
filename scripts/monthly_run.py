"""Monthly automation: rebuild the dashboard, push to GitHub, email a summary.

Run manually to test:
    python3 scripts/monthly_run.py

Scheduled by ~/Library/LaunchAgents/com.nasdaq50dashboard.monthly.plist
Reads the Gmail App Password from macOS Keychain (service: "nasdaq50-dashboard-gmail").
"""

import json
import os
import smtplib
import ssl
import subprocess
import sys
from datetime import date
from email.mime.text import MIMEText

import certifi

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DASHBOARD_URL = "https://ahankent3-byte.github.io/nasdaq50-dashboard-/"
GMAIL_ADDRESS = "ahankent3@gmail.com"
KEYCHAIN_SERVICE = "nasdaq50-dashboard-gmail"

sys.path.insert(0, HERE)
import build as build_module  # noqa: E402


def get_app_password():
    result = subprocess.run(
        ["security", "find-generic-password", "-a", GMAIL_ADDRESS, "-s", KEYCHAIN_SERVICE, "-w"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Could not read Gmail app password from Keychain (service={KEYCHAIN_SERVICE}). "
            "Run scripts/store_app_password.py first."
        )
    return result.stdout.strip()


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)


def compute_last_month_summary(data):
    dates = data["dates"]
    as_of = dates[-1]
    y, m, _ = (int(x) for x in as_of.split("-"))
    prev_month = m - 1 or 12
    prev_year = y if m > 1 else y - 1
    prev_prefix = f"{prev_year:04d}-{prev_month:02d}"
    month_dates = [d for d in dates if d.startswith(prev_prefix)]
    if len(month_dates) < 2:
        return None
    start_idx = dates.index(month_dates[0])
    end_idx = dates.index(month_dates[-1])

    rows = []
    for t, s in data["stocks"].items():
        c0, c1 = s["close"][start_idx], s["close"][end_idx]
        ret = (c1 / c0 - 1) * 100
        rows.append((t, s["name"], ret))
    rows.sort(key=lambda r: r[2])
    worst = rows[0]
    best = rows[-1]
    avg = sum(r[2] for r in rows) / len(rows)
    up = sum(1 for r in rows if r[2] > 0)
    down = sum(1 for r in rows if r[2] < 0)
    return {
        "period_start": month_dates[0], "period_end": month_dates[-1],
        "best": best, "worst": worst, "avg": avg, "up": up, "down": down, "n": len(rows),
    }


def send_email(summary):
    if summary:
        month_label = date.fromisoformat(summary["period_end"]).strftime("%B %Y")
        body_lines = [
            f"NASDAQ 50 Dashboard — Monthly Update ({month_label})",
            "",
            f"Period: {summary['period_start']} to {summary['period_end']}",
            f"Average return across all 50 stocks: {summary['avg']:+.2f}%",
            f"Best performer: {summary['best'][0]} ({summary['best'][1]}) {summary['best'][2]:+.2f}%",
            f"Worst performer: {summary['worst'][0]} ({summary['worst'][1]}) {summary['worst'][2]:+.2f}%",
            f"Breadth: {summary['up']} up / {summary['down']} down (of {summary['n']})",
            "",
            f"View the full interactive dashboard: {DASHBOARD_URL}",
            "(Select \"Last month\" in the Reporting period control to see this exact period, "
            "with full gainers/losers, heatmap, and sector detail.)",
        ]
        subject = f"NASDAQ 50 Dashboard — Monthly Update ({month_label})"
    else:
        body_lines = [
            "The monthly data refresh ran, but there wasn't enough history yet to summarize last month.",
            f"View the dashboard: {DASHBOARD_URL}",
        ]
        subject = "NASDAQ 50 Dashboard — Monthly Update"

    msg = MIMEText("\n".join(body_lines))
    msg["Subject"] = subject
    msg["From"] = GMAIL_ADDRESS
    msg["To"] = GMAIL_ADDRESS

    password = get_app_password()
    context = ssl.create_default_context(cafile=certifi.where())
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
        server.login(GMAIL_ADDRESS, password)
        server.sendmail(GMAIL_ADDRESS, [GMAIL_ADDRESS], msg.as_string())
    print(f"Email sent: {subject}")


def main():
    print(f"=== Monthly run starting {date.today().isoformat()} ===")

    price_data_raw, fundamentals = build_module.fetch()
    price_data = {}
    for t, df in price_data_raw.items():
        price_data[t] = df.reset_index().rename(columns={"index": "Date"})
    data = build_module.build_compact_dataset(price_data, fundamentals)
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    with open(os.path.join(ROOT, "data", "nasdaq50_data.json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
    build_module.assemble_html(data)

    diff = git("status", "--porcelain")
    if diff.stdout.strip():
        git("add", "-A")
        commit_msg = f"Monthly data refresh: {date.today().isoformat()}"
        commit = git("commit", "-m", commit_msg)
        print(commit.stdout, commit.stderr)
        push = git("push", "origin", "main")
        print(push.stdout, push.stderr)
        if push.returncode != 0:
            print("WARNING: git push failed — dashboard link will show stale data until this is resolved.")
    else:
        print("No changes to commit (data unchanged since last run).")

    summary = compute_last_month_summary(data)
    send_email(summary)
    print("=== Monthly run complete ===")


if __name__ == "__main__":
    main()
