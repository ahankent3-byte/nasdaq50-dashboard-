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
  if (state.replayEnd != null) return `▶ Replaying · ${fmtDate(DATA.dates[endIdx])}`;
  const sessions = endIdx - startIdx + 1;
  if (state.period === "1D") return `Latest session · ${fmtDate(DATA.dates[endIdx])}`;
  return `${fmtDate(DATA.dates[startIdx])} → ${fmtDate(DATA.dates[endIdx])} · ${sessions} trading sessions`;
}
const RISK_MIN_SESSIONS = 20;
function riskWindow(startIdx, endIdx) {
  if (endIdx - startIdx >= RISK_MIN_SESSIONS) return { rStart: startIdx, rEnd: endIdx };
  return { rStart: Math.max(0, endIdx - RISK_MIN_SESSIONS), rEnd: endIdx };
}
let PERIOD = null;
function computePeriod() {
  let { startIdx, endIdx } = getPeriodIndices();
  if (state.replayEnd != null) endIdx = Math.max(startIdx + 1, Math.min(state.replayEnd, endIdx));
  const { rStart, rEnd } = riskWindow(startIdx, endIdx);
  const benchRetSlice = benchRet.slice(rStart, rEnd);
  const metrics = {};
  TICKERS.forEach(t => {
    const s = DATA.stocks[t];
    const startClose = s.close[startIdx], endClose = s.close[endIdx];
    const periodReturn = (endClose/startClose - 1) * 100;
    let volSum = 0, dollarSum = 0;
    for (let i = startIdx+1; i <= endIdx; i++) { volSum += s.volume[i]; dollarSum += s.volume[i]*s.close[i]; }
    const days = Math.max(1, endIdx - startIdx);
    const retSlice = M[t].ret.slice(rStart, rEnd);
    const vol = stdev(retSlice) * Math.sqrt(TDAYS) * 100;
    const beta = betaCalc(retSlice, benchRetSlice);
    const sharpe = sharpeCalc(retSlice);
    metrics[t] = { periodReturn, periodVolume: volSum, periodDollarVolume: dollarSum, avgDailyVolume: volSum/days,
                   close: endClose, vol, beta, sharpe, retSlice };
  });
  PERIOD = { startIdx, endIdx, rStart, rEnd, metrics };
  document.getElementById("period-summary").textContent = periodLabel(startIdx, endIdx);
  const isSingleDay = state.period === "1D";
  document.getElementById("gainers-sub").textContent = isSingleDay ? "Daily return, close-over-close" : "Period return, start-to-end close";
  document.getElementById("losers-sub").textContent = isSingleDay ? "Daily return, close-over-close" : "Period return, start-to-end close";
  document.getElementById("heatmap-sub").textContent = `Tile size = market cap · color = ${isSingleDay ? "today's" : "period"} return`;
  document.getElementById("hist-sub").textContent = isSingleDay ? "Today's daily return, all constituents" : "Period return, all constituents";
  document.getElementById("top-volume-sub").textContent = isSingleDay ? "Today's session" : "Total shares traded over selected period";
  const riskSessions = rEnd - rStart;
  const riskWindowText = `Annualized, ${riskSessions} sessions ending ${fmtDate(DATA.dates[rEnd])}` +
    (riskSessions !== (endIdx-startIdx) ? ` (period extended to ${RISK_MIN_SESSIONS}-session minimum)` : "");
  const riskLabelEl = document.getElementById("risk-window-label");
  if (riskLabelEl) riskLabelEl.textContent = riskWindowText;
  const corrLabelEl = document.getElementById("corr-window-label");
  if (corrLabelEl) corrLabelEl.textContent = riskSessions + " daily returns ending " + fmtDate(DATA.dates[rEnd]);
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

/* ---------------- sector scope ---------------- */
function updateSnapshotScope(filtered) {
  const scopeEl = document.getElementById("snapshot-scope");
  const listWrap = document.getElementById("sector-company-list");
  if (state.sector !== "All") {
    scopeEl.textContent = `Showing the ${state.sector} sector — ${filtered.length} of ${TICKERS.length} companies`;
    document.getElementById("sector-company-list-title").textContent = `Companies in ${state.sector}`;
    const tbody = document.getElementById("sector-company-tbody");
    tbody.innerHTML = "";
    [...filtered].sort((a,b) => DATA.stocks[b].marketCap - DATA.stocks[a].marketCap).forEach(t => {
      const s = DATA.stocks[t], p = PERIOD.metrics[t];
      const tr = document.createElement("tr");
      tr.style.cursor = "pointer";
      tr.innerHTML = `<td style="font-weight:700">${t}</td><td>${s.name}</td><td>${fmtUsd(p.close)}</td>
        <td class="${p.periodReturn>=0?'pos':'neg'}">${fmtPct(p.periodReturn)}</td><td>${fmtCompact(s.marketCap)}</td>`;
      tr.addEventListener("click", () => openCompanyPage(t));
      tbody.appendChild(tr);
    });
    listWrap.style.display = "block";
  } else {
    scopeEl.textContent = "How is the market performing over the selected period?";
    listWrap.style.display = "none";
  }
}

/* ---------------- KPI row ---------------- */
function renderKPIs(filtered) {
  const container = document.getElementById("kpi-row"); container.innerHTML = "";
  updateSnapshotScope(filtered);
  if (!filtered.length) { container.innerHTML = '<p style="color:var(--muted);grid-column:1/-1;">No companies match the current filters.</p>'; return; }
  const totalCap = filtered.reduce((a,t) => a + DATA.stocks[t].marketCap, 0);
  const avgRet = mean(filtered.map(t => PERIOD.metrics[t].periodReturn));
  const best = filtered.reduce((a,b) => PERIOD.metrics[a].periodReturn > PERIOD.metrics[b].periodReturn ? a : b);
  const worst = filtered.reduce((a,b) => PERIOD.metrics[a].periodReturn < PERIOD.metrics[b].periodReturn ? a : b);
  const pes = filtered.map(t => DATA.stocks[t].trailingPE).filter(v => v != null);
  const medPE = pes.length ? median(pes) : null;
  const totalDollarVol = filtered.reduce((a,t) => a + PERIOD.metrics[t].periodDollarVolume, 0);
  const avgVol = mean(filtered.map(t => PERIOD.metrics[t].vol));
  const up = filtered.filter(t => PERIOD.metrics[t].periodReturn > 0).length;
  const down = filtered.filter(t => PERIOD.metrics[t].periodReturn < 0).length;
  const isSingleDay = state.period === "1D";

  const tiles = [
    { label: "Total market cap", value: fmtCompact(totalCap) },
    { label: isSingleDay ? "Average daily return" : "Average period return", value: fmtPct(avgRet), cls: avgRet >= 0 ? "good" : "bad" },
    { label: "Best performer", value: `${best} · ${DATA.stocks[best].name}`, sub2: fmtPct(PERIOD.metrics[best].periodReturn), cls: "good", onClick: () => openCompanyPage(best) },
    { label: "Worst performer", value: `${worst} · ${DATA.stocks[worst].name}`, sub2: fmtPct(PERIOD.metrics[worst].periodReturn), cls: "bad", onClick: () => openCompanyPage(worst) },
    { label: "Median P/E ratio", value: medPE != null ? medPE.toFixed(1) : "—", sub2: "Median, not mean — resistant to outliers" },
    { label: isSingleDay ? "Total dollar volume" : "Total dollar volume (period)", value: fmtCompact(totalDollarVol) },
    { label: "Average volatility (period, ann.)", value: avgVol.toFixed(1) + "%" },
    { label: "Breadth — up vs. down", value: `${up} / ${filtered.length}`, sub2: `${down} declining` },
  ];
  tiles.forEach(tl => {
    const div = document.createElement("div"); div.className = "panel kpi" + (tl.onClick ? " kpi-clickable" : "");
    div.innerHTML = `<p class="label">${tl.label}</p><div class="value${tl.cls ? (" "+tl.cls) : ""}" style="${tl.value.length>10?"font-size:18px;":""}">${tl.value}</div>${tl.sub2 ? `<div class="sub2">${tl.sub2}</div>` : ""}`;
    if (tl.onClick) div.addEventListener("click", tl.onClick);
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
  const rows = [...filtered].sort((a,b) => PERIOD.metrics[b].vol - PERIOD.metrics[a].vol).slice(0,12);
  const container = document.getElementById("risk-table");
  let html = '<table class="dtable" style="font-size:12px"><thead><tr><th>Ticker</th><th>Company</th><th>Vol (ann.)</th><th>Beta</th><th>Sharpe</th><th>Max DD (5Y)</th></tr></thead><tbody>';
  rows.forEach(t => {
    const m = M[t], p = PERIOD.metrics[t], s = DATA.stocks[t];
    html += `<tr data-t="${t}"><td style="font-weight:700">${t}</td><td>${truncateName(s.name,22)}</td><td>${p.vol.toFixed(1)}%</td><td>${p.beta.toFixed(2)}</td><td>${p.sharpe.toFixed(2)}</td><td class="neg">${m.mdd.toFixed(1)}%</td></tr>`;
  });
  html += "</tbody></table>";
  container.innerHTML = html;
  container.querySelectorAll("tr[data-t]").forEach(tr => tr.addEventListener("click", () => openCompanyPage(tr.dataset.t)));
}
function renderRollingVol() {
  const rv = rollingVol(benchRet, 30);
  const dates = DATA.dates.slice(1);
  const showN = 504;
  const dSlice = dates.slice(-showN), rvSlice = rv.slice(-showN);
  renderLineChart(document.getElementById("rolling-vol"), dSlice,
    [{ name: "Nasdaq Composite volatility", values: rvSlice, color: cssVar("--accent"), fill: true }],
    { w: 460, h: 200, yfmt: (v) => v.toFixed(0)+"%", vfmt: (v) => v.toFixed(1)+"%", endBadge: true });
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
  const rets = {}; filtered.forEach(t => rets[t] = PERIOD.metrics[t].retSlice);
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
        box.appendChild(ttHead(`${rt} (${DATA.stocks[rt].name}) × ${ct} (${DATA.stocks[ct].name})`));
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
  const isSingleDay = state.period === "1D";
  document.getElementById("retvol-sub").textContent = isSingleDay
    ? "Period return vs. volatility (both annualized-vol basis) · bubble size = market cap · color = sector"
    : "Period return vs. volatility over the selected period · bubble size = market cap · color = sector";
  const pts = filtered.map(t => {
    const s = DATA.stocks[t], p = PERIOD.metrics[t];
    return {
      x: p.vol, y: p.periodReturn, size: s.marketCap, color: sectorColor(s.sector), label: `${t} — ${s.name}`, ticker: t,
      tooltip: [
        { color: sectorColor(s.sector), name: "Sector", value: s.sector },
        { color: cssVar("--muted"), name: "Volatility", value: p.vol.toFixed(1)+"%" },
        { color: cssVar("--muted"), name: "Return (period)", value: fmtPct(p.periodReturn,1) },
      ],
      onClick: () => openCompanyPage(t),
    };
  });
  if (pts.length) {
    const byReturn = [...pts].sort((a,b) => b.y - a.y);
    const labelSet = new Set([byReturn[0]?.ticker, byReturn[byReturn.length-1]?.ticker,
      [...pts].sort((a,b)=>b.x-a.x)[0]?.ticker].filter(Boolean));
    scatterChart(document.getElementById("cagr-scatter"), pts, {
      w: 620, h: 380, yZeroLine: true, xMedianLine: true, maxRadius: 14,
      xfmt: (v) => v.toFixed(0)+"%", yfmt: (v) => v.toFixed(0)+"%", directLabelTickers: labelSet,
    });
  } else document.getElementById("cagr-scatter").innerHTML = "";
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
  const xScale = (i) => padL + innerW * (i/n);
  svg.appendChild(el("path", { d: smoothLinePath(macdArr, xScale, yScale), class: "trend-line", stroke: cssVar("--sec-1") }));
  svg.appendChild(el("path", { d: smoothLinePath(signalArr, xScale, yScale), class: "trend-line", stroke: cssVar("--warning") }));
  container.appendChild(svg);
}
function ratioTile(label, val, cls) {
  const tile = document.createElement("div"); tile.className = "ratio-tile";
  tile.innerHTML = `<div class="rl">${label}</div><div class="rv ${cls||""}">${val}</div>`;
  return tile;
}
function fmtPct100(frac, d=1) { return frac == null ? "—" : fmtPct(frac*100, d); }
function renderCompanyPage() {
  const t = state.selectedTicker;
  const s = DATA.stocks[t], m = M[t], p = PERIOD.metrics[t];
  const cache = getDetailCache(t);
  const dates = DATA.dates, N = dates.length;
  const range = state.range || "1Y";
  const startIdx = rangeStart(range, dates);
  const sliceArr = (arr) => arr.slice(startIdx);
  const dSlice = sliceArr(dates), closeSlice = sliceArr(s.close), volSlice = sliceArr(s.volume);

  document.getElementById("cv-scope").textContent = t + " · " + s.sector;
  document.getElementById("cv-name").textContent = s.name + " (" + t + ")";
  document.getElementById("cv-industry").textContent = s.industry || s.sector;
  document.getElementById("cv-price").textContent = fmtUsd(s.close[N-1]);
  const chg = document.getElementById("cv-change");
  chg.textContent = fmtPct(m.latestReturn) + " today";
  chg.className = "cv-change " + (m.latestReturn >= 0 ? "pos" : "neg");

  const technical = [
    ["Volatility (period, ann.)", p.vol.toFixed(1)+"%"],
    ["Sharpe ratio (period)", p.sharpe.toFixed(2)],
    ["Beta (period)", p.beta.toFixed(2)],
    ["Max drawdown (5Y)", m.mdd.toFixed(1)+"%", "neg"],
    ["Momentum (1Y return)", fmtPct(m.momentum,1), m.momentum>=0?"pos":"neg"],
    ["52-week high distance", fmtPct(m.high52dist,1), m.high52dist>=-1?"pos":"neg"],
    ["CAGR (5Y)", fmtPct(m.cagr,1), m.cagr>=0?"pos":"neg"],
  ];
  const tgrid = document.getElementById("cv-technical-ratios"); tgrid.innerHTML = "";
  technical.forEach(([l,v,c]) => tgrid.appendChild(ratioTile(l,v,c)));

  const fundamental = [
    ["Market cap", fmtCompact(s.marketCap)],
    ["P/E ratio (trailing)", s.trailingPE != null ? s.trailingPE.toFixed(1) : "—"],
    ["P/E ratio (forward)", s.forwardPE != null ? s.forwardPE.toFixed(1) : "—"],
    ["EPS (trailing)", s.trailingEps != null ? fmtUsd(s.trailingEps) : "—"],
    ["EPS (forward)", s.forwardEps != null ? fmtUsd(s.forwardEps) : "—"],
    ["Price / book", s.priceToBook != null ? s.priceToBook.toFixed(1) : "—"],
    ["Dividend yield", s.dividendYield ? s.dividendYield.toFixed(2)+"%" : "—"],
    ["Return on equity", fmtPct100(s.returnOnEquity)],
    ["Profit margin", fmtPct100(s.profitMargins)],
    ["Revenue growth (YoY)", fmtPct100(s.revenueGrowth), (s.revenueGrowth||0)>=0?"pos":"neg"],
    ["Total revenue", s.totalRevenue ? fmtCompact(s.totalRevenue) : "—"],
    ["Free cash flow", s.freeCashflow ? fmtCompact(s.freeCashflow) : "—"],
    ["Debt / equity", s.debtToEquity != null ? s.debtToEquity.toFixed(1)+"%" : "—"],
    ["Analyst rating", s.recommendationKey ? s.recommendationKey.replace(/_/g," ").replace(/\b\w/g, c=>c.toUpperCase()) : "—"],
    ["Analyst target price", s.targetMeanPrice ? fmtUsd(s.targetMeanPrice) : "—"],
    ["Analyst coverage", s.numberOfAnalystOpinions ? s.numberOfAnalystOpinions + " analysts" : "—"],
  ];
  const fgrid = document.getElementById("cv-fundamental-ratios"); fgrid.innerHTML = "";
  fundamental.forEach(([l,v,c]) => fgrid.appendChild(ratioTile(l,v,c)));

  const showMA = Array.from(document.querySelectorAll(".cv-ma:checked")).map(cb => cb.value);
  const showBB = document.getElementById("cv-bb").checked;
  const maColors = { "20": "#6da7ec", "50": "#2a78d6", "200": "#184f95" };
  const chartType = state.cvChartType || "line";

  if (chartType === "candle") {
    const overlays = [];
    if (showBB) {
      overlays.push({ name: "Bollinger upper", values: sliceArr(cache.bb.upper), color: cssVar("--sec-1"), dashed: true });
      overlays.push({ name: "Bollinger lower", values: sliceArr(cache.bb.lower), color: cssVar("--sec-1"), dashed: true });
    }
    showMA.forEach(w => {
      const arr = w === "20" ? cache.sma20 : w === "50" ? cache.sma50 : cache.sma200;
      overlays.push({ name: `SMA ${w}`, values: sliceArr(arr), color: maColors[w] });
    });
    renderCandlestick(document.getElementById("cv-price-chart"), dSlice,
      { open: sliceArr(s.open), high: sliceArr(s.high), low: sliceArr(s.low), close: closeSlice },
      overlays, { w: 460, h: 260, yfmt: (v) => "$"+v.toFixed(0) });
  } else {
    const priceSeries = [];
    if (showBB) {
      priceSeries.push({ name: "Bollinger upper", values: sliceArr(cache.bb.upper), color: cssVar("--sec-1"), dashed: true });
      priceSeries.push({ name: "Bollinger lower", values: sliceArr(cache.bb.lower), color: cssVar("--sec-1"), dashed: true });
    }
    showMA.forEach(w => {
      const arr = w === "20" ? cache.sma20 : w === "50" ? cache.sma50 : cache.sma200;
      priceSeries.push({ name: `SMA ${w}`, values: sliceArr(arr), color: maColors[w] });
    });
    const periodUp = closeSlice[closeSlice.length-1] >= closeSlice[0];
    priceSeries.push({ name: "Close", values: closeSlice, color: periodUp ? cssVar("--good") : cssVar("--critical"), fill: true });
    renderLineChart(document.getElementById("cv-price-chart"), dSlice, priceSeries, { w: 460, h: 260, yfmt: (v) => "$"+v.toFixed(0), vfmt: (v) => "$"+v.toFixed(2), endBadge: true });
  }

  renderVolumeBars(document.getElementById("cv-volume"), dSlice, closeSlice, volSlice, startIdx, s.close);

  renderLineChart(document.getElementById("cv-rsi"), dSlice, [{ name: "RSI", values: sliceArr(cache.rsi), color: cssVar("--accent"), fill: true }],
    { w: 460, h: 160, fixedRange: [0,100], yfmt: (v) => v.toFixed(0), vfmt: (v) => v.toFixed(1), endBadge: true,
      refLines: [{ v: 70, color: cssVar("--critical"), label: "70" }, { v: 30, color: cssVar("--good"), label: "30" }] });

  renderMacdChart(document.getElementById("cv-macd"), dSlice, sliceArr(cache.macd.macd), sliceArr(cache.macd.signal), sliceArr(cache.macd.hist));
}
function openCompanyPage(t) {
  state.selectedTicker = t;
  document.getElementById("cv-ticker").value = t;
  document.getElementById("dashboard-view").style.display = "none";
  document.getElementById("company-view").style.display = "block";
  window.scrollTo(0, 0);
  renderCompanyPage();
}
function closeCompanyPage() {
  document.getElementById("company-view").style.display = "none";
  document.getElementById("dashboard-view").style.display = "block";
  window.scrollTo(0, 0);
}

/* ---------------- ticker tape ---------------- */
let tapeKey = "";
function buildTape() {
  const tape = document.getElementById("tape");
  const root = document.documentElement;
  const key = [PERIOD.startIdx, PERIOD.endIdx, root.dataset.theme || "", root.dataset.accent || ""].join(":");
  if (key === tapeKey) return;   // avoid restarting the marquee on unrelated re-renders
  tapeKey = key;
  tape.innerHTML = "";
  const track = document.createElement("div");
  track.className = "tape-track";
  track.style.animationDuration = (TICKERS.length * 3) + "s";
  for (let rep = 0; rep < 2; rep++) {
    TICKERS.forEach(t => {
      const p = PERIOD.metrics[t];
      const item = document.createElement("span");
      item.className = "tape-item";
      if (rep === 1) item.setAttribute("aria-hidden", "true");
      const sym = document.createElement("span");
      sym.className = "sym";
      sym.style.color = sectorColor(DATA.stocks[t].sector);
      sym.textContent = t;
      const px = document.createElement("span");
      px.className = "px";
      px.textContent = fmtUsd(p.close);
      const chg = document.createElement("span");
      chg.className = "chg " + (p.periodReturn >= 0 ? "pos" : "neg");
      chg.textContent = (p.periodReturn >= 0 ? "▲ " : "▼ ") + fmtPct(p.periodReturn);
      item.append(sym, px, chg);
      item.addEventListener("click", () => selectTicker(t));
      track.appendChild(item);
    });
  }
  tape.appendChild(track);
}

/* ---------------- filters + init ---------------- */
function renderAll() {
  computePeriod();
  buildTape();
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
  const cvSel = document.getElementById("cv-ticker");
  cvSel.innerHTML = [...TICKERS].sort().map(t => `<option value="${t}">${t} — ${DATA.stocks[t].name}</option>`).join("");
  cvSel.value = state.selectedTicker;
}
function wireEvents() {
  document.getElementById("f-search").addEventListener("input", (e) => { state.search = e.target.value; renderAll(); });
  document.getElementById("f-search").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const matches = getFiltered();
    if (matches.length === 1) openCompanyPage(matches[0]);
  });
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
  document.getElementById("cv-back").addEventListener("click", closeCompanyPage);
  document.getElementById("cv-ticker").addEventListener("change", (e) => { state.selectedTicker = e.target.value; renderCompanyPage(); });
  document.getElementById("cv-range").addEventListener("click", (e) => {
    if (e.target.tagName !== "BUTTON") return;
    document.querySelectorAll("#cv-range button").forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");
    state.range = e.target.dataset.range;
    renderCompanyPage();
  });
  document.getElementById("cv-chart-type").addEventListener("click", (e) => {
    if (e.target.tagName !== "BUTTON") return;
    document.querySelectorAll("#cv-chart-type button").forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");
    state.cvChartType = e.target.dataset.charttype;
    renderCompanyPage();
  });
  document.querySelectorAll(".cv-ma").forEach(cb => cb.addEventListener("change", renderCompanyPage));
  document.getElementById("cv-bb").addEventListener("change", renderCompanyPage);
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

/* ---------------- theme & palette ---------------- */
const themeSeg = document.getElementById("themeSeg");
const accentSel = document.getElementById("accentSel");
function rerenderForTheme() {
  tapeKey = "";
  renderAll();
  renderRollingVol();
  if (document.getElementById("company-view").style.display !== "none") renderCompanyPage();
}
function applyTheme(mode) {
  if (mode === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  themeSeg.querySelectorAll("button").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.themeOpt === mode)));
  try { localStorage.setItem("nd50-theme", mode); } catch {}
}
function applyAccent(accent) {
  if (accent === "classic") delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = accent;
  accentSel.value = accent;
  try { localStorage.setItem("nd50-accent", accent); } catch {}
}
themeSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-theme-opt]");
  if (!btn) return;
  applyTheme(btn.dataset.themeOpt);
  rerenderForTheme();
});
accentSel.addEventListener("change", () => { applyAccent(accentSel.value); rerenderForTheme(); });
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rerenderForTheme);

/* ---------------- period replay ---------------- */
const replayBtn = document.getElementById("replayBtn");
const replayDot = document.getElementById("replayDot");
let replayTimer = null;
state.replayEnd = null;
function renderReplayFrame() {
  computePeriod();
  const filtered = getFiltered();
  renderKPIs(filtered);
  renderGainersLosers(filtered);
  renderHeatmapSection(filtered);
  renderReturnsHist(filtered);
}
function stopReplay() {
  if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
  state.replayEnd = null;
  replayBtn.textContent = "▶";
  replayBtn.setAttribute("aria-label", "Replay the selected period");
  replayDot.classList.remove("on");
  renderAll();
}
replayBtn.addEventListener("click", () => {
  if (replayTimer) { stopReplay(); return; }
  const { startIdx, endIdx } = getPeriodIndices();
  const span = endIdx - startIdx;
  if (span < 2) {
    document.getElementById("period-summary").textContent = "Pick a multi-day period to replay";
    setTimeout(() => { if (!replayTimer) computePeriod(); }, 1800);
    return;
  }
  const stride = Math.max(1, Math.ceil(span / 60));
  let cur = startIdx + stride;
  window.ANIMATE_LINES = false;
  replayBtn.textContent = "❚❚";
  replayBtn.setAttribute("aria-label", "Stop replay");
  replayDot.classList.add("on");
  const tick = () => {
    state.replayEnd = Math.min(cur, endIdx);
    renderReplayFrame();
    if (cur >= endIdx) { stopReplay(); return; }
    cur += stride;
  };
  tick();
  replayTimer = setInterval(tick, 300);
});

state.range = "1Y";
state.period = "1D";
state.cvChartType = "line";
let savedTheme = "system", savedAccent = "classic";
try {
  savedTheme = localStorage.getItem("nd50-theme") || "system";
  savedAccent = localStorage.getItem("nd50-accent") || "classic";
} catch {}
applyTheme(savedTheme);
applyAccent(savedAccent);
document.body.classList.add("entrance");
setTimeout(() => {
  document.body.classList.remove("entrance");
  window.ANIMATE_LINES = false;
}, 1600);
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
