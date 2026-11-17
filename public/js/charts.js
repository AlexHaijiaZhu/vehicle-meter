import { esc, fmtCompact, fmtNum } from './ui.js';

let uid = 0;

function niceCeil(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const f = value / base;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * base;
}

function legendHtml(series) {
  return `<div class="chart-legend">${series
    .filter((s) => s.name)
    .map((s) => `<span class="legend-item"><i style="background:${s.color}"></i>${esc(s.name)}</span>`)
    .join('')}</div>`;
}

function emptyChart(message = '暂无足够数据') {
  return `<div class="chart-empty"><span class="chart-empty-line"></span><p>${esc(message)}</p></div>`;
}

function prepare(el, html) {
  el.innerHTML = `<div class="chart-wrap">${html}<div class="chart-tip" hidden></div></div>`;
  return el.querySelector('.chart-wrap');
}

function tooltipAt(wrap, event, html) {
  const tip = wrap.querySelector('.chart-tip');
  const rect = wrap.getBoundingClientRect();
  tip.innerHTML = html;
  tip.hidden = false;
  const x = Math.min(Math.max(event.clientX - rect.left, 8), rect.width - 8);
  tip.style.left = `${x}px`;
  tip.style.top = `${Math.max(event.clientY - rect.top - 8, 8)}px`;
}

function hideTip(wrap) {
  const tip = wrap.querySelector('.chart-tip');
  if (tip) tip.hidden = true;
}

export function lineChart(el, { labels = [], series = [], unit = '', height = 300, area = true } = {}) {
  if (!el) return;
  const visible = series.filter((s) => s.values.some((v) => v != null));
  if (!labels.length || !visible.length) {
    el.innerHTML = emptyChart();
    return;
  }
  const W = 760;
  const H = height;
  const pad = { l: 48, r: 18, t: 18, b: 34 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const values = visible.flatMap((s) => s.values.filter((v) => v != null));
  const max = niceCeil(Math.max(...values, 1) * 1.12);
  const x = (i) => (labels.length === 1 ? pad.l + plotW / 2 : pad.l + (i / (labels.length - 1)) * plotW);
  const y = (v) => pad.t + plotH - (Number(v) / max) * plotH;
  const chartId = `chart-${++uid}`;

  const grid = Array.from({ length: 5 }, (_, i) => {
    const value = (max / 4) * i;
    const yy = y(value);
    return `<line x1="${pad.l}" y1="${yy}" x2="${W - pad.r}" y2="${yy}" class="grid-line"/>
      <text x="${pad.l - 10}" y="${yy + 4}" class="axis-label" text-anchor="end">${fmtCompact(value)}</text>`;
  }).join('');

  const step = Math.max(1, Math.ceil(labels.length / 8));
  const xLabels = labels
    .map((label, i) => {
      if (i % step !== 0 && i !== labels.length - 1) return '';
      return `<text x="${x(i)}" y="${H - 10}" class="axis-label" text-anchor="middle">${esc(label)}</text>`;
    })
    .join('');

  const defs = visible
    .map((s, i) => `<linearGradient id="${chartId}-g${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".26"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`)
    .join('');

  const paths = visible
    .map((s, si) => {
      let d = '';
      let segmentStarted = false;
      s.values.forEach((v, i) => {
        if (v == null) { segmentStarted = false; return; }
        d += `${segmentStarted ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
        segmentStarted = true;
      });
      let areaPath = '';
      if (area) {
        const valid = s.values.map((v, i) => ({ v, i })).filter((p) => p.v != null);
        if (valid.length > 1) {
          areaPath = `<path d="M${x(valid[0].i).toFixed(1)},${(pad.t + plotH).toFixed(1)} ${valid.map((p) => `L${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} L${x(valid[valid.length - 1].i).toFixed(1)},${(pad.t + plotH).toFixed(1)} Z" fill="url(#${chartId}-g${si})"/>`;
        }
      }
      const dots = s.values
        .map((v, i) => (v == null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.1" fill="#fff" stroke="${s.color}" stroke-width="2"/>`))
        .join('');
      return `<g>${areaPath}<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>${dots}</g>`;
    })
    .join('');

  const html = `${legendHtml(visible)}
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="折线图">
      <defs>${defs}</defs>
      ${grid}${xLabels}${paths}
      <rect x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}" fill="transparent" class="chart-hit"/>
    </svg>`;
  const wrap = prepare(el, html);
  const svg = wrap.querySelector('svg');

  svg.addEventListener('pointermove', (event) => {
    const rect = svg.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const px = ratio * W;
    let index = 0;
    let best = Infinity;
    labels.forEach((_, i) => {
      const dist = Math.abs(x(i) - px);
      if (dist < best) { best = dist; index = i; }
    });
    const rows = visible
      .map((s) => `<div class="tip-row"><i style="background:${s.color}"></i><span>${esc(s.name)}</span><b>${s.values[index] == null ? '—' : `${fmtNum(s.values[index], 2)}${unit}`}</b></div>`)
      .join('');
    tooltipAt(wrap, event, `<div class="tip-title">${esc(labels[index])}</div>${rows}`);
  });
  svg.addEventListener('pointerleave', () => hideTip(wrap));
}

export function barChart(el, { labels = [], series = [], unit = '', height = 300, stacked = false } = {}) {
  if (!el) return;
  const visible = series.filter((s) => s.values.some((v) => v != null && Number(v) !== 0));
  if (!labels.length || !visible.length) {
    el.innerHTML = emptyChart();
    return;
  }
  const W = 760;
  const H = height;
  const pad = { l: 48, r: 18, t: 18, b: 34 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const totals = labels.map((_, i) => visible.reduce((n, s) => n + (Number(s.values[i]) || 0), 0));
  const maxRaw = stacked ? Math.max(...totals) : Math.max(...visible.flatMap((s) => s.values.map((v) => Number(v) || 0)));
  const max = niceCeil(Math.max(maxRaw, 1) * 1.12);
  const groupW = plotW / labels.length;
  const barGap = stacked ? 0 : Math.min(8, groupW * 0.12);
  const barW = stacked ? Math.min(34, groupW * 0.58) : Math.max(3, (groupW * 0.66 - barGap * (visible.length - 1)) / visible.length);
  const y = (v) => pad.t + plotH - (Number(v) / max) * plotH;
  const xCenter = (i) => pad.l + groupW * i + groupW / 2;

  const grid = Array.from({ length: 5 }, (_, i) => {
    const value = (max / 4) * i;
    const yy = y(value);
    return `<line x1="${pad.l}" y1="${yy}" x2="${W - pad.r}" y2="${yy}" class="grid-line"/>
      <text x="${pad.l - 10}" y="${yy + 4}" class="axis-label" text-anchor="end">${fmtCompact(value)}</text>`;
  }).join('');

  const step = Math.max(1, Math.ceil(labels.length / 8));
  const xLabels = labels
    .map((label, i) => (i % step === 0 || i === labels.length - 1
      ? `<text x="${xCenter(i)}" y="${H - 10}" class="axis-label" text-anchor="middle">${esc(label)}</text>`
      : ''))
    .join('');

  const bars = labels
    .map((_, i) => {
      if (stacked) {
        let offset = 0;
        return `<g>${visible
          .map((s) => {
            const value = Number(s.values[i]) || 0;
            if (value <= 0) return '';
            const h = (value / max) * plotH;
            const yy = pad.t + plotH - offset - h;
            offset += h;
            return `<rect x="${xCenter(i) - barW / 2}" y="${yy}" width="${barW}" height="${h}" rx="2.5" fill="${s.color}"/>`;
          })
          .join('')}</g>`;
      }
      const totalW = barW * visible.length + barGap * (visible.length - 1);
      return `<g>${visible
        .map((s, si) => {
          const value = Number(s.values[i]) || 0;
          if (value <= 0) return '';
          const h = (value / max) * plotH;
          const xx = xCenter(i) - totalW / 2 + si * (barW + barGap);
          return `<rect x="${xx}" y="${pad.t + plotH - h}" width="${barW}" height="${h}" rx="2.5" fill="${s.color}"/>`;
        })
        .join('')}</g>`;
    })
    .join('');

  const hits = labels
    .map((_, i) => `<rect x="${pad.l + groupW * i}" y="${pad.t}" width="${groupW}" height="${plotH}" fill="transparent" data-idx="${i}" class="bar-hit"/>`)
    .join('');

  const wrap = prepare(el, `${legendHtml(visible)}<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="柱状图">${grid}${xLabels}${bars}${hits}</svg>`);
  const svg = wrap.querySelector('svg');
  svg.querySelectorAll('.bar-hit').forEach((hit) => {
    hit.addEventListener('pointermove', (event) => {
      const index = Number(hit.dataset.idx);
      const rows = visible
        .map((s) => `<div class="tip-row"><i style="background:${s.color}"></i><span>${esc(s.name)}</span><b>${s.values[index] == null ? '—' : `${fmtNum(s.values[index], 2)}${unit}`}</b></div>`)
        .join('');
      tooltipAt(wrap, event, `<div class="tip-title">${esc(labels[index])}</div>${rows}${stacked ? `<div class="tip-total">合计 ${fmtNum(totals[index], 2)}${unit}</div>` : ''}`);
    });
    hit.addEventListener('pointerleave', () => hideTip(wrap));
  });
}

export function donutChart(el, { items = [], centerLabel = '合计', centerValue = '', size = 190 } = {}) {
  if (!el) return;
  const total = items.reduce((n, item) => n + Number(item.value || 0), 0);
  if (!items.length || total <= 0) {
    el.innerHTML = emptyChart();
    return;
  }
  const r = 64;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const segments = items
    .filter((item) => Number(item.value) > 0)
    .map((item) => {
      const ratio = Number(item.value) / total;
      const length = ratio * circumference;
      const seg = `<circle cx="90" cy="90" r="${r}" fill="none" stroke="${item.color || '#94a3b8'}" stroke-width="22"
        stroke-dasharray="${Math.max(length - 2, 0.5)} ${circumference - Math.max(length - 2, 0.5)}"
        stroke-dashoffset="${-offset}" transform="rotate(-90 90 90)" stroke-linecap="butt"><title>${esc(item.label)} ${fmtNum(item.value, 2)}</title></circle>`;
      offset += length;
      return seg;
    })
    .join('');

  const legend = items
    .filter((item) => Number(item.value) > 0)
    .map((item) => {
      const pct = ((Number(item.value) / total) * 100).toFixed(1);
      return `<div class="donut-legend-row">
        <i style="background:${item.color || '#94a3b8'}"></i>
        <span class="dl-label">${esc(item.label)}</span>
        <span class="dl-value">${fmtNum(item.value, 2)}</span>
        <span class="dl-pct">${pct}%</span>
      </div>`;
    })
    .join('');

  el.innerHTML = `<div class="donut-layout">
    <div class="donut-svg-wrap">
      <svg viewBox="0 0 180 180" style="width:${size}px;height:${size}px" role="img" aria-label="费用构成">
        <circle cx="90" cy="90" r="${r}" fill="none" stroke="var(--line-soft)" stroke-width="22"/>
        ${segments}
        <text x="90" y="84" text-anchor="middle" class="donut-center-label">${esc(centerLabel)}</text>
        <text x="90" y="106" text-anchor="middle" class="donut-center-value">${esc(centerValue)}</text>
      </svg>
    </div>
    <div class="donut-legend">${legend}</div>
  </div>`;
}

export function sparkline(values = [], color = '#2383e2', width = 120, height = 36) {
  const valid = values.filter((v) => v != null);
  if (!valid.length) return '';
  const max = Math.max(...valid, 1);
  const min = Math.min(...valid, 0);
  const range = max - min || 1;
  const points = values
    .map((v, i) => (v == null ? null : `${(i / Math.max(values.length - 1, 1)) * width},${height - ((v - min) / range) * (height - 6) - 3}`))
    .filter(Boolean)
    .join(' ');
  return `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" aria-hidden="true"><polyline points="${points}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function chartCard({ title, subtitle = '', value = '', chart = '', footer = '', className = '' }) {
  return `<section class="card chart-card ${className}">
    <header class="card-head">
      <div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
      ${value ? `<div class="card-head-value">${value}</div>` : ''}
    </header>
    <div class="chart-body">${chart}</div>
    ${footer ? `<footer class="card-foot">${footer}</footer>` : ''}
  </section>`;
}
