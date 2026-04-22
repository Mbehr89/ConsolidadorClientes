'use client';

export interface FlowReportRow {
  ticker: string;
  date: string;
  currency: string;
  intereses: number;
  amortizacion: number;
}

export interface FlowReportSections {
  monthlyByBond: boolean;
  annualDualAxis: boolean;
  flowTable: boolean;
}

export function exportFlowReportPdf(args: {
  title: string;
  rows: FlowReportRow[];
  totalsByCurrency: Array<[string, { intereses: number; amortizacion: number }]>;
  portfolioMetrics?: {
    ytm: number | null;
    duration: number | null;
    arsYtm?: number | null;
    arsDuration?: number | null;
    usdYtm?: number | null;
    usdDuration?: number | null;
  };
  sections?: FlowReportSections;
}) {
  const { title, rows, totalsByCurrency, portfolioMetrics } = args;
  const sections: FlowReportSections = {
    monthlyByBond: args.sections?.monthlyByBond ?? true,
    annualDualAxis: args.sections?.annualDualAxis ?? true,
    flowTable: args.sections?.flowTable ?? true,
  };
  const safeName = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const fileName = `${safeName || 'flujo_bonos'}.html`;

  const w = window.open('about:blank', '_blank', 'width=1200,height=900');
  if (!w) {
    // Fallback si el popup está bloqueado: descarga HTML imprimible.
    const fallbackHtml = `<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title></head><body>
      <h1>${title}</h1>
      <p>El navegador bloqueó la apertura automática para imprimir. Abrí este archivo y usá Imprimir / Guardar como PDF.</p>
    </body></html>`;
    const blob = new Blob([fallbackHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const fmt = (n: number) =>
    n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const grouped = new Map<string, FlowReportRow[]>();
  for (const r of rows) {
    const c = r.currency.toUpperCase();
    const list = grouped.get(c) ?? [];
    list.push(r);
    grouped.set(c, list);
  }

  const chartSectionsByCurrency = [...grouped.entries()]
    .map(([currency, list]) => {
      const palette = [
        '#2563eb',
        '#7c3aed',
        '#ea580c',
        '#16a34a',
        '#0891b2',
        '#dc2626',
        '#4f46e5',
        '#ca8a04',
      ];

      // ── Monthly stacked by ticker (different bar colors per bond) ──
      const monthTicker = new Map<string, Map<string, number>>();
      for (const x of list) {
        const month = x.date.slice(0, 7);
        const t = x.ticker || 'N/A';
        const total = x.intereses + x.amortizacion;
        const byTicker = monthTicker.get(month) ?? new Map<string, number>();
        byTicker.set(t, (byTicker.get(t) ?? 0) + total);
        monthTicker.set(month, byTicker);
      }
      const monthly = [...monthTicker.entries()]
        .map(([month, byTicker]) => ({ month, byTicker }))
        .sort((a, b) => a.month.localeCompare(b.month));

      const tickerTotals = new Map<string, number>();
      for (const m of monthly) {
        for (const [t, v] of m.byTicker.entries()) tickerTotals.set(t, (tickerTotals.get(t) ?? 0) + v);
      }
      const topTickers = [...tickerTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([t]) => t);

      const colorByTicker = new Map<string, string>();
      topTickers.forEach((t, i) => colorByTicker.set(t, palette[i % palette.length]!));
      colorByTicker.set('OTROS', '#94a3b8');

      const maxMonthly = Math.max(
        ...monthly.map((m) => {
          let s = 0;
          for (const v of m.byTicker.values()) s += v;
          return s;
        }),
        1
      );

      const monthlyBars = monthly
        .slice(0, 60)
        .map((m) => {
          const trackW = 460;
          let others = 0;
          const ordered: Array<[string, number]> = [];
          for (const [t, v] of m.byTicker.entries()) {
            if (topTickers.includes(t)) ordered.push([t, v]);
            else others += v;
          }
          if (others > 0) ordered.push(['OTROS', others]);
          const total = ordered.reduce((s, [, v]) => s + v, 0);
          let cursor = 0;
          const rects = ordered
            .map(([t, v]) => {
              const w = maxMonthly > 0 ? (v / maxMonthly) * trackW : 0;
              const out = `<rect x="${cursor}" y="0" width="${Math.max(w, 0)}" height="12" fill="${
                colorByTicker.get(t) ?? '#94a3b8'
              }" />`;
              cursor += w;
              return out;
            })
            .join('');
          return `<div class="bar-row">
            <div class="bar-label">${m.month}</div>
            <div class="bar-svg-wrap">
              <svg width="100%" height="12" viewBox="0 0 ${trackW} 12" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect x="0" y="0" width="${trackW}" height="12" rx="6" ry="6" fill="#e2e8f0" />
                ${rects}
              </svg>
            </div>
            <div class="bar-val">${fmt(total)}</div>
          </div>`;
        })
        .join('');

      const monthlyLegend = [...colorByTicker.entries()]
        .map(([t, c]) => `<span class="legend-chip"><span class="legend-swatch" style="background:${c}"></span>${t}</span>`)
        .join('');

      // ── Annual maturities with dual-axis bar chart ──
      const yearMap = new Map<string, { intereses: number; amortizacion: number }>();
      for (const x of list) {
        const year = x.date.slice(0, 4);
        const prev = yearMap.get(year) ?? { intereses: 0, amortizacion: 0 };
        prev.intereses += x.intereses;
        prev.amortizacion += x.amortizacion;
        yearMap.set(year, prev);
      }
      const annual = [...yearMap.entries()]
        .map(([year, v]) => ({ year, ...v }))
        .sort((a, b) => a.year.localeCompare(b.year));
      const maxI = Math.max(...annual.map((x) => x.intereses), 1);
      const maxA = Math.max(...annual.map((x) => x.amortizacion), 1);

      const svgW = 900;
      const svgH = 340;
      const ml = 78;
      const mr = 78;
      const mt = 22;
      const mb = 72;
      const cw = svgW - ml - mr;
      const ch = svgH - mt - mb;
      const step = annual.length > 0 ? cw / annual.length : cw;
      const barW = Math.max(8, step * 0.28);

      const ticks = [0, 0.25, 0.5, 0.75, 1];
      const gridLines = ticks
        .map((t) => {
          const y = mt + ch - t * ch;
          const leftVal = fmt(maxA * t);
          const rightVal = fmt(maxI * t);
          return `
            <line x1="${ml}" y1="${y}" x2="${svgW - mr}" y2="${y}" stroke="#e2e8f0" stroke-width="1" />
            <text x="${ml - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#16a34a">${leftVal}</text>
            <text x="${svgW - mr + 8}" y="${y + 4}" text-anchor="start" font-size="10" fill="#2563eb">${rightVal}</text>
          `;
        })
        .join('');

      const annualBars = annual
        .map((x, i) => {
          const center = ml + i * step + step / 2;
          const hA = (x.amortizacion / maxA) * ch;
          const hI = (x.intereses / maxI) * ch;
          const yA = mt + ch - hA;
          const yI = mt + ch - hI;
          const total = x.intereses + x.amortizacion;
          return `
            <rect x="${center - barW - 2}" y="${yA}" width="${barW}" height="${hA}" fill="#16a34a" />
            <rect x="${center + 2}" y="${yI}" width="${barW}" height="${hI}" fill="#2563eb" />
            <text x="${center}" y="${mt + ch + 16}" text-anchor="middle" font-size="10" fill="#334155">${x.year}</text>
            <text x="${center}" y="${mt + ch + 30}" text-anchor="middle" font-size="9" fill="#64748b">${fmt(total)}</text>
          `;
        })
        .join('');

      const annualChart = `
        <svg width="100%" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          ${gridLines}
          <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ch}" stroke="#64748b" stroke-width="1" />
          <line x1="${svgW - mr}" y1="${mt}" x2="${svgW - mr}" y2="${mt + ch}" stroke="#64748b" stroke-width="1" />
          <line x1="${ml}" y1="${mt + ch}" x2="${svgW - mr}" y2="${mt + ch}" stroke="#64748b" stroke-width="1" />
          ${annualBars}
          <text x="8" y="${mt + 12}" font-size="10" fill="#16a34a">Amortización (max ${fmt(maxA)})</text>
          <text x="${svgW - mr + 8}" y="${mt + 12}" font-size="10" fill="#2563eb">Intereses (max ${fmt(maxI)})</text>
          <text x="${ml + cw / 2}" y="${svgH - 8}" text-anchor="middle" font-size="10" fill="#64748b">Año · Total (Interés + Amortización)</text>
        </svg>`;

      return {
        currency,
        monthlyHtml: `<section class="card">
          <h3>${currency}</h3>
          <div class="legend-line">${monthlyLegend}</div>
          <div>${monthlyBars}</div>
        </section>`,
        annualHtml: `<section class="card">
          <h3>${currency}</h3>
          <div>${annualChart}</div>
        </section>`,
      };
    })
    ;

  const totalBadges = totalsByCurrency
    .map(
      ([c, t]) =>
        `<span class="badge">${c} · Int. ${fmt(t.intereses)} · Amort. ${fmt(t.amortizacion)} · Total ${fmt(
          t.intereses + t.amortizacion
        )}</span>`
    )
    .join('');

  const fmtPctMaybe = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(2)}%`;
  const fmtNumMaybe = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? '—' : v.toFixed(2);
  const compactHeader = `
    <div class="compact-head">
      <div class="compact-title">${title}</div>
      ${
        portfolioMetrics
          ? `<div class="compact-metrics">
              <span>TIR: ${fmtPctMaybe(portfolioMetrics.ytm)}</span>
              <span>Dur: ${fmtNumMaybe(portfolioMetrics.duration)}</span>
              <span>Valor actual: ${fmt(
                totalsByCurrency.reduce((s, [, t]) => s + t.intereses + t.amortizacion, 0)
              )}</span>
              <span>Valor final: ${fmt(
                totalsByCurrency.reduce((s, [, t]) => s + t.intereses + t.amortizacion, 0)
              )}</span>
            </div>`
          : ''
      }
    </div>
  `;

  const monthlySectionHtml = sections.monthlyByBond
    ? `<section class="sheet">
        ${compactHeader}
        <h2>Grafico mensual por bono</h2>
        <div class="cards">${
          chartSectionsByCurrency.map((s) => s.monthlyHtml).join('') || '<p class="meta">Sin datos</p>'
        }</div>
      </section>`
    : '';

  const annualSectionHtml = sections.annualDualAxis
    ? `<section class="sheet">
        ${compactHeader}
        <h2>Vencimientos anuales</h2>
        <div class="cards">${
          chartSectionsByCurrency.map((s) => s.annualHtml).join('') || '<p class="meta">Sin datos</p>'
        }</div>
      </section>`
    : '';

  const tableRows = rows
    .map(
      (r, idx) => `<tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
      <td>${r.ticker}</td>
      <td>${r.date}</td>
      <td>${r.currency}</td>
      <td class="num">${fmt(r.intereses)}</td>
      <td class="num">${fmt(r.amortizacion)}</td>
      <td class="num">${fmt(r.intereses + r.amortizacion)}</td>
    </tr>`
    )
    .join('');

  const tableSectionHtml = sections.flowTable
    ? `<section class="sheet table-section">
        ${compactHeader}
        <h2>Tabla de flujo</h2>
        <table>
          <thead>
            <tr><th>Ticker</th><th>Fecha</th><th>Moneda pago</th><th class="num">Intereses</th><th class="num">Amortización</th><th class="num">Total</th></tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </section>`
    : '';

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --bg-soft:#f8fafc; --bg-page:#fffaf0; --brand:#1d4ed8; --i:#2563eb; --a:#16a34a; }
    * { box-sizing: border-box; }
    body { font-family: "Inter","Segoe UI",Arial,sans-serif; margin:0; color:var(--ink); background:var(--bg-page); }
    .page { max-width: 1080px; margin: 0 auto; padding: 28px 30px 34px; background: var(--bg-page); min-height: 100vh; }
    .header { padding: 18px 20px; border:1px solid var(--line); border-radius:14px; background:linear-gradient(180deg,#f8fbff,#f2f7ff); margin-bottom:14px; }
    h1 { font-size:24px; margin:0 0 8px; color:var(--brand); }
    h2 { font-size:16px; margin:20px 0 10px; color:#0b3b9a; }
    h3 { font-size:14px; margin:0 0 8px; color:#1e3a8a; }
    .meta { margin:0; color:var(--muted); font-size:12px; }
    .legend { display:flex; gap:14px; margin-top:10px; font-size:12px; color:#334155; flex-wrap: wrap; }
    .dot { width:10px; height:10px; border-radius:999px; display:inline-block; margin-right:6px; }
    .dot.i { background:var(--i); } .dot.a { background:var(--a); }
    .dot.t { background:#4f46e5; }
    .badges { margin-top:10px; }
    .badge { display:inline-block; margin:0 8px 8px 0; padding:7px 11px; border:1px solid var(--line); border-radius:999px; font-family:Consolas,Menlo,monospace; font-size:12px; background:white; }
    .cards { display:grid; grid-template-columns:1fr; gap:10px; }
    .card { border:1px solid var(--line); border-radius:12px; background:var(--bg-soft); padding:12px; break-inside:avoid; }
    .legend-line { margin: 2px 0 8px; display:flex; flex-wrap:wrap; gap:6px; }
    .legend-chip { display:inline-flex; align-items:center; gap:5px; border:1px solid var(--line); background:white; border-radius:999px; padding:2px 8px; font-size:10px; font-family:Consolas,Menlo,monospace; }
    .legend-swatch { width:8px; height:8px; border-radius:999px; display:inline-block; }
    .compact-head { border:1px solid var(--line); border-radius:10px; padding:8px 10px; margin-bottom: 10px; background: #fff; }
    .compact-title { font-size: 12px; color:#1e3a8a; font-weight: 600; margin-bottom: 4px; }
    .compact-metrics { display:flex; flex-wrap:wrap; gap:10px; font-size:11px; color:#334155; font-family:Consolas,Menlo,monospace; }
    table { width:100%; border-collapse:collapse; font-size:12px; border:1px solid var(--line); border-radius:12px; overflow:hidden; }
    thead th { background:#eff6ff; color:#1e3a8a; border-bottom:1px solid #dbeafe; font-weight:600; padding:8px; text-align:left; }
    tbody td { border-bottom:1px solid #f1f5f9; padding:7px 8px; text-align:left; }
    tbody tr.even { background:#fff; } tbody tr.odd { background:#fcfdff; }
    .num { text-align:right; font-family:Consolas,Menlo,monospace; }
    .bar-row { display:grid; grid-template-columns:190px 1fr 130px; align-items:center; gap:8px; margin-bottom:5px; }
    .bar-label { font-size:11px; color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-family:Consolas,Menlo,monospace; }
    .bar-svg-wrap { height: 12px; width: 100%; }
    .bar-val { text-align:right; font-family:Consolas,Menlo,monospace; font-size:11px; }
    .footer { margin-top:18px; font-size:11px; color:var(--muted); text-align:right; }
    .sheet { page-break-after: always; }
    .sheet:last-of-type { page-break-after: auto; }
    .table-section { margin-top: 0; }
    .table-section table { page-break-inside: auto; }
    .table-section tr { page-break-inside: avoid; page-break-after: auto; }
    .table-section thead { display: table-header-group; }
    .table-section tfoot { display: table-footer-group; }
    @media print {
      @page { size: A4 portrait; margin: 12mm; }
      html, body { background: var(--bg-page) !important; }
      .page { max-width:100%; padding:14mm; background: var(--bg-page) !important; }
      .header { break-inside:avoid; page-break-after: always; }
      h2 { page-break-before: auto; }
      .cards { display:block; }
      .page-break-block { page-break-inside: avoid; break-inside: avoid; margin-bottom: 10mm; }
      .table-section { page-break-before: auto; }
      .footer { position: fixed; bottom: 6mm; right: 12mm; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="page">
    ${monthlySectionHtml}
    ${annualSectionHtml}
    ${tableSectionHtml}
    <div class="footer">Reporte de flujo generado automáticamente</div>
  </div>
</body>
</html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();

  const triggerPrint = () => {
    try {
      w.focus();
      w.print();
    } catch {
      // no-op
    }
  };
  if (w.document.readyState === 'complete') {
    setTimeout(triggerPrint, 250);
  } else {
    w.addEventListener('load', () => setTimeout(triggerPrint, 250), { once: true });
  }
}

