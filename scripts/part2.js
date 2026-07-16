/* ---------------- reporting period ---------------- */
function findIdxOnOrAfter(dateStr) {
  const i = DATA.dates.findIndex(d => d >= dateStr);
  return i < 0 ? DATA.dates.length - 1 : i;
}
function findIdxOnOrBefore(dateStr) {
  for (let i = DATA.dates.length - 1; i >= 0; i--) if (DATA.dates[i] <= dateStr) return i;
  return 0;
}
function getPeriodIndices() {
  const N = DATA.dates.length;
  const preset = state.period;
  if (preset === "custom" && state.customFrom && state.customTo) {
    let s = findIdxOnOrAfter(state.customFrom);
    let e = findIdxOnOrBefore(state.customTo);
    if (e <= s) e = Math.min(N-1, s+1);
    return { startIdx: s, endIdx: e };
  }
  if (preset === "1M") {
    const asOf = new Date(DATA.dates[N-1] + "T00:00:00");
    const firstOfThisMonth = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
    const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 86400000);
    const firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);
    const fmt = (d) => d.toISOString().slice(0,10);
    const s = findIdxOnOrAfter(fmt(firstOfPrevMonth));
    const e = findIdxOnOrBefore(fmt(lastOfPrevMonth));
    return { startIdx: s, endIdx: e < s ? N-1 : e };
  }
  if (preset === "3M") return { startIdx: Math.max(0, N-64), endIdx: N-1 };
  if (preset === "YTD") { const year = DATA.dates[N-1].slice(0,4); const s = DATA.dates.findIndex(d => d.slice(0,4) === year); return { startIdx: s < 0 ? 0 : s, endIdx: N-1 }; }
  if (preset === "1Y") return { startIdx: Math.max(0, N-253), endIdx: N-1 };
  if (preset === "5Y") return { startIdx: 0, endIdx: N-1 };
  return { startIdx: Math.max(0, N-2), endIdx: N-1 }; // "1D"
}
function periodLabel(startIdx, endIdx) {
  const sessions = endIdx - startIdx + 1;
  if (state.period === "1D") return `Latest session · ${fmtDate(DATA.dates[endIdx])}`;
  return `${fmtDate(DATA.dates[startIdx])} → ${fmtDate(DATA.dates[endIdx])} · ${sessions} trading sessions`;
}
let PERIOD = null;
function computePeriod() {
  const { startIdx, endIdx } = getPeriodIndices();
  const metrics = {};
  TICKERS.forEach(t => {
    const s = DATA.stocks[t];
    const startClose = s.close[startIdx], endClose = s.close[endIdx];
    const periodReturn = (endClose/startClose - 1) * 100;
    let volSum = 0, dollarSum = 0;
    for (let i = startIdx+1; i <= endIdx; i++) { volSum += s.volume[i]; dollarSum += s.volume[i]*s.close[i]; }
    const days = Math.max(1, endIdx - startIdx);
    metrics[t] = { periodReturn, periodVolume: volSum, periodDollarVolume: dollarSum, avgDailyVolume: volSum/days, close: endClose };
  });
  PERIOD = { startIdx, endIdx, metrics };
  document.getElementById("period-summary").textContent = periodLabel(startIdx, endIdx);
  const isSingleDay = state.period === "1D";
  document.getElementById("gainers-sub").textContent = isSingleDay ? "Daily return, close-over-close" : "Period return, start-to-end close";
  document.getElementById("losers-sub").textContent = isSingleDay ? "Daily return, close-over-close" : "Period return, start-to-end close";
  document.getElementById("heatmap-sub").textContent = `Tile size = market cap · color = ${isSingleDay ? "today's" : "period"} return`;
  document.getElementById("hist-sub").textContent = isSingleDay ? "Today's daily return, all constituents" : "Period return, all constituents";
  document.getElementById("top-volume-sub").textContent = isSingleDay ? "Today's session" : "Total shares traded over selected period";
}

/* ---------------- legends ---------------- */
function buildReturnLegend(container) {
  container.innerHTML = "";
  [["-3% or worse", returnColor(-3)], ["Flat", returnColor(0)], ["+3% or better", returnColor(3)]].forEach(([label,color]) => {
    const item = document.createElement("div"); item.className = "legend-item";
    item.innerHTML = `<span class="legend-dot" style="background:${color}"></span>${label}`;
    container.appendChild(item);
  });
}
function buildSectorLegend(container) {
  container.innerHTML = "";
  [...TOP_SECTORS, "Other"].forEach(sec => {
    const item = document.createElement("div"); item.className = "legend-item";
    item.innerHTML = `<span class="legend-dot" style="background:${sectorColor(sec)}"></span>${sec}`;
    container.appendChild(item);
  });
}
function buildCorrLegend(container) {
  container.innerHTML = "";
  [["-1.0 (inverse)", divergingColor(-1,1)], ["0 (uncorrelated)", divergingColor(0,1)], ["+1.0 (perfect)", divergingColor(1,1)]].forEach(([label,color]) => {
    const item = document.createElement("div"); item.className = "legend-item";
    item.innerHTML = `<span class="legend-dot" style="background:${color}"></span>${label}`;
    container.appendChild(item);
  });
}

/* ---------------- KPI row ---------------- */
function renderKPIs(filtered) {
  const container = document.getElementById("kpi-row"); container.innerHTML = "";
  if (!filtered.length) { container.innerHTML = '<p style="color:var(--muted);grid-column:1/-1;">No companies match the current filters.</p>'; return; }
  const totalCap = filtered.reduce((a,t) => a + DATA.stocks[t].marketCap, 0);
  const avgRet = mean(filtered.map(t => PERIOD.metrics[t].periodReturn));
  const best = filtered.reduce((a,b) => PERIOD.metrics[a].periodReturn > PERIOD.metrics[b].periodReturn ? a : b);
  const worst = filtered.reduce((a,b) => PERIOD.metrics[a].periodReturn < PERIOD.metrics[b].periodReturn ? a : b);
  const pes = filtered.map(t => DATA.stocks[t].trailingPE).filter(v => v != null);
  const avgPE = pes.length ? mean(pes) : null;
  const totalDollarVol = filtered.reduce((a,t) => a + PERIOD.metrics[t].periodDollarVolume, 0);
  const avgVol = mean(filtered.map(t => M[t].vol1y));
  const up = filtered.filter(t => PERIOD.metrics[t].periodReturn > 0).length;
  const down = filtered.filter(t => PERIOD.metrics[t].periodReturn < 0).length;
  const isSingleDay = state.period === "1D";

  const tiles = [
    { label: "Total market cap", value: fmtCompact(totalCap) },
    { label: isSingleDay ? "Average daily return" : "Average period return", value: fmtPct(avgRet), cls: avgRet >= 0 ? "good" : "bad" },
    { label: "Best performer", value: best, sub2: fmtPct(PERIOD.metrics[best].periodReturn), cls: "good" },
    { label: "Worst performer", value: worst, sub2: fmtPct(PERIOD.metrics[worst].periodReturn), cls: "bad" },
    { label: "Average P/E ratio", value: avgPE != null ? avgPE.toFixed(1) : "—" },
    { label: isSingleDay ? "Total dollar volume" : "Total dollar volume (period)", value: fmtCompact(totalDollarVol) },
    { label: "Average volatility (1Y ann.)", value: avgVol.toFixed(1) + "%" },
    { label: "Breadth — up vs. down", value: `${up} / ${filtered.length}`, sub2: `${down} declining` },
  ];
  tiles.forEach(tl => {
    const div = document.createElement("div"); div.className = "panel kpi";
    div.innerHTML = `<p class="label">${tl.label}</p><div class="value${tl.cls ? (" "+tl.cls) : ""}">${tl.value}</div>${tl.sub2 ? `<div class="sub2">${tl.sub2}</div>` : ""}`;
    container.appendChild(div);
  });
}

/* ---------------- gainers / losers ---------------- */
function renderGainersLosers(filtered) {
  const withRet = filtered.map(t => ({ t, ret: PERIOD.metrics[t].periodReturn }));
  const gainers = [...withRet].sort((a,b) => b.ret - a.ret).slice(0,10)
    .map(r => ({ label: r.t, value: r.ret, ticker: r.t, sub: DATA.stocks[r.t].name }));
  const losers = [...withRet].sort((a,b) => a.ret - b.ret).slice(0,10)
    .map(r => ({ label: r.t, value: r.ret, ticker: r.t, sub: DATA.stocks[r.t].name }));
  hBarChart(document.getElementById("gainers"), gainers, { fmt: fmtPct, name: "Return" });
  hBarChart(document.getElementById("losers"), losers, { fmt: fmtPct, name: "Return" });
}

/* ---------------- heatmap ---------------- */
function renderHeatmapSection(filtered) {
  buildReturnLegend(document.getElementById("heatmap-legend"));
  const items = filtered.map(t => {
    const s = DATA.stocks[t], p = PERIOD.metrics[t];
    const color = returnColor(p.periodReturn, 3);
    return {
      value: s.marketCap, color, label: t, sub: fmtPct(p.periodReturn),
      tooltip: [
        { color, name: "Return", value: fmtPct(p.periodReturn) },
        { color: cssVar("--muted"), name: "Market cap", value: fmtCompact(s.marketCap) },
        { color: cssVar("--muted"), name: "Price", value: fmtUsd(p.close) },
      ],
      onClick: () => selectTicker(t),
    };
  });
  renderTreemap(document.getElementById("heatmap"), items, { w: 1180, h: 380 });
}

/* ---------------- sector analysis ---------------- */
function renderSectorReturnBars(container, rows) {
  container.innerHTML = "";
  const W = 460, H = 240, padL = 34, padR = 10, padT = 10, padB = 62;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxAbs = Math.max(0.5, ...rows.map(r => Math.abs(r.value)));
  const yScale = (v) => padT + innerH/2 - (v/maxAbs) * (innerH/2);
  const bw = innerW / rows.length - 8;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}` });
  [maxAbs, 0, -maxAbs].forEach(v => {
    const y = yScale(v);
    svg.appendChild(el("line", { class: v===0?"baseline-line":"gridline", x1: padL, x2: W-padR, y1: y, y2: y }));
    const t = el("text", { class: "axis-label", x: padL-5, y: y+3, "text-anchor": "end" }); t.textContent = v.toFixed(1)+"%";
    svg.appendChild(t);
  });
  rows.forEach((r, i) => {
    const cx = padL + innerW * ((i+0.5)/rows.length);
    const isUp = r.value >= 0;
    const y0 = yScale(0), y1 = yScale(r.value);
    const top = Math.min(y0,y1), h = Math.max(1, Math.abs(y1-y0));
    const x = cx - bw/2, rad = Math.min(4, h);
    const d = isUp
      ? `M${x},${top+h} L${x},${top+rad} Q${x},${top} ${x+rad},${top} L${x+bw-rad},${top} Q${x+bw},${top} ${x+bw},${top+rad} L${x+bw},${top+h} Z`
      : `M${x},${top} L${x+bw},${top} L${x+bw},${top+h-rad} Q${x+bw},${top+h} ${x+bw-rad},${top+h} L${x+rad},${top+h} Q${x},${top+h} ${x},${top+h-rad} Z`;
    svg.appendChild(el("path", { d, class: "bar-visual " + (isUp?"bar-up":"bar-down") }));
    const label = el("text", { class: "axis-label", x: cx, y: H-padB+14, "text-anchor": "end", transform: `rotate(-35 ${cx} ${H-padB+14})` });
    label.textContent = r.sector; svg.appendChild(label);
    const hit = el("rect", { class: "bar-hit", x: x-3, y: padT, width: bw+6, height: innerH });
    hit.addEventListener("pointerenter", () => {
      const rect = hit.getBoundingClientRect();
      const box = document.createElement("div");
      box.appendChild(ttHead(r.sector));
      box.appendChild(ttRow(isUp?cssVar("--good"):cssVar("--critical"), "Avg return", fmtPct(r.value)));
      showTooltip(rect.left+rect.width/2, rect.top, box);
    });
    hit.addEventListener("pointerleave", hideTooltip);
    svg.appendChild(hit);
  });
  container.appendChild(svg);
}
function renderSectorSection(filtered) {
  const bySector = {};
  filtered.forEach(t => { const sec = DATA.stocks[t].sector; (bySector[sec] = bySector[sec] || []).push(t); });
  const rows = Object.entries(bySector).map(([sector, ts]) => ({ sector, value: mean(ts.map(t => PERIOD.metrics[t].periodReturn)) }))
    .sort((a,b) => b.value - a.value);
  if (rows.length) renderSectorReturnBars(document.getElementById("sector-bar"), rows);
  else document.getElementById("sector-bar").innerHTML = '<p style="color:var(--muted);font-size:12.5px;">No data.</p>';

  buildSectorLegend(document.getElementById("sector-tm-legend"));
  const totalCap = filtered.reduce((a,t) => a + DATA.stocks[t].marketCap, 0);
  const capItems = Object.entries(bySector).map(([sector, ts]) => {
    const sum = ts.reduce((a,t) => a + DATA.stocks[t].marketCap, 0);
    return { value: sum, color: sectorColor(sector), label: sector, sub: fmtCompact(sum) + " · " + (sum/totalCap*100).toFixed(1) + "%" };
  });
  if (capItems.length) renderTreemap(document.getElementById("sector-treemap"), capItems, { w: 560, h: 260 });
  else document.getElementById("sector-treemap").innerHTML = "";
}

/* ---------------- risk analysis ---------------- */
function renderRiskTable(filtered) {
  const rows = [...filtered].sort((a,b) => M[b].vol1y - M[a].vol1y).slice(0,12);
  const container = document.getElementById("risk-table");
  let html = '<table class="dtable" style="font-size:12px"><thead><tr><th>Ticker</th><th>Vol (1Y ann.)</th><th>Beta</th><th>Sharpe</th><th>Max DD (5Y)</th></tr></thead><tbody>';
  rows.forEach(t => {
    const m = M[t];
    html += `<tr data-t="${t}"><td style="font-weight:700">${t}</td><td>${m.vol1y.toFixed(1)}%</td><td>${m.beta.toFixed(2)}</td><td>${m.sharpe1y.toFixed(2)}</td><td class="neg">${m.mdd.toFixed(1)}%</td></tr>`;
  });
  html += "</tbody></table>";
  container.innerHTML = html;
  container.querySelectorAll("tr[data-t]").forEach(tr => tr.addEventListener("click", () => selectTicker(tr.dataset.t)));
}
function renderRollingVol() {
  const rv = rollingVol(benchRet, 30);
  const dates = DATA.dates.slice(1);
  const showN = 504;
  const dSlice = dates.slice(-showN), rvSlice = rv.slice(-showN);
  renderLineChart(document.getElementById("rolling-vol"), dSlice,
    [{ name: "Nasdaq Composite volatility", values: rvSlice, color: cssVar("--accent"), fill: true }],
    { w: 460, h: 200, yfmt: (v) => v.toFixed(0)+"%", vfmt: (v) => v.toFixed(1)+"%" });
}

/* ---------------- valuation scatter ---------------- */
function renderValuation(filtered) {
  buildSectorLegend(document.getElementById("scatter-legend"));
  const pts = filtered.filter(t => DATA.stocks[t].trailingPE != null).map(t => {
    const s = DATA.stocks[t], p = PERIOD.metrics[t];
    return {
      x: s.marketCap, y: s.trailingPE, size: Math.max(p.periodDollarVolume, 1), color: sectorColor(s.sector), label: `${t} — ${s.name}`,
      tooltip: [
        { color: sectorColor(s.sector), name: "Sector", value: s.sector },
        { color: cssVar("--muted"), name: "P/E ratio", value: s.trailingPE.toFixed(1) },
        { color: cssVar("--muted"), name: "Market cap", value: fmtCompact(s.marketCap) },
        { color: cssVar("--muted"), name: "$ volume (period)", value: fmtCompact(p.periodDollarVolume) },
      ],
      onClick: () => selectTicker(t),
    };
  });
  if (pts.length) scatterChart(document.getElementById("valuation-scatter"), pts, { w: 1180, h: 380, xLog: true, xfmt: (v) => fmtCompact(v), yfmt: (v) => v.toFixed(0) });
  else document.getElementById("valuation-scatter").innerHTML = '<p style="color:var(--muted);font-size:12.5px;">No P/E data for current filters.</p>';
}

/* ---------------- trading activity ---------------- */
function renderUnusualVolume(container, filtered) {
  container.innerHTML = "";
  const rows = filtered.map(t => {
    const avgVol = DATA.stocks[t].averageVolume;
    const ratio = avgVol ? PERIOD.metrics[t].avgDailyVolume / avgVol : null;
    return { t, ratio };
  }).filter(r => r.ratio != null).sort((a,b) => b.ratio - a.ratio).slice(0,10);
  if (!rows.length) { container.innerHTML = '<p style="color:var(--muted);font-size:12.5px;">No unusual activity detected.</p>'; return; }
  rows.forEach(r => {
    const s = DATA.stocks[r.t];
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer;font-size:12.5px;";
    const ratioColor = r.ratio >= 1.5 ? "var(--critical)" : "var(--ink-2)";
    row.innerHTML = `<span><b>${r.t}</b> <span style="color:var(--muted)">${s.name}</span></span><span style="font-weight:700;color:${ratioColor}">${r.ratio.toFixed(2)}× avg</span>`;
    row.addEventListener("click", () => selectTicker(r.t));
    container.appendChild(row);
  });
}
function renderTradingActivity(filtered) {
  const byVolume = [...filtered].sort((a,b) => PERIOD.metrics[b].periodVolume - PERIOD.metrics[a].periodVolume).slice(0,10)
    .map(t => ({ label: t, value: PERIOD.metrics[t].periodVolume, ticker: t, sub: DATA.stocks[t].name }));
  hBarChart(document.getElementById("top-volume"), byVolume, { fmt: fmtShares, name: "Shares traded", barColor: cssVar("--accent") });
  const byDollar = [...filtered].sort((a,b) => PERIOD.metrics[b].periodDollarVolume - PERIOD.metrics[a].periodDollarVolume).slice(0,10)
    .map(t => ({ label: t, value: PERIOD.metrics[t].periodDollarVolume, ticker: t, sub: DATA.stocks[t].name }));
  hBarChart(document.getElementById("top-dollar-volume"), byDollar, { fmt: fmtCompact, name: "Dollar volume", barColor: cssVar("--accent") });
  renderUnusualVolume(document.getElementById("unusual-volume"), filtered);
}

/* ---------------- correlation matrix ---------------- */
function renderCorrelation(filtered) {
  buildCorrLegend(document.getElementById("corr-legend"));
  const n = filtered.length;
  const container = document.getElementById("corr-matrix");
  container.innerHTML = "";
  if (n < 2) { container.innerHTML = '<p style="color:var(--muted);font-size:12.5px;">Select at least two companies to compare.</p>'; return; }
  const cell = Math.max(9, Math.min(16, 680/n));
  const labelSpace = 62;
  const W = labelSpace + n*cell, H = labelSpace + n*cell;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, style: `width:${Math.max(600,W)}px` });
  const rets = {}; filtered.forEach(t => rets[t] = M[t].ret1y);
  filtered.forEach((rt, ri) => {
    const rowLbl = el("text", { class: "axis-label", x: labelSpace-4, y: labelSpace+ri*cell+cell*0.72, "text-anchor": "end", style: "font-size:8px" });
    rowLbl.textContent = rt; svg.appendChild(rowLbl);
    const colLbl = el("text", { class: "axis-label", x: labelSpace+ri*cell+cell*0.5, y: labelSpace-6, "text-anchor": "start",
      transform: `rotate(-60 ${labelSpace+ri*cell+cell*0.5} ${labelSpace-6})`, style: "font-size:8px" });
    colLbl.textContent = rt; svg.appendChild(colLbl);
    filtered.forEach((ct, ci) => {
      const corr = ri === ci ? 1 : correlation(rets[rt], rets[ct]);
      const x = labelSpace + ci*cell, y = labelSpace + ri*cell;
      const rect = el("rect", { x, y, width: cell-1, height: cell-1, fill: divergingColor(corr,1) });
      rect.addEventListener("pointerenter", () => {
        const r = rect.getBoundingClientRect();
        const box = document.createElement("div");
        box.appendChild(ttHead(rt + " × " + ct));
        box.appendChild(ttRow(divergingColor(corr,1), "Correlation", corr.toFixed(2)));
        showTooltip(r.left+r.width/2, r.top, box);
      });
      rect.addEventListener("pointerleave", hideTooltip);
      svg.appendChild(rect);
    });
  });
  container.appendChild(svg);
}

/* ---------------- returns histogram + CAGR/vol scatter ---------------- */
function renderReturnsHist(filtered) {
  if (!filtered.length) { document.getElementById("returns-hist").innerHTML = ""; return; }
  renderHistogram(document.getElementById("returns-hist"), filtered.map(t => PERIOD.metrics[t].periodReturn));
}
function renderCagrScatter(filtered) {
  buildSectorLegend(document.getElementById("cagr-legend"));
  const pts = filtered.map(t => {
    const s = DATA.stocks[t], m = M[t];
    return {
      x: m.vol1y, y: m.cagr, size: s.marketCap, color: sectorColor(s.sector), label: `${t} — ${s.name}`,
      tooltip: [
        { color: sectorColor(s.sector), name: "Sector", value: s.sector },
        { color: cssVar("--muted"), name: "Volatility (1Y)", value: m.vol1y.toFixed(1)+"%" },
        { color: cssVar("--muted"), name: "CAGR (5Y)", value: fmtPct(m.cagr,1) },
      ],
      onClick: () => selectTicker(t),
    };
  });
  if (pts.length) scatterChart(document.getElementById("cagr-scatter"), pts, { w: 560, h: 320, yZeroLine: true, xfmt: (v) => v.toFixed(0)+"%", yfmt: (v) => v.toFixed(0)+"%" });
  else document.getElementById("cagr-scatter").innerHTML = "";
}

/* ---------------- company table ---------------- */
let tableSort = { key: "marketCap", dir: "desc" };
function buildTableRows(filtered) {
  return filtered.map(t => {
    const s = DATA.stocks[t], m = M[t], p = PERIOD.metrics[t];
    return { symbol: t, name: s.name, sector: s.sector, close: p.close, ret: p.periodReturn,
             marketCap: s.marketCap, volume: p.periodVolume, pe: s.trailingPE, beta: s.beta, high52dist: m.high52dist };
  });
}
function renderCompanyTable(filtered) {
  const rows = buildTableRows(filtered);
  rows.sort((a,b) => {
    let av = a[tableSort.key], bv = b[tableSort.key];
    if (typeof av === "string") return tableSort.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    if (av == null) av = -Infinity; if (bv == null) bv = -Infinity;
    return tableSort.dir === "asc" ? av - bv : bv - av;
  });
  const tbody = document.getElementById("company-tbody"); tbody.innerHTML = "";
  rows.forEach(r => {
    const tr = document.createElement("tr");
    if (r.symbol === state.selectedTicker) tr.classList.add("selected");
    tr.innerHTML = `<td style="font-weight:700">${r.symbol}</td><td>${r.name}</td><td><span class="sector-chip">${r.sector}</span></td>
      <td>${fmtUsd(r.close)}</td><td class="${r.ret>=0?'pos':'neg'}">${fmtPct(r.ret)}</td><td>${fmtCompact(r.marketCap)}</td>
      <td>${fmtShares(r.volume)}</td><td>${r.pe!=null?r.pe.toFixed(1):"—"}</td><td>${r.beta!=null?r.beta.toFixed(2):"—"}</td>
      <td>${fmtPct(r.high52dist,1)}</td>`;
    tr.addEventListener("click", () => selectTicker(r.symbol));
    tbody.appendChild(tr);
  });
  document.querySelectorAll("#company-table th").forEach(th => {
    th.classList.toggle("sorted", th.dataset.key === tableSort.key);
    th.dataset.dir = tableSort.dir === "asc" ? "▲" : "▼";
  });
}

/* ---------------- company detail (drill-through) ---------------- */
const detailCache = {};
function getDetailCache(t) {
  if (detailCache[t]) return detailCache[t];
  const c = DATA.stocks[t].close;
  detailCache[t] = { sma20: sma(c,20), sma50: sma(c,50), sma200: sma(c,200), rsi: rsi(c,14), macd: macd(c), bb: bollinger(c,20,2) };
  return detailCache[t];
}
function rangeStart(range, dates) {
  const N = dates.length;
  if (range === "1M") return Math.max(0, N-22);
  if (range === "3M") return Math.max(0, N-64);
  if (range === "YTD") { const year = dates[N-1].slice(0,4); const idx = dates.findIndex(d => d.slice(0,4) === year); return idx < 0 ? 0 : idx; }
  if (range === "1Y") return Math.max(0, N-253);
  return 0;
}
function renderVolumeBars(container, dates, closeSlice, volSlice, startIdx, fullClose) {
  container.innerHTML = "";
  const W = 460, H = 140, padL = 44, padR = 8, padT = 10, padB = 18;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxV = Math.max(1, ...volSlice);
  const n = dates.length;
  const barW = Math.max(1, innerW/n - 1);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}` });
  const lbl = el("text", { class: "axis-label", x: padL-6, y: padT+4, "text-anchor": "end" }); lbl.textContent = fmtShares(maxV); svg.appendChild(lbl);
  svg.appendChild(el("line", { class: "gridline", x1: padL, x2: W-padR, y1: padT, y2: padT }));
  svg.appendChild(el("line", { class: "baseline-line", x1: padL, x2: W-padR, y1: H-padB, y2: H-padB }));
  volSlice.forEach((v, i) => {
    const prevClose = i === 0 ? (startIdx > 0 ? fullClose[startIdx-1] : closeSlice[0]) : closeSlice[i-1];
    const isUp = closeSlice[i] >= prevClose;
    const h = (v/maxV) * innerH;
    const x = padL + innerW * (i/n);
    const y = H - padB - h;
    svg.appendChild(el("rect", { x, y, width: barW, height: h, fill: isUp?cssVar("--good"):cssVar("--critical"), opacity: 0.85 }));
  });
  container.appendChild(svg);
}
function renderMacdChart(container, dates, macdArr, signalArr, histArr) {
  container.innerHTML = "";
  const W = 460, H = 180, padL = 40, padR = 8, padT = 10, padB = 18;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const vals = [...macdArr, ...signalArr, ...histArr].filter(v => v != null);
  const maxAbs = Math.max(0.01, ...vals.map(v => Math.abs(v)));
  const yScale = (v) => padT + innerH/2 - (v/maxAbs) * (innerH/2);
  const n = dates.length;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}` });
  const y0 = yScale(0);
  svg.appendChild(el("line", { class: "baseline-line", x1: padL, x2: W-padR, y1: y0, y2: y0 }));
  const barW = Math.max(1, innerW/n - 1);
  histArr.forEach((v, i) => {
    if (v == null) return;
    const x = padL + innerW * (i/n);
    const yv = yScale(v), top = Math.min(y0,yv), h = Math.max(1, Math.abs(yv-y0));
    svg.appendChild(el("rect", { x, y: top, width: barW, height: h, fill: v>=0?cssVar("--good"):cssVar("--critical"), opacity: 0.55 }));
  });
  const lineD = (arr) => { let d = "", started = false; arr.forEach((v,i) => { if (v == null) { started=false; return; } const x = padL+innerW*(i/n); d += (started?"L":"M")+x+","+yScale(v)+" "; started=true; }); return d; };
  svg.appendChild(el("path", { d: lineD(macdArr), class: "trend-line", stroke: cssVar("--sec-1") }));
  svg.appendChild(el("path", { d: lineD(signalArr), class: "trend-line", stroke: cssVar("--warning") }));
  container.appendChild(svg);
}
function renderDetail() {
  const t = state.selectedTicker;
  const s = DATA.stocks[t], m = M[t];
  const cache = getDetailCache(t);
  const dates = DATA.dates, N = dates.length;
  const range = state.range || "1Y";
  const startIdx = rangeStart(range, dates);
  const sliceArr = (arr) => arr.slice(startIdx);
  const dSlice = sliceArr(dates), closeSlice = sliceArr(s.close), volSlice = sliceArr(s.volume);

  document.getElementById("d-tk").textContent = t;
  document.getElementById("d-nm").textContent = s.name + " · " + s.sector;

  const ratios = [
    ["Price", fmtUsd(s.close[N-1])],
    ["Daily %", fmtPct(m.latestReturn), m.latestReturn >= 0 ? "pos" : "neg"],
    ["Market cap", fmtCompact(s.marketCap)],
    ["P/E ratio", s.trailingPE != null ? s.trailingPE.toFixed(1) : "—"],
    ["Beta", s.beta != null ? s.beta.toFixed(2) : "—"],
    ["Dividend yield", s.dividendYield ? s.dividendYield.toFixed(2)+"%" : "—"],
    ["Volatility (1Y, ann.)", m.vol1y.toFixed(1)+"%"],
    ["Sharpe ratio (1Y)", m.sharpe1y.toFixed(2)],
    ["Max drawdown (5Y)", m.mdd.toFixed(1)+"%", "neg"],
    ["CAGR (5Y)", fmtPct(m.cagr,1), m.cagr>=0?"pos":"neg"],
    ["Momentum (1Y return)", fmtPct(m.momentum,1), m.momentum>=0?"pos":"neg"],
    ["52-week high distance", fmtPct(m.high52dist,1), m.high52dist>=-1?"pos":"neg"],
  ];
  const rgrid = document.getElementById("d-ratios"); rgrid.innerHTML = "";
  ratios.forEach(([label,val,cls]) => {
    const tile = document.createElement("div"); tile.className = "ratio-tile";
    tile.innerHTML = `<div class="rl">${label}</div><div class="rv ${cls||""}">${val}</div>`;
    rgrid.appendChild(tile);
  });

  const showMA = Array.from(document.querySelectorAll(".d-ma:checked")).map(cb => cb.value);
  const showBB = document.getElementById("d-bb").checked;
  const priceSeries = [];
  if (showBB) {
    priceSeries.push({ name: "Bollinger upper", values: sliceArr(cache.bb.upper), color: cssVar("--sec-1"), dashed: true });
    priceSeries.push({ name: "Bollinger lower", values: sliceArr(cache.bb.lower), color: cssVar("--sec-1"), dashed: true });
  }
  const maColors = { "20": "#6da7ec", "50": "#2a78d6", "200": "#184f95" };
  showMA.forEach(w => {
    const arr = w === "20" ? cache.sma20 : w === "50" ? cache.sma50 : cache.sma200;
    priceSeries.push({ name: `SMA ${w}`, values: sliceArr(arr), color: maColors[w] });
  });
  priceSeries.push({ name: "Close", values: closeSlice, color: cssVar("--ink"), fill: true });
  renderLineChart(document.getElementById("d-price"), dSlice, priceSeries, { w: 460, h: 220, yfmt: (v) => "$"+v.toFixed(0), vfmt: (v) => "$"+v.toFixed(2) });

  renderVolumeBars(document.getElementById("d-volume"), dSlice, closeSlice, volSlice, startIdx, s.close);

  renderLineChart(document.getElementById("d-rsi"), dSlice, [{ name: "RSI", values: sliceArr(cache.rsi), color: cssVar("--accent"), fill: true }],
    { w: 460, h: 160, fixedRange: [0,100], yfmt: (v) => v.toFixed(0), vfmt: (v) => v.toFixed(1),
      refLines: [{ v: 70, color: cssVar("--critical") }, { v: 30, color: cssVar("--good") }] });

  renderMacdChart(document.getElementById("d-macd"), dSlice, sliceArr(cache.macd.macd), sliceArr(cache.macd.signal), sliceArr(cache.macd.hist));
}

/* ---------------- filters + init ---------------- */
function renderAll() {
  computePeriod();
  const filtered = getFiltered();
  document.getElementById("filter-count").textContent = `${filtered.length} of ${TICKERS.length} companies`;
  renderKPIs(filtered);
  renderGainersLosers(filtered);
  renderHeatmapSection(filtered);
  renderSectorSection(filtered);
  renderRiskTable(filtered);
  renderValuation(filtered);
  renderTradingActivity(filtered);
  renderCorrelation(filtered);
  renderReturnsHist(filtered);
  renderCagrScatter(filtered);
  renderCompanyTable(filtered);
}
function populateFilters() {
  const sectorSel = document.getElementById("f-sector");
  const sectors = [...new Set(TICKERS.map(t => DATA.stocks[t].sector))].sort();
  sectorSel.innerHTML = '<option value="All">All</option>' + sectors.map(s => `<option value="${s}">${s}</option>`).join("");
  const dSel = document.getElementById("d-ticker");
  dSel.innerHTML = [...TICKERS].sort().map(t => `<option value="${t}">${t} — ${DATA.stocks[t].name}</option>`).join("");
  dSel.value = state.selectedTicker;
}
function wireEvents() {
  document.getElementById("f-search").addEventListener("input", (e) => { state.search = e.target.value; renderAll(); });
  document.getElementById("f-sector").addEventListener("change", (e) => { state.sector = e.target.value; renderAll(); });
  document.getElementById("f-cap").addEventListener("change", (e) => { state.cap = e.target.value; renderAll(); });
  document.getElementById("f-pe").addEventListener("change", (e) => { state.pe = e.target.value; renderAll(); });
  document.getElementById("f-div").addEventListener("change", (e) => { state.divOnly = e.target.checked; renderAll(); });
  document.getElementById("f-reset").addEventListener("click", () => {
    state.search = ""; state.sector = "All"; state.cap = "All"; state.pe = "All"; state.divOnly = false;
    document.getElementById("f-search").value = ""; document.getElementById("f-sector").value = "All";
    document.getElementById("f-cap").value = "All"; document.getElementById("f-pe").value = "All"; document.getElementById("f-div").checked = false;
    renderAll();
  });
  document.getElementById("d-ticker").addEventListener("change", (e) => { state.selectedTicker = e.target.value; renderDetail(); });
  document.getElementById("d-range").addEventListener("click", (e) => {
    if (e.target.tagName !== "BUTTON") return;
    document.querySelectorAll("#d-range button").forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");
    state.range = e.target.dataset.range;
    renderDetail();
  });
  document.querySelectorAll(".d-ma").forEach(cb => cb.addEventListener("change", renderDetail));
  document.getElementById("d-bb").addEventListener("change", renderDetail);
  document.querySelectorAll("#company-table th").forEach(th => th.addEventListener("click", () => {
    const k = th.dataset.key;
    if (tableSort.key === k) tableSort.dir = tableSort.dir === "asc" ? "desc" : "asc"; else { tableSort.key = k; tableSort.dir = "desc"; }
    renderCompanyTable(getFiltered());
  }));
  document.getElementById("period-toggle").addEventListener("click", (e) => {
    if (e.target.tagName !== "BUTTON") return;
    document.querySelectorAll("#period-toggle button").forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");
    state.period = e.target.dataset.period;
    document.getElementById("period-custom-wrap").style.display = state.period === "custom" ? "flex" : "none";
    if (state.period !== "custom") renderAll();
  });
  document.getElementById("period-custom-apply").addEventListener("click", () => {
    const from = document.getElementById("period-from").value, to = document.getElementById("period-to").value;
    if (!from || !to) return;
    state.period = "custom"; state.customFrom = from; state.customTo = to;
    renderAll();
  });
}

state.range = "1Y";
state.period = "1D";
document.getElementById("asof-date").textContent = fmtDate(DATA.asOf);
document.getElementById("period-from").min = DATA.dates[0];
document.getElementById("period-from").max = DATA.dates[DATA.dates.length-1];
document.getElementById("period-to").min = DATA.dates[0];
document.getElementById("period-to").max = DATA.dates[DATA.dates.length-1];
document.getElementById("period-to").value = DATA.dates[DATA.dates.length-1];
populateFilters();
wireEvents();
renderAll();
renderRollingVol();
renderDetail();
