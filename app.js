/* Daily BRVM – CGF Bourse : dashboard interactif (données publiées par le robot dans data/) */
(() => {
'use strict';

// ------------------------------------------------------------------ format
const nf = (d) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const ok = (v) => v !== null && v !== undefined && !Number.isNaN(v);
const F = {
  n0: (v) => ok(v) ? nf(0).format(v) : '—',
  n1: (v) => ok(v) ? nf(1).format(v) : '—',
  n2: (v) => ok(v) ? nf(2).format(v) : '—',
  pct: (v, d = 1) => ok(v) ? nf(d).format(v * 100) + ' %' : '—',
  spct: (v, d = 2) => ok(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + nf(d).format(Math.abs(v) * 100) + ' %' : '—',
  mds: (v) => ok(v) ? nf(1).format(v / 1e9) : '—',
  big: (v) => !ok(v) ? '—' : Math.abs(v) >= 1e12 ? nf(2).format(v / 1e12) + ' T' : Math.abs(v) >= 1e9 ? nf(1).format(v / 1e9) + ' Mds' : Math.abs(v) >= 1e6 ? nf(1).format(v / 1e6) + ' M' : nf(0).format(v),
  date: (s) => s ? new Date(s + (s.length === 10 ? 'T00:00:00Z' : '')).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—',
  dshort: (d) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' }),
  dtime: (s) => new Date(s).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dakar' }) + ' (heure de Dakar)',
};
const cls = (v) => ok(v) ? (v > 0 ? 'up' : v < 0 ? 'down' : '') : '';
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;      // attribut absent (case non cochée, bouton actif…)
    if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids) if (k !== null && k !== undefined) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
};
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const palette = () => ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7'].map(css);

const SECTORS = ['Services financiers', 'Télécommunications', 'Consommation de base', 'Consommation discrétionnaire', 'Industriels', 'Energie', 'Services publics'];
const secColor = (s) => palette()[Math.max(0, SECTORS.indexOf(s)) % 7];

// ------------------------------------------------------------------ état
const S = {
  idxPer: 'YTD', idxSel: new Set(['BRVM Composite', 'BRVM 30', 'BRVM Prestige']), tm: 'var_seance', secPer: 'var_seance', tf: 'var_seance',
  sel: null, tmg: 'secteur', tPer: '1A', ov: new Set(['MM50', 'MM200']), scSort: { k: 'capitalisation', dir: -1 }, scView: 'perf', sx: 'vol_1a', sy: 'perf_1a',
};
let D, P, V, DATES, TIT;

// ------------------------------------------------------------------ tooltip
const tip = $('#tip');
const showTip = (ev, title, lines) => {
  tip.replaceChildren(el('div', { class: 't' }, title), ...lines.map((l) => el('div', {}, l.c ? el('i', { style: `background:${l.c}` }) : null, l.t)));
  tip.style.display = 'block';
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = ev.clientX + 14, y = ev.clientY - h - 12;
  if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
  if (y < 8) y = ev.clientY + 16;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
};
const hideTip = () => { tip.style.display = 'none'; };

// ------------------------------------------------------------------ données
const series = (k) => P.series[k] || [];
const periodStart = (per, last) => {
  const d = new Date(last);
  switch (per) {
    case '1M': d.setUTCMonth(d.getUTCMonth() - 1); break;
    case '3M': d.setUTCMonth(d.getUTCMonth() - 3); break;
    case '6M': d.setUTCMonth(d.getUTCMonth() - 6); break;
    case 'YTD': return new Date(Date.UTC(last.getUTCFullYear(), 0, 1));   // base : première séance de l'année (2 janvier en 2026)
    case '1A': d.setUTCFullYear(d.getUTCFullYear() - 1); break;
    case '3A': d.setUTCFullYear(d.getUTCFullYear() - 3); break;
    case '5A': d.setUTCFullYear(d.getUTCFullYear() - 5); break;
    default: return new Date(0);
  }
  return d;
};
const startIdx = (per) => { const s = periodStart(per, DATES.at(-1)); const i = DATES.findIndex((d) => d >= s); return Math.max(0, i); };
const rebase = (a) => { const b = a.find((v) => ok(v) && v > 0); return a.map((v) => ok(v) ? v / b * 100 : null); };
const sma = (a, n) => a.map((_, i) => { if (i < n - 1) return null; const w = a.slice(i - n + 1, i + 1).filter(ok); return w.length >= n * 0.8 ? d3.mean(w) : null; });
const rstd = (a, n) => a.map((_, i) => { if (i < n - 1) return null; const w = a.slice(i - n + 1, i + 1).filter(ok); return w.length >= n * 0.8 ? d3.deviation(w) : null; });
const logret = (a) => a.map((v, i) => i && ok(v) && ok(a[i - 1]) && a[i - 1] > 0 ? Math.log(v / a[i - 1]) : null);
const rollVol = (a, n) => { const r = logret(a); return r.map((_, i) => { if (i < n) return null; const w = r.slice(i - n + 1, i + 1).filter(ok); return w.length >= n * 0.8 ? d3.deviation(w) * Math.sqrt(252) : null; }); };

// ------------------------------------------------------------------ graphiques
function svgIn(box, h) {
  box.replaceChildren();
  const w = Math.max(300, box.clientWidth);
  const svg = d3.select(box).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('height', h);
  return { svg, w, h };
}
const tw = (svg, t) => { const n = svg.append('text').text(t); const w = n.node().getComputedTextLength(); n.remove(); return w; };
const empty = (box, msg) => box.replaceChildren(el('div', { class: 'empty' }, msg));

function lineChart(box, ser, o = {}) {
  // Graphique en courbes avec zoom (lot 8) : boutons + / − / ↺, double-clic pour zoomer, glisser pour se déplacer,
  // pincer sur mobile, Ctrl + molette sur ordinateur. L'axe vertical s'ajuste aux données visibles.
  const h = o.h || box.clientHeight || 300;
  const all = ser.flatMap((s) => s.v.filter(ok));
  if (!all.length) return empty(box, 'Pas de données sur la période');
  const { svg, w } = svgIn(box, h);
  if (o.legend) box.prepend(el('div', { class: 'legend', style: 'margin-bottom:6px' }, ...ser.filter((s) => !s.band).map((s) => el('span', {}, el('i', { style: `background:${s.c}` }), s.n))));
  const dates = ser[0].d;
  const yDom = (i0, i1) => {
    const vals = ser.flatMap((s) => [...s.v.slice(i0, i1 + 1), ...(s.band ? [...s.band[0].slice(i0, i1 + 1), ...s.band[1].slice(i0, i1 + 1)] : [])]).filter(ok);
    let yd = vals.length ? d3.extent(vals) : d3.extent(all);
    if (ok(o.ref)) yd = [Math.min(yd[0], o.ref), Math.max(yd[1], o.ref)];
    if (o.zeroTop) yd[1] = 0;
    if (o.zeroBase) yd[0] = Math.min(0, yd[0]);
    // série plate ou presque (ex. cours inchangé entre deux relevés) : marge de ±0,5 % pour garder un axe lisible
    const pad = Math.max(1e-9, Math.abs((yd[0] + yd[1]) / 2) * 0.005);
    if (yd[1] - yd[0] < pad) { const m = (yd[0] + yd[1]) / 2; yd = [m - pad, m + pad]; }
    return yd;
  };
  const y0 = d3.scaleLinear(yDom(0, dates.length - 1), [h - 22, 8]).nice(5);
  const ml = d3.max(y0.ticks(5), (t) => tw(svg, o.fy(t))) + 10;
  const labels = o.end === false ? [] : ser.filter((s) => !s.noEnd).map((s) => `${s.n} ${o.fy(s.v.filter(ok).at(-1))}`);
  const mr = labels.length && w > 560 ? d3.max(labels, (l) => tw(svg, l)) + 12 : 6;
  const x0 = d3.scaleUtc(d3.extent(dates), [ml, w - mr]);
  const cid = 'c' + Math.random().toString(36).slice(2);
  svg.append('defs').append('clipPath').attr('id', cid).append('rect').attr('x', ml).attr('y', 0).attr('width', Math.max(0, w - ml - mr)).attr('height', h);
  const gy = svg.append('g').attr('class', 'grid'), gx = svg.append('g').attr('transform', `translate(0,${h - 18})`);
  const gc = svg.append('g').attr('clip-path', `url(#${cid})`), ge = svg.append('g');
  let gid = null;
  if (o.area) {
    gid = 'g' + Math.random().toString(36).slice(2);
    const g = svg.select('defs').append('linearGradient').attr('id', gid).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
    [[0, .28], [.5, .08], [1, 0]].forEach(([a, b]) => g.append('stop').attr('offset', a).attr('stop-color', ser[0].c).attr('stop-opacity', b));
  }
  const st = { x: x0, y: y0 };
  const render = (x) => {
    const [d0, d1] = x.domain();
    let i0 = d3.bisectLeft(dates, d0), i1 = d3.bisectRight(dates, d1) - 1;
    i0 = Math.max(0, i0 - 1); i1 = Math.min(dates.length - 1, Math.max(i0, i1 + 1));
    const y = d3.scaleLinear(yDom(i0, i1), [h - 22, 8]).nice(5);
    st.x = x; st.y = y;
    gy.attr('transform', `translate(${ml - 4},0)`).call(d3.axisLeft(y).tickValues(y.ticks(5).filter((t, i, T) => !i || o.fy(t) !== o.fy(T[i - 1]))).tickFormat(o.fy).tickSize(-(w - mr - ml + 4))).call((g) => g.selectAll('.tick text').attr('x', -4));
    gx.call((() => { const ax = d3.axisBottom(x).tickSize(0).tickFormat(o.fx || F.dshort); return o.xvals ? ax.tickValues(o.xvals) : ax.ticks(Math.max(2, Math.floor((w - ml - mr) / 95))); })());
    gc.selectAll('*').remove(); ge.selectAll('*').remove();
    if (ok(o.ref)) gc.append('line').attr('x1', ml).attr('x2', w - mr).attr('y1', y(o.ref)).attr('y2', y(o.ref)).attr('stroke', css('--muted-line')).attr('stroke-dasharray', '4 3');
    ser.forEach((s, i) => {
      const pts = dates.map((d, j) => [d, s.v[j]]);
      if (s.band) {
        const pb = dates.map((d, j) => [d, s.band[0][j], s.band[1][j]]);
        gc.append('path').attr('d', d3.area().defined((p) => ok(p[1]) && ok(p[2])).x((p) => x(p[0])).y0((p) => y(p[1])).y1((p) => y(p[2]))(pb)).attr('fill', s.c).attr('opacity', 0.1);
        return;
      }
      if (o.area && i === 0) gc.append('path').attr('d', d3.area().defined((p) => ok(p[1])).x((p) => x(p[0])).y0(o.zeroTop ? y(0) : h - 22).y1((p) => y(p[1]))(pts)).attr('fill', `url(#${gid})`);
      gc.append('path').attr('d', (o.step ? d3.line().curve(d3.curveStepAfter) : d3.line()).defined((p) => ok(p[1])).x((p) => x(p[0])).y((p) => y(p[1]))(pts))
        .attr('fill', 'none').attr('stroke', s.c).attr('stroke-width', s.w || 1.6).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
        .attr('stroke-dasharray', s.dash ? '5 4' : null);
    });
    if (mr > 6) {
      const ends = ser.filter((s) => !s.noEnd && !s.band).map((s) => { const v = s.v.slice(0, i1 + 1).filter(ok).at(-1); return ok(v) ? { y: y(v), c: s.c, t: `${s.n} ${o.fy(v)}` } : null; }).filter(Boolean).sort((a, b) => a.y - b.y);
      for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
      ends.forEach((e) => ge.append('text').attr('x', w - mr + 6).attr('y', e.y + 4).attr('fill', e.c).style('fill', e.c).text(e.t));
    }
    if (o.onZoom) o.onZoom(x);
  };
  render(x0);
  const rule = svg.append('line').attr('y1', 8).attr('y2', h - 22).attr('stroke', css('--muted-line')).style('display', 'none');
  const vis = ser.filter((s) => !s.band);
  const dots = vis.map((s) => svg.append('circle').attr('r', 3.5).attr('fill', s.c).style('display', 'none'));
  const hit = svg.append('rect').attr('x', ml).attr('width', Math.max(0, w - ml - mr)).attr('height', h).attr('fill', 'transparent')
    .on('mousemove', (ev) => {
      const [mx] = d3.pointer(ev);
      const i = Math.max(0, Math.min(dates.length - 1, d3.bisector((d) => d).center(dates, st.x.invert(mx))));
      rule.attr('x1', st.x(dates[i])).attr('x2', st.x(dates[i])).style('display', null);
      vis.forEach((s, k) => dots[k].style('display', ok(s.v[i]) ? null : 'none').attr('cx', st.x(dates[i])).attr('cy', ok(s.v[i]) ? st.y(s.v[i]) : 0));
      showTip(ev, o.ftip ? o.ftip(dates[i]) : F.date(dates[i].toISOString().slice(0, 10)), vis.map((s) => ({ c: vis.length > 1 ? s.c : null, t: `${s.n} : ${o.fy(s.v[i])}` })));
      if (o.onHover) o.onHover(i);
    })
    .on('mouseleave', () => { rule.style('display', 'none'); dots.forEach((d) => d.style('display', 'none')); hideTip(); });
  if (o.zoom !== false && dates.length > 8) {
    const kmax = Math.max(2, dates.length / 6);
    const zoom = d3.zoom().scaleExtent([1, kmax]).translateExtent([[ml, 0], [w - mr, h]]).extent([[ml, 0], [w - mr, h]])
      .filter((ev) => (ev.type === 'wheel' ? ev.ctrlKey || ev.metaKey : !ev.button))
      .on('zoom', (ev) => { hideTip(); rule.style('display', 'none'); dots.forEach((d) => d.style('display', 'none')); render(ev.transform.rescaleX(x0)); bar.classList.toggle('zoomed', ev.transform.k > 1.001); });
    hit.style('cursor', 'grab').call(zoom).on('dblclick.zoom', null)
      .on('dblclick', (ev) => { const [mx] = d3.pointer(ev); hit.transition().duration(250).call(zoom.scaleBy, 2, [mx, h / 2]); });
    const btn = (t, tl, f) => el('button', { type: 'button', title: tl, 'aria-label': tl, onclick: f }, t);
    const bar = el('div', { class: 'zbar' },
      btn('+', 'Zoomer (ou double-cliquer sur le graphique)', () => hit.transition().duration(250).call(zoom.scaleBy, 2)),
      btn('−', 'Dézoomer', () => hit.transition().duration(250).call(zoom.scaleBy, 0.5)),
      btn('↺', 'Vue complète', () => hit.transition().duration(300).call(zoom.transform, d3.zoomIdentity)));
    box.style.position = 'relative';
    box.append(bar);
  }
  return { get x() { return st.x; }, ml, mr, w };
}

function hbars(box, items, o) {
  if (!items.length) return empty(box, 'Pas de données');
  const rh = o.rh || 24, h = items.length * rh + 8;
  const { svg, w } = svgIn(box, h);
  const ml = d3.max(items, (d) => tw(svg, d.label)) + 12;
  const vl = d3.max(items, (d) => tw(svg, o.f(d.value))) + 10;
  const vals = items.map((d) => d.value);
  const x = d3.scaleLinear([Math.min(0, d3.min(vals)), Math.max(0, d3.max(vals))], [ml, w - vl]);
  items.forEach((d, i) => {
    const yy = i * rh + 4;
    svg.append('text').attr('class', 'lbl').attr('x', ml - 8).attr('y', yy + rh / 2 + 3).attr('text-anchor', 'end').text(d.label);
    const x0 = x(Math.min(0, d.value)), x1 = x(Math.max(0, d.value));
    svg.append('rect').attr('x', x0).attr('y', yy + 4).attr('width', Math.max(1, x1 - x0)).attr('height', rh - 9).attr('rx', 3)
      .attr('fill', d.c || (d.value >= 0 ? css('--up') : css('--down'))).attr('opacity', .85).style('cursor', o.click ? 'pointer' : null)
      .on('mousemove', (ev) => showTip(ev, d.title || d.label, [{ t: o.f(d.value) }, ...(d.extra || []).map((t) => ({ t }))])).on('mouseleave', hideTip)
      .on('click', () => o.click && o.click(d));
    svg.append('text').attr('x', x1 + 5).attr('y', yy + rh / 2 + 3).text(o.f(d.value));
  });
  svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', h).attr('stroke', css('--muted-line'));
}

function spark(vals, w = 90, h = 24, color, dates, label) {
  const v = vals.filter(ok);
  const s = d3.create('svg').attr('width', w).attr('height', h).attr('viewBox', `0 0 ${w} ${h}`);
  if (v.length < 2) return s.node();
  const x = d3.scaleLinear([0, vals.length - 1], [1, w - 1]), y = d3.scaleLinear(d3.extent(v), [h - 2, 2]);
  const c = color || (v.at(-1) >= v[0] ? css('--up') : css('--down'));
  s.append('path').attr('d', d3.line().defined(ok).x((_, i) => x(i)).y((d) => y(d))(vals)).attr('fill', 'none').attr('stroke', c).attr('stroke-width', 1.5);
  if (dates) {   // miniature interactive : cours et variation depuis le début de la courbe au survol
    const dot = s.append('circle').attr('r', 2.5).attr('fill', c).style('display', 'none');
    const first = v[0];
    s.append('rect').attr('width', w).attr('height', h).attr('fill', 'transparent')
      .on('mousemove', (ev) => { const [mx] = d3.pointer(ev); let i = Math.round(x.invert(mx)); i = Math.max(0, Math.min(vals.length - 1, i));
        while (i > 0 && !ok(vals[i])) i--; if (!ok(vals[i])) return; dot.attr('cx', x(i)).attr('cy', y(vals[i])).style('display', null);
        showTip(ev, `${label ? label + ' · ' : ''}${F.date(dates[i].toISOString().slice(0, 10))}`, [{ t: `Cours : ${F.n0(vals[i])}` }, { t: `Depuis le début de la courbe : ${F.spct(vals[i] / first - 1, 1)}` }]); })
      .on('mouseleave', () => { dot.style('display', 'none'); hideTip(); })
      .on('click', (ev) => ev.stopPropagation());
  }
  return s.node();
}

// Tableau triable générique : cols [{k, h, f, cls, l, bar, spark}]
function table(t, rows, cols, o = {}) {
  const sort = o.sort;
  const thead = el('thead', {}, el('tr', {}, ...cols.map((c) => {
    const th = el('th', { class: c.l ? 'l' : '' }, c.h + (sort && sort.k === c.k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''));
    if (o.onSort && !c.spark) th.addEventListener('click', () => o.onSort(c.k));
    return th;
  })));
  const mx = {};
  cols.filter((c) => c.bar).forEach((c) => { mx[c.k] = d3.max(rows, (r) => Math.abs(r[c.k])) || 1; });
  const tb = el('tbody');
  rows.forEach((r) => {
    const tr = el('tr', o.click ? { onclick: () => o.click(r) } : {});
    cols.forEach((c) => {
      const v = r[c.k];
      const td = el('td', { class: [c.l ? 'l' : '', c.nm ? 'nm' : '', c.sym ? 'sym' : ''].join(' ') });
      if (c.spark) td.append(spark(c.spark(r)));
      else if (c.pill) td.append(el('span', { class: 'pill ' + cls(v) }, c.f(v)));
      else {
        if (c.bar && ok(v)) td.append(el('span', { class: 'bar-in', style: `width:${Math.round(40 * Math.abs(v) / mx[c.k])}px` }));
        td.append(document.createTextNode(c.f ? c.f(v) : (v ?? '—')));
        const k = c.cls ? cls(v) : '';
        if (k) td.classList.add(k);
      }
      if (c.title) td.title = r[c.title] || '';
      tr.append(td);
    });
    tb.append(tr);
  });
  t.replaceChildren(thead, tb);
}

const seg = (box, opts, cur, on) => {
  box.replaceChildren(...opts.map(([v, lab]) => el('button', { class: v === cur ? 'on' : '', onclick: () => { box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); on(v); }, 'data-v': v }, lab)));
};
const PERIODS = [['1M', '1M'], ['3M', '3M'], ['6M', '6M'], ['YTD', 'YTD'], ['1A', '1A'], ['3A', '3A'], ['5A', '5A'], ['MAX', 'Max']];

// ------------------------------------------------------------------ en-tête
function header() {
  const r = D.resume;
  $('#seance').textContent = F.date(r.seance);
  $('#maj').textContent = F.dtime(D.genere_le);
  $('#gen').textContent = 'généré le ' + F.dtime(D.genere_le);
  $('#commentaire').textContent = r.commentaire || '';
  const tape = TIT.slice().sort((a, b) => (b.capitalisation || 0) - (a.capitalisation || 0)).map((t) =>
    el('span', {}, el('b', {}, t.symbole), F.n0(t.cours) + ' ', el('span', { class: cls(t.var_seance) }, F.spct(t.var_seance))));
  $('#tape').replaceChildren(...tape, ...tape.map((n) => n.cloneNode(true)));

  const ix = Object.fromEntries(D.indices.map((i) => [i.indice, i]));
  const i0 = startIdx('3M');
  // chiffres clés : nom, valeur, variation, période ; source quand elle compte (refonte visuelle)
  const kpi = (cls_, lab, per, val, unit, lines) => el('div', { class: 'kpi ' + cls_ },
    el('span', { class: 'l' }, lab, per ? el('small', {}, per) : null),
    el('span', { class: 'v' }, val, unit ? el('small', {}, unit) : null), ...lines.filter(Boolean));
  const vr = (p, v) => el('span', {}, el('span', { class: 'p' }, p), el('span', { class: cls(v) }, F.spct(v)));
  const ks = [];
  for (const n of ['BRVM Composite', 'BRVM 30', 'BRVM Prestige']) {   // BRVM Principal retiré du bandeau (demande du 12/11/2026)
    const i = ix[n]; if (!i) continue;
    const ser = series(n), deb = ser.findIndex(ok);
    const court = ser.slice(i0).filter(ok).length < 20;
    const ytd = ok(i.perf_ytd) ? el('span', { title: DEF.ytd }, vr('YTD', i.perf_ytd))
      : el('span', { class: 'na', title: `YTD non disponible : l'indice n'est suivi par le robot que depuis le ${deb >= 0 ? F.date(P.dates[deb]) : '—'}` }, 'YTD n.d.');
    ks.push(kpi('idx', n, 'points', F.n2(i.niveau), null, [el('span', { class: 'd' }, vr('Jour', i.var_seance), ytd),
      court ? el('span', { class: 'note' }, `Suivi depuis le ${deb >= 0 ? F.date(P.dates[deb]) : '—'}`) : spark(ser.slice(i0), 150, 24)]));
  }
  ks.push(kpi('mk', 'Capitalisation', 'actions', F.big(r.capitalisation_actions ?? r.capitalisation_calculee), 'FCFA',
    [ok(r.capitalisation_obligations) ? el('span', { class: 'note' }, 'Obligations : ' + F.big(r.capitalisation_obligations) + ' FCFA') : null]));
  const off = ok(r.valeur_transactions);
  ks.push(kpi('mk', 'Valeur échangée', 'séance', F.big(off ? r.valeur_transactions : r.valeur_jour_calculee), 'FCFA',
    [el('span', { class: 'note' }, el('span', { class: 'tag ' + (off ? 'off' : 'est'), title: off ? 'Montant publié par la BRVM' : 'Total estimé (volume × cours) : montant officiel non publié' }, off ? 'officielle' : 'estimée'),
      ` ${r.hausse} ▲ · ${r.baisse} ▼ · ${r.inchanges} =`)]));
  ks.push(kpi('mk', 'PER du marché', 'pondéré', F.n1(r.per_pondere), null,
    [el('span', { class: 'note' }, 'médian ' + F.n1(r.per_median) + ' · rendement médian ' + F.pct(r.rendement_median, 2))]));
  $('#kpis').replaceChildren(...ks);
  $('#bases').textContent = r.base_ytd ? `YTD : performance depuis la première séance de l'année, base = clôture du ${F.date(r.base_ytd)}` : '';
  $('#loading')?.remove();
  qualiteBar();
}

// ------------------------------------------------------------------ QUALITÉ DES DONNÉES (lot 4)
function qualiteBar() {
  const q = D.qualite; if (!q) return;
  const c = q.controle || {};
  const chips = [];
  const complet = q.titres_cotes_du_jour === q.titres_reference && !(q.titres_sans_cours || []).length;
  if (c.statut && !c.ancien) chips.push([c.statut === 'validée' ? 'ok' : 'warn', 'Collecte', `contrôle ${c.statut}` + ((c.absents || []).length ? ` · absents : ${c.absents.join(', ')}` : '')]);
  chips.push([complet ? 'ok' : 'warn', 'Cotations', `${q.titres_cotes_du_jour}/${q.titres_reference} titres`
    + ((q.titres_cours_anterieur || []).length ? ` · ${q.titres_cours_anterieur.length} cours antérieur(s)` : '')]);
  chips.push([q.montants_estimes ? 'warn' : 'ok', 'Montants', q.montants_estimes ? `${q.montants_estimes} estimés (BOC non encore lu)` : 'officiels (BOC)']);
  if (q.corrections_total) chips.push(['warn', 'Historique', `${q.corrections_total} correction(s) tracée(s)`]);
  // niveau de qualité et titres insuffisants : affichés seulement dans l'onglet Historique (décision du 12/11/2026)
  $('#qualite').replaceChildren(...chips.map(([k, lab, t]) => el('span', { class: 'q ' + k, role: 'button', tabindex: 0, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }, title: (k === 'ok' ? 'Conforme' : k === 'bad' ? 'Insuffisant' : 'À surveiller') + ' · détail : onglet Historique, carte « Qualité des données »', onclick: () => { showTab('historique'); historique(); $('#q-card').scrollIntoView({ behavior: 'smooth' }); } }, el('b', {}, lab), t)));
}
function qualiteDetail() {
  const q = D.qualite; if (!q) return;
  const c = q.controle || {};
  const row = (a, b) => el('tr', {}, el('td', {}, a), el('td', {}, b));
  const t = el('table', {},
    row('Titres cotés à la séance', `${q.titres_cotes_du_jour} sur ${q.titres_reference}`),
    row('Cours d\'une séance antérieure', (q.titres_cours_anterieur || []).map((x) => `${x.symbole} (${F.date(x.date_cours)})`).join(', ') || 'aucun'),
    row('Titres sans aucun cours', (q.titres_sans_cours || []).join(', ') || 'aucun'),
    row('Montants par titre', `${q.montants_officiels} officiels (BOC), ${q.montants_estimes} estimés (volume × cours)` + (q.sans_transaction ? `, ${q.sans_transaction} sans transaction (montant nul)` : '')),
    row('Derniers montants officiels lus', q.derniers_montants_officiels ? F.date(q.derniers_montants_officiels) : 'aucun encore'),
    row('Valeur échangée de la séance', q.valeur_transactions_source),
    row('Dernier BOC traité', q.dernier_boc_traite ? F.date(q.dernier_boc_traite) : '—'),
    row('Contrôle de la séance', c.statut && !c.ancien ? `${c.statut} (${c.horodatage} GMT) · ${c.recus}/${c.attendus} titres reçus` : 'pas encore enregistré pour cette séance'),
    row('Titres absents de la page', (c.absents || []).join(', ') || 'aucun'),
    row('Alertes du contrôle', (c.alertes || []).join(' ; ') || 'aucune'),
    row('Ajustements', `${q.ajustements_ost} OST · ${q.ajustements_correction} correction(s) de donnée`));
  const parts = [t];
  if (q.niveau) {
    parts.unshift(el('p', { class: 'note' }, `Niveau global : ${q.niveau}` + ((q.niveau_motifs || []).length ? ' — ' + q.niveau_motifs.join(' ; ') : '')));
    const nt = (q.titres || []).filter((x) => x.niveau !== 'fiable').map((x) => ({ ...x, motifs_txt: x.motifs.join(' ; ') }));
    parts.push(el('h3', {}, `Titres à surveiller ou insuffisants (${nt.length} sur ${(q.titres || []).length})`));
    if (nt.length) {
      const box = el('table', { class: 'tbl compact' }); parts.push(el('div', { class: 'scroll' }, box));
      table(box, nt, [{ k: 'symbole', h: 'Titre', l: true, sym: true, title: 'nom' }, { k: 'niveau', h: 'Niveau', l: true, f: (v) => v === 'insuffisant' ? '✗ insuffisant' : '◐ à surveiller' }, { k: 'motifs_txt', h: 'Motifs', l: true }], { click: (r) => openTitle(r.symbole) });
    }
  }
  const j = q.corrections_recentes || [];
  parts.push(el('h3', {}, `Corrections de l'historique (${q.corrections_total})`));
  if (j.length) {
    const box = el('table', { class: 'tbl compact' }); parts.push(box);
    table(box, j, [{ k: 'date_seance', h: 'Séance', l: true }, { k: 'symbole', h: 'Titre', l: true }, { k: 'champ', h: 'Champ', l: true },
      { k: 'ancienne_valeur', h: 'Ancienne', f: F.n2 }, { k: 'nouvelle_valeur', h: 'Nouvelle', f: (v) => ok(v) ? F.n2(v) : 'effacée' }, { k: 'motif', h: 'Motif', l: true }]);
  } else parts.push(el('p', { class: 'note' }, 'Aucune valeur historique modifiée depuis la mise en place du journal.'));
  const adj = D.ajustements || [];
  if (adj.length) {
    parts.push(el('h3', {}, 'Ajustements de l\'historique'));
    const box = el('table', { class: 'tbl compact' }); parts.push(box);
    table(box, adj, [{ k: 'date', h: 'Date', l: true }, { k: 'symbole', h: 'Titre', l: true }, { k: 'type', h: 'Type', l: true, f: (v) => v === 'ost' ? 'OST' : (v || 'OST') }, { k: 'facteur', h: 'Facteur', f: (v) => F.n2(v) }, { k: 'raison', h: 'Raison', l: true }]);
  }
  $('#q-detail').replaceChildren(...parts);
}

// ------------------------------------------------------------------ MARCHÉ
const IDX_ALL = ['BRVM Composite', 'BRVM 30', 'BRVM Prestige', 'BRVM Principal', 'BRVM Composite Total Return', ...SECTORS];
function drawIdx() {
  const i0 = startIdx(S.idxPer);
  const pal = palette();
  const ser = IDX_ALL.filter((n) => S.idxSel.has(n) && P.series[n]).map((n) => ({ n, c: pal[IDX_ALL.indexOf(n) % 7], v: rebase(series(n).slice(i0)), d: DATES.slice(i0) }));
  if (!ser.length) return empty($('#idx-chart'), 'Choisissez au moins un indice');
  lineChart($('#idx-chart'), ser, { fy: F.n0, ref: 100, h: 360 });
}
function drawSec() {
  const secs = D.indices.filter((i) => i.type === 'Sectoriel');
  hbars($('#sec-chart'), secs.slice().sort((a, b) => (b[S.secPer] ?? -9) - (a[S.secPer] ?? -9)).map((i) => ({ label: i.indice, value: i[S.secPer] ?? 0 })), { f: (v) => F.spct(v) });
}
function marche() {
  const pal = palette();
  const pick = $('#idx-pick');
  pick.replaceChildren(...IDX_ALL.filter((n) => P.series[n]).map((n) => el('button', {
    class: 'chip' + (S.idxSel.has(n) ? ' on' : ''), onclick: (e) => { S.idxSel.has(n) ? S.idxSel.delete(n) : S.idxSel.add(n); e.currentTarget.classList.toggle('on'); drawIdx(); },
  }, el('i', { style: `background:${pal[IDX_ALL.indexOf(n) % 7]}` }), n.replace('BRVM Composite Total Return', 'Total Return'))));
  seg($('#idx-per'), PERIODS, S.idxPer, (v) => { S.idxPer = v; drawIdx(); });
  drawIdx();

  mkNav(); mkMenu(); resumeJour(); profondeur(); mouvements(); seanceJour(); idxCards();
  seg($('#tm-metric'), [['var_seance', 'Jour'], ['perf_1m', '1 mois'], ['perf_ytd', 'YTD'], ['perf_1a', '1 an'], ['perf_5a', '5 ans']], S.tm, (v) => { S.tm = v; treemap(); });
  seg($('#tm-group'), [['titre', 'Par titre'], ['secteur', 'Par secteur'], ['pays', 'Par pays']], S.tmg, (v) => { S.tmg = v; treemap(); });
  treemap();

  const secs = D.indices.filter((i) => i.type === 'Sectoriel');
  seg($('#sec-per'), [['var_seance', 'Jour'], ['perf_1m', '1 mois'], ['perf_3m', '3 mois'], ['perf_ytd', 'YTD'], ['perf_1a', '1 an']], S.secPer, (v) => { S.secPer = v; drawSec(); });
  drawSec();
  table($('#sec-table'), D.secteurs.slice().sort((a, b) => b.capitalisation - a.capitalisation), [
    { k: 'secteur', h: 'Secteur', l: true }, { k: 'nb_titres', h: 'Titres', f: F.n0 }, { k: 'poids', h: 'Poids', f: (v) => F.pct(v) },
    { k: 'hausse', h: '▲', f: F.n0 }, { k: 'baisse', h: '▼', f: F.n0 }, { k: 'per_median', h: 'PER méd.', f: F.n1 }, { k: 'rendement_median', h: 'Rdt méd.', f: (v) => F.pct(v, 2) },
  ]);

  indicesVue();
  breadth();
}

// ------------------------------------------------------------------ MARCHÉ › INDICES BRVM (cartes, fiche d'indice, horizons)
const IX_MAIN = ['BRVM Composite', 'BRVM Composite Total Return', 'BRVM 30', 'BRVM Prestige', 'BRVM Principal'];
const IX_DESC = {
  'BRVM Composite': 'Toutes les actions cotées à la BRVM, pondérées par la capitalisation.',
  'BRVM Composite Total Return': 'Le BRVM Composite avec les dividendes réinvestis, publié par la BRVM depuis novembre 2026 dans nos relevés.',
  'BRVM 30': 'Les 30 actions les plus liquides de la cote.',
  'BRVM Prestige': 'Le compartiment Prestige de la cote.',
  'BRVM Principal': 'Le compartiment Principal de la cote.',
};
const IX = { sel: 'BRVM Composite', per: '1A', tab: 'ess' };
const ixShort = (n) => n.replace('BRVM Composite Total Return', 'Composite Total Return');
const ixFirst = (n) => { const v = series(n); const i = v.findIndex(ok); return i < 0 ? null : i; };
const ixInfo = (n) => D.indices.find((i) => i.indice === n) || {};
// variation depuis l'indice i0 ; nulle (n.d.) si l'historique ne couvre pas le début de la période
const ixPerf = (n, i0) => { const v = series(n), f = ixFirst(n); if (f === null || f > i0) return null; let j = i0; while (j < v.length && !ok(v[j])) j++; const last = v.findLast(ok); return ok(v[j]) && ok(last) ? last / v[j] - 1 : null; };
const ixPerfOk = (n, per) => { const f = ixFirst(n); return f !== null && DATES[f] <= periodStart(per, DATES.at(-1)) ? ixPerf(n, startIdx(per)) : null; };

function ixCard(n, small) {
  const i = ixInfo(n), f = ixFirst(n), v = series(n);
  const ytd = ixPerfOk(n, 'YTD'), a1 = ixPerfOk(n, '1A');
  const pv = (x) => el('b', { class: ok(x) ? cls(x) : 'nd' }, ok(x) ? F.spct(x, 2) : 'n.d.');
  if (small) return el('button', { class: 'ixc sm', type: 'button', onclick: () => ixOpen(n) },
    el('div', { class: 'r1' }, el('span', { class: 'n' }, n), el('b', { class: cls(i.var_seance) }, F.spct(i.var_seance, 2))),
    el('div', { class: 'r2' }, el('span', { class: 'v' }, F.n2(i.niveau)), el('span', {}, 'YTD ', pv(ytd))));
  return el('button', { class: 'ixc', type: 'button', onclick: () => ixOpen(n) },
    el('div', { class: 'n' }, ixShort(n).replace('Composite Total Return', 'BRVM Composite TR'), el('span', { class: 'ar' }, '↗')),
    el('div', { class: 'ds' }, IX_DESC[n] || ''),
    el('div', { class: 'row' }, el('div', { class: 'v' }, F.n2(i.niveau)), el('span', { class: 'jr' }, el('b', { class: cls(i.var_seance) }, F.spct(i.var_seance, 2)), ' jour')),
    el('div', { class: 'p' }, el('span', {}, 'YTD ', pv(ytd)), el('span', {}, '1 an ', pv(a1))));
}

// indicateurs techniques (descriptifs : aucun signal d'achat ou de vente n'en est tiré)
const ema = (a, n) => { const k = 2 / (n + 1); let e = null; return a.map((v) => { if (!ok(v)) return e; e = e === null ? v : v * k + e * (1 - k); return e; }); };
function rsi(a, n = 14) {
  const out = a.map(() => null); let g = 0, l = 0, c = 0, prev = null;
  a.forEach((v, i) => {
    if (!ok(v)) return; if (prev === null) { prev = v; return; }
    const d = v - prev; prev = v; c++;
    if (c <= n) { g += Math.max(d, 0); l += Math.max(-d, 0); if (c === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return; }
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  });
  return out;
}
const IXP = { ov: new Set() };
function ixOpen(n) {
  IX.sel = n; $('#ix-list').hidden = true; $('#ix-page').hidden = false;
  ixPage(); $('#mk-nav').scrollIntoView({ block: 'start' });
}
addEventListener('scroll', () => {
  const pg = document.getElementById('ix-page'); if (!pg || pg.hidden || Date.now() < (IXP.lock || 0)) return;
  const nav = $('#ix-anchors'), y = nav.getBoundingClientRect().bottom + 40;
  let cur = 'ix-s-ess'; ['ix-s-ess', 'ix-s-plus', 'ix-s-av'].forEach((id) => { if (document.getElementById(id).getBoundingClientRect().top <= y) cur = id; });
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 8) cur = 'ix-s-av';
  nav.querySelectorAll('button[data-a]').forEach((b) => b.classList.toggle('on', b.dataset.a === cur));
}, { passive: true });
function ixClose() { $('#ix-page').hidden = true; $('#ix-list').hidden = false; ixRender(); ixRendement(); drawIdx(); breadth(); drawSec(); }

function ixRender() {   // liste des indices (cartes)
  $('#ix-main').replaceChildren(...IX_MAIN.filter((k) => P.series[k]).map((k) => ixCard(k)));
  $('#ix-sec').replaceChildren(...D.indices.filter((x) => x.type === 'Sectoriel').map((x) => ixCard(x.indice, true)));
  $('#ix-meta').textContent = `Indices officiels publiés par la BRVM · séance du ${F.date(D.resume.seance)} · cliquez sur un indice pour ouvrir sa page · calculs limités à l'historique enregistré par le robot (depuis le ${F.date(DATES[0].toISOString().slice(0, 10))} pour le Composite)`;
  if (!$('#ix-page').hidden) ixPage();
}

function ixPage() {
  const n = IX.sel, i = ixInfo(n), f = ixFirst(n), v = series(n);
  const iso = (k) => DATES[k].toISOString().slice(0, 10), dt = (k) => F.date(iso(k));
  // sélecteur d'indice
  const pick = $('#ix-pick');
  const names = [...IX_MAIN.filter((k) => P.series[k]), ...D.indices.filter((x) => x.type === 'Sectoriel').map((x) => x.indice)];
  if (pick.options.length !== names.length) { pick.replaceChildren(...names.map((k) => new Option(ixShort(k), k))); pick.onchange = () => { IX.sel = pick.value; ixPage(); }; }
  pick.value = n;
  $('#ix-name').textContent = ixShort(n);
  $('#ix-desc').textContent = (IX_DESC[n] || 'Indice sectoriel officiel de la BRVM.') + (f !== null ? ` Historique enregistré depuis le ${dt(f)}.` : '');
  // chiffres clés
  const i1 = Math.max(f ?? 0, startIdx('1A'));
  let hi = -1, lo = -1; for (let k = i1; k < v.length; k++) if (ok(v[k])) { if (hi < 0 || v[k] > v[hi]) hi = k; if (lo < 0 || v[k] < v[lo]) lo = k; }
  const kp = (l, val, sub, c) => el('div', { class: 'k' }, el('div', { class: 'l' }, l), el('div', { class: 'v ' + (c || '') }, val), sub ? el('div', { class: 's' }, sub) : null);
  const court = v.slice(i1).filter(ok).length < 200;
  $('#ix-kpis').replaceChildren(
    kp('Dernier niveau', F.n2(i.niveau), `points · séance du ${F.date(i.date || D.resume.seance)}`, 'gold'),
    kp('Perf. 1 jour', F.spct(i.var_seance), `veille ${F.n2(i.niveau_prec)}`, cls(i.var_seance)),
    kp(court ? 'Plus haut (historique)' : 'Plus haut 1 an', hi >= 0 ? F.n2(v[hi]) : '—', hi >= 0 ? dt(hi) : ''),
    kp(court ? 'Plus bas (historique)' : 'Plus bas 1 an', lo >= 0 ? F.n2(v[lo]) : '—', lo >= 0 ? dt(lo) : ''),
    kp('Famille', ixInfo(n).type === 'Sectoriel' ? 'Sectoriel' : 'Marché', 'indice officiel BRVM'),
    kp('Historique depuis', f !== null ? iso(f).split('-').reverse().join('/') : '—', `${v.filter(ok).length} séances enregistrées`));
  // périodes couvertes par l'historique
  const pers = [['1M', '1M'], ['3M', '3M'], ['6M', '6M'], ['YTD', 'YTD'], ['1A', '1A'], ['3A', '3A'], ['5A', '5A'], ['MAX', 'Tout']].filter(([p]) => p === 'MAX' || (f !== null && DATES[f] <= periodStart(p, DATES.at(-1))));
  if (!pers.some(([p]) => p === IX.per)) IX.per = pers.find(([p]) => p === '1A') ? '1A' : 'MAX';
  seg($('#ix-per'), pers, IX.per, (p) => { IX.per = p; ixPage(); });
  const OV = [['MM50', 'MM50'], ['MM200', 'MM200'], ['BB', 'Bollinger'], ['MACD', 'MACD'], ['RSI', 'RSI']];
  $('#ix-ov').replaceChildren(...OV.map(([k, l]) => el('label', { class: 'ixo ixo-' + k }, el('input', { type: 'checkbox', checked: IXP.ov.has(k) ? true : null, onchange: (e) => { e.target.checked ? IXP.ov.add(k) : IXP.ov.delete(k); ixPage(); } }), l)));
  ixCharts();
  // vue rapide
  const qr = (l, x, tip) => el('div', { class: 'ixq' }, el('span', { class: 'ic ' + cls(x) }, ok(x) ? (x >= 0 ? '↗' : '↘') : '·'), el('span', { class: 'l', title: tip || '' }, l), el('b', { class: cls(x) }, ok(x) ? F.spct(x, 2) : 'n.d.'));
  $('#ix-quick').replaceChildren(qr('Depuis le début de l\'année (YTD)', ixPerfOk(n, 'YTD'), 'Base : clôture de la première séance de l\'année'), qr('1 an', ixPerfOk(n, '1A')), qr('5 ans', ixPerfOk(n, '5A')),
    el('p', { class: 'note' }, '« n.d. » : l\'historique enregistré ne couvre pas toute la période.'));
  ixPerfDetail(); ixReperes(); ixRisk();
  // menu d'ancres
  const nav = $('#ix-anchors');
  $('#ix-back').onclick = ixClose;
  nav.querySelectorAll('button[data-a]').forEach((b) => { b.onclick = () => { IXP.lock = Date.now() + 1200; nav.querySelectorAll('button[data-a]').forEach((x) => x.classList.toggle('on', x === b)); const t = document.getElementById(b.dataset.a); scrollTo({ top: t.getBoundingClientRect().top + scrollY - nav.offsetHeight - 70, behavior: 'smooth' }); }; });
}

function ixCharts() {
  const n = IX.sel, f = ixFirst(n), v = series(n);
  const i0 = Math.max(f ?? 0, IX.per === 'MAX' ? 0 : startIdx(IX.per));
  const sv = v.slice(i0), sd = DATES.slice(i0), vv = sv.filter(ok);
  if (vv.length < 2) { empty($('#ix-chart'), 'Historique trop court pour tracer une courbe.'); $('#ix-cnote').textContent = ''; $('#ix-macd-w').hidden = $('#ix-rsi-w').hidden = true; return; }
  const up = vv.at(-1) >= vv[0], pal = palette();
  const ser = [{ n: ixShort(n), c: up ? css('--up') : css('--down'), v: sv, d: sd }];
  const mm = (k) => sma(v, k).slice(i0);
  const manque = [];
  if (IXP.ov.has('MM50')) { const m = mm(50); m.some(ok) ? ser.push({ n: 'MM50', c: '#b4652a', v: m, d: sd, w: 1.2 }) : manque.push('MM50'); }
  if (IXP.ov.has('MM200')) { const m = mm(200); m.some(ok) ? ser.push({ n: 'MM200', c: '#6b5aa6', v: m, d: sd, w: 1.2 }) : manque.push('MM200'); }
  if (IXP.ov.has('BB')) { const m = sma(v, 20), s2 = rstd(v, 20); const lo = m.map((x, k) => ok(x) && ok(s2[k]) ? x - 2 * s2[k] : null).slice(i0), hi = m.map((x, k) => ok(x) && ok(s2[k]) ? x + 2 * s2[k] : null).slice(i0);
    lo.some(ok) ? ser.push({ n: 'Bollinger', c: '#3d7f99', band: [lo, hi], v: [], d: sd, noEnd: true }) : manque.push('Bollinger'); }
  lineChart($('#ix-chart'), ser, { fy: F.n2, h: 360, area: ser.length === 1, legend: ser.length > 1 });
  $('#ix-cnote').textContent = `${F.date(sd[sv.findIndex(ok)].toISOString().slice(0, 10))} → ${F.date(DATES.at(-1).toISOString().slice(0, 10))} · variation ${F.spct(vv.at(-1) / vv[0] - 1, 2)} · ${vv.length} séances · + / − ou double-clic pour zoomer, glisser pour se déplacer`;
  // MACD
  const wM = $('#ix-macd-w'); wM.hidden = !IXP.ov.has('MACD');
  if (!wM.hidden) {
    const e12 = ema(v, 12), e26 = ema(v, 26), mac = e12.map((x, k) => (ok(x) && ok(e26[k]) && k - (f ?? 0) >= 25 ? x - e26[k] : null));
    const sig = ema(mac, 9).map((x, k) => (ok(mac[k]) ? x : null));
    const M = mac.slice(i0), S9 = sig.slice(i0), H = M.map((x, k) => (ok(x) && ok(S9[k]) ? x - S9[k] : null));
    if (!M.some(ok)) empty($('#ix-macd'), 'Historique trop court (26 séances au moins).');
    else macdChart($('#ix-macd'), sd, M, S9, H);
  }
  const wR = $('#ix-rsi-w'); wR.hidden = !IXP.ov.has('RSI');
  if (!wR.hidden) {
    const R = rsi(v, 14).slice(i0);
    if (!R.some(ok)) empty($('#ix-rsi'), 'Historique trop court (15 séances au moins).');
    else lineChart($('#ix-rsi'), [{ n: 'RSI 14', c: '#2f6f5a', v: R, d: sd }, { n: 'Zone haute 70', c: css('--down'), v: R.map(() => 70), d: sd, w: 1, dash: true, noEnd: true }, { n: 'Zone basse 30', c: css('--up'), v: R.map(() => 30), d: sd, w: 1, dash: true, noEnd: true }], { fy: F.n0, h: 170, zoom: false });
  }
  $('#ix-ovnote').textContent = (manque.length ? `Pas assez d'historique pour : ${manque.join(', ')}. ` : '')
    + (IXP.ov.size ? 'MM50 / MM200 : moyennes des 50 / 200 dernières clôtures. Bollinger : moyenne 20 séances ± 2 écarts-types. MACD : écart entre moyennes exponentielles 12 et 26 séances, signal = moyenne 9 séances. RSI : force relative sur 14 séances (au-dessus de 70 ou sous 30 : mouvement récent marqué). Ce sont des indicateurs descriptifs, pas des recommandations.' : 'Cochez MM50, MM200, Bollinger, MACD ou RSI pour ajouter un indicateur.');
}

function macdChart(box, d, M, S9, H) {
  const h = 170, { svg, w } = svgIn(box, h);
  const all = [...M, ...S9, ...H].filter(ok), ml = 46, mr = 8;
  const x = d3.scaleUtc(d3.extent(d), [ml, w - mr]), y = d3.scaleLinear(d3.extent([0, ...all]), [h - 20, 8]).nice(4);
  svg.append('g').attr('class', 'grid').attr('transform', `translate(${ml - 4},0)`).call(d3.axisLeft(y).ticks(4).tickFormat(F.n1).tickSize(-(w - ml - mr + 4)));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${h - 20})`).call(d3.axisBottom(x).tickSize(0).ticks(Math.max(2, Math.floor(w / 110))).tickFormat(F.dshort));
  const bw = Math.max(1, (w - ml - mr) / d.length * 0.7);
  H.forEach((v, k) => { if (ok(v)) svg.append('rect').attr('x', x(d[k]) - bw / 2).attr('width', bw).attr('y', Math.min(y(v), y(0))).attr('height', Math.abs(y(v) - y(0))).attr('fill', v >= 0 ? css('--up') : css('--down')).attr('opacity', .45); });
  const line = (a, c, dash) => svg.append('path').attr('d', d3.line().defined(ok).x((_, k) => x(d[k])).y((v) => y(v))(a)).attr('fill', 'none').attr('stroke', c).attr('stroke-width', 1.4).attr('stroke-dasharray', dash ? '4 3' : null);
  line(M, '#2f5fa8'); line(S9, '#b4652a', true);
  const dot = svg.append('line').attr('y1', 8).attr('y2', h - 20).attr('stroke', css('--muted')).attr('stroke-dasharray', '2 2').style('display', 'none');
  svg.append('rect').attr('x', ml).attr('width', w - ml - mr).attr('height', h).attr('fill', 'transparent')
    .on('mousemove', (ev) => { const [mx] = d3.pointer(ev); const k = Math.max(0, Math.min(d.length - 1, d3.bisectCenter(d.map(Number), +x.invert(mx)))); dot.attr('x1', x(d[k])).attr('x2', x(d[k])).style('display', null);
      showTip(ev, F.date(d[k].toISOString().slice(0, 10)), [{ t: `MACD ${F.n2(M[k])}` }, { t: `Signal ${F.n2(S9[k])}` }, { t: `Histogramme ${F.n2(H[k])}` }]); })
    .on('mouseleave', () => { dot.style('display', 'none'); hideTip(); });
  box.prepend(el('div', { class: 'legend' }, el('span', {}, el('i', { style: 'background:#2f5fa8' }), 'MACD'), el('span', {}, el('i', { style: 'background:#b4652a' }), 'Signal (9)'), el('span', {}, el('i', { style: `background:${css('--up')}` }), 'Histogramme')));
}

function ixPerfDetail() {
  const n = IX.sel, i = ixInfo(n), f = ixFirst(n);
  if (f === null) return $('#ix-perf').replaceChildren();
  const last = DATES.at(-1), mtd = DATES.findIndex((d) => d.getUTCFullYear() === last.getUTCFullYear() && d.getUTCMonth() === last.getUTCMonth());
  const items = [['1 jour', i.var_seance], ['1 semaine', f <= DATES.length - 6 ? i.perf_1s : null], ['Mois en cours (MTD)', f <= mtd - 1 ? ixPerf(n, Math.max(0, mtd - 1)) : null],
    ['1 mois', ixPerfOk(n, '1M')], ['3 mois', ixPerfOk(n, '3M')], ['6 mois', ixPerfOk(n, '6M')], ['YTD', ixPerfOk(n, 'YTD')], ['1 an', ixPerfOk(n, '1A')], ['3 ans', ixPerfOk(n, '3A')], ['5 ans', ixPerfOk(n, '5A')],
    [`Depuis le ${F.date(DATES[f].toISOString().slice(0, 10))} (début de notre historique)`, ixPerf(n, f)]];
  const mx = d3.max(items, (x) => Math.abs(x[1] || 0)) || 1;
  $('#ix-perf').replaceChildren(...items.map(([l, x]) => el('div', { class: 'ixp' }, el('span', { class: 'l' }, el('span', { class: 'ic ' + cls(x) }, ok(x) ? (x >= 0 ? '↗' : '↘') : '·'), l),
    el('span', { class: 'tr' }, ok(x) ? el('i', { class: x >= 0 ? 'up' : 'down', style: `width:${Math.max(1, 50 * Math.abs(x) / mx)}%;${x >= 0 ? 'left:50%' : 'right:50%'}` }) : null),
    el('b', { class: cls(x) }, ok(x) ? F.spct(x, 2) : 'n.d.'))),
  el('p', { class: 'note' }, 'MTD : depuis la clôture du dernier jour du mois précédent. YTD : depuis la première séance de l\'année. « n.d. » : l\'historique enregistré ne couvre pas toute la période. Fiducy calcule « depuis l\'introduction » de l\'indice ; nous partons du début de notre historique.'));
}

function ixReperes() {
  const n = IX.sel, v = series(n), f = ixFirst(n), box = $('#ix-reperes');
  if (f === null) return box.replaceChildren();
  const i0 = Math.max(f, IX.per === 'MAX' ? 0 : startIdx(IX.per)), dt = (k) => F.date(DATES[k].toISOString().slice(0, 10));
  let hi = -1, lo = -1; for (let k = i0; k < v.length; k++) if (ok(v[k])) { if (hi < 0 || v[k] > v[hi]) hi = k; if (lo < 0 || v[k] < v[lo]) lo = k; }
  const j0 = v.findIndex((x, k) => k >= i0 && ok(x)), last = v.findLast(ok);
  const lib = IX.per === 'MAX' ? 'tout l\'historique' : `période ${IX.per}`;
  const row = (l, val, c, sub) => el('div', { class: 'ixr' }, el('span', {}, l, sub ? el('small', {}, sub) : null), el('b', { class: c || '' }, val));
  box.replaceChildren(el('p', { class: 'note' }, `Période affichée sur le graphique : ${lib}.`), el('div', { class: 'ixg' },
    row('Niveau en début de période', F.n2(v[j0]), '', dt(j0)), row('Plus haut', F.n2(v[hi]), '', dt(hi)), row('Plus bas', F.n2(v[lo]), '', dt(lo)),
    row('Écart au plus haut', F.spct(last / v[hi] - 1, 2), cls(last / v[hi] - 1)), row('Variation sur la période', F.spct(last / v[j0] - 1, 2), cls(last / v[j0] - 1)),
    row('Séances', F.n0(v.slice(i0).filter(ok).length))));
}

function ixRisk() {
  const n = IX.sel, v = series(n), f = ixFirst(n), box = $('#ix-risk');
  if (f === null) return box.replaceChildren();
  const dt = (k) => F.date(DATES[k].toISOString().slice(0, 10));
  const i0 = Math.max(f, startIdx('1A'));
  const r = []; for (let k = i0 + 1; k < v.length; k++) if (ok(v[k]) && ok(v[k - 1]) && v[k - 1] > 0) r.push([k, v[k] / v[k - 1] - 1]);
  if (r.length < 60) return box.replaceChildren(el('p', { class: 'note ixwarn' }, `Historique trop court (${r.length} variations journalières) : il faut au moins 60 séances pour des indicateurs de risque fiables.`));
  const rs = r.map((x) => x[1]).sort(d3.ascending);
  const vol = d3.deviation(rs) * Math.sqrt(252), var95 = d3.quantileSorted(rs, 0.05);
  const worst = r.reduce((a, b) => (b[1] < a[1] ? b : a)), best = r.reduce((a, b) => (b[1] > a[1] ? b : a));
  const mdd = (a0) => { let pk = a0, m = 0, mp = a0, mt = a0; for (let k = a0; k < v.length; k++) { if (!ok(v[k])) continue; if (!ok(v[pk]) || v[k] > v[pk]) pk = k; const dd = v[k] / v[pk] - 1; if (dd < m) { m = dd; mp = pk; mt = k; } } return [m, mp, mt]; };
  const [m1, p1, t1] = mdd(i0), [mA, pA, tA] = mdd(f);
  const rr = (ic, l, val, c, frac, sub) => el('div', { class: 'ixk' }, el('div', { class: 'ixk-t' }, el('span', { class: 'ic' }, ic), el('span', { class: 'l' }, l, sub ? el('small', {}, sub) : null), el('b', { class: c || '' }, val)),
    el('div', { class: 'gauge' }, el('i', { style: `width:${Math.max(1, Math.min(100, frac * 100))}%` })));
  box.replaceChildren(
    rr('∿', 'Volatilité annualisée', F.pct(vol, 2), '', vol / 0.4, 'écart-type des variations journalières sur 1 an × √252 · jauge sur 40 %'),
    rr('◈', 'VaR 95 % sur 1 jour', F.spct(var95, 2), 'down', Math.abs(var95) / 0.05, 'perte journalière dépassée 1 séance sur 20 sur la dernière année (méthode historique) · jauge sur 5 %'),
    rr('▁▃▅', 'Pire baisse depuis un plus haut, sur 1 an', F.spct(m1, 2), 'down', Math.abs(m1) / 0.5, `${dt(p1)} → ${dt(t1)} · jauge sur 50 %`),
    rr('▁▃▅', `Pire baisse depuis un plus haut, depuis le ${dt(f)}`, F.spct(mA, 2), 'down', Math.abs(mA) / 0.5, `${dt(pA)} → ${dt(tA)} · tout notre historique`),
    rr('↘', 'Pire séance sur 1 an', F.spct(worst[1], 2), 'down', Math.abs(worst[1]) / 0.05, dt(worst[0])),
    rr('↗', 'Meilleure séance sur 1 an', F.spct(best[1], 2), 'up', Math.abs(best[1]) / 0.05, dt(best[0])),
    el('p', { class: 'note' }, `Calculs sur ${r.length} variations journalières. Mesures du passé, pas des prévisions.`));
}

function indicesVue() {
  if (!P.series[IX.sel]) IX.sel = 'BRVM Composite';
  const secs = D.indices.filter((x) => x.type === 'Sectoriel');
  const fs = secs.map((x) => ixFirst(x.indice)).filter((x) => x !== null);
  if (fs.length) $('#ix-sec-h').textContent = `Indices sectoriels (historique depuis le ${F.date(DATES[d3.min(fs)].toISOString().slice(0, 10))})`;
  ixRender();
  const keys = [...IX_MAIN.filter((k) => P.series[k]), ...secs.map((x) => x.indice)];
  const rows = keys.map((k) => {
    const i = ixInfo(k), f = ixFirst(k);
    return { indice: ixShort(k).replace('Composite Total Return', 'BRVM Composite TR').toUpperCase(), key: k, j: i.var_seance, s1: f !== null && f <= DATES.length - 6 ? i.perf_1s : null,
      m1: ixPerfOk(k, '1M'), m3: ixPerfOk(k, '3M'), m6: ixPerfOk(k, '6M'), ytd: ixPerfOk(k, 'YTD'), a1: ixPerfOk(k, '1A'), a3: ixPerfOk(k, '3A'), a5: ixPerfOk(k, '5A') };
  });
  const pc = (k, h) => ({ k, h, f: (v) => ok(v) ? F.spct(v, 2) : 'n.d.', cls: true });
  table($('#ix-hz'), rows, [{ k: 'indice', h: 'Indice', l: true }, pc('j', 'Jour'), pc('s1', '1 sem.'), pc('m1', '1 mois'), pc('m3', '3 mois'), pc('m6', '6 mois'), pc('ytd', 'YTD'), pc('a1', '1 an'), pc('a3', '3 ans'), pc('a5', '5 ans')],
    { click: (r) => ixOpen(r.key) });
  // dates de début, regroupées
  const deb = {}; keys.forEach((k) => { const f = ixFirst(k); if (f === null) return; const d = DATES[f].toISOString().slice(0, 10); (deb[d] = deb[d] || []).push(ixShort(k).replace('Composite Total Return', 'Composite TR')); });
  const lst = Object.entries(deb).sort().map(([d, ns]) => `${ns.length > 3 ? 'les indices sectoriels' : ns.join(', ')} depuis le ${F.date(d)}`);
  $('#ix-hz-note').textContent = `« n.d. » quand notre historique ne couvre pas toute la période. Historique enregistré : ${lst.join(' ; ')}. Cliquez sur une ligne pour ouvrir l'indice.`;
  ixRendement();
}

function ixRendement() {
  const c = series('BRVM Composite'), f = ixFirst('BRVM Composite');
  if (f === null) return;
  const last = c.findLast(ok), li = c.length - 1 - [...c].reverse().findIndex(ok);
  const ans = (DATES[li] - DATES[f]) / (365.25 * 864e5), ann = Math.pow(last / c[f], 1 / ans) - 1, tot = last / c[f] - 1;
  const tr = series('BRVM Composite Total Return'), ft = ixFirst('BRVM Composite Total Return');
  const kc = (ic, l, val, sub, c2) => el('div', { class: 'card ix-rk' + (c2 ? ' ' + c2 : '') }, el('div', { class: 'l' }, el('span', { class: 'ic' }, ic), l), el('div', { class: 'v ' + cls(val) }, ok(val) ? F.spct(val, 2) : 'n.d.'), el('div', { class: 's' }, sub));
  const k = [kc('%', 'Indice de prix', ann, `BRVM Composite, annualisé depuis le ${F.date(DATES[f].toISOString().slice(0, 10))} (${F.spct(tot, 1)} au total)`, 'lead'),
    kc('↗', 'Indice de prix · 5 ans', ixPerfOk('BRVM Composite', '5A') !== null ? Math.pow(1 + ixPerfOk('BRVM Composite', '5A'), 1 / 5) - 1 : null, 'BRVM Composite, annualisé sur 5 ans')];
  if (ft !== null) { const t0 = tr[ft], tl = tr.findLast(ok), c0 = c[ft]; k.push(kc('◎', 'Total Return officiel', tl / t0 - 1, `depuis son premier relevé (${F.date(DATES[ft].toISOString().slice(0, 10))}) · Composite sur la même période : ${F.spct(last / c0 - 1, 2)}`)); }
  $('#ix-rt-k').replaceChildren(...k);
  $('#ix-rt-note').textContent = 'Fiducy reconstruit un rendement « dividendes réinvestis » depuis 2009. Nous ne le faisons pas : notre historique des dividendes ne commence qu\'avec les versements de 2023 et contient des montants nets, ce qui fausserait la série. '
    + 'Nous montrons donc l\'indice de prix (BRVM Composite) sur tout notre historique, base 100 au début, et l\'indice Total Return officiel de la BRVM à partir de son premier relevé, raccordé au niveau du Composite ce jour-là.';
  const ser = [{ n: 'Indice de prix', c: '#8b8b8b', v: rebase(c.slice(f)), d: DATES.slice(f) }];
  if (ft !== null && tr.filter(ok).length >= 2) { const base = c[ft] / c[f] * 100; ser.push({ n: 'Total Return officiel', c: '#b8973f', v: tr.slice(f).map((x) => ok(x) ? x / tr[ft] * base : null), d: DATES.slice(f) }); }
  lineChart($('#ix-rt-chart'), ser, { fy: F.n0, h: 340, legend: true, ref: 100 });
}

function treemap() {
  const box = $('#treemap');
  const h = box.clientWidth < 600 ? 380 : 460;
  const { svg, w } = svgIn(box, h);
  const k = S.tm;
  const g = S.tmg, cap = TIT.filter((t) => t.capitalisation > 0);
  const groups = g === 'pays' ? [...new Set(cap.map((t) => paysDe(t.symbole)))] : SECTORS;
  const key = (t) => (g === 'pays' ? paysDe(t.symbole) : t.secteur);
  const data = g === 'titre' ? { children: cap } : { children: groups.map((s) => ({ name: s, children: cap.filter((t) => key(t) === s) })).filter((s) => s.children.length) };
  const root = d3.hierarchy(data).sum((d) => d.capitalisation || 0).sort((a, b) => b.value - a.value);
  d3.treemap().size([w, h]).paddingOuter(2).paddingTop(g === 'titre' ? 2 : 16).paddingInner(1).round(true)(root);
  const lim = k === 'var_seance' ? 0.03 : k === 'perf_1m' ? 0.12 : k === 'perf_5a' ? 1.5 : 0.5;   // saturation de l'échelle de couleur
  const color = d3.scaleLinear([-lim, 0, lim], [css('--tm-down'), css('--tm-mid'), css('--tm-up')]).clamp(true);
  const lab = { var_seance: 'VAR. JOUR', perf_1m: 'PERF. 1 MOIS', perf_ytd: 'PERF. YTD', perf_1a: 'PERF. 1 AN', perf_5a: 'PERF. 5 ANS' }[k];
  $('#tm-leg').replaceChildren(el('span', { class: 'note' }, lab), ...[[-lim, '< ' + F.spct(-lim, lim < 0.1 ? 1 : 0)], [-lim / 2, F.spct(-lim / 2, lim < 0.1 ? 1 : 0)], [0, '0'], [lim / 2, F.spct(lim / 2, lim < 0.1 ? 1 : 0)], [lim, '> ' + F.spct(lim, lim < 0.1 ? 1 : 0)]]
    .map(([v, t]) => el('span', {}, el('i', { style: `background:${color(v)}` }), t)), el('span', {}, el('i', { style: `background:${css('--grid')}` }), 'n.d.'));
  $('#tm-note').textContent = `Taille = capitalisation · couleur = ${lab.toLowerCase()} · ${g === 'titre' ? 'tous les titres' : g === 'pays' ? 'regroupés par pays (selon le symbole BRVM)' : 'regroupés par secteur'}. Cliquez sur un titre pour l'analyser.`;
  if (g !== 'titre') root.children.forEach((s) => {
    svg.append('text').attr('x', s.x0 + 4).attr('y', s.y0 + 12).attr('class', 'lbl').style('font-weight', 600).text(s.data.name).each(function () {
      if (this.getComputedTextLength() > s.x1 - s.x0 - 6) d3.select(this).text(s.data.name.slice(0, Math.max(0, Math.floor((s.x1 - s.x0) / 7))) + '…');
    });
  });
  const leaves = svg.selectAll('g.leaf').data(root.leaves()).join('g').attr('transform', (d) => `translate(${d.x0},${d.y0})`).style('cursor', 'pointer')
    .on('mousemove', (ev, d) => showTip(ev, `${d.data.nom} (${d.data.symbole})`, [{ t: `Cours : ${F.n0(d.data.cours)} FCFA` }, { t: `${lab.toLowerCase()} : ${ok(d.data[k]) ? F.spct(d.data[k]) : 'non disponible'}` }, { t: `Jour : ${F.spct(d.data.var_seance)} · YTD : ${F.spct(d.data.perf_ytd)}` }, { t: `${d.data.secteur} · ${paysDe(d.data.symbole)}` }, { t: `Capitalisation : ${F.big(d.data.capitalisation)} FCFA (${F.pct(d.data.poids, 2)})` }, { t: `PER ${F.n1(d.data.per)} · rendement ${F.pct(d.data.rendement, 2)}` }]))
    .on('mouseleave', hideTip).on('click', (ev, d) => openTitle(d.data.symbole));
  leaves.append('rect').attr('width', (d) => Math.max(0, d.x1 - d.x0)).attr('height', (d) => Math.max(0, d.y1 - d.y0)).attr('fill', (d) => ok(d.data[k]) ? color(d.data[k]) : css('--grid')).attr('rx', 1);
  leaves.filter((d) => d.x1 - d.x0 > 38 && d.y1 - d.y0 > 24).each(function (d) {
    const g = d3.select(this);
    const strong = Math.abs(d.data[k] || 0) > lim * 0.4;
    const fill = strong ? '#fff' : css('--fg');
    g.append('text').attr('x', 4).attr('y', 13).style('fill', fill).style('font-weight', 600).style('font-size', '11px').text(d.data.symbole);
    if (d.y1 - d.y0 > 36) g.append('text').attr('x', 4).attr('y', 26).style('fill', fill).style('font-size', '10.5px').text(F.spct(d.data[k], 1));
  });
}


function breadth() {
  const syms = TIT.map((t) => t.symbole).filter((s) => P.series[s]);
  const i0 = Math.max(1, startIdx('1A'));
  const share = [];
  for (let i = i0; i < DATES.length; i++) {
    let up = 0, n = 0;
    for (const s of syms) { const a = P.series[s][i], b = P.series[s][i - 1]; if (ok(a) && ok(b)) { n++; if (a > b) up++; } }
    share.push(n ? up / n : null);
  }
  const ma = sma(share, 20);
  lineChart($('#breadth'), [{ n: 'Hausses (moy. 20 s.)', c: css('--c1'), v: ma, d: DATES.slice(i0) }], { fy: (v) => F.pct(v, 0), ref: 0.5, h: 260, end: false });
}


// ------------------------------------------------------------------ STATUT DU MARCHÉ (horaires BRVM, UTC = heure de Dakar)
const PAYS = { C: 'Côte d\'Ivoire', S: 'Sénégal', B: 'Bénin', F: 'Burkina Faso', M: 'Mali', N: 'Niger', T: 'Togo' };
const paysDe = (sym) => PAYS[sym.at(-1)] || 'Autre';
function etatMarche(now = new Date()) {
  const cal = D.calendrier || {};
  const iso = now.toISOString().slice(0, 10), wd = now.getUTCDay(), m = now.getUTCHours() * 60 + now.getUTCMinutes();
  const fer = (cal.feries || []).find((f) => f.date === iso);
  const hm = (x) => x.split(':').reduce((a, b) => a * 60 + +b);
  const ph = (cal.phases || []).map(([h, l]) => [hm(h), l]);
  let k = -1; ph.forEach(([t], i) => { if (m >= t) k = i; });
  if (wd === 0 || wd === 6) return { c: 'ferme', lab: 'Marché fermé', det: 'week-end', k: -1, jour: false };
  if (fer) return { c: 'ferme', lab: 'Marché fermé', det: fer.libelle || 'jour férié', k: -1, jour: false };
  if (k < 0) return { c: 'ferme', lab: 'Marché fermé', det: 'ouverture à 09:00', k, jour: true };
  if (k === 0) return { c: 'pre', lab: 'Pré-ouverture', det: 'ouverture des échanges à 09:45', k, jour: true };
  if (k === 1) return { c: 'ouvert', lab: 'Marché ouvert', det: 'négociation en continu jusqu\'à 14:00', k, jour: true };
  if (k === 2 || k === 3) return { c: 'cloture', lab: 'Clôture en cours', det: ph[k][1].toLowerCase() + ', fermeture à 15:00', k, jour: true };
  return { c: 'ferme', lab: 'Marché fermé', det: 'séance terminée à 15:00', k, jour: true };
}
function tickMarche() {
  if (!D) return;
  const now = new Date(), e = etatMarche(now);
  const h = now.toISOString().slice(11, 19);
  const fill = (box, full) => { if (!box) return; box.className = 'mstat ' + e.c + (full ? ' big' : ''); box.title = `${e.det} · horaires normaux de la BRVM (heure de Dakar et d'Abidjan) ; ${(D.calendrier || {}).veille_fete || ''}`;
    box.replaceChildren(el('i', { class: 'pt' }), e.lab, el('span', { class: 'h' }, h, el('small', {}, 'GMT'))); };
  fill($('#mstat'), false);
  fill($('#sj-stat'), true);
  const phs = $('#sj-phases');
  if (phs && phs.childElementCount) [...phs.children].forEach((c, i) => { c.classList.toggle('on', e.jour && i === e.k); c.classList.toggle('past', e.jour && i < e.k); });
}
setInterval(tickMarche, 1000);

function resumeJour() {
  const r = D.resume, ix = Object.fromEntries(D.indices.map((i) => [i.indice, i]));
  $('#rj-meta').textContent = `Séance du ${F.date(r.seance)} · indices, volumes et faits de la séance`;
  const off = ok(r.valeur_transactions);
  const st = (l, v) => el('span', {}, l + ' ', el('b', {}, v));
  const up = TIT.filter((t) => ok(t.var_seance)).sort((a, b) => b.var_seance - a.var_seance);
  $('#rj-stats').replaceChildren(st('Hausses', r.hausse), st('Baisses', r.baisse), st('Inchangés', r.inchanges),
    up.length ? st('Plus forte hausse', `${up[0].symbole} ${F.spct(up[0].var_seance)}`) : null,
    up.length ? st('Plus forte baisse', `${up.at(-1).symbole} ${F.spct(up.at(-1).var_seance)}`) : null);
}
const SJ = { f: 'tous', sel: null };
let LIVE = null;
const liveToday = () => (LIVE && LIVE.date && LIVE.releves && LIVE.releves.length ? LIVE : null);          // relevés disponibles (graphiques)
const liveValeurs = () => { const L = liveToday(); return L && D && L.date > D.resume.seance ? L : null; }; // séance pas encore clôturée : les relevés priment
function chargerLive(then) {
  fetch('data/live.json?t=' + Date.now()).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => { LIVE = j; if (then) then(); });
}
// rafraîchit la séance en direct toutes les 5 minutes tant que la page est ouverte sur cette vue
setInterval(() => { if (MK.v === 'seance' && !document.hidden && $('#tabs button[data-tab="marche"]')?.classList.contains('on')) chargerLive(seanceJour); }, 5 * 60 * 1000);
const hmDate = (day, hm) => new Date(`${day}T${hm}:00Z`);
function seanceJour() {
  if (LIVE === null && !SJ.charge) { SJ.charge = true; chargerLive(seanceJour); }
  const r = D.resume, cal = D.calendrier || {}, e = etatMarche();
  const L = liveToday();
  const today = new Date().toISOString().slice(0, 10);
  const enDirect = L && L.date === today;
  $('#sj-meta').textContent = enDirect
    ? `Séance du ${F.date(L.date)} · dernier relevé à ${L.dernier_releve} GMT (mise à jour brvm.org ${L.maj_brvm || 'n.d.'}) · cours différés de 15 minutes · ${L.releves.length} relevé(s)`
    : L ? `Pas encore de relevé aujourd'hui. Derniers relevés : séance du ${F.date(L.date)}, de ${L.releves[0]} à ${L.dernier_releve} GMT.`
      : 'Les relevés en cours de séance apparaîtront ici dès le premier passage du robot (vers 10 h GMT), puis toutes les 30 minutes.';
  $('#sj-phases').replaceChildren(...(cal.phases || []).map(([h, l]) => el('div', { class: 'ph' }, el('b', {}, h), l)));
  $('#lv-releves').textContent = L ? `Relevés du ${F.date(L.date)} : ${L.releves.join(' · ')} (GMT). Un relevé environ toutes les 30 minutes pendant la séance.` : '';
  $('#lv-foot').textContent = 'Source : pages publiques de brvm.org (cours diffusés avec 15 minutes de différé), relevées par le robot environ toutes les 30 minutes. '
    + 'Le carnet d\'ordres et la liste des transactions ne sont pas diffusés en accès libre par la BRVM ; ils nécessitent le flux officiel. '
    + 'La séance n\'est enregistrée dans l\'historique qu\'après la clôture. Les limites affichées suivent la règle générale de ±7,5 % autour du cours de la veille.';
  // indices en direct
  const ix = Object.fromEntries(D.indices.map((i) => [i.indice, i]));
  const LV = liveValeurs();
  const li = (n) => { const lv = LV?.indices?.[n]; const v = lv ? lv.niveau : ix[n]?.niveau, va = lv ? lv.variation : ix[n]?.var_seance;
    return el('div', { class: 'li' }, el('div', { class: 'l' }, n), el('div', { class: 'v' }, F.n2(v), el('small', { class: cls(va) }, F.spct(va)))); };
  $('#lv-idx').replaceChildren(...['BRVM Composite', 'BRVM 30', 'BRVM Prestige'].map(li),
    el('div', { class: 'li' }, el('div', { class: 'l' }, LV ? 'Valeur échangée (séance en cours)' : 'Valeur échangée (clôture)'), el('div', { class: 'v' }, F.big(LV ? LV.valeur_transactions : (r.valeur_transactions ?? r.valeur_jour_calculee)), el('small', {}, 'FCFA'))));
  // sélection du titre
  const sel = $('#lv-sel');
  if (!sel.options.length) {
    sel.replaceChildren(...TIT.slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((t) => new Option(`${t.symbole} – ${t.nom}`, t.symbole)));
    sel.onchange = () => { SJ.sel = sel.value; lvTitre(); };
    seg($('#sj-f'), [['tous', 'Tous'], ['hausse', 'Hausses'], ['baisse', 'Baisses'], ['echange', 'Échangés']], SJ.f, (v) => { SJ.f = v; sjTable(); });
    $('#sj-q').addEventListener('input', sjTable);
  }
  if (!SJ.sel) SJ.sel = (TIT.slice().sort((a, b) => (b.valeur_jour || 0) - (a.valeur_jour || 0))[0] || TIT[0]).symbole;
  sel.value = SJ.sel;
  lvTitre();
  // Composite pendant la séance
  const cs = L?.indices?.['BRVM Composite']?.serie || [];
  if (cs.length >= 2) lineChart($('#lv-comp'), [{ n: 'BRVM Composite', c: css('--c1'), v: cs.map((x) => x[1]), d: cs.map((x) => hmDate(L.date, x[0])) }],
    { fy: F.n2, h: 240, area: true, end: false, fx: (d) => d.toISOString().slice(11, 16), ftip: (d) => `${F.date(L.date)} · relevé de ${d.toISOString().slice(11, 16)} GMT` });
  else $('#lv-comp').replaceChildren(el('div', { class: 'lv-wait' }, cs.length === 1 ? `Un seul relevé (${cs[0][0]} GMT) : la courbe apparaîtra au relevé suivant.` : 'Aucun relevé de séance pour l\'instant.'));
  sjTable();
  tickMarche();
}
function lvTitre() {
  const L = liveToday(), LV = liveValeurs(), sym = SJ.sel, t = TIT.find((x) => x.symbole === sym) || {};
  const lt = LV?.titres?.[sym];
  const k = (l, v, u, sub) => el('div', { class: 'k' }, el('div', { class: 'l' }, l), el('div', { class: 'v' }, v, u ? el('small', {}, u) : null), el('div', { class: 's' }, ...[].concat(sub || [])));
  const cours = lt ? lt.cours : t.cours, va = lt ? lt.variation : t.var_seance, vol = lt ? lt.volume : t.volume_jour, veille = lt ? lt.veille : t.cours_veille;
  const plaf = lt ? lt.plafond : ok(veille) ? veille * 1.075 : null, plan = lt ? lt.plancher : ok(veille) ? veille * 0.925 : null;
  $('#lv-tnote').textContent = lt ? `${t.nom || sym} · ${t.secteur || ''} · dernier relevé ${LV.dernier_releve} GMT (différé 15 min)` : `${t.nom || sym} · ${t.secteur || ''} · chiffres de la clôture du ${F.date(D.resume.seance)}` + (L?.titres?.[sym] ? ` ; courbe : relevés de la séance du ${F.date(L.date)}` : '');
  $('#lv-kpis').replaceChildren(
    k('Dernier cours', F.n0(cours), 'FCFA', [el('span', { class: 'pill ' + cls(va) }, F.spct(va)), ` · veille ${F.n0(veille)}`]),
    k('Volume de la séance', F.n0(vol), 'titres', [`valeur estimée `, el('b', {}, F.big(ok(vol) && ok(cours) ? vol * cours : null)), ' FCFA']),
    k('Ouverture', F.n0(lt ? lt.ouverture : t.ouverture), 'FCFA', 'premier cours de la séance'),
    k('Limites autorisées', '', null, [el('div', {}, '▲ Plafond ', el('b', {}, F.n0(plaf))), el('div', {}, '▼ Plancher ', el('b', {}, F.n0(plan)))]));
  const se = L?.titres?.[sym]?.serie || [];
  if (se.length >= 2) {
    const d = se.map((x) => hmDate(L.date, x[0]));
    const fxh = (x) => x.toISOString().slice(11, 16);
    const vols = se.map((x, i) => (ok(x[2]) ? Math.max(0, x[2] - (i ? (se[i - 1][2] || 0) : 0)) : null));
    let vsvg = null;
    const drawV = (x) => {
      if (!vsvg) vsvg = svgIn($('#lv-vol'), 80).svg;
      vsvg.selectAll('*').remove();
      const [r0, r1] = x.range(), y = d3.scaleLinear([0, d3.max(vols.filter(ok)) || 1], [76, 14]);
      const bw = Math.min(26, Math.max(3, (r1 - r0) / Math.max(se.length, 8) * 0.6));
      vols.forEach((v, i) => { if (ok(v) && v > 0) vsvg.append('rect').attr('x', Math.min(r1 - bw, Math.max(r0, x(d[i]) - bw / 2))).attr('y', y(v)).attr('width', bw).attr('height', 76 - y(v)).attr('fill', css('--c7')).attr('opacity', .7)
        .on('mousemove', (ev) => showTip(ev, `Entre ${i ? se[i - 1][0] : 'l\'ouverture'} et ${se[i][0]} GMT`, [{ t: `${F.n0(v)} titres échangés` }])).on('mouseleave', hideTip); });
      vsvg.append('text').attr('x', r0).attr('y', 10).text('Titres échangés entre deux relevés');
    };
    const ser = [{ n: sym, c: css('--c1'), v: se.map((x) => x[1]), d }];
    if (ok(veille)) ser.push({ n: 'Veille', c: css('--muted-line'), v: se.map(() => veille), d, w: 1, dash: true, noEnd: true });
    lineChart($('#lv-chart'), ser, { fy: F.n0, h: 280, step: true, end: false, fx: fxh, ftip: (x) => `Relevé de ${fxh(x)} GMT`, onZoom: drawV });
  } else {
    $('#lv-chart').replaceChildren(el('div', { class: 'lv-wait' }, se.length === 1 ? `Un seul relevé (${se[0][0]} GMT) : la courbe apparaîtra au relevé suivant.` : 'Pas de relevé en séance pour ce titre. Le graphique se remplit pendant la séance, environ toutes les 30 minutes.'));
    $('#lv-vol').replaceChildren();
  }
  const rows = se.slice().reverse().map((x, i, arr) => ({ h: x[0], cours: x[1], vol: x[2], dv: ok(x[2]) ? x[2] - (arr[i + 1] ? (arr[i + 1][2] || 0) : 0) : null, var: ok(x[1]) && ok(veille) ? x[1] / veille - 1 : null }));
  if (rows.length) table($('#lv-rel'), rows, [{ k: 'h', h: 'Relevé (GMT)', l: true }, { k: 'cours', h: 'Cours', f: F.n0 }, { k: 'var', h: 'Var.', f: (v) => F.spct(v), cls: true }, { k: 'vol', h: 'Volume cumulé', f: F.n0 }, { k: 'dv', h: 'Depuis le relevé préc.', f: F.n0 }]);
  else $('#lv-rel').replaceChildren(el('tbody', {}, el('tr', {}, el('td', { class: 'l note' }, 'Aucun relevé pour ce titre.'))));
}
function sjTable() {
  const L = liveValeurs();
  const q = $('#sj-q').value.trim().toLowerCase();
  const base = TIT.map((t) => { const lt = L?.titres?.[t.symbole]; return lt ? { ...t, cours: lt.cours, var_seance: lt.variation, volume_jour: lt.volume, valeur_jour: ok(lt.volume) && ok(lt.cours) ? lt.volume * lt.cours : null } : t; });
  const rows = base.filter((t) => (!q || (t.symbole + ' ' + t.nom).toLowerCase().includes(q))
    && (SJ.f === 'tous' || (SJ.f === 'hausse' && t.var_seance > 0) || (SJ.f === 'baisse' && t.var_seance < 0) || (SJ.f === 'echange' && t.volume_jour > 0)))
    .sort((a, b) => (b.valeur_jour || 0) - (a.valeur_jour || 0));
  $('#sj-ttl').textContent = L ? `Cotations au relevé de ${L.dernier_releve} GMT` : `Cotations de la clôture du ${F.date(D.resume.seance)}`;
  $('#sj-src').textContent = L ? `Séance du ${F.date(L.date)} · cours différés de 15 minutes · valeur estimée = volume × cours · cliquez sur une ligne pour suivre le titre` : 'Cours de clôture publiés par la BRVM · cliquez sur une ligne pour suivre le titre';
  table($('#sj-table'), rows, [{ k: 'symbole', h: 'Titre', l: true, sym: true, title: 'nom' }, { k: 'nom', h: '', l: true, nm: true }, { k: 'cours', h: 'Cours', f: F.n0 },
    { k: 'var_seance', h: 'Var.', f: (v) => F.spct(v), pill: true }, { k: 'volume_jour', h: 'Volume', f: F.n0 }, { k: 'valeur_jour', h: L ? 'Valeur est.' : 'Valeur', f: F.big }],
  { click: (x) => { SJ.sel = x.symbole; $('#lv-sel').value = x.symbole; lvTitre(); $('#lv-sel').scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
}
const IDXC = { per: '7J' };
function idxCards() {
  const ix = Object.fromEntries(D.indices.map((i) => [i.indice, i]));
  const n0 = IDXC.per === '7J' ? DATES.length - 7 : startIdx(IDXC.per);
  const lib = { '7J': '7 séances', '1M': '1 mois', '3M': '3 mois', YTD: 'depuis le début de l\'année', '1A': '1 an' }[IDXC.per];
  $('#idx-cards').replaceChildren(...['BRVM Composite', 'BRVM 30', 'BRVM Prestige'].filter((n) => ix[n]).map((n) => {
    const v = series(n).slice(Math.max(0, n0)), vv = v.filter(ok);
    const w = 360, h = 64, up = vv.at(-1) >= vv[0], c = up ? css('--up') : css('--down');
    const svg = d3.create('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('preserveAspectRatio', 'none').attr('height', h);
    if (vv.length >= 2) {
      const x = d3.scaleLinear([0, v.length - 1], [0, w]), y = d3.scaleLinear(d3.extent(vv), [h - 4, 6]);
      svg.append('path').attr('d', d3.area().defined(ok).x((_, i) => x(i)).y0(h).y1((d) => y(d))(v)).attr('fill', c).attr('opacity', 0.06);
      svg.append('path').attr('d', d3.line().defined(ok).x((_, i) => x(i)).y((d) => y(d))(v)).attr('fill', 'none').attr('stroke', c).attr('stroke-width', 2).attr('vector-effect', 'non-scaling-stroke');
    }
    const pv = vv.length >= 2 ? vv.at(-1) / vv[0] - 1 : null;
    return el('div', { class: 'idc', title: 'Comparer dans le graphique des indices', onclick: () => { S.idxSel = new Set([n]); marche(); mkGo('indices'); scrollTo({ top: $('#tabs').offsetTop - 10, behavior: 'smooth' }); } },
      el('div', { class: 'n' }, n, el('small', {}, IDXC.per === '7J' ? '7 j' : IDXC.per)),
      el('div', { class: 'v' }, F.n2(ix[n].niveau)),
      el('div', { class: 'd' }, el('b', { class: cls(ix[n].var_seance) }, F.spct(ix[n].var_seance)), ' · var. jour', ok(pv) ? el('span', {}, ' · ', el('b', { class: cls(pv) }, F.spct(pv, 1)), ' sur ' + lib) : null),
      svg.node(), el('div', { class: 't' }, 'Tendance sur ' + lib));
  }));
  if (!$('#idx-cards-per').childElementCount) seg($('#idx-cards-per'), [['7J', '7 j'], ['1M', '1 mois'], ['3M', '3 mois'], ['YTD', 'YTD'], ['1A', '1 an']], IDXC.per, (v) => { IDXC.per = v; idxCards(); });
}


// ------------------------------------------------------------------ MARCHÉ : sous-rubriques, menu, profondeur, mouvements, palmarès (lot 8)
const MK_VIEWS = [
  ['resume', 'Résumé du jour', 'Indices, volumes et faits de la séance'],
  ['seance', 'Séance en direct', 'Cours et volumes pendant les échanges'],
  ['palmares', 'Palmarès', 'Meilleures et pires performances, par période'],
  ['indices', 'Indices BRVM', 'Indices de marché et sectoriels, fiche de chaque indice'],
  ['@dividendes', 'Dividendes et coupons', 'Calendrier des détachements et des paiements'],
  ['@obligations', 'Obligations et taux', 'Marché obligataire, rendements et échéances'],
];
const MK = { v: 'resume' };
function mkGo(v) {
  if (v.startsWith('@')) { hideMenu(); showTab(v.slice(1)); return; }
  MK.v = v;
  if (!$('#tabs button[data-tab="marche"]').classList.contains('on')) showTab('marche');
  document.querySelectorAll('.mview').forEach((d) => { d.hidden = d.dataset.mview !== v; });
  $('#mk-nav').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'indices') { $('#ix-page').hidden = true; $('#ix-list').hidden = false; ixRender(); ixRendement(); drawIdx(); breadth(); drawSec(); }
  if (v === 'palmares') palmares();
  if (v === 'seance') seanceJour();
  hideMenu();
}
function mkNav() {
  const nav = $('#mk-nav');
  if (nav.childElementCount) return;
  nav.replaceChildren(...MK_VIEWS.map(([v, l, d]) => el('button', { 'data-v': v, class: (v === MK.v ? 'on' : '') + (v.startsWith('@') ? ' ext' : ''), title: d, onclick: () => mkGo(v) }, l)));
}
function hideMenu() { const m = $('#mk-menu'); if (m) m.hidden = true; }
function mkMenu() {
  const btn = $('#tabs button[data-tab="marche"]'), m = $('#mk-menu');
  if (!btn || !m || btn.dataset.menu) return;
  btn.dataset.menu = '1';
  btn.append(el('span', { class: 'car', 'aria-hidden': 'true' }, '▾'));
  let tmr;
  const open = () => {
    clearTimeout(tmr);
    const ix = Object.fromEntries(D.indices.map((i) => [i.indice, i]));
    m.replaceChildren(el('p', { class: 't' }, 'L\'état du marché aujourd\'hui'),
      el('div', { class: 'res', onclick: () => mkGo('resume') }, el('div', { class: 'h' }, 'Résumé du jour', el('span', {}, 'Commencer ici ›')),
        el('div', { class: 'note', style: 'margin:2px 0 6px' }, `Séance du ${F.date(D.resume.seance)}`),
        ...['BRVM Composite', 'BRVM 30', 'BRVM Prestige'].filter((n) => ix[n]).map((n) => el('div', { class: 'r' }, el('span', {}, n.toUpperCase()), el('b', {}, F.n2(ix[n].niveau)), el('span', { class: cls(ix[n].var_seance) }, F.spct(ix[n].var_seance))))),
      ...MK_VIEWS.slice(1).map(([v, l, d]) => el('button', { class: 'ent', onclick: () => mkGo(v) }, el('b', {}, l + (v.startsWith('@') ? ' ↗' : '')), el('span', {}, d))));
    const r = btn.getBoundingClientRect();
    m.style.top = `${r.bottom + 4}px`;
    m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 400))}px`;
    m.hidden = false;
  };
  const close = () => { tmr = setTimeout(hideMenu, 220); };
  btn.addEventListener('mouseenter', () => { if (matchMedia('(hover: hover) and (min-width: 901px)').matches) open(); });
  btn.addEventListener('mouseleave', close);
  m.addEventListener('mouseenter', () => clearTimeout(tmr));
  m.addEventListener('mouseleave', close);
  addEventListener('scroll', hideMenu, { passive: true });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });
}
function profondeur() {
  const r = D.resume;
  const cap = TIT.reduce((a, t) => a + (t.capitalisation || 0), 0);
  const flo = TIT.reduce((a, t) => a + (ok(t.flottant_pct) && t.capitalisation ? t.capitalisation * t.flottant_pct : 0), 0);
  const nf = TIT.filter((t) => t.capitalisation && !ok(t.flottant_pct)).length;
  const idx = D.indices.filter((i) => ok(i.var_seance)), up = idx.filter((i) => i.var_seance > 0).length;
  const dk = (l, v, u, sub) => el('div', { class: 'dk' }, el('div', { class: 'l' }, l), el('div', { class: 'v' }, v, u ? el('small', {}, u) : null), el('div', { class: 's' }, sub));
  const vj = ok(r.valeur_transactions) ? r.valeur_transactions : r.valeur_jour_calculee;
  const top5 = d3.sum(TIT.slice().sort((a, b) => (b.capitalisation || 0) - (a.capitalisation || 0)).slice(0, 5), (t) => t.capitalisation || 0);
  const lead = TIT.slice().sort((a, b) => (b.capitalisation || 0) - (a.capitalisation || 0))[0];
  $('#mk-depth').replaceChildren(
    dk('Capitalisation flottante', F.big(flo), 'FCFA', 'part négociable sur le marché' + (nf ? ` (${nf} titre(s) sans flottant connu)` : '')),
    dk('Ratio flottant / total', F.pct(cap ? flo / cap : null, 1), null, 'profondeur du marché'),
    dk('Taux de rotation du jour', F.pct(flo ? vj / flo : null, 3), null, 'valeur échangée / capitalisation flottante'),
    dk('Concentration', F.pct(cap ? top5 / cap : null, 0), null, `poids des 5 premières capitalisations · ${lead ? lead.symbole + ' ' + F.pct(lead.poids, 0) : ''}`),
    dk('Indices en hausse', `${up} / ${idx.length}`, null, `${F.pct(idx.length ? up / idx.length : null, 0)} des indices`),
    dk('Titres échangés', `${TIT.filter((t) => t.volume_jour > 0).length} / ${TIT.length}`, null, 'titres ayant au moins une transaction'));
}
const MV = { f: 'hausse' };
function mouvements() {
  const box = $('#mv-list');
  let rows;
  if (MV.f === 'hausse') rows = TIT.filter((t) => t.var_seance > 0).sort((a, b) => b.var_seance - a.var_seance);
  else if (MV.f === 'baisse') rows = TIT.filter((t) => t.var_seance < 0).sort((a, b) => a.var_seance - b.var_seance);
  else rows = TIT.filter((t) => t.valeur_jour > 0).sort((a, b) => b.valeur_jour - a.valeur_jour);
  rows = rows.slice(0, 6);   // affichés sur deux colonnes
  box.replaceChildren(...(rows.length ? rows.map((t) => el('div', { class: 'it', onclick: () => openTitle(t.symbole) }, el('b', {}, t.symbole), el('span', {}, t.nom),
    el('span', { class: 'c' }, MV.f === 'volume' ? F.big(t.valeur_jour) + ' FCFA' : F.n0(t.cours)), el('span', { class: 'p ' + cls(t.var_seance) }, F.spct(t.var_seance))))
    : [el('p', { class: 'note' }, 'Aucun titre pour ce filtre')]));
  $('#mv-src').textContent = MV.f === 'volume' ? (TIT.some((t) => t.valeur_jour_source === 'estimé') ? 'Valeurs estimées (volume × cours) tant que le Bulletin Officiel de la Cote du lendemain n\'est pas lu.' : 'Montants officiels (Bulletin Officiel de la Cote).') : '';
  if (!$('#mv-f').childElementCount) seg($('#mv-f'), [['hausse', 'Hausses'], ['baisse', 'Baisses'], ['volume', 'Volumes']], MV.f, (v) => { MV.f = v; mouvements(); });
}
const PM = { sort: { k: 'perf_1a', dir: -1 } };
const PM_COLS = [['var_seance', 'Jour'], ['perf_1s', '1 sem.'], ['perf_1m', '1 mois'], ['perf_3m', '3 mois'], ['perf_6m', '6 mois'], ['perf_ytd', 'YTD'], ['perf_1a', '1 an'], ['perf_3a', '3 ans'], ['perf_5a', '5 ans']];
function palmares() {
  const comp = D.indices.find((i) => i.indice === 'BRVM Composite') || {};
  const c5 = (() => { const v = series('BRVM Composite'), a = v[startIdx('5A')], b = v.filter(ok).at(-1); return ok(a) && ok(b) ? b / a - 1 : null; })();
  $('#pm-ref').replaceChildren(el('div', { class: 't' }, 'Référence de marché', el('b', {}, 'BRVM Composite')),
    ...PM_COLS.map(([k, l]) => { const v = k === 'perf_5a' ? c5 : comp[k]; return el('div', { class: 'k' }, l, el('b', { class: cls(v) }, ok(v) ? F.spct(v, 2) : '—')); }));
  const sec = $('#pm-sec'), pays = $('#pm-pays');
  if (!sec.options.length) {
    sec.replaceChildren(new Option('Tous les secteurs', ''), ...SECTORS.map((x) => new Option(x, x)));
    pays.replaceChildren(new Option('Tous les pays', ''), ...[...new Set(TIT.map((t) => paysDe(t.symbole)))].sort().map((x) => new Option(x, x)));
    ['#pm-q', '#pm-sec', '#pm-pays'].forEach((id) => $(id).addEventListener('input', palmares));
    $('#pm-reset').onclick = () => { $('#pm-q').value = ''; sec.value = ''; pays.value = ''; palmares(); };
  }
  const q = $('#pm-q').value.trim().toLowerCase();
  const rows = TIT.filter((t) => (!q || (t.symbole + ' ' + t.nom).toLowerCase().includes(q)) && (!sec.value || t.secteur === sec.value) && (!pays.value || paysDe(t.symbole) === pays.value))
    .map((t) => ({ ...t, pays: paysDe(t.symbole), soc: t.nom }));
  const { k, dir } = PM.sort;
  rows.sort((a, b) => { const x = a[k], y = b[k]; if (!ok(x) && !ok(y)) return 0; if (!ok(x)) return 1; if (!ok(y)) return -1; return typeof x === 'string' ? dir * x.localeCompare(y, 'fr') : dir * (x - y); });
  $('#pm-count').textContent = `${rows.length} valeur(s) sur ${TIT.length} · cours au ${F.date(D.resume.seance)}`;
  const cols = [{ k: 'soc', h: 'Société', l: true }, { k: 'cours', h: 'Cours', f: F.n0 }, { k: 'date_cours', h: 'Coté le', f: (v) => (v ? v.split('-').reverse().join('/') : '—') },
    ...PM_COLS.map(([kk, l]) => ({ k: kk, h: l, f: (v) => (ok(v) ? F.spct(v, 2) : '—'), cls: true })), { k: 'secteur', h: 'Secteur', l: true, nm: true }, { k: 'pays', h: 'Pays', l: true, nm: true }];
  table($('#pm-table'), rows, cols, { sort: PM.sort, onSort: (kk) => { PM.sort = { k: kk, dir: PM.sort.k === kk ? -PM.sort.dir : (['soc', 'secteur', 'pays'].includes(kk) ? 1 : -1) }; palmares(); }, click: (r) => openTitle(r.symbole) });
  $('#pm-table').querySelectorAll('tbody tr').forEach((tr, i) => { const td = tr.firstChild; td.className = 'l nm2'; td.replaceChildren(rows[i].nom, el('small', {}, rows[i].symbole)); });
}

// ------------------------------------------------------------------ TITRE
function openTitle(sym) {
  S.sel = sym;
  showTab('titre');
  titre();
  scrollTo({ top: $('#tabs').offsetTop - 80, behavior: 'smooth' });
}
const DEF = {
  cours: 'Dernier cours de clôture publié par la BRVM, ajusté des divisions d\'actions.',
  jour: 'Variation du cours lors de la dernière séance (journée de bourse) par rapport à la veille. 0 % : aucun échange ou prix inchangé.',
  m1: 'Évolution du cours sur le dernier mois.',
  ytd: 'YTD : évolution depuis la clôture de la première séance de cotation de l\'année (2 janvier en 2026 ; date indiquée sous les chiffres clés).',
  dimson: 'Bêta corrigé (méthode de Dimson), indicateur complémentaire : régression des rendements du titre sur ceux du BRVM Composite de la veille, du jour et du lendemain ; bêta = somme des trois coefficients. Hypothèse : le titre réagit au marché avec au plus une séance de décalage (titres peu échangés). Le bêta classique reste la référence.',
  qual: 'Qualité des données du titre : fiable (données disponibles, contrôles satisfaisants), à surveiller (donnée disponible avec une réserve) ou insuffisant (donnée manquante, incohérente ou non vérifiable). Règles détaillées dans la méthode.',
  a1: 'Évolution du cours sur 12 mois.',
  cap: 'Cours × nombre d\'actions : valeur boursière de la société.',
  per: 'Price Earning Ratio = cours / bénéfice par action. Nombre d\'années de bénéfices que paie l\'acheteur ; plus il est bas, moins le titre est cher.',
  bnpa: 'Bénéfice net par action. Exercice et source indiqués ; corrections éventuelles tracées dans data/corrections_referentiel.csv.',
  perboc: 'PER publié par la BRVM dans le Bulletin Officiel de la Cote : référence indépendante qui contrôle le PER calculé par le Daily. Il ne remplace jamais le BNPA.',
  div: 'Dernier dividende net payé par action, tel que publié au Bulletin Officiel de la Cote, avec sa date de paiement.',
  rdt: 'Dividende de référence / cours. Dividende de référence : la décision la plus récente connue (dernier paiement publié au BOC, ou décision d\'AGO plus récente du fichier Daily, y compris « aucun dividende »). Non calculé si le dernier dividende date de plus de 18 mois.',
  vol: 'Amplitude annuelle moyenne des variations du cours. Plus elle est élevée, plus le titre est risqué.',
  beta: 'Bêta classique (référence) : sensibilité au BRVM Composite ; 1 = suit le marché. Bêta corrigé (Dimson) en complément : ajoute la réaction au marché de la veille et du lendemain, ce qui corrige la sous-estimation due aux cotations peu fréquentes.',
  dd: 'Plus forte baisse subie sur 12 mois, d\'un plus haut à un plus bas.',
  ddev: 'Downside deviation : √(moyenne de min(rendement quotidien, 0)²) × √252, sur toutes les séances de 12 mois. Mesure le risque de baisse seul.',
  fiab: 'Mesures de risque peu fiables si plus de 30 % des séances sont sans variation (titre peu échangé) ou si moins de 120 rendements sont disponibles. Seuils provisoires.',
  liq: 'Montant moyen négocié par jour sur 3 mois : plus il est élevé, plus il est facile d\'acheter ou de vendre.',
  flot: 'Part du capital qui circule en bourse (hors actionnaires de référence).',
  inch: 'Part des séances sans variation de cours : un niveau élevé signale un titre peu échangé.',
};
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const qual = (v, a, b, low, mid, high) => (!ok(v) ? '' : v < a ? low : v < b ? mid : high);
function titre() {
  const sel = $('#t-sel');
  if (!sel.options.length) {
    sel.replaceChildren(...TIT.slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((t) => new Option(`${t.nom} (${t.symbole})`, t.symbole)));
    sel.onchange = () => { S.sel = sel.value; titre(); };
    $('#t-cmp-sec').onclick = () => { CP.sel = cpPairs(S.sel); showTab('comparer'); };
    $('#t-cmp').onclick = () => { if (!CP.sel.includes(S.sel)) CP.sel = [S.sel, ...CP.sel].slice(0, CP_MAX); showTab('comparer'); };
    seg($('#t-per'), PERIODS, S.tPer, (v) => { S.tPer = v; titreCharts(); });
    const ovs = [['MM50', 'Moyenne 50 j'], ['MM200', 'Moyenne 200 j'], ['BB', 'Bandes de Bollinger']];
    $('#t-ov').replaceChildren(...ovs.map(([v, l]) => el('button', { class: 'chip' + (S.ov.has(v) ? ' on' : ''), onclick: (e) => { S.ov.has(v) ? S.ov.delete(v) : S.ov.add(v); e.currentTarget.classList.toggle('on'); titreCharts(); } }, l)));
  }
  sel.value = S.sel;
  const t = TIT.find((x) => x.symbole === S.sel);
  const secIdx = D.indices.find((i) => i.indice === t.secteur) || {};
  const sec = D.secteurs.find((x) => x.secteur === t.secteur) || {};
  const comp = D.indices.find((i) => i.indice === 'BRVM Composite') || {};
  $('#t-meta').textContent = `${t.secteur || 'Secteur non renseigné'} · cours au ${F.date(t.date_cours)}`;

  // ---- synthèse rédigée automatiquement
  const parts = [];
  parts.push(`<b>${esc(t.nom)}</b> (${esc(t.symbole)}) cote <b>${F.n0(t.cours)} FCFA</b> au ${F.date(t.date_cours)}`
    + (ok(t.var_seance) ? `, ${t.var_seance > 0 ? 'en hausse' : t.var_seance < 0 ? 'en baisse' : 'stable'} sur la dernière séance (${F.spct(t.var_seance)}).` : '.'));
  if (ok(t.perf_ytd)) parts.push(`Depuis le début de l'année (YTD, base ${F.date(D.resume.base_ytd)}), le titre ${t.perf_ytd >= 0 ? 'gagne' : 'perd'} <b>${F.pct(Math.abs(t.perf_ytd))}</b>, contre ${F.spct(comp.perf_ytd, 1)} pour le BRVM Composite`
    + (ok(secIdx.perf_ytd) ? ` et ${F.spct(secIdx.perf_ytd, 1)} pour l'indice ${esc(t.secteur)}.` : '.'));
  if (ok(t.per)) {
    const ref = sec.per_median;
    const pos = !ok(ref) ? '' : t.per < ref * 0.85 ? 'moins cher que' : t.per > ref * 1.15 ? 'plus cher que' : 'valorisé en ligne avec';
    if (t.per_statut === 'écart') parts.push(`Attention : le PER calculé (${F.n1(t.per)}) diffère du PER publié au BOC (${F.n1(t.per_boc)}) ; origine : ${esc(t.per_origine || 'indéterminée')}.`);
    parts.push(`Avec un PER de <b>${F.n1(t.per)}</b>${ok(ref) ? ` (médiane du secteur : ${F.n1(ref)}), il est ${pos} ses pairs` : ''}`
      + (ok(t.rendement) && t.rendement > 0 ? ` ; son dividende rapporte <b>${F.pct(t.rendement, 2)}</b> par an${ok(sec.rendement_median) ? ` (secteur : ${F.pct(sec.rendement_median, 2)})` : ''}.` : '.'));
  }
  if (ok(t.vol_1a)) parts.push(`Le risque est ${qual(t.vol_1a, 0.2, 0.35, 'faible', 'modéré', 'élevé')} (volatilité de ${F.pct(t.vol_1a, 0)} sur un an, baisse maximale de ${F.pct(Math.abs(t.max_dd_1a), 0)})`
    + (ok(t.beta_1a) ? ` et ${t.beta_1a < 0.5 ? 'le titre suit peu les mouvements du marché' : t.beta_1a < 1.2 ? 'le titre évolue globalement avec le marché' : 'le titre amplifie les mouvements du marché'} (bêta ${F.n2(t.beta_1a)}).` : '.'));
  if (ok(t.ecart_plus_haut)) parts.push(`Le cours se situe à ${F.pct(Math.abs(t.ecart_plus_haut), 0)} sous son plus haut de l'année.`);
  if (ok(t.seances_inchangees) && t.seances_inchangees > 0.3) parts.push(`Attention : titre peu liquide (${F.pct(t.seances_inchangees, 0)} des séances sans variation) ; volatilité et bêta y sont peu fiables${ok(t.beta_dimson_1a) ? ` (bêta corrigé : ${F.n2(t.beta_dimson_1a)})` : ''}.`);
  else if (t.risque_fiabilite === 'peu fiable') parts.push(`Mesures de risque peu fiables : ${esc(t.risque_detail)}.`);
  $('#t-synth').innerHTML = parts.join(' ');   // textes construits à partir de chiffres et de noms de la BRVM
  const dg = (D.diagnostic?.titres || []).find((x) => x.symbole === t.symbole);
  if (dg) $('#t-synth').append(' ', el('span', { class: 'rc-lien' }, 'Diagnostic du jour : ', catPill(dg.categorie), ' ',
    el('a', { href: '#recos', onclick: (e) => { e.preventDefault(); RC.sel = t.symbole; RC.cat = ''; showTab('recos'); recos(); } }, 'voir le détail')));

  // ---- fiche en quatre blocs
  const kv = (lab, def, val, c, sub) => el('div', { class: 'kv' }, el('span', { class: 'k', title: def }, lab, el('i', {}, 'ⓘ')),
    el('span', { class: 'v ' + (c || '') }, val, sub ? el('small', {}, sub) : null));
  const bloc = (titreB, ...rows) => el('div', { class: 'bloc' }, el('h3', {}, titreB), ...rows);
  $('#t-fiche').replaceChildren(
    bloc('Cours et performance',
      kv('Cours', DEF.cours, F.n0(t.cours) + ' FCFA', t.statut_cours === 'séance antérieure' ? 'down' : '', t.statut_cours === 'séance antérieure' ? '⚠ cours du ' + F.date(t.date_cours) : ''),
      kv('Variation du jour', DEF.jour, F.spct(t.var_seance), cls(t.var_seance)),
      kv('1 mois', DEF.m1, F.spct(t.perf_1m), cls(t.perf_1m)),
      kv('YTD', DEF.ytd, F.spct(t.perf_ytd), cls(t.perf_ytd), ok(comp.perf_ytd) ? 'marché ' + F.spct(comp.perf_ytd, 1) : ''),
      kv('1 an', DEF.a1, F.spct(t.perf_1a), cls(t.perf_1a))),
    bloc('Valorisation',
      kv('Capitalisation', DEF.cap, F.big(t.capitalisation) + ' FCFA'),
      kv('PER', DEF.per, F.n1(t.per), t.per_statut === 'écart' ? 'down' : '', ok(sec.per_median) ? 'secteur ' + F.n1(sec.per_median) : ''),
      kv('PER publié (BOC)', DEF.perboc, ok(t.per_boc) ? F.n1(t.per_boc) : '—', t.per_statut === 'écart' ? 'down' : '',
        t.per_statut === 'conforme' ? '✓ conforme' : t.per_statut === 'écart' ? '⚠ écart ' + F.spct(t.per_ecart, 0) + ' · ' + (t.per_origine || '') : 'non contrôlable'),
      kv('BNPA', DEF.bnpa, ok(t.bnpa) ? F.n0(t.bnpa) + ' FCFA' : '—', '', t.bnpa_exercice ? 'exercice ' + t.bnpa_exercice : ''),
      kv('Dernier dividende payé', DEF.div, ok(t.dividende_net) ? F.n2(t.dividende_net) + ' FCFA' : '—', '', t.dividende_dernier_date ? 'le ' + F.date(t.dividende_dernier_date) : ''),
      kv('Rendement', DEF.rdt, ok(t.rendement) ? F.pct(t.rendement, 2) : '—', '',
        t.dividende_statut === 'aucun dividende' ? 'aucun dividende décidé' : t.dividende_statut === 'ancien' ? 'dividende ancien' : (ok(sec.rendement_median) ? 'secteur ' + F.pct(sec.rendement_median, 2) : ''))),
    bloc('Risque',
      kv('Volatilité 1 an', DEF.vol, F.pct(t.vol_1a, 0), '', qual(t.vol_1a, 0.2, 0.35, 'faible', 'modérée', 'élevée')),
      kv('Downside deviation', DEF.ddev, F.pct(t.downside_dev_1a, 0)),
      kv('Bêta (référence)', DEF.beta, F.n2(t.beta_1a), '', t.risque_fiabilite && t.risque_fiabilite !== 'fiable' ? '⚠ limité : titre peu échangé' : ''),
      kv('Bêta corrigé (Dimson)', DEF.dimson, ok(t.beta_dimson_1a) ? F.n2(t.beta_dimson_1a) : '—', '', ok(t.n_obs_1a) ? `complément · ${F.n0(t.n_obs_1a)} obs.` + (ok(t.beta_dimson_r2) ? ` · R² ${F.n2(t.beta_dimson_r2)}` : '') : 'complément'),
      kv('Baisse max. 1 an', DEF.dd, F.pct(t.max_dd_1a, 0), 'down'),
      ...(t.risque_fiabilite && t.risque_fiabilite !== 'fiable' ? [kv('Fiabilité', DEF.fiab, '⚠ ' + t.risque_fiabilite, 'down', t.risque_detail || '')] : [])),
    bloc('Liquidité',
      kv('Valeur échangée / jour', DEF.liq, ok(t.valeur_moy_3m) ? F.big(t.valeur_moy_3m) + ' FCFA' : 'en cours de collecte'),
      kv('Flottant', DEF.flot, F.pct(t.flottant_pct, 0)),
      kv('Séances sans variation', DEF.inch, F.pct(t.seances_inchangees, 0))),
  );
  let pc = document.getElementById('t-perctl');
  if (!pc) { pc = el('p', { class: 'note', id: 't-perctl', style: 'margin:6px 2px 0' }); $('#t-fiche').after(pc); }
  pc.textContent = [t.qualite ? `Qualité des données : ${t.qualite}` + (t.qualite_motifs ? ` (${t.qualite_motifs})` : '') : '', t.per_detail ? 'Contrôle du PER : ' + t.per_detail + (t.bnpa_source ? ' · BNPA : ' + t.bnpa_source : '') : '',
    t.dividende_detail ? 'Dividende de référence : ' + t.dividende_detail + (t.dividende_ecart_sources ? ' · ⚠ ' + t.dividende_ecart_sources : '') : ''].filter(Boolean).join('  —  ');
  const pos = ok(t.plus_haut_1a) && t.plus_haut_1a > t.plus_bas_1a ? (t.cours - t.plus_bas_1a) / (t.plus_haut_1a - t.plus_bas_1a) : 0.5;
  $('#t-range').replaceChildren(el('div', {}, 'Position du cours sur 12 mois'),
    el('div', { class: 'track' }, el('span', { class: 'dot', style: `left:${(pos * 100).toFixed(1)}%` })),
    el('div', { class: 'ends' }, el('span', {}, 'Plus bas ' + F.n0(t.plus_bas_1a)), el('span', {}, 'Plus haut ' + F.n0(t.plus_haut_1a))));

  // ---- comparaison avec le secteur
  const peers = TIT.filter((x) => x.secteur === t.secteur).sort((a, b) => (b.capitalisation || 0) - (a.capitalisation || 0));
  $('#t-peers-note').textContent = `${peers.length} titres du secteur ${t.secteur || ''}, classés par capitalisation. Cliquez pour changer de titre.`;
  table($('#t-peers'), peers, [
    { k: 'symbole', h: 'Titre', l: true, sym: true }, { k: 'nom', h: '', l: true, nm: true }, { k: 'cours', h: 'Cours', f: F.n0 },
    { k: 'var_seance', h: 'Jour', f: (v) => F.spct(v), cls: true }, { k: 'perf_ytd', h: 'YTD', f: (v) => F.spct(v), cls: true },
    { k: 'perf_1a', h: '1 an', f: (v) => F.spct(v), cls: true }, { k: 'per', h: 'PER', f: F.n1 }, { k: 'rendement', h: 'Rendement', f: (v) => F.pct(v, 2) },
    { k: 'capitalisation', h: 'Capi. (Mds)', f: F.mds }, { k: 'vol_1a', h: 'Volatilité', f: (v) => F.pct(v, 0) },
  ], { click: (r) => openTitle(r.symbole) });
  [...$('#t-peers').querySelectorAll('tbody tr')].forEach((tr, i) => tr.classList.toggle('me', peers[i].symbole === t.symbole));
  titreCharts();
}
function titreCharts() {
  const t = TIT.find((x) => x.symbole === S.sel);
  const s = series(S.sel);
  const i0 = startIdx(S.tPer);
  const d = DATES.slice(i0);
  const pal = palette();
  const ser = [];
  if (S.ov.has('BB')) {
    const m = sma(s, 20), sd = rstd(s, 20);
    ser.push({ n: 'Bollinger', c: '#3d7f99', band: [m.map((v, i) => ok(v) && ok(sd[i]) ? v - 2 * sd[i] : null).slice(i0), m.map((v, i) => ok(v) && ok(sd[i]) ? v + 2 * sd[i] : null).slice(i0)], v: [], d, noEnd: true });
  }
  const main = { n: S.sel, c: pal[0], v: s.slice(i0), d };
  const extra = [];
  if (S.ov.has('MM50')) extra.push({ n: 'Moy. 50 j', c: pal[1], v: sma(s, 50).slice(i0), d, w: 1.5 });
  if (S.ov.has('MM200')) extra.push({ n: 'Moy. 200 j', c: pal[2], v: sma(s, 200).slice(i0), d, w: 1.5, dash: true });
  const vb = $('#t-vol');
  const vs = V.series[S.sel];
  const vmap = vs ? new Map(V.dates.map((x, i) => [x, vs[i]])) : new Map();
  const vals = d.map((x) => vmap.get(x.toISOString().slice(0, 10)) ?? null);
  const hasV = vals.some((v) => ok(v) && v > 0);
  let vsvg = null;
  const drawVol = (x) => {
    if (!hasV) return;
    if (!vsvg) vsvg = svgIn(vb, 90).svg;
    vsvg.selectAll('*').remove();
    const [d0, d1] = x.domain(), [r0, r1] = x.range();
    const iv = d.map((x_, i) => i).filter((i) => d[i] >= d0 && d[i] <= d1);
    const y = d3.scaleLinear([0, d3.max(iv, (i) => vals[i]) || 1], [86, 6]);
    const bw = Math.max(1, (r1 - r0) / Math.max(1, iv.length) - 1);
    iv.forEach((i) => { const v = vals[i]; if (ok(v) && v > 0) vsvg.append('rect').attr('x', Math.min(r1 - bw, Math.max(r0, x(d[i]) - bw / 2))).attr('y', y(v)).attr('width', bw).attr('height', 86 - y(v)).attr('fill', css('--c7')).attr('opacity', .6).on('mousemove', (ev) => showTip(ev, F.date(d[i].toISOString().slice(0, 10)), [{ t: 'Volume : ' + F.n0(v) + ' titres' }])).on('mouseleave', hideTip); });
    vsvg.append('text').attr('x', r0).attr('y', 12).text('Volumes échangés');
  };
  const ax = lineChart($('#t-price'), [main, ...ser, ...extra], { fy: F.n0, area: true, h: 360, onZoom: drawVol });
  const drawn = hasV && !!ax;
  if (!drawn) empty(vb, 'Volumes : collectés chaque jour depuis la mise en service du robot');

  const rel = [{ n: S.sel, c: pal[0], v: rebase(s.slice(i0)), d }];
  if (P.series[t.secteur]) rel.push({ n: t.secteur, c: pal[1], v: rebase(series(t.secteur).slice(i0)), d });
  rel.push({ n: 'BRVM Composite', c: css('--muted-line'), v: rebase(series('BRVM Composite').slice(i0)), d });
  lineChart($('#t-rel'), rel, { fy: F.n0, ref: 100, h: 236, end: false, legend: true });

  let pk = -Infinity;
  const dd = s.slice(i0).map((v) => { if (!ok(v)) return null; pk = Math.max(pk, v); return v / pk - 1; });
  lineChart($('#t-dd'), [{ n: 'Baisse depuis le plus haut', c: css('--down'), v: dd, d }], { fy: (v) => F.pct(v, 0), area: true, zeroTop: true, h: 260, end: false });
}
function monthGrid(box, s, dates) {
  const m = new Map();
  dates.forEach((d, i) => { if (ok(s[i])) m.set(d.getUTCFullYear() * 100 + d.getUTCMonth(), s[i]); });
  const keys = [...m.keys()].sort((a, b) => a - b);
  const ret = new Map();
  keys.forEach((k, i) => { if (i) ret.set(k, m.get(k) / m.get(keys[i - 1]) - 1); });
  gridYM(box, ret);
}
function gridYM(box, ret) {
  const years = [...new Set([...ret.keys()].map((k) => Math.floor(k / 100)))].sort((a, b) => b - a);
  if (!years.length) return empty(box, 'Pas de données');
  const MO = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc', 'Année'];
  const w0 = Math.max(300, box.clientWidth), cw = Math.max(26, Math.floor((w0 - 44) / 13)), ch = 22;
  const h = 18 + years.length * ch;
  const { svg } = svgIn(box, h);
  const col = d3.scaleLinear([-0.1, 0, 0.1], [css('--down'), css('--panel'), css('--up')]).clamp(true);
  MO.forEach((mo, j) => svg.append('text').attr('x', 44 + j * cw + cw / 2).attr('y', 12).attr('text-anchor', 'middle').text(mo));
  years.forEach((y, i) => {
    svg.append('text').attr('x', 38).attr('y', 18 + i * ch + 15).attr('text-anchor', 'end').attr('class', 'lbl').text(y);
    let yr = 1, any = false;
    for (let mo = 0; mo < 13; mo++) {
      const v = mo < 12 ? ret.get(y * 100 + mo) : (any ? yr - 1 : null);
      if (mo < 12 && ok(v)) { yr *= 1 + v; any = true; }
      if (!ok(v)) continue;
      const g = svg.append('g').attr('transform', `translate(${44 + mo * cw},${18 + i * ch})`);
      g.append('rect').attr('width', cw - 2).attr('height', ch - 2).attr('rx', 3).attr('fill', col(v)).attr('stroke', mo === 12 ? css('--muted-line') : 'none');
      if (cw >= 34) g.append('text').attr('x', (cw - 2) / 2).attr('y', 14).attr('text-anchor', 'middle').style('font-size', '10px').style('fill', Math.abs(v) > 0.06 ? '#fff' : css('--fg')).text(nf(1).format(v * 100));
      g.on('mousemove', (ev) => showTip(ev, `${mo < 12 ? MO[mo] : 'Année'} ${y}`, [{ t: F.spct(v) }])).on('mouseleave', hideTip);
    }
  });
}

// ------------------------------------------------------------------ COMPARATEUR (lot 8)
const CP = { sel: [], per: '1A' };
const CP_MAX = 4;
const cpT = (s) => TIT.find((t) => t.symbole === s);
const cpDiag = (s) => (D.diagnostic?.titres || []).find((t) => t.symbole === s);
const cpHist = (s) => (D.historique_titres || {})[s] || { resultats: [], dividendes: [] };
const cpHash = () => { history.replaceState(null, '', '#comparer' + (CP.sel.length ? '=' + CP.sel.join(',') : '')); };
function cpLiq(sym) {
  // volumes collectés par le robot (depuis juillet 2026) ; valeur estimée = volume × cours de clôture
  const vs = V.series[sym] || [];
  const pi = new Map(P.dates.map((d, i) => [d, i]));
  const rows = V.dates.map((d, i) => ({ d, v: vs[i], p: series(sym)[pi.get(d)] })).filter((r) => ok(r.v));
  const last = V.dates.at(-1) ? new Date(V.dates.at(-1) + 'T00:00:00Z') : null;
  const win = (m) => { if (!last) return []; const a = new Date(last); a.setUTCMonth(a.getUTCMonth() - m); const s = a.toISOString().slice(0, 10); return rows.filter((r) => r.d > s); };
  const m1 = win(1), m3 = win(3);
  const avg = (a, f) => a.length ? d3.mean(a, f) : null;
  return { vol1: avg(m1, (r) => r.v), vol3: avg(m3, (r) => r.v), val1: avg(m1, (r) => ok(r.p) ? r.v * r.p : null), val3: avg(m3, (r) => ok(r.p) ? r.v * r.p : null),
    part3: m3.length ? m3.filter((r) => r.v > 0).length / m3.length : null, n3: m3.length };
}
function cpTop() {
  const syms = Object.keys(V.series).filter((s) => cpT(s));
  return syms.map((s) => [s, cpLiq(s).val1]).filter((x) => ok(x[1])).sort((a, b) => b[1] - a[1]).slice(0, 6).map((x) => x[0]);
}
function cpPairs(sym) {
  // le titre et les 3 titres de son secteur les plus échangés sur 1 mois (à défaut : les plus grosses capitalisations)
  const t = cpT(sym); if (!t) return [sym];
  const pairs = TIT.filter((x) => x.secteur === t.secteur && x.symbole !== sym)
    .map((x) => ({ s: x.symbole, v: cpLiq(x.symbole).val1, c: x.capitalisation }))
    .sort((a, b) => (ok(b.v) ? b.v : -1) - (ok(a.v) ? a.v : -1) || (b.c || 0) - (a.c || 0));
  return [sym, ...pairs.slice(0, CP_MAX - 1).map((x) => x.s)];
}
function cpSet(list) {
  CP.sel = [...new Set(list.filter((s) => cpT(s)))].slice(0, CP_MAX);
  cpHash();
  comparer();
}
// lignes des tableaux : [libellé, explication, valeur brute (Excel), texte affiché, sens du « meilleur » (1, -1 ou 0)]
function cpSections() {
  const sel = CP.sel.map((s) => ({ s, t: cpT(s), g: cpDiag(s), h: cpHist(s), l: cpLiq(s) }));
  const div = (x) => x.h.dividendes || [];
  const res = (x) => x.h.resultats || [];
  const ex = [2022, 2023, 2024, 2025];
  const dexo = (x, e) => div(x).find((d) => d.exercice === e)?.dividende;
  const rexo = (x, e, k) => res(x).find((d) => d.exercice === e)?.[k];
  const reg = (x) => { const k = div(x).filter((d) => ok(d.dividende)); return k.length ? `${k.filter((d) => d.dividende > 0).length}/${k.length}` : '—'; };
  const croiss = (x) => { const a = rexo(x, 2025, 'resultat_net'), b = rexo(x, 2024, 'resultat_net'); return ok(a) && ok(b) && b !== 0 ? (a - b) / Math.abs(b) : null; };
  const lq = (x) => x.g?.dimensions?.liquidite || {};
  const pct = (v) => F.spct(v, 1), p1 = (v) => F.pct(v, 1);
  const R = (lab, why, f, fmt, best = 0) => ({ lab, why, vals: sel.map((x) => f(x)), fmt, best });
  return { sel, sections: {
    vue: [
      R('Nom', '', (x) => x.t.nom, (v) => v),
      R('Secteur', '', (x) => x.t.secteur, (v) => v || '—'),
      R('Dernier cours (FCFA)', '', (x) => x.t.cours, F.n0),
      R('Date du cours', '', (x) => x.t.date_cours, (v) => F.date(v)),
      R('Variation du jour', '', (x) => x.t.var_seance, pct),
      R('Capitalisation (FCFA)', '', (x) => x.t.capitalisation, F.big),
      R('Volume du jour (titres)', '', (x) => x.t.volume_jour, F.n0),
      R('Valeur échangée du jour (FCFA)', '', (x) => x.t.valeur_jour, (v) => F.big(v)),
      R('Source du montant', '', (x) => x.t.valeur_jour_source, (v) => v || '—'),
      R('Diagnostic du jour', 'Catégorie de la rubrique Recommandations', (x) => x.g?.categorie, (v) => v || '—'),
      R('Qualité des données', '', (x) => x.t.qualite, (v) => v || '—'),
    ],
    perf: [
      R('1 semaine', '', (x) => x.t.perf_1s, pct, 1), R('1 mois', '', (x) => x.t.perf_1m, pct, 1), R('3 mois', '', (x) => x.t.perf_3m, pct, 1),
      R('6 mois', '', (x) => x.t.perf_6m, pct, 1), R('YTD', 'Depuis la première séance de l\'année', (x) => x.t.perf_ytd, pct, 1), R('1 an', '', (x) => x.t.perf_1a, pct, 1),
    ],
    div: [
      R('Dernier dividende net (FCFA)', 'Dividende de référence', (x) => x.t.dividende_ref, F.n2),
      R('Exercice', '', (x) => x.t.dividende_ref_exercice, (v) => v || '—'),
      R('Statut', 'payé, décidé ou aucun dividende', (x) => x.t.dividende_statut, (v) => v || '—'),
      R('Rendement historique', 'Dernier dividende / cours ; jamais un rendement prévisionnel', (x) => x.t.rendement, (v) => F.pct(v, 2), 1),
      R('Ex-cote', '', (x) => x.t.ex_cote, (v) => v ? F.date(v) : '—'),
      R('Paiement', '', (x) => x.t.date_valeur, (v) => v ? F.date(v) : '—'),
      ...ex.map((e) => R(`Dividende ${e}`, '', (x) => dexo(x, e), (v) => ok(v) ? F.n2(v) : '—')),
      R('Régularité 2022-2025', 'Exercices avec dividende / exercices connus', (x) => reg(x), (v) => v),
    ],
    liq: [
      R('Niveau', 'Valeur médiane échangée sur 6 mois : élevée ≥ 35 M FCFA, moyenne 10 à 35 M, faible < 10 M', (x) => lq(x).niveau, (v) => v || '—'),
      R('Valeur médiane par séance (FCFA)', 'Montant officiel quand il existe, sinon volume × cours', (x) => lq(x).valeur_mediane, F.big, 1),
      R('Séances avec transaction (3 mois)', '', (x) => x.l.part3, (v) => F.pct(v, 0), 1),
      R('Volume moyen 1 mois (titres)', '', (x) => x.l.vol1, F.n0, 1),
      R('Volume moyen 3 mois (titres)', '', (x) => x.l.vol3, F.n0, 1),
      R('Valeur moyenne 1 mois (FCFA, estimée)', 'Volume × cours de clôture', (x) => x.l.val1, F.big, 1),
      R('Valeur moyenne 3 mois (FCFA, estimée)', 'Volume × cours de clôture', (x) => x.l.val3, F.big, 1),
      R('Évolution 1 mois / 3 mois', 'Valeur moyenne du dernier mois comparée à celle des 3 derniers mois', (x) => ok(x.l.val1) && x.l.val3 ? x.l.val1 / x.l.val3 - 1 : null, pct),
    ],
    risk: [
      R('Volatilité 1 an', 'Amplitude annuelle des variations : plus elle est élevée, plus le cours bouge', (x) => x.t.vol_1a, p1, -1),
      R('Bêta (référence)', 'Sensibilité au BRVM Composite ; 1 = suit le marché', (x) => x.t.beta_1a, F.n2),
      R('Bêta corrigé (Dimson)', 'Complément pour les titres peu échangés', (x) => x.t.beta_dimson_1a, F.n2),
      R('Perte maximale 1 an', 'Plus forte baisse d\'un plus haut à un plus bas', (x) => x.t.max_dd_1a, p1, 1),
      R('Downside deviation', 'Risque de baisse seul', (x) => x.t.downside_dev_1a, p1, -1),
      R('Séances sans variation', 'Un niveau élevé signale un titre peu échangé', (x) => x.t.seances_inchangees, (v) => F.pct(v, 0), -1),
      R('Fiabilité des mesures', 'Peu fiable si plus de 30 % de séances sans variation ou moins de 120 rendements', (x) => x.t.risque_fiabilite, (v) => v || '—'),
    ],
    fond: [
      ...ex.map((e) => R(`Résultat net ${e} (FCFA)`, '', (x) => rexo(x, e, 'resultat_net'), F.big)),
      ...ex.map((e) => R(`BNPA ${e} (FCFA)`, '', (x) => rexo(x, e, 'bnpa'), F.n1)),
      R('Croissance du résultat 2025', 'Résultat net 2025 / 2024 − 1', (x) => croiss(x), pct, 1),
      R('Contrôle du BNPA', 'Comparaison au PER publié par le BOC', (x) => x.t.per_statut, (v) => v || '—'),
      R('Source', '', (x) => res(x).at(-1)?.source, (v) => (v ? String(v).split(' – ')[0] : '—')),
      R('Chiffre d\'affaires, ROE, marge, dette', 'États financiers non encore collectés', () => 'non disponible', (v) => v),
    ],
  } };
}
function cpTable(box, rows, sel) {
  const thead = el('thead', {}, el('tr', {}, el('th', {}, 'Indicateur'), ...sel.map((x) => el('th', {}, x.s))));
  const tb = el('tbody', {}, ...rows.map((r) => {
    const nums = r.vals.filter((v) => typeof v === 'number' && ok(v));
    const bestV = r.best && nums.length >= 2 ? (r.best > 0 ? d3.max(nums) : d3.min(nums)) : null;
    return el('tr', {}, el('td', {}, r.lab, r.why ? el('span', { class: 'why' }, r.why) : null),
      ...r.vals.map((v) => el('td', { class: ok(bestV) && v === bestV ? 'best' : '' }, ok(v) ? r.fmt(v) : '—')));
  }));
  box.replaceChildren(thead, tb);
}
function cpSynthese(sel) {
  const out = [];
  const name = (x) => `${x.t.nom} (${x.s})`;
  const ext = (f, dir) => { const a = sel.filter((x) => ok(f(x))); if (a.length < 2) return null; return a.reduce((m, x) => (dir * f(x) > dir * f(m) ? x : m)); };
  const b3 = ext((x) => x.t.perf_3m, 1); if (b3) out.push(`${name(b3)} affiche la meilleure performance sur 3 mois (${F.spct(b3.t.perf_3m, 1)}).`);
  const by = ext((x) => x.t.perf_ytd, 1); if (by && by !== b3) out.push(`Depuis le début de l'année, c'est ${name(by)} qui progresse le plus (${F.spct(by.t.perf_ytd, 1)}).`);
  const lv = ext((x) => x.g?.dimensions?.liquidite?.valeur_mediane, 1); if (lv) out.push(`${name(lv)} est le plus échangé (${F.big(lv.g.dimensions.liquidite.valeur_mediane)} FCFA par séance en médiane).`);
  const reg = sel.filter((x) => { const k = (x.h.dividendes || []).filter((d) => ok(d.dividende)); return k.length === 4 && k.every((d) => d.dividende > 0); });
  if (reg.length && reg.length < sel.length) out.push(`${reg.map(name).join(', ')} ${reg.length > 1 ? 'ont' : 'a'} versé un dividende chaque année de 2022 à 2025.`);
  else if (reg.length === sel.length) out.push('Tous ont versé un dividende chaque année de 2022 à 2025.');
  const rd = ext((x) => x.t.rendement, 1); if (rd) out.push(`Le rendement historique le plus élevé est celui de ${name(rd)} (${F.pct(rd.t.rendement, 2)}).`);
  const vh = ext((x) => x.t.vol_1a, 1), vl = ext((x) => x.t.vol_1a, -1);
  if (vh && vl && vh !== vl) out.push(`En revanche, ${name(vh)} est le plus volatil (${F.pct(vh.t.vol_1a, 0)} sur un an), ${name(vl)} le plus stable (${F.pct(vl.t.vol_1a, 0)}).`);
  const nf_ = sel.filter((x) => x.t.risque_fiabilite && x.t.risque_fiabilite !== 'fiable');
  if (nf_.length) out.push(`Mesures de risque peu fiables pour ${nf_.map((x) => x.s).join(', ')} : à interpréter avec prudence.`);
  if (sel.length === 2) { const c = cpCorrVal(sel[0].s, sel[1].s); if (ok(c)) out.push(c >= 0.5 ? `Les deux titres évoluent souvent ensemble (corrélation ${F.n2(c)}) : les détenir ensemble diversifie peu.` : c < 0.2 ? `Les deux titres évoluent de façon assez indépendante (corrélation ${F.n2(c)}) : ils se complètent dans un portefeuille.` : `Le lien entre les deux titres est modéré (corrélation ${F.n2(c)}).`); }
  if (CP.export) sel.forEach((x) => { const pr = cpProfil(x.t); if (pr.forts.length || pr.faibles.length) out.push(`${x.s} : ` + [pr.forts.length ? 'atout principal, ' + pr.forts[0].ax.lab.toLowerCase() + ` (${pr.forts[0].p}e sur 100 dans le marché)` : '', pr.faibles.length ? 'point faible, ' + pr.faibles[0].ax.lab.toLowerCase() + ` (${pr.faibles[0].p}e sur 100)` : ''].filter(Boolean).join(' ; ') + '.'); });
  const secs = [...new Set(sel.map((x) => x.t.secteur))];
  out.push(secs.length === 1 ? `Les titres appartiennent tous au secteur ${secs[0]} : la comparaison porte sur des activités proches.` : `Les titres relèvent de ${secs.length} secteurs différents : les écarts reflètent aussi la nature de leurs activités.`);
  out.push('Aucun titre n\'est désigné comme gagnant : chacun présente des points forts et des points faibles selon le critère retenu.');
  return out;
}
function cpChart(sel) {
  const i0 = startIdx(CP.per);
  const idxs = d3.range(i0, DATES.length).filter((i) => sel.every((x) => ok(series(x.s)[i])));
  if (idxs.length < 2) return empty($('#cp-chart'), 'Pas de dates communes à tous les titres sur cette période');
  const pal = palette();
  const ser = sel.map((x, k) => { const v = idxs.map((i) => series(x.s)[i]); return { n: x.s, c: pal[k % pal.length], v: v.map((y) => y / v[0] * 100), d: idxs.map((i) => DATES[i]) }; });
  lineChart($('#cp-chart'), ser, { fy: (v) => F.n0(v), ref: 100, h: 300, legend: true });
}
// ---- Comparateur parlant : profil dans le marché, verdicts, graphiques
const cpCol = (k) => palette()[k % 7];
const cpRN = (s, e) => (cpHist(s).resultats || []).find((r) => r.exercice === e)?.resultat_net;
const cpCroiss = (s) => { const a = cpRN(s, 2025), b = cpRN(s, 2024); return ok(a) && ok(b) && b !== 0 ? (a - b) / Math.abs(b) : null; };
const cpLiqMed = (t) => { const v = cpDiag(t.symbole)?.dimensions?.liquidite?.valeur_mediane; return ok(v) ? v : null; };
const CP_AX = [
  { k: 'perf', lab: 'Performance 1 an', f: (t) => t.perf_1a, dir: 1, fort: 'Forte hausse sur 1 an', faible: 'En retard sur 1 an', fmt: (v) => F.spct(v, 1) },
  { k: 'dyn', lab: 'Dynamique 3 mois', f: (t) => t.perf_3m, dir: 1, fort: 'Dynamique récente forte', faible: 'Dynamique récente faible', fmt: (v) => F.spct(v, 1) },
  { k: 'stab', lab: 'Stabilité', f: (t) => t.vol_1a, dir: -1, fort: 'Cours stable', faible: 'Cours très volatil', fmt: (v) => 'volatilité ' + F.pct(v, 0) },
  { k: 'liq', lab: 'Liquidité', f: cpLiqMed, dir: 1, fort: 'Très liquide', faible: 'Peu liquide', fmt: (v) => F.big(v) + ' FCFA/séance' },
  { k: 'div', lab: 'Rendement du dividende', f: (t) => t.rendement, dir: 1, fort: 'Rendement élevé', faible: 'Rendement faible', fmt: (v) => F.pct(v, 2) },
  { k: 'rn', lab: 'Croissance des résultats', f: (t) => cpCroiss(t.symbole), dir: 1, fort: 'Résultats en forte hausse', faible: 'Résultats en recul', fmt: (v) => F.spct(v, 1) + ' en 2025' },
];
function cpPctile(ax, t) {
  const v = ax.f(t);
  if (!ok(v)) return null;
  const all = TIT.map(ax.f).filter(ok);
  if (all.length < 5) return null;
  const below = all.filter((x) => ax.dir * x < ax.dir * v).length, eq = all.filter((x) => x === v).length;
  return Math.round((below + (eq - 1) / 2) / (all.length - 1) * 100);
}
function cpProfil(t) {
  const p = CP_AX.map((ax) => ({ ax, p: cpPctile(ax, t), v: ax.f(t) }));
  const forts = p.filter((x) => ok(x.p) && x.p >= 80).sort((a, b) => b.p - a.p);
  const faibles = p.filter((x) => ok(x.p) && x.p <= 20).sort((a, b) => a.p - b.p);
  return { p, forts, faibles };
}
function cpCards(sel) {
  $('#cp-cards').replaceChildren(...sel.map((x, k) => {
    const t = x.t, pr = cpProfil(t);
    const s1 = series(x.s).slice(startIdx('1A'));
    const phr = [];
    if (pr.forts.length) phr.push('Se distingue par : ' + pr.forts.slice(0, 2).map((f) => f.ax.lab.toLowerCase() + ` (${f.p}e sur 100)`).join(', ') + '.');
    if (pr.faibles.length) phr.push('Point faible : ' + pr.faibles[0].ax.lab.toLowerCase() + ` (${pr.faibles[0].p}e sur 100).`);
    if (!phr.length) phr.push('Profil dans la moyenne du marché sur les six critères.');
    return el('div', { class: 'cp-card', style: `--cc:${cpCol(k)}` },
      el('div', { class: 'hd' }, el('span', { class: 'sym' }, x.s), x.g ? catPill(x.g.categorie) : null),
      el('div', { class: 'nm' }, `${t.nom} · ${t.secteur || ''}`),
      el('div', { class: 'px' }, F.n0(t.cours), el('small', { class: cls(t.var_seance) }, F.spct(t.var_seance))),
      el('div', { class: 'row' }, el('span', {}, 'YTD ', el('b', { class: cls(t.perf_ytd) }, F.spct(t.perf_ytd, 1))), el('span', {}, '1 an ', el('b', {}, F.spct(t.perf_1a, 1))), el('span', {}, 'Capi. ', el('b', {}, F.big(t.capitalisation)))),
      spark(s1, 220, 34, cpCol(k)),
      el('div', { class: 'tags' }, ...pr.forts.slice(0, 3).map((f) => el('span', { class: 'tg fort', title: `${f.ax.lab} : ${f.ax.fmt(f.v)}` }, '▲ ' + f.ax.fort)),
        ...pr.faibles.slice(0, 2).map((f) => el('span', { class: 'tg faible', title: `${f.ax.lab} : ${f.ax.fmt(f.v)}` }, '▼ ' + f.ax.faible))),
      el('div', { class: 'profil' }, phr.join(' ')));
  }));
}
function cpRadar(sel) {
  const box = $('#cp-radar'), h = 380;
  const { svg, w } = svgIn(box, h);
  const court = w < 520, SH = ['Perf. 1 an', 'Dyn. 3 mois', 'Stabilité', 'Liquidité', 'Dividende', 'Résultats'];
  const cx = w / 2, cy = h / 2 + 4, R = Math.min(w / 2 - (court ? 62 : 90), h / 2 - 34), n = CP_AX.length;
  const ang = (i) => -Math.PI / 2 + i * 2 * Math.PI / n;
  const pt = (i, v) => [cx + Math.cos(ang(i)) * R * v / 100, cy + Math.sin(ang(i)) * R * v / 100];
  [25, 50, 75, 100].forEach((g) => svg.append('polygon').attr('points', d3.range(n).map((i) => pt(i, g).join(',')).join(' ')).attr('fill', 'none').attr('stroke', css('--grid')));
  svg.append('text').attr('x', cx + 3).attr('y', cy - R * 0.5 + 3).attr('class', 'lbl').style('font-size', '10px').style('fill', css('--faint')).text('50');
  CP_AX.forEach((ax, i) => {
    svg.append('line').attr('x1', cx).attr('y1', cy).attr('x2', pt(i, 100)[0]).attr('y2', pt(i, 100)[1]).attr('stroke', css('--grid'));
    const [lx, ly] = pt(i, 118);
    svg.append('text').attr('x', lx).attr('y', ly + 4).attr('text-anchor', Math.abs(lx - cx) < 10 ? 'middle' : lx > cx ? 'start' : 'end').style('font-size', court ? '11px' : '12px').style('fill', css('--fg')).text(court ? SH[i] : ax.lab);
  });
  const nd = [];
  sel.forEach((x, k) => {
    const pr = cpProfil(x.t).p, c = cpCol(k);
    const pts = pr.map((q, i) => (ok(q.p) ? pt(i, Math.max(q.p, 2)) : null));
    pr.forEach((q) => { if (!ok(q.p)) nd.push(`${x.s} : ${q.ax.lab.toLowerCase()} non disponible`); });
    const okp = pts.filter(Boolean);
    svg.append('polygon').attr('points', okp.map((p) => p.join(',')).join(' ')).attr('fill', c).attr('fill-opacity', 0.1).attr('stroke', c).attr('stroke-width', 2);
    pr.forEach((q, i) => { if (!ok(q.p)) return; const [px, py] = pts[i];
      svg.append('circle').attr('cx', px).attr('cy', py).attr('r', 4).attr('fill', c)
        .on('mousemove', (ev) => showTip(ev, `${x.s} · ${q.ax.lab}`, [{ c, t: `${q.p}e sur 100 dans le marché` }, { t: q.ax.fmt(q.v) }])).on('mouseleave', hideTip); });
  });
  $('#cp-radar-leg').replaceChildren(...sel.map((x, k) => el('span', {}, el('i', { style: `background:${cpCol(k)}` }), x.s)),
    ...(nd.length ? [el('span', { class: 'note' }, ' · ' + nd.join(' ; '))] : []));
}
function cpVerdict(sel) {
  const C = [...CP_AX.map((ax) => ({ lab: ax.lab, f: (x) => ax.f(x.t), dir: ax.dir, fmt: ax.fmt })),
    { lab: 'Perte maximale 1 an', f: (x) => x.t.max_dd_1a, dir: 1, fmt: (v) => F.pct(v, 1) },
    { lab: 'Régularité du dividende', f: (x) => { const k = (x.h.dividendes || []).filter((d) => ok(d.dividende)); return k.length ? k.filter((d) => d.dividende > 0).length / k.length : null; }, dir: 1, fmt: (v) => F.pct(v, 0) + ' des exercices' }];
  $('#cp-verdict').replaceChildren(...C.map((c) => {
    const a = sel.map((x, k) => ({ x, k, v: c.f(x) })).filter((y) => ok(y.v)).sort((p, q) => c.dir * (q.v - p.v));
    if (a.length < 2) return el('div', { class: 'vd' }, el('span', { class: 'k' }, c.lab), el('span', { class: 'w note' }, 'données insuffisantes pour départager'));
    const [w1, w2] = a, egal = w1.v === w2.v;
    return el('div', { class: 'vd' }, el('span', { class: 'k' }, c.lab),
      el('span', { class: 'w' }, el('i', { class: 'dot', style: `background:${cpCol(w1.k)}` }), el('b', {}, egal ? 'Égalité' : w1.x.s), c.fmt(w1.v),
        el('span', { class: 'gap' }, egal ? '' : `devant ${w2.x.s} (${c.fmt(w2.v)})`)));
  }));
}
function cpPerfBars(sel) {
  const box = $('#cp-perfbars'), h = 300;
  const per = [['perf_1m', '1 mois'], ['perf_3m', '3 mois'], ['perf_6m', '6 mois'], ['perf_ytd', 'YTD'], ['perf_1a', '1 an']];
  const comp = D.indices.find((i) => i.indice === 'BRVM Composite') || {};
  const vals = per.flatMap(([k]) => [...sel.map((x) => x.t[k]), comp[k]]).filter(ok);
  if (!vals.length) return empty(box, 'Pas de données');
  const { svg, w } = svgIn(box, h);
  const y = d3.scaleLinear([Math.min(0, d3.min(vals)), Math.max(0, d3.max(vals))], [h - 24, 10]).nice();
  const ml = d3.max(y.ticks(5), (t) => tw(svg, F.pct(t, 0))) + 12;
  const x0 = d3.scaleBand(per.map((p) => p[1]), [ml, w - 6]).paddingInner(0.25), x1 = d3.scaleBand(sel.map((x) => x.s), [0, x0.bandwidth()]).padding(0.08);
  svg.append('g').attr('class', 'grid').attr('transform', `translate(${ml - 4},0)`).call(d3.axisLeft(y).ticks(5).tickFormat((v) => F.pct(v, 0)).tickSize(-(w - ml)));
  svg.append('g').attr('transform', `translate(0,${h - 20})`).call(d3.axisBottom(x0).tickSize(0));
  svg.append('line').attr('x1', ml).attr('x2', w - 6).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', css('--muted-line'));
  per.forEach(([k, lab]) => {
    const g = svg.append('g').attr('transform', `translate(${x0(lab)},0)`);
    sel.forEach((x, i) => { const v = x.t[k]; if (!ok(v)) return;
      g.append('rect').attr('x', x1(x.s)).attr('width', x1.bandwidth()).attr('y', Math.min(y(v), y(0))).attr('height', Math.abs(y(v) - y(0))).attr('fill', cpCol(i)).attr('rx', 2)
        .on('mousemove', (ev) => showTip(ev, `${x.s} · ${lab}`, [{ c: cpCol(i), t: F.spct(v, 1) }, { t: `BRVM Composite : ${F.spct(comp[k], 1)}` }])).on('mouseleave', hideTip); });
    if (ok(comp[k])) g.append('line').attr('x1', -3).attr('x2', x0.bandwidth() + 3).attr('y1', y(comp[k])).attr('y2', y(comp[k])).attr('stroke', css('--fg')).attr('stroke-width', 2).attr('stroke-dasharray', '3 2');
  });
}
function cpDrawdown(sel) {
  // capture des hausses et des baisses : rendement quotidien moyen du titre selon le sens du BRVM Composite (1 an)
  const box = $('#cp-dd'), h = 300;
  const i0 = Math.max(1, startIdx('1A')), C = series('BRVM Composite');
  const cats = [['up', 'Jours de hausse du marché'], ['down', 'Jours de baisse du marché']];
  const stats = sel.map((x) => { const s = series(x.s), u = [], d = [];
    for (let i = i0; i < DATES.length; i++) { const a = s[i], b = s[i - 1], ca = C[i], cb = C[i - 1]; if (!ok(a) || !ok(b) || !ok(ca) || !ok(cb) || cb === ca) continue; (ca > cb ? u : d).push(a / b - 1); }
    return { x, up: u.length ? d3.mean(u) : null, down: d.length ? d3.mean(d) : null, nu: u.length, nd: d.length }; });
  const cu = [], cd = [];
  for (let i = i0; i < DATES.length; i++) { const ca = C[i], cb = C[i - 1]; if (ok(ca) && ok(cb) && ca !== cb) (ca > cb ? cu : cd).push(ca / cb - 1); }
  const ref = { up: d3.mean(cu), down: d3.mean(cd) };
  const vals = stats.flatMap((r) => [r.up, r.down]).concat([ref.up, ref.down]).filter(ok);
  if (!vals.length) return empty(box, 'Pas de données');
  const { svg, w } = svgIn(box, h);
  const y = d3.scaleLinear([Math.min(0, d3.min(vals)), Math.max(0, d3.max(vals))], [h - 24, 12]).nice();
  const ml = d3.max(y.ticks(5), (t) => tw(svg, F.spct(t, 2))) + 12;
  const x0 = d3.scaleBand(cats.map((c) => c[1]), [ml, w - 6]).paddingInner(0.3), x1 = d3.scaleBand(sel.map((x) => x.s), [0, x0.bandwidth()]).padding(0.1);
  svg.append('g').attr('class', 'grid').attr('transform', `translate(${ml - 4},0)`).call(d3.axisLeft(y).ticks(5).tickFormat((v) => F.spct(v, 2)).tickSize(-(w - ml)));
  svg.append('g').attr('transform', `translate(0,${h - 20})`).call(d3.axisBottom(x0).tickSize(0));
  svg.append('line').attr('x1', ml).attr('x2', w - 6).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', css('--muted-line'));
  cats.forEach(([k, lab]) => {
    const g = svg.append('g').attr('transform', `translate(${x0(lab)},0)`);
    stats.forEach((r, i) => { const v = r[k]; if (!ok(v)) return;
      g.append('rect').attr('x', x1(r.x.s)).attr('width', x1.bandwidth()).attr('y', Math.min(y(v), y(0))).attr('height', Math.abs(y(v) - y(0))).attr('fill', cpCol(i)).attr('rx', 2)
        .on('mousemove', (ev) => showTip(ev, `${r.x.s} · ${lab.toLowerCase()}`, [{ c: cpCol(i), t: `variation moyenne ${F.spct(v, 2)} par séance` }, { t: `BRVM Composite : ${F.spct(ref[k], 2)} · ${k === 'up' ? r.nu : r.nd} séances` }])).on('mouseleave', hideTip); });
    if (ok(ref[k])) g.append('line').attr('x1', -3).attr('x2', x0.bandwidth() + 3).attr('y1', y(ref[k])).attr('y2', y(ref[k])).attr('stroke', css('--fg')).attr('stroke-width', 2).attr('stroke-dasharray', '3 2');
  });
}
const cpCorrVal = (a, b) => { const C = D.correlations || {}; const i = (C.symboles || []).indexOf(a), j = (C.symboles || []).indexOf(b); return i >= 0 && j >= 0 ? C.matrice[i][j] : null; };
function cpCorr(sel) {
  const pairs = [];
  for (let i = 0; i < sel.length; i++) for (let j = i + 1; j < sel.length; j++) pairs.push([sel[i], sel[j], cpCorrVal(sel[i].s, sel[j].s)]);
  const txt = (c) => !ok(c) ? 'non calculée' : c >= 0.5 ? 'évoluent souvent ensemble : peu de diversification' : c >= 0.2 ? 'lien modéré' : c > -0.2 ? 'évoluent indépendamment : bonne diversification' : 'tendent à évoluer en sens inverse';
  $('#cp-corr').replaceChildren(el('div', { class: 'cpc' }, ...pairs.flatMap(([a, b, c]) => [
    el('div', { class: 'pr' }, el('b', {}, `${a.s} – ${b.s}`), el('div', { class: 'bar' }, el('i', { style: `width:${ok(c) ? Math.max(2, Math.abs(c) * 100) : 0}%;${ok(c) && c < 0 ? 'background:var(--down)' : ''}` })), el('span', { style: 'font-family:var(--mono);text-align:right' }, ok(c) ? F.n2(c) : '—')),
    el('div', { class: 'txt' }, txt(c))])));
}
function cpDivViz(sel) {
  const ex = [2022, 2023, 2024, 2025];
  $('#cp-divviz').replaceChildren(el('div', { class: 'dvz' },
    el('div', { class: 'ln' }, el('span', {}), ...ex.map((e) => el('span', { class: 'yr note' }, String(e))), el('span', { class: 'note', style: 'text-align:right' }, 'Rdt hist.')),
    ...sel.map((x, k) => {
      const d = ex.map((e) => (x.h.dividendes || []).find((q) => q.exercice === e)?.dividende);
      const mx = d3.max(d.filter(ok)) || 1;
      return el('div', { class: 'ln', style: `--cc:${cpCol(k)}` }, el('b', { style: `color:${cpCol(k)}` }, x.s),
        ...d.map((v) => !ok(v) ? el('div', { class: 'nd' }, 'n.d.') : v === 0 ? el('div', { class: 'nd' }, 'aucun')
          : el('div', {}, el('div', { class: 'b', style: `height:${Math.round(8 + 42 * v / mx)}px` }), el('div', { class: 'v' }, F.n0(v)))),
        el('span', { class: 'rd' }, F.pct(x.t.rendement, 2)));
    })));
}
function cpRnLiq(sel) {
  const ex = [2022, 2023, 2024, 2025], dd = ex.map((e) => new Date(Date.UTC(e, 0, 1)));
  const ser = sel.map((x, k) => { const b = cpRN(x.s, 2022); return { n: x.s, c: cpCol(k), v: ex.map((e) => (ok(b) && b > 0 && ok(cpRN(x.s, e)) ? cpRN(x.s, e) / b * 100 : null)), d: dd }; })
    .filter((s) => s.v.some(ok));
  if (ser.length) lineChart($('#cp-rn'), ser, { fy: (v) => F.n0(v), ref: 100, h: 200, fx: (d) => 'Exercice ' + d.getUTCFullYear(), xvals: dd }); else empty($('#cp-rn'), 'Résultats non disponibles');
  const box = $('#cp-liqbars'), h = 150;
  const vals = sel.map((x) => cpLiqMed(x.t));
  if (!vals.some(ok)) return empty(box, 'Liquidité non disponible');
  const { svg, w } = svgIn(box, h);
  const ml = 56, x = d3.scaleLinear([0, Math.max(40e6, d3.max(vals.filter(ok)) * 1.08)], [ml, w - 70]);
  const bh = Math.min(22, (h - 30) / sel.length - 6);
  [[10e6, '10 M'], [35e6, '35 M']].forEach(([v, l]) => { svg.append('line').attr('x1', x(v)).attr('x2', x(v)).attr('y1', 4).attr('y2', h - 18).attr('stroke', css('--muted-line')).attr('stroke-dasharray', '4 3');
    svg.append('text').attr('x', x(v)).attr('y', h - 4).attr('text-anchor', 'middle').style('font-size', '10px').style('fill', css('--faint')).text(l); });
  sel.forEach((s, k) => { const v = vals[k], yy = 6 + k * (bh + 8);
    svg.append('text').attr('x', 0).attr('y', yy + bh / 2 + 4).style('font-weight', 700).style('fill', cpCol(k)).text(s.s);
    if (!ok(v)) { svg.append('text').attr('x', ml).attr('y', yy + bh / 2 + 4).style('fill', css('--faint')).text('données insuffisantes'); return; }
    svg.append('rect').attr('x', ml).attr('y', yy).attr('width', Math.max(2, x(v) - ml)).attr('height', bh).attr('rx', 3).attr('fill', cpCol(k));
    svg.append('text').attr('x', x(v) + 6).attr('y', yy + bh / 2 + 4).style('font-family', 'var(--mono)').style('font-size', '11px').text(F.big(v)); });
}

function comparer() {
  const q = $('#cp-q');
  if (!$('#cp-list').options.length) {
    $('#cp-list').replaceChildren(...TIT.slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((t) => el('option', { value: `${t.symbole} – ${t.nom}` })));
    const add = () => { const v = q.value.trim().toUpperCase(); const s = (TIT.find((t) => v.startsWith(t.symbole + ' ')) || TIT.find((t) => t.symbole === v) || TIT.find((t) => t.nom.toUpperCase().includes(v)) || {}).symbole;
      q.value = ''; if (s && CP.sel.length < CP_MAX) cpSet([...CP.sel, s]); };
    $('#cp-add').onclick = add;
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    q.addEventListener('change', () => { if (/ – /.test(q.value)) add(); });
    $('#cp-reset').onclick = () => cpSet([]);
    $('#cp-print').onclick = () => { $('#cp-print-date').textContent = `séance du ${F.date(D.resume.seance)} · données www.brvm.org et Bulletin Officiel de la Cote`; document.body.classList.add('print-cp'); print(); };
    addEventListener('afterprint', () => document.body.classList.remove('print-cp'));
    $('#cp-xlsx').onclick = cpExcel;
    $('#cp-rk').onclick = () => { RK.hl = new Set(CP.sel); S.sx = 'vol_1a'; S.sy = 'perf_1a'; showTab('risque'); if ($('#sx').options.length) { $('#sx').value = S.sx; $('#sy').value = S.sy; } scatter(); };
    seg($('#cp-per'), PERIODS, CP.per, (v) => { CP.per = v; cpChart(cpSections().sel); });
  }
  q.disabled = CP.sel.length >= CP_MAX;
  q.placeholder = CP.sel.length >= CP_MAX ? '4 titres au maximum' : 'Nom ou symbole…';
  $('#cp-sel').replaceChildren(...CP.sel.map((s) => el('span', { class: 'chip on' }, el('b', {}, s), cpT(s).nom,
    el('button', { title: 'Retirer', 'aria-label': 'Retirer ' + s, onclick: () => cpSet(CP.sel.filter((x) => x !== s)) }, '×'))));
  const top = cpTop().filter((s) => !CP.sel.includes(s));
  $('#cp-sugg').replaceChildren(top.length && CP.sel.length < CP_MAX ? 'Raccourcis (titres les plus échangés sur 1 mois) : ' : '',
    ...(CP.sel.length < CP_MAX ? top : []).map((s) => el('button', { class: 'chip cp-sugg-b', onclick: () => cpSet([...CP.sel, s]) }, '+ ' + s)));
  const ref = CP.sel[0] && cpT(CP.sel[0]);
  $('#cp-sect').hidden = !ref;
  if (ref) { $('#cp-sect').textContent = `Comparer ${ref.symbole} avec son secteur (${ref.secteur})`; $('#cp-sect').onclick = () => cpSet(cpPairs(ref.symbole)); }
  const secs = [...new Set(CP.sel.map((s0) => cpT(s0).secteur))];
  $('#cp-mix').hidden = secs.length < 2 || CP.sel.length < 2;
  $('#cp-mix').replaceChildren(el('b', {}, `Titres de secteurs différents (${secs.join(', ')}).`), ` Comparez surtout la performance, le risque, la liquidité et le dividende. `
    + 'Les fondamentaux ne sont pas directement comparables entre secteurs : seule l\'évolution propre à chaque société a un sens.');
  const ready = CP.sel.length >= 2;
  $('#cp-body').hidden = !ready;
  $('#cp-print').disabled = $('#cp-xlsx').disabled = !ready;
  if (!ready) return;
  const { sel, sections } = cpSections();
  $('#cp-synth').replaceChildren(...cpSynthese(sel).map((t) => el('li', {}, t)));
  cpTable($('#cp-vue'), sections.vue, sel);
  cpTable($('#cp-perf'), sections.perf, sel);
  cpTable($('#cp-div'), sections.div, sel);
  cpTable($('#cp-liq'), sections.liq, sel);
  cpTable($('#cp-risk'), sections.risk, sel);
  cpTable($('#cp-fond'), sections.fond, sel);
  cpChart(sel);
  cpCards(sel); cpRadar(sel); cpVerdict(sel); cpPerfBars(sel); cpDrawdown(sel); cpCorr(sel); cpDivViz(sel); cpRnLiq(sel);
  $('#cp-notes').textContent = `Données de la séance du ${F.date(D.resume.seance)}. Sources : cours, volumes et montants publiés par la BRVM (www.brvm.org, Bulletin Officiel de la Cote) ; `
    + 'résultats et dividendes 2022-2025 du référentiel CGF Bourse, ajustés des opérations sur titres. En gras : la meilleure valeur de la ligne quand le classement a un sens. '
    + 'Performances calculées sur les cours, hors dividendes. Les volumes ne sont collectés que depuis juillet 2026. '
    + 'Cette comparaison est descriptive : elle ne constitue ni un conseil en investissement ni une garantie de performance future.';
}
function cpExcel() {
  const go = () => {
    const { sel, sections } = cpSections();
    const wb = XLSX.utils.book_new();
    const sheet = (rows) => [['Indicateur', ...sel.map((x) => x.s)], ...rows.map((r) => [r.lab, ...r.vals.map((v) => (ok(v) ? v : null))])];
    const add = (name, aoa) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 38 }, ...sel.map(() => ({ wch: 18 }))]; XLSX.utils.book_append_sheet(wb, ws, name); };
    CP.export = true; const syn = cpSynthese(sel); CP.export = false;
    add('Synthèse', [['Fiche comparative Daily BRVM – CGF Bourse'], [`Séance du ${D.resume.seance}`], [], ...syn.map((t) => [t])]);
    add('Profil dans le marché', [['Critère (rang sur 100 parmi les titres cotés)', ...sel.map((x) => x.s)], ...CP_AX.map((ax) => [ax.lab, ...sel.map((x) => cpPctile(ax, x.t))])]);
    add('Vue d\'ensemble', sheet(sections.vue));
    add('Performances', sheet(sections.perf));
    add('Dividendes', sheet(sections.div));
    add('Liquidité', sheet(sections.liq));
    add('Risque', sheet(sections.risk));
    add('Fondamentaux', sheet(sections.fond));
    const i0 = startIdx(CP.per);
    const idxs = d3.range(i0, DATES.length).filter((i) => sel.every((x) => ok(series(x.s)[i])));
    add('Cours (base 100)', [['Date', ...sel.map((x) => x.s)], ...idxs.map((i) => [P.dates[i], ...sel.map((x) => +(series(x.s)[i] / series(x.s)[idxs[0]] * 100).toFixed(2))])]);
    add('Notes', [['Sources et avertissements'], [$('#cp-notes').textContent], [], ['Pourcentages exprimés en décimales (0,05 = 5 %).']]);
    XLSX.writeFile(wb, `Comparateur_BRVM_${sel.map((x) => x.s).join('_')}_${D.resume.seance}.xlsx`);
  };
  if (window.XLSX) return go();
  const sc = document.createElement('script');
  sc.src = 'vendor/sheetjs/xlsx.mini.min.js';
  sc.onload = go;
  sc.onerror = () => { $('#cp-notes').textContent = 'Export Excel indisponible : la bibliothèque n\'a pas pu être chargée.'; };
  document.head.append(sc);
}

// ------------------------------------------------------------------ SCREENER
// ------------------------------------------------------------------ SCREENER v2 (lot 8)
// Filtres structurés par catégorie, vues prédéfinies (filtres, jamais des recommandations), colonnes personnalisables,
// tri multicritère, sélection de 2 à 4 titres pour le Comparateur, fiche d'analyse, surveillance de titres.
// Qualité des données et signal analytique sont deux colonnes distinctes. Aucune donnée manquante n'est traitée comme nulle.
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible : sans effet */ } };
function scBase() {
  const H = D.historique_titres || {}, G = new Map((D.diagnostic?.titres || []).map((x) => [x.symbole, x]));
  const i3 = (() => { if (!V.dates.length) return 0; const a = new Date(V.dates.at(-1) + 'T00:00:00Z'); a.setUTCMonth(a.getUTCMonth() - 3); const s0 = a.toISOString().slice(0, 10); return V.dates.findIndex((d) => d > s0); })();
  return TIT.map((t) => {
    const g = G.get(t.symbole), lq = g?.dimensions?.liquidite || {};
    const vs = (V.series[t.symbole] || []).slice(Math.max(0, i3)).filter(ok);
    const dv = (H[t.symbole]?.dividendes || []).filter((x) => ok(x.dividende));
    return { ...t, pays: paysDe(t.symbole), liq_med: ok(lq.valeur_mediane) ? lq.valeur_mediane : null, part_tx: ok(lq.part_transactions) ? lq.part_transactions : null,
      vol_moy_3m: vs.length >= 20 ? d3.mean(vs) : null, reg: dv.length >= 3 ? dv.filter((x) => x.dividende > 0).length : null, reg_n: dv.length, cat: g?.categorie || 'Analyse indisponible' };
  });
}
const SC_F = [
  ['Identification', [['q', 'Société ou symbole', 'text'], ['secteur', 'Secteur', 'sel'], ['pays', 'Pays', 'sel']]],
  ['Performance', [['perf_1m', '1 mois (%)', 'pct'], ['perf_3m', '3 mois (%)', 'pct'], ['perf_6m', '6 mois (%)', 'pct'], ['perf_ytd', 'YTD (%)', 'pct'], ['perf_1a', '1 an (%)', 'pct']]],
  ['Liquidité', [['vol_moy_3m', 'Volume moyen 3 mois (titres)', 'num'], ['liq_med', 'Valeur médiane / séance (M FCFA)', 'mio'], ['part_tx', 'Séances avec transaction (%)', 'pct']]],
  ['Risque', [['vol_1a', 'Volatilité 1 an (%)', 'pct'], ['beta_1a', 'Bêta 1 an', 'num'], ['max_dd_1a', 'Perte max. 1 an (%)', 'pct'], ['fiab', 'Mesures de risque fiables seulement', 'chk']]],
  ['Dividendes', [['rendement', 'Rendement historique (%)', 'pct'], ['reg', 'Exercices avec dividende (sur 4)', 'num']]],
  ['Fondamentaux, qualité et signal', [['per', 'PER', 'num'], ['na', 'ROE, marge nette, endettement : non disponibles (états financiers non collectés)', 'na'], ['qualite', 'Qualité des données', 'sel'], ['cat', 'Signal analytique', 'sel']]],
];
const SC_COLS = [
  ['symbole', 'Symbole', 'Identification', 1], ['nom', 'Société', 'Identification', 1], ['secteur', 'Secteur', 'Identification', 1], ['pays', 'Pays', 'Identification', 0],
  ['cours', 'Cours', 'Cotation', 1], ['date_cours', 'Dernière cotation', 'Cotation', 0], ['var_seance', 'Jour', 'Cotation', 1],
  ['perf_1m', '1 mois', 'Performance', 0], ['perf_3m', '3 mois', 'Performance', 0], ['perf_6m', '6 mois', 'Performance', 0], ['perf_ytd', 'YTD', 'Performance', 1], ['perf_1a', '1 an', 'Performance', 1],
  ['vol_moy_3m', 'Volume moy. 3 m', 'Liquidité', 0], ['liq_med', 'Valeur méd./séance', 'Liquidité', 1], ['part_tx', 'Séances échangées', 'Liquidité', 0],
  ['vol_1a', 'Volatilité', 'Risque', 1], ['beta_1a', 'Bêta', 'Risque', 0], ['max_dd_1a', 'Perte max.', 'Risque', 0],
  ['rendement', 'Rdt hist.', 'Dividendes', 1], ['reg', 'Régularité', 'Dividendes', 0], ['per', 'PER', 'Fondamentaux', 0], ['capitalisation', 'Capitalisation', 'Fondamentaux', 1],
  ['qualite', 'Qualité des données', 'Qualité et signal', 1], ['cat', 'Signal analytique', 'Qualité et signal', 1], ['spark', 'Cours 3 mois', 'Qualité et signal', 1],
];
const SC_FMT = { cours: F.n0, date_cours: (v) => (v ? v.split('-').reverse().join('/') : '—'), var_seance: (v) => F.spct(v), perf_1m: (v) => F.spct(v, 1), perf_3m: (v) => F.spct(v, 1), perf_6m: (v) => F.spct(v, 1),
  perf_ytd: (v) => F.spct(v, 1), perf_1a: (v) => F.spct(v, 1), vol_moy_3m: F.n0, liq_med: F.big, part_tx: (v) => F.pct(v, 0), vol_1a: (v) => F.pct(v, 0), beta_1a: F.n2, max_dd_1a: (v) => F.pct(v, 0),
  rendement: (v) => F.pct(v, 2), reg: (v) => (ok(v) ? `${v} / 4` : '—'), per: F.n1, capitalisation: F.big };
const SC_SIGNED = new Set(['var_seance', 'perf_1m', 'perf_3m', 'perf_6m', 'perf_ytd', 'perf_1a']);
const SC = { f: {}, preset: '', sort: [{ k: 'capitalisation', dir: -1 }], sel: new Set(), cols: null };
const SC_PRESETS = [
  ['perf', 'Quelles actions ont le plus monté ?', 'Les actions en hausse sur 1 an, de la plus forte hausse à la plus faible.', { 'perf_1a:min': 0 }, [{ k: 'perf_1a', dir: -1 }]],
  ['liq', 'Lesquelles s\'échangent le plus ?', 'Au moins 10 M FCFA échangés lors d\'une séance typique : plus faciles à acheter ou à vendre.', { 'liq_med:min': 10 }, [{ k: 'liq_med', dir: -1 }]],
  ['div', 'Lesquelles versent de bons dividendes ?', 'Dividende d\'au moins 5 % du cours, versé chacune des 4 dernières années.', { 'rendement:min': 5, 'reg:min': 4 }, [{ k: 'rendement', dir: -1 }]],
  ['calme', 'Lesquelles bougent le moins ?', 'Cours les plus stables sur 1 an (volatilité de 30 % au plus), mesure fiable.', { 'vol_1a:max': 30, fiab: true }, [{ k: 'vol_1a', dir: 1 }]],
  ['surv', 'Lesquelles surveiller ?', 'Actions classées « À surveiller » par le diagnostic de l\'onglet Recommandations.', { cat: 'À surveiller' }, [{ k: 'capitalisation', dir: -1 }]],
];
// filtres simples : chaque menu règle une ou plusieurs clés des filtres avancés
const SC_SIMPLE = [
  ['secteur', 'Secteur', null],
  ['pays', 'Pays', null],
  ['evo', 'Évolution sur 1 an', [['Toutes', {}], ['En hausse', { 'perf_1a:min': 0 }], ['Hausse de plus de 20 %', { 'perf_1a:min': 20 }], ['Hausse de plus de 50 %', { 'perf_1a:min': 50 }], ['En baisse', { 'perf_1a:max': 0 }]]],
  ['dv', 'Dividende', [['Tous', {}], ['Verse un dividende', { 'rendement:min': 0.01 }], ['Rendement de 5 % ou plus', { 'rendement:min': 5 }], ['Rendement de 8 % ou plus', { 'rendement:min': 8 }]]],
  ['ech', 'Échanges par séance', [['Tous', {}], ['Au moins 1 M FCFA', { 'liq_med:min': 1 }], ['Au moins 10 M FCFA', { 'liq_med:min': 10 }], ['Au moins 50 M FCFA', { 'liq_med:min': 50 }]]],
  ['rq', 'Variations du cours', [['Toutes', {}], ['Calmes (volatilité ≤ 30 %)', { 'vol_1a:max': 30 }], ['Modérées (≤ 40 %)', { 'vol_1a:max': 40 }], ['Fortes (> 40 %)', { 'vol_1a:min': 40 }]]],
];
const SC_HELP = {
  symbole: 'Code de l\'action à la BRVM', nom: 'Nom de la société', secteur: 'Secteur d\'activité (classification BRVM)', pays: 'Pays de la société (lettre finale du symbole)',
  cours: 'Dernier cours de clôture, en FCFA', date_cours: 'Date de la dernière séance où le titre a coté', var_seance: 'Variation lors de la dernière séance',
  perf_1m: 'Variation du cours sur 1 mois', perf_3m: 'Variation du cours sur 3 mois', perf_6m: 'Variation du cours sur 6 mois', perf_ytd: 'Variation depuis la première séance de l\'année', perf_1a: 'Variation du cours sur 1 an',
  vol_moy_3m: 'Nombre moyen de titres échangés par séance sur 3 mois', liq_med: 'Montant échangé lors d\'une séance typique (médiane sur 6 mois) : plus il est élevé, plus il est facile d\'acheter ou de vendre', part_tx: 'Part des séances où au moins un titre a été échangé',
  vol_1a: 'Volatilité : ampleur habituelle des variations du cours sur 1 an. Plus elle est élevée, plus le cours bouge', beta_1a: 'Sensibilité au marché : 1 = suit le BRVM Composite', max_dd_1a: 'Plus forte baisse depuis un plus haut, sur 1 an',
  rendement: 'Dernier dividende / cours actuel', reg: 'Nombre d\'exercices (sur les 4 derniers) avec un dividende versé', per: 'Cours / bénéfice par action : nombre d\'années de bénéfices que représente le cours', capitalisation: 'Valeur boursière de la société (cours × nombre d\'actions)',
  qualite: 'État des données du titre (fiable, à surveiller, insuffisante)', cat: 'Catégorie du diagnostic de l\'onglet Recommandations', spark: 'Évolution du cours sur 3 mois',
};
function scSimple() {
  const box = $('#sc-simple'), base = scBase();
  const opts = { secteur: SECTORS, pays: [...new Set(base.map((t) => t.pays))].sort() };
  if (!box.childElementCount) box.replaceChildren(...SC_SIMPLE.map(([id, l, o]) => el('label', { class: 'sc-s' }, el('span', {}, l),
    el('select', { 'data-s': id, onchange: (e) => {
      const v = e.target.value;
      if (!o) { if (v) SC.f[id] = v; else delete SC.f[id]; }
      else { o.forEach(([, f]) => Object.keys(f).forEach((k) => delete SC.f[k])); Object.assign(SC.f, o[+v][1]); }
      SC.preset = ''; scSyncInputs(); screener(); } },
    ...(o ? o.map(([t], i) => new Option(t, String(i))) : [new Option('Tous', ''), ...opts[id].map((x) => new Option(x, x))])))));
  // position des menus selon les filtres en cours (« Réglage avancé » si la combinaison ne correspond à aucun choix)
  box.querySelectorAll('select').forEach((sel) => {
    const def = SC_SIMPLE.find((x) => x[0] === sel.dataset.s), o = def[2];
    if (!o) { sel.value = SC.f[def[0]] || ''; return; }
    const keys = new Set(o.flatMap(([, f]) => Object.keys(f)));
    const cur = Object.fromEntries(Object.entries(SC.f).filter(([k]) => keys.has(k)));
    let i = o.findIndex(([, f]) => Object.keys(f).length === Object.keys(cur).length && Object.entries(f).every(([k, v]) => cur[k] === v));
    [...sel.options].filter((x) => x.dataset.custom).forEach((x) => x.remove());
    if (i < 0) { const op = new Option('Réglage avancé', 'c'); op.dataset.custom = '1'; op.disabled = true; sel.append(op); sel.value = 'c'; } else sel.value = String(i);
  });
}
function scInputs() {
  const box = $('#sc-cats');
  if (box.childElementCount) return;
  const base = scBase();
  const opts = { secteur: SECTORS, pays: [...new Set(base.map((t) => t.pays))].sort(), qualite: ['fiable', 'à surveiller', 'insuffisant'], cat: CATS };
  const inp = (key, ph) => el('input', { type: 'number', step: 'any', placeholder: ph, 'data-f': key, oninput: (e) => { const v = e.target.value; if (v === '') delete SC.f[key]; else SC.f[key] = +v; SC.preset = ''; screener(); } });
  box.replaceChildren(...SC_F.map(([cat, items]) => el('div', { class: 'sc-cat' }, el('b', {}, cat), el('div', { class: 'rows' }, ...items.map(([k, l, ty]) => {
    if (ty === 'na') return el('div', { class: 'na' }, l);
    if (ty === 'text') return el('div', { class: 'r one' }, el('span', {}, l), el('input', { type: 'search', 'data-f': k, placeholder: 'Rechercher…', oninput: (e) => { SC.f[k] = e.target.value; screener(); } }));
    if (ty === 'sel') return el('div', { class: 'r one' }, el('span', {}, l), el('select', { 'data-f': k, oninput: (e) => { if (e.target.value) SC.f[k] = e.target.value; else delete SC.f[k]; SC.preset = ''; screener(); } }, new Option('Tous', ''), ...opts[k].map((o) => new Option(o, o))));
    if (ty === 'chk') return el('label', { class: 'r one' }, el('span', {}, l), el('input', { type: 'checkbox', 'data-f': k, style: 'width:auto;justify-self:end', onchange: (e) => { if (e.target.checked) SC.f[k] = true; else delete SC.f[k]; SC.preset = ''; screener(); } }));
    return el('div', { class: 'r' }, el('span', {}, l), inp(k + ':min', 'min'), inp(k + ':max', 'max'));
  })))));
}
function scSyncInputs() {
  document.querySelectorAll('#sc-cats [data-f]').forEach((e) => { const v = SC.f[e.dataset.f]; if (e.type === 'checkbox') e.checked = !!v; else e.value = v ?? ''; });
}
const SC_SCALE = (k) => (SC_F.flatMap((c) => c[1]).find((x) => x[0] === k) || [])[2];
function scPass(t) {
  for (const [key, v] of Object.entries(SC.f)) {
    if (v === '' || v === null || v === undefined) continue;
    if (key === 'q') { if (!(t.symbole + ' ' + t.nom).toLowerCase().includes(String(v).toLowerCase())) return false; continue; }
    if (key === 'fiab') { if (t.risque_fiabilite !== 'fiable') return false; continue; }
    if (['secteur', 'pays', 'qualite', 'cat'].includes(key)) { if (t[key] !== v) return false; continue; }
    const [k, b] = key.split(':'), x = t[k], ty = SC_SCALE(k);
    if (!ok(x)) return false;                         // donnée manquante : le titre ne remplit pas le critère (jamais traité comme 0)
    const lim = ty === 'pct' ? v / 100 : ty === 'mio' ? v * 1e6 : v;
    if (b === 'min' && x < lim) return false;
    if (b === 'max' && x > lim) return false;
  }
  return true;
}
let SC_ROWS = [];
function screener() {
  if (!$('#sc-presets').childElementCount) {
    scInputs();
    $('#sc-presets').replaceChildren(...SC_PRESETS.map(([k, l, d, f, so]) => el('button', { 'data-k': k, type: 'button', onclick: () => {
      const on = SC.preset === k; SC.f = on ? {} : { ...f }; SC.preset = on ? '' : k; if (!on) SC.sort = so.map((x) => ({ ...x })); scSyncInputs(); screener();
      if (!on) $('#sc-count').scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, el('b', {}, l), el('span', {}, d), el('em', { 'data-n': k }, ''))),
      el('button', { 'data-k': '', type: 'button', class: 'all', onclick: () => { SC.f = {}; SC.preset = ''; SC.sort = [{ k: 'capitalisation', dir: -1 }]; scSyncInputs(); screener(); } }, el('b', {}, 'Toutes les actions'), el('span', {}, 'Sans filtre, des plus grosses capitalisations aux plus petites.'), el('em', { 'data-n': '' }, '')));
    SC.cols = new Set(lsGet('dbrvm-sc-cols2', SC_COLS.filter((c) => c[3]).map((c) => c[0])));
    const menu = $('#sc-cols');
    const groups = [...new Set(SC_COLS.map((c) => c[2]))];
    menu.replaceChildren(...groups.flatMap((g) => [el('b', {}, g), ...SC_COLS.filter((c) => c[2] === g).map(([k, l]) => el('label', {}, el('input', { type: 'checkbox', checked: SC.cols.has(k) ? true : null, onchange: (e) => { e.target.checked ? SC.cols.add(k) : SC.cols.delete(k); lsSet('dbrvm-sc-cols2', [...SC.cols]); screener(); } }), l))]),
      el('p', { style: 'margin:8px 0 0' }, el('button', { class: 'linkbtn', onclick: () => { SC.cols = new Set(SC_COLS.filter((c) => c[3]).map((c) => c[0])); lsSet('dbrvm-sc-cols2', [...SC.cols]); menu.replaceChildren(); $('#sc-presets').replaceChildren(); screener(); } }, 'Colonnes par défaut')));
    $('#sc-colbtn').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.hidden = true; });
    $('#sc-q2').addEventListener('input', screener);
    $('#sc-csv').onclick = scCsv;
    $('#sc-cmp').onclick = () => { CP.sel = [...SC.sel].slice(0, CP_MAX); showTab('comparer'); };
    $('#sc-fiche').onclick = () => ficheAnalyse([...SC.sel], 'Screener');
    scDoc();
  }
  const nact = Object.keys(SC.f).length;
  $('#sc-presets').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.k === SC.preset && (SC.preset !== '' || !nact)));
  { const all = scBase(); const sv = SC.f; SC_PRESETS.forEach(([k, , , f]) => { SC.f = { ...f }; const n = all.filter(scPass).length; $(`#sc-presets em[data-n="${k}"]`).textContent = `${n} action${n > 1 ? 's' : ''}`; }); SC.f = sv;
    $('#sc-presets em[data-n=""]').textContent = `${all.length} actions`; }
  scSimple();
  const q2 = $('#sc-q2').value.trim().toLowerCase();
  const rows = scBase().filter((t) => scPass(t) && (!q2 || (t.symbole + ' ' + t.nom + ' ' + t.secteur).toLowerCase().includes(q2)));
  const cmp = (a, b) => { for (const { k, dir } of SC.sort) { const x = a[k], y = b[k]; if (!ok(x) && !ok(y)) continue; if (!ok(x)) return 1; if (!ok(y)) return -1;
    const c = typeof x === 'string' ? x.localeCompare(y, 'fr') : x - y; if (c) return dir * c; } return 0; };
  rows.sort(cmp);
  SC_ROWS = rows;
  // filtres actifs
  const lab = (key) => { const [k, b] = key.split(':'); const it = SC_F.flatMap((c) => c[1]).find((x) => x[0] === k); return (it ? it[1].replace(/ \(.*\)$/, '') : k) + (b === 'min' ? ' ≥ ' : b === 'max' ? ' ≤ ' : ' : '); };
  const act = Object.entries(SC.f).filter(([, v]) => v !== '' && v !== undefined).map(([key, v]) => el('span', { class: 'fc' }, key === 'fiab' ? 'Mesures fiables' : lab(key) + v + (['pct'].includes(SC_SCALE(key.split(':')[0])) ? ' %' : SC_SCALE(key.split(':')[0]) === 'mio' ? ' M' : ''),
    el('button', { 'aria-label': 'Retirer', onclick: () => { delete SC.f[key]; SC.preset = ''; scSyncInputs(); screener(); } }, '×')));
  const pr = SC_PRESETS.find((x) => x[0] === SC.preset);
  $('#sc-active').replaceChildren(...(act.length ? [el('span', { class: 'note' }, 'Critères appliqués :')] : []), ...act, ...(act.length ? [el('button', { class: 'clr', onclick: () => { SC.f = {}; SC.preset = ''; scSyncInputs(); screener(); } }, 'Tout effacer')] : []));
  $('#sc-count').textContent = `${rows.length} action${rows.length > 1 ? 's' : ''} sur ${TIT.length}`;
  $('#sc-phrase').textContent = (pr ? `Question : « ${pr[1]} » ${pr[2]} ` : act.length ? 'Actions qui remplissent tous les critères choisis. ' : 'Toutes les actions cotées, sans filtre. ')
    + `Classement : ${SC.sort.map((x) => (SC_COLS.find((c) => c[0] === x.k) || [0, x.k])[1].toLowerCase() + (x.dir > 0 ? ' croissant' : ' décroissant')).join(', puis ')}. Cliquez sur une ligne pour analyser l'action.`;
  const med = (f) => d3.median(rows.map(f).filter(ok));
  const sm = (l, v, u) => el('div', { class: 's' }, el('div', { class: 'l' }, l), el('div', { class: 'v' }, v, u ? el('small', {}, u) : null));
  $('#sc-sum').replaceChildren(sm('Titres retenus', String(rows.length), `/ ${TIT.length}`), sm('Performance 1 an médiane', F.spct(med((t) => t.perf_1a), 1)),
    sm('Volatilité médiane', F.pct(med((t) => t.vol_1a), 0)), sm('Rendement médian', F.pct(med((t) => t.rendement), 2)), sm('Capitalisation totale', F.big(d3.sum(rows, (t) => t.capitalisation || 0)), 'FCFA'));
  $('#sc-sortinfo').hidden = SC.sort.length < 2;
  $('#sc-sortinfo').textContent = 'Tri : ' + SC.sort.map((x, i) => `${i + 1}. ${(SC_COLS.find((c) => c[0] === x.k) || [0, x.k])[1]} ${x.dir > 0 ? '↑' : '↓'}`).join('  ·  ');
  scTable(rows);
  watchRender();
}
function scTable(rows) {
  const cols = SC_COLS.filter((c) => SC.cols.has(c[0]));
  const i3 = startIdx('3M'), d3m = DATES.slice(i3);
  const th = (k, l) => { const i = SC.sort.findIndex((x) => x.k === k); const t = el('th', { class: ['symbole', 'nom', 'secteur', 'pays', 'qualite', 'cat'].includes(k) ? 'l' : '', title: (SC_HELP[k] ? SC_HELP[k] + '. ' : '') + 'Clic : trier · Maj + clic : critère de tri supplémentaire' }, l, i >= 0 ? el('span', { class: 'sk' }, `${SC.sort.length > 1 ? i + 1 : ''}${SC.sort[i].dir > 0 ? '↑' : '↓'}`) : null);
    if (k !== 'spark') t.addEventListener('click', (e) => { const j = SC.sort.findIndex((x) => x.k === k), def = ['symbole', 'nom', 'secteur', 'pays', 'qualite', 'cat', 'vol_1a'].includes(k) ? 1 : -1;
      if (e.shiftKey) { if (j >= 0) SC.sort[j].dir *= -1; else SC.sort.push({ k, dir: def }); } else SC.sort = [{ k, dir: j === 0 && SC.sort.length === 1 ? -SC.sort[0].dir : def }]; screener(); });
    return t; };
  const head = el('tr', {}, el('th', { class: 'ck', title: 'Sélection (2 à 4 titres pour comparer)' }, '✓'), el('th', { class: 'ck', title: 'Surveillance' }, '★'), ...cols.map(([k, l]) => th(k, l)));
  const qb = (v) => el('span', { class: 'qb ' + (v === 'fiable' ? 'fiable' : v === 'insuffisant' ? 'insuf' : 'surv') }, v === 'insuffisant' ? 'insuffisante' : v || '—');
  const tb = el('tbody', {}, ...rows.map((r) => {
    const tr = el('tr', { onclick: () => openTitle(r.symbole) });
    tr.append(el('td', { class: 'ck', onclick: (e) => e.stopPropagation() }, el('input', { type: 'checkbox', checked: SC.sel.has(r.symbole) ? true : null, disabled: !SC.sel.has(r.symbole) && SC.sel.size >= CP_MAX ? true : null, title: 'Sélectionner pour comparer (4 au maximum)',
      onchange: (e) => { e.target.checked ? SC.sel.add(r.symbole) : SC.sel.delete(r.symbole); scSelInfo(); scTable(SC_ROWS); } })));
    tr.append(el('td', { class: 'ck', onclick: (e) => { e.stopPropagation(); watchToggle(r.symbole); screener(); } }, el('span', { class: 'star' + (watchHas(r.symbole) ? ' on' : ''), title: 'Surveiller ce titre' }, watchHas(r.symbole) ? '★' : '☆')));
    cols.forEach(([k]) => {
      const v = r[k];
      if (k === 'spark') { tr.append(el('td', {}, spark(series(r.symbole).slice(i3), 96, 26, null, d3m, r.symbole))); return; }
      if (k === 'qualite') { tr.append(el('td', { class: 'l' }, qb(v))); return; }
      if (k === 'cat') { tr.append(el('td', { class: 'l' }, catPill(v))); return; }
      if (k === 'symbole') { tr.append(el('td', { class: 'l sym' }, v)); return; }
      if (['nom', 'secteur', 'pays'].includes(k)) { tr.append(el('td', { class: 'l nm' }, v || '')); return; }
      const td = el('td', { class: SC_SIGNED.has(k) ? cls(v) : '' }, ok(v) || typeof v === 'string' ? (SC_FMT[k] || String)(v) : 'n.d.');
      if (k === 'var_seance' && ok(v)) td.replaceChildren(el('span', { class: 'pill ' + cls(v) }, F.spct(v)));
      if (k === 'date_cours' && v && v !== D.resume.seance) td.title = 'Cours d\'une séance antérieure';
      tr.append(td);
    });
    return tr;
  }));
  $('#sc-table').replaceChildren(el('thead', {}, head), tb);
  if (!rows.length) $('#sc-table').append(el('tbody', {}, el('tr', {}, el('td', { class: 'l note', colspan: String(cols.length + 2) }, 'Aucun titre ne remplit tous ces critères : retirez un filtre.'))));
  scSelInfo();
}
function scSelInfo() {
  const n = SC.sel.size;
  $('#sc-cmp').disabled = n < 2; $('#sc-cmp').textContent = n ? `Comparer (${n})` : 'Comparer';
  $('#sc-fiche').disabled = n < 1; $('#sc-fiche').textContent = n ? `Fiche d'analyse (${n})` : 'Fiche d\'analyse';
}
function scCsv() {
  const cols = SC_COLS.filter((c) => SC.cols.has(c[0]) && c[0] !== 'spark');
  const esc = (v) => { const x = v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? '' : String(v); return /[;"\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const lines = [`# Daily BRVM - CGF Bourse - Screener - séance du ${D.resume.seance} - source : BRVM (cours, BOC), calculs Daily BRVM - données descriptives, pas une recommandation`,
    cols.map((c) => c[1]).join(';'), ...SC_ROWS.map((r) => cols.map(([k]) => esc(typeof r[k] === 'number' ? String(r[k]).replace('.', ',') : r[k])).join(';'))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `Screener_BRVM_${D.resume.seance}.csv` });
  document.body.append(a); a.click(); a.remove();
}
function scDoc() {
  const rows = [
    ['Performances', 'cours / cours à la date de début − 1 (YTD : depuis la première séance de l\'année)', '1 mois à 1 an', '%', 'cours BRVM ajustés'],
    ['Volume moyen 3 mois', 'moyenne des volumes quotidiens collectés', '3 mois', 'titres', 'brvm.org (depuis juillet 2026) ; au moins 20 séances'],
    ['Valeur médiane / séance', 'médiane du montant échangé (officiel du BOC, sinon volume × cours)', '6 mois', 'FCFA', 'diagnostic ; au moins 60 séances'],
    ['Séances avec transaction', 'séances avec volume > 0 / séances relevées', '6 mois', '%', 'idem'],
    ['Volatilité, bêta, perte max.', 'voir l\'onglet Risque', '1 an', '% / nombre', 'fiables si ≥ 120 rendements et ≤ 30 % de séances inchangées'],
    ['Rendement historique', 'dernier dividende de référence / cours', '—', '%', 'BOC et référentiel ; jamais prévisionnel'],
    ['Régularité', 'exercices 2022-2025 avec dividende / exercices connus', '4 exercices', 'sur 4', 'au moins 3 exercices connus'],
    ['PER', 'cours / BNPA du dernier exercice', '—', 'fois', 'contrôlé avec le PER du BOC'],
    ['Qualité des données', 'règles du lot 7 (fiable, à surveiller, insuffisante)', 'séance', '—', 'contrôles du robot'],
    ['Signal analytique', 'catégorie du diagnostic multifactoriel', 'séance', '—', 'onglet Recommandations ; distinct de la qualité'],
  ];
  $('#sc-doc').append(el('div', { class: 'scroll' }, el('table', { class: 'tbl compact' }, el('thead', {}, el('tr', {}, ...['Indicateur', 'Formule', 'Période', 'Unité', 'Source et contrôle'].map((h) => el('th', { class: 'l' }, h)))),
    el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.map((c) => el('td', { class: 'l nm' }, c))))))),
  el('p', { class: 'note' }, 'Une donnée manquante n\'est jamais remplacée par zéro : un titre sans la donnée ne remplit pas le critère et apparaît « n.d. » dans le tableau. ROE, marge nette et endettement ne sont pas disponibles tant que les états financiers ne sont pas collectés.'));
}

// ------------------------------------------------------------------ FICHE D'ANALYSE (lot 8) : PDF (impression) et Excel
function ficheAnalyse(syms, origine) {
  const T = syms.map((s) => TIT.find((t) => t.symbole === s)).filter(Boolean).slice(0, 8);
  if (!T.length) return;
  const G = new Map((D.diagnostic?.titres || []).map((x) => [x.symbole, x]));
  const comp = D.indices.find((i) => i.indice === 'BRVM Composite') || {};
  const lq = (t) => G.get(t.symbole)?.dimensions?.liquidite || {};
  const sec = {
    info: [['Société', (t) => t.nom], ['Secteur', (t) => t.secteur], ['Pays', (t) => paysDe(t.symbole)], ['Cours (FCFA)', (t) => t.cours, F.n0], ['Date du cours', (t) => t.date_cours, (v) => v.split('-').reverse().join('/')],
      ['Capitalisation (FCFA)', (t) => t.capitalisation, F.big], ['Qualité des données', (t) => t.qualite], ['Signal analytique', (t) => G.get(t.symbole)?.categorie || 'indisponible']],
    perf: [['1 semaine', 'perf_1s'], ['1 mois', 'perf_1m'], ['3 mois', 'perf_3m'], ['6 mois', 'perf_6m'], ['YTD', 'perf_ytd'], ['1 an', 'perf_1a'], ['3 ans', 'perf_3a']].map(([l, k]) => [l, (t) => t[k], (v) => F.spct(v, 1), comp[k]]),
    risk: [['Volatilité 1 an', (t) => t.vol_1a, (v) => F.pct(v, 1)], ['Bêta 1 an (référence)', (t) => t.beta_1a, F.n2], ['Bêta corrigé (Dimson)', (t) => t.beta_dimson_1a, F.n2], ['Perte maximale 1 an', (t) => t.max_dd_1a, (v) => F.pct(v, 1)],
      ['Downside deviation', (t) => t.downside_dev_1a, (v) => F.pct(v, 1)], ['Séances sans variation', (t) => t.seances_inchangees, (v) => F.pct(v, 0)], ['Fiabilité des mesures', (t) => t.risque_fiabilite],
      ['Liquidité (valeur médiane / séance)', (t) => lq(t).valeur_mediane, F.big], ['Niveau de liquidité', (t) => lq(t).niveau]],
  };
  const val = (f, t) => { const v = f(t); return v === undefined ? null : v; };
  const tbl = (rows, withComp) => el('table', { class: 'tbl compact' }, el('thead', {}, el('tr', {}, el('th', { class: 'l' }, ''), ...T.map((t) => el('th', {}, t.symbole)), withComp ? el('th', {}, 'BRVM Composite') : null)),
    el('tbody', {}, ...rows.map(([l, f, fm, c]) => el('tr', {}, el('td', { class: 'l' }, l), ...T.map((t) => { const v = val(f, t); return el('td', { class: fm && String(fm).includes('spct') ? cls(v) : '' }, ok(v) || typeof v === 'string' ? (fm ? fm(v) : v) : 'n.d.'); }),
      withComp ? el('td', {}, ok(c) ? F.spct(c, 1) : '—') : null))));
  // synthèse calculée
  const syn = [];
  const ext = (f, d) => { const a = T.filter((t) => ok(f(t))); return a.length >= 2 ? a.reduce((m, t) => (d * f(t) > d * f(m) ? t : m)) : null; };
  const bp = ext((t) => t.perf_1a, 1); if (bp) syn.push(`Meilleure performance sur 1 an : ${bp.nom} (${F.spct(bp.perf_1a, 1)}), contre ${F.spct(comp.perf_1a, 1)} pour le BRVM Composite.`);
  const hv = ext((t) => t.vol_1a, 1), lv = ext((t) => t.vol_1a, -1); if (hv && lv && hv !== lv) syn.push(`Volatilité la plus forte : ${hv.symbole} (${F.pct(hv.vol_1a, 0)}) ; la plus faible : ${lv.symbole} (${F.pct(lv.vol_1a, 0)}).`);
  const ml = ext((t) => lq(t).valeur_mediane, 1); if (ml) syn.push(`Titre le plus échangé : ${ml.symbole} (${F.big(lq(ml).valeur_mediane)} FCFA par séance en médiane).`);
  const br = ext((t) => t.rendement, 1); if (br) syn.push(`Rendement historique le plus élevé : ${br.symbole} (${F.pct(br.rendement, 2)}).`);
  const C = D.correlations || {}, P = new Map((C.symboles || []).map((x, i) => [x, i]));
  const pairs = []; T.forEach((a, i) => T.forEach((b, j) => { if (j > i && P.has(a.symbole) && P.has(b.symbole)) { const v = C.matrice[P.get(a.symbole)][P.get(b.symbole)]; if (ok(v)) pairs.push([a.symbole, b.symbole, v]); } }));
  if (pairs.length) syn.push('Corrélations sur 1 an : ' + pairs.map((p) => `${p[0]}–${p[1]} ${F.n2(p[2])}`).join(', ') + ' (lien statistique passé, pas une relation de cause à effet).');
  const nf = T.filter((t) => t.risque_fiabilite !== 'fiable'); if (nf.length) syn.push(`Mesures de risque peu fiables pour ${nf.map((t) => t.symbole).join(', ')} : titres peu échangés ou historique court.`);
  if (T.length === 1) syn.unshift(`${T[0].nom} : performance 1 an ${F.spct(T[0].perf_1a, 1)}, volatilité ${F.pct(T[0].vol_1a, 0)}, liquidité ${lq(T[0]).niveau || 'n.d.'}.`);
  const notes = [`Date de référence : séance du ${F.date(D.resume.seance)} (fiche générée le ${F.dtime(new Date().toISOString())}).`,
    'Sources : cours, volumes et indices publiés par la BRVM (www.brvm.org, Bulletin Officiel de la Cote) ; résultats et dividendes du référentiel CGF Bourse ; calculs Daily BRVM.',
    'Méthodes : performances sur cours ajustés hors dividendes ; volatilité = écart-type des rendements quotidiens × √252 ; mesures fiables si au moins 120 rendements et au plus 30 % de séances inchangées ; une donnée manquante est notée n.d., jamais zéro.',
    'Avertissement : document d\'information fondé sur des données passées. Il ne constitue ni un conseil en investissement ni une garantie de performance future.'];
  const ov = $('#fiche-ov');
  const doc = el('div', { class: 'fa-doc' },
    el('div', { class: 'fa-h' }, el('div', {}, el('b', {}, 'CGF Bourse · Daily BRVM'), el('div', { class: 'note' }, `Fiche d'analyse · ${origine} · séance du ${F.date(D.resume.seance)}`)), el('div', { class: 'note' }, T.map((t) => t.symbole).join(' · '))),
    el('h3', {}, 'Informations générales'), tbl(sec.info.map(([l, f, fm]) => [l, f, fm])),
    el('h3', {}, 'Performances'), tbl(sec.perf, true),
    el('h3', {}, 'Indicateurs de risque et de liquidité'), tbl(sec.risk),
    el('h3', {}, 'Évolution des cours sur 1 an (base 100)'), el('div', { class: 'chart', id: 'fiche-chart', style: 'height:260px' }),
    el('h3', {}, 'Synthèse'), el('ul', { class: 'cp-synth' }, ...syn.map((x) => el('li', {}, x))),
    el('h3', {}, 'Sources, dates et avertissements'), ...notes.map((x) => el('p', { class: 'note' }, x)));
  ov.replaceChildren(el('div', { class: 'fiche-bar' }, el('b', {}, 'Fiche d\'analyse'), el('span', { style: 'flex:1' }),
    el('button', { class: 'btn primary', onclick: () => { document.body.classList.add('print-fiche'); print(); } }, 'Imprimer / PDF'),
    el('button', { class: 'btn', onclick: () => ficheExcel(T, sec, syn, notes, origine) }, 'Excel'),
    el('button', { class: 'btn', onclick: () => { ov.hidden = true; } }, 'Fermer')), doc);
  ov.hidden = false;
  addEventListener('afterprint', () => document.body.classList.remove('print-fiche'), { once: true });
  const i0 = startIdx('1A'), idx = d3.range(i0, DATES.length).filter((i) => T.every((t) => ok(series(t.symbole)[i])));
  const pal = palette();
  if (idx.length >= 2) lineChart($('#fiche-chart'), [...T.map((t, k) => ({ n: t.symbole, c: pal[k % 7], v: idx.map((i) => series(t.symbole)[i] / series(t.symbole)[idx[0]] * 100), d: idx.map((i) => DATES[i]) })),
    { n: 'BRVM Composite', c: css('--muted-line'), v: idx.map((i) => series('BRVM Composite')[i] / series('BRVM Composite')[idx[0]] * 100), d: idx.map((i) => DATES[i]), dash: true }], { fy: F.n0, ref: 100, h: 260, legend: true, zoom: false });
  else empty($('#fiche-chart'), 'Pas assez de dates communes');
}
function ficheExcel(T, sec, syn, notes, origine) {
  const go = () => {
    const wb = XLSX.utils.book_new();
    const add = (name, aoa, w) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = w || [{ wch: 36 }, ...T.map(() => ({ wch: 16 })), { wch: 16 }]; XLSX.utils.book_append_sheet(wb, ws, name); };
    const raw = (rows, comp) => [['Indicateur', ...T.map((t) => t.symbole), ...(comp ? ['BRVM Composite'] : [])], ...rows.map(([l, f, , c]) => [l, ...T.map((t) => { const v = f(t); return ok(v) || typeof v === 'string' ? v : 'n.d.'; }), ...(comp ? [ok(c) ? c : null] : [])])];
    add('Synthèse', [['Fiche d\'analyse Daily BRVM – CGF Bourse'], [`Origine : ${origine}`], [`Séance du ${D.resume.seance}`], [], ...syn.map((x) => [x])], [{ wch: 120 }]);
    add('Informations', raw(sec.info));
    add('Performances', raw(sec.perf, true));
    add('Risque et liquidité', raw(sec.risk));
    const i0 = startIdx('1A'), idx = d3.range(i0, DATES.length).filter((i) => T.every((t) => ok(series(t.symbole)[i])));
    add('Cours (base 100)', [['Date', ...T.map((t) => t.symbole), 'BRVM Composite'], ...idx.map((i) => [P.dates[i], ...T.map((t) => +(series(t.symbole)[i] / series(t.symbole)[idx[0]] * 100).toFixed(2)), +(series('BRVM Composite')[i] / series('BRVM Composite')[idx[0]] * 100).toFixed(2)])]);
    add('Sources et avertissements', [...notes.map((x) => [x]), [], ['Pourcentages en décimales (0,05 = 5 %). n.d. : donnée non disponible.']], [{ wch: 140 }]);
    XLSX.writeFile(wb, `Fiche_BRVM_${T.map((t) => t.symbole).join('_')}_${D.resume.seance}.xlsx`);
  };
  if (window.XLSX) return go();
  const sc = document.createElement('script'); sc.src = 'vendor/sheetjs/xlsx.mini.min.js'; sc.onload = go; document.head.append(sc);
}

// ------------------------------------------------------------------ SURVEILLANCE (lot 8) : liste propre à ce navigateur
const watchList = () => lsGet('dbrvm-surveillance', []);
const watchHas = (s) => watchList().includes(s);
function watchToggle(s) { const w = watchList(); lsSet('dbrvm-surveillance', w.includes(s) ? w.filter((x) => x !== s) : [...w, s]); }
function watchAlerts(sym) {
  const t = TIT.find((x) => x.symbole === sym); if (!t) return [];
  const out = [], g = (D.diagnostic?.titres || []).find((x) => x.symbole === sym);
  if (ok(t.var_seance) && Math.abs(t.var_seance) >= 0.05) out.push(['perf', `variation de ${F.spct(t.var_seance)} sur la séance${Math.abs(t.var_seance) >= 0.07 ? ' (proche de la limite de ±7,5 %)' : ''}`]);
  if (ok(t.perf_1m) && Math.abs(t.perf_1m) >= 0.15) out.push(['perf', `${F.spct(t.perf_1m, 1)} sur un mois`]);
  if (ok(t.ecart_plus_haut) && t.ecart_plus_haut >= -0.001) out.push(['perf', 'au plus haut de l\'année']);
  if (ok(t.cours) && ok(t.plus_bas_1a) && t.cours <= t.plus_bas_1a) out.push(['risque', 'au plus bas de l\'année']);
  if (ok(t.valeur_jour) && ok(t.valeur_moy_3m) && t.valeur_moy_3m > 0 && t.valeur_jour >= 3 * t.valeur_moy_3m) out.push(['liq', `valeur échangée du jour égale à ${F.n1(t.valeur_jour / t.valeur_moy_3m)} fois la moyenne de 3 mois`]);
  (g?.signaux || []).forEach((x) => out.push([x.type === 'activité inhabituelle' ? 'liq' : 'perf', x.texte]));
  const ch = (D.diagnostic?.changements || []).find((x) => x.symbole === sym); if (ch) out.push(['risque', `signal analytique passé de « ${ch.avant} » à « ${ch.apres} »`]);
  if (t.risque_fiabilite && t.risque_fiabilite !== 'fiable') out.push(['risque', `mesures de risque ${t.risque_fiabilite}`]);
  if (t.qualite === 'insuffisant') out.push(['risque', 'qualité des données insuffisante']);
  return out;
}
function watchRender() {
  const box = $('#wt-card'); if (!box) return;
  const w = watchList().filter((s) => TIT.some((t) => t.symbole === s));
  const al = w.flatMap((s) => watchAlerts(s).map(([k, t]) => ({ s, k, t })));
  box.replaceChildren(...[el('div', { class: 'wt-h' }, el('h2', {}, `Ma surveillance${w.length ? ` · ${w.length} titre(s)` : ''}`),
    el('span', { class: 'note' }, w.length ? `Alertes calculées sur la séance du ${F.date(D.resume.seance)} : variation ≥ 5 %, mouvement ≥ 15 % sur un mois, plus haut ou plus bas annuel, activité inhabituelle, changement de signal, qualité ou fiabilité dégradée. Liste gardée dans ce navigateur.` : 'Cliquez sur ☆ dans le tableau (ou dans l\'onglet Risque) pour surveiller un titre. La liste est gardée dans ce navigateur.')),
  w.length ? el('div', { class: 'chips', style: 'margin-top:8px' }, ...w.map((s) => el('span', { class: 'chip on x' }, s, el('button', { 'aria-label': 'Ne plus surveiller ' + s, onclick: () => { watchToggle(s); screener(); } }, '×')))) : null,
  w.length ? el('div', { class: 'al' }, ...(al.length ? al.map((a) => el('div', { class: 'a ' + a.k, onclick: () => openTitle(a.s) }, el('b', {}, a.s), el('span', {}, a.t))) : [el('p', { class: 'note' }, 'Aucune évolution significative sur la dernière séance pour les titres surveillés.')])) : null].filter(Boolean));
}

// ------------------------------------------------------------------ RECOMMANDATIONS (lot 8 : diagnostic multifactoriel)
const CATS = ['Signal positif', 'À surveiller', 'Signal neutre', 'Prudence', 'Signal négatif', 'Analyse indisponible'];
const CAT_CLS = { 'Signal positif': 'pos', 'À surveiller': 'sur', 'Signal neutre': 'neu', 'Prudence': 'pru', 'Signal négatif': 'neg', 'Analyse indisponible': 'ind' };
const DIMS = [['tendance', 'Tend.', 'Tendance'], ['position', 'Pos.', 'Position relative'], ['liquidite', 'Liq.', 'Liquidité'], ['risque', 'Risque', 'Risque'], ['fondamentaux', 'Fond.', 'Fondamentaux'], ['dividendes', 'Div.', 'Dividendes']];
const DIM_ICO = { favorable: ['▲', 'fav'], neutre: ['●', 'neu'], 'défavorable': ['▼', 'def'], indisponible: ['–', 'ind'] };
const catPill = (c) => el('span', { class: 'cat ' + (CAT_CLS[c] || '') }, c || '—');
const RC = { cat: '', sel: null };
function recos() {
  const G = D.diagnostic;
  if (!G) { empty($('#rc-table'), 'Diagnostic non encore publié'); return; }
  $('#rc-avert').textContent = G.avertissement;
  $('#rc-meta').textContent = ` Calcul du ${F.date(G.seance)} · méthode ${G.version} · ${G.univers} titres analysés sur ${G.titres.length} · mis à jour automatiquement à chaque séance.`;
  const box = $('#rc-kpis');
  box.replaceChildren(...CATS.map((c) => el('div', { class: 'kpi' + (RC.cat === c ? ' on' : ''), role: 'button', tabindex: '0', title: 'Filtrer sur cette catégorie',
    onclick: () => { RC.cat = RC.cat === c ? '' : c; $('#rc-cat').value = RC.cat; recos(); } },
  el('span', { class: 'l' }, c), el('span', { class: 'v' }, String(G.repartition[c] || 0), el('small', {}, 'titre(s)')))));
  const chg = G.changements || [];
  $('#rc-chg-card').style.display = chg.length ? '' : 'none';
  $('#rc-chg').replaceChildren(...chg.map((x) => el('li', {}, el('b', {}, x.symbole), ` : ${x.avant} → `, catPill(x.apres))));
  const cs = $('#rc-cat'), ss = $('#rc-sec');
  if (!cs.options.length) {
    cs.replaceChildren(new Option('Toutes les catégories', ''), ...CATS.map((c) => new Option(c, c)));
    ss.replaceChildren(new Option('Tous les secteurs', ''), ...SECTORS.map((x) => new Option(x, x)));
    ['#rc-q', '#rc-sec', '#rc-liq'].forEach((id) => $(id).addEventListener('input', rcTable));
    cs.addEventListener('input', () => { RC.cat = cs.value; recos(); });
  }
  cs.value = RC.cat;
  rcTable();
  rcMethode(G.methode);
}
function rcTable() {
  const G = D.diagnostic;
  const q = $('#rc-q').value.trim().toLowerCase(), sv = $('#rc-sec').value, lv = $('#rc-liq').value;
  const rows = G.titres.filter((t) => (!RC.cat || t.categorie === RC.cat) && (!sv || t.secteur === sv)
    && (!lv || (t.dimensions.liquidite || {}).niveau === lv) && (!q || (t.symbole + ' ' + (t.nom || '')).toLowerCase().includes(q)));
  const tb = el('tbody');
  rows.forEach((t) => {
    const tr = el('tr', { class: t.symbole === RC.sel ? 'sel' : '', onclick: () => { RC.sel = t.symbole; rcTable(); $('#rc-fiche').scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
      el('td', { class: 'l sym' }, t.symbole), el('td', { class: 'l nm' }, t.nom || ''), el('td', { class: 'l nm' }, t.secteur || ''),
      el('td', { class: 'l' }, catPill(t.categorie)),
      ...DIMS.map(([k, , lab]) => { const d = t.dimensions[k] || { statut: 'indisponible' }; const [ic, c] = DIM_ICO[d.statut] || DIM_ICO.indisponible; return el('td', { class: 'dim ' + c, title: `${lab} : ${d.statut}${d.texte ? ' – ' + d.texte : ''}` }, ic); }),
      el('td', { class: 'l nm' }, (t.signaux || []).map((x) => x.type).join(', ') || ''));
    tb.append(tr);
  });
  const thead = el('thead', {}, el('tr', {}, el('th', { class: 'l' }, 'Symbole'), el('th', { class: 'l' }, 'Titre'), el('th', { class: 'l' }, 'Secteur'), el('th', { class: 'l' }, 'Catégorie'),
    ...DIMS.map(([, h, lab]) => el('th', { title: lab }, h)), el('th', { class: 'l' }, 'Signaux')));
  $('#rc-table').replaceChildren(thead, tb);
  if (!rows.length) $('#rc-table').append(el('tbody', {}, el('tr', {}, el('td', { colspan: '11', class: 'l note' }, 'Aucun titre ne correspond aux filtres'))));
  if (!RC.sel || !G.titres.some((t) => t.symbole === RC.sel)) RC.sel = (rows[0] || G.titres[0]).symbole;
  rcFiche(G.titres.find((t) => t.symbole === RC.sel));
}
function rcFiche(t) {
  const G = D.diagnostic;
  const li = (a) => a.length ? el('ul', {}, ...a.map((x) => el('li', {}, typeof x === 'string' ? x : el('span', {}, el('b', {}, x.dimension + ' : '), x.texte)))) : el('p', { class: 'note' }, 'Aucun');
  const dimRows = el('tbody', {}, ...DIMS.map(([k, , lab]) => { const d = t.dimensions[k] || { statut: 'indisponible', texte: '' }; const [ic, c] = DIM_ICO[d.statut] || DIM_ICO.indisponible;
    return el('tr', {}, el('td', { class: 'l' }, lab), el('td', { class: 'l dim ' + c, style: 'text-align:left' }, ic + ' ' + d.statut), el('td', { class: 'l nm' }, d.texte || '')); }));
  const dq = t.qualite ? `Qualité des données : ${t.qualite}` + ((t.motifs_qualite || []).length ? ' (' + t.motifs_qualite.join(' ; ') + ')' : '') : '';
  $('#rc-fiche').replaceChildren(
    el('h2', {}, `${t.nom || t.symbole} (${t.symbole})`, catPill(t.categorie)),
    el('p', { class: 'note' }, `${t.secteur || ''} · diagnostic du ${F.date(G.seance)} · règle appliquée : ${(t.motif_categorie || []).join(' ; ')}`),
    el('p', { class: 'resume' }, t.resume || ''),
    el('div', { class: 'cols' },
      el('div', {}, el('h3', {}, 'Facteurs favorables'), li(t.favorables || [])),
      el('div', {}, el('h3', {}, 'Facteurs défavorables'), li(t.defavorables || []))),
    el('h3', {}, 'Les six dimensions'),
    el('div', { class: 'scroll' }, el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, el('th', { class: 'l' }, 'Dimension'), el('th', { class: 'l' }, 'Statut'), el('th', { class: 'l' }, 'Mesures'))), dimRows)),
    el('div', { class: 'cols' },
      el('div', {}, el('h3', {}, 'Signaux complémentaires'), li((t.signaux || []).map((x) => x.texte[0].toUpperCase() + x.texte.slice(1)))),
      el('div', {}, el('h3', {}, 'Ce qui ferait changer la catégorie'), li(t.invalidation || []))),
    dq ? el('p', { class: 'note' }, dq) : null,
    TIT.some((x) => x.symbole === t.symbole) ? el('p', { class: 'lien' }, el('a', { href: '#titre', onclick: (e) => { e.preventDefault(); openTitle(t.symbole); } }, 'Voir l\'analyse complète du titre →')) : null);
}
function rcMethode(M) {
  const box = $('#rc-methode');
  if (!M || box.dataset.ok) return;
  box.dataset.ok = '1';
  const dl = el('dl', {},
    el('dt', {}, 'Principe'), el('dd', {}, 'Six dimensions notées favorable, neutre, défavorable ou indisponible, puis une catégorie déduite par des règles fixes. ' + M.ponderation[0].toUpperCase() + M.ponderation.slice(1) + '. Les rangs centiles sont calculés dans l\'univers des titres éligibles de la séance. Une donnée manquante rend la dimension indisponible, jamais nulle.'),
    el('dt', {}, 'Éligibilité'), el('dd', {}, M.eligibilite.join(' ; ') + '.'),
    ...DIMS.flatMap(([k, , lab]) => [el('dt', {}, lab), el('dd', {}, M.dimensions[k] + '.')]),
    el('dt', {}, 'Catégories'), el('dd', {}, el('ol', { style: 'margin:0;padding-left:18px' }, ...M.categories.map(([c, r]) => el('li', {}, el('b', {}, c), ' : ' + r)))),
    el('dt', {}, 'Signaux'), el('dd', {}, M.signaux.join(' ; ') + '. Affichés à part, ils ne modifient aucune dimension.'),
    el('dt', {}, 'Limites'), el('dd', {}, 'Le diagnostic décrit la situation ; il ne prédit pas. L\'étude 2018-2026 ne montre aucun facteur au pouvoir prédictif stable. La liquidité repose sur les volumes collectés depuis juillet 2026 ; les fondamentaux se limitent au résultat net 2022-2025 ; le PER n\'est pas utilisé.'),
    el('dt', {}, 'Avertissement'), el('dd', {}, M.avertissement));
  box.append(dl);
}

// ------------------------------------------------------------------ RISQUE
const AXES = [['vol_1a', 'Volatilité 1 an', 'pct'], ['perf_1a', 'Performance 1 an', 'pct'], ['perf_ytd', 'Performance YTD', 'pct'], ['beta_1a', 'Bêta', 'n'], ['beta_dimson_1a', 'Bêta corrigé', 'n'], ['downside_dev_1a', 'Downside deviation', 'pct'],
  ['max_dd_1a', 'Perte max. 1 an', 'pct'], ['per', 'PER', 'n'], ['rendement', 'Rendement dividende', 'pct'], ['rsi14', 'RSI 14', 'n'], ['seances_inchangees', 'Séances inchangées', 'pct'], ['ecart_mm200', 'Écart MM200', 'pct']];
// Risque et corrélations v2 (lot 8). Toutes les mesures viennent du robot : risque_periodes (6 mois à 3 ans) et
// correlations (titres éligibles, 120 observations communes). Rien n'est recalculé ni complété ici.
const RK = { hl: new Set(), sel: null, secM: 'vol_1a', sort: { k: 'vol_1a', dir: -1 }, per: '1A', secs: new Set(), custom: false, hm: 'syn', hmN: 10, hmOrd: 'secteur', hmPick: [] };
const RK_PER = [['6M', '6 mois'], ['1A', '1 an'], ['2A', '2 ans'], ['3A', '3 ans']];
const rkLib = () => RK_PER.find((p) => p[0] === RK.per)[1];
const rkM = (sym) => (D.risque_periodes || {})[sym]?.[RK.per] || null;
const rkOk = (m) => m && m.fiabilite === 'fiable' && ok(m.perf) && ok(m.vol);
const rkQual = (t) => (t.qualite === 'fiable' ? '✓ fiable' : t.qualite === 'insuffisant' ? '✗ insuffisante' : t.qualite ? '◐ à surveiller' : '—');
function rkPoints() {
  return TIT.filter((t) => !RK.secs.size || RK.secs.has(t.secteur)).map((t) => ({ t, m: rkM(t.symbole) }));
}
function risque() {
  const sx = $('#sx'), sy = $('#sy');
  if (!sx.options.length) {
    [sx, sy].forEach((x) => x.replaceChildren(...AXES.map(([v, l]) => new Option(l, v))));
    sx.value = S.sx; sy.value = S.sy;
    sx.onchange = () => { S.sx = sx.value; RK.custom = true; scatter(); };
    sy.onchange = () => { S.sy = sy.value; RK.custom = true; scatter(); };
    $('#rk-axreset').onclick = () => { RK.custom = false; S.sx = 'vol_1a'; S.sy = 'perf_1a'; sx.value = S.sx; sy.value = S.sy; scatter(); };
    seg($('#rk-per'), RK_PER, RK.per, (v) => { RK.per = v; RK.custom = false; rkAll(); });
    $('#rk-list').replaceChildren(...TIT.map((t) => el('option', { value: `${t.symbole} – ${t.nom}` })));
    const pick = (inp, f) => inp.addEventListener('change', () => { const v = inp.value.trim().toUpperCase(); const t = TIT.find((x) => v.startsWith(x.symbole + ' ') || x.symbole === v); inp.value = ''; if (t) f(t.symbole); });
    pick($('#rk-hl'), (sym) => { RK.hl.add(sym); RK.sel = sym; scatter(); rkSide(); rkChosen(); });
    pick($('#hm-add'), (sym) => { if (!RK.hmPick.includes(sym)) RK.hmPick.push(sym); heatmap(); });
    seg($('#rk-sec-m'), [['vol_1a', 'Volatilité'], ['max_dd_1a', 'Perte max.'], ['beta_1a', 'Bêta']], RK.secM, (v) => { RK.secM = v; rkSecteurs(); });
    $('#rk-fsec').replaceChildren(new Option('Tous les secteurs', ''), ...SECTORS.map((x) => new Option(x, x)));
    ['#rk-q', '#rk-fsec', '#rk-fiab'].forEach((id) => $(id).addEventListener('input', rkTable));
    $('#hm-sec').replaceChildren(new Option('Tous', ''), ...SECTORS.map((x) => new Option(x, x)));
    $('#hm-sec').addEventListener('input', heatmap);
    seg($('#hm-mode'), [['syn', 'Vue synthétique'], ['det', 'Vue détaillée']], RK.hm, (v) => { RK.hm = v; heatmap(); });
    seg($('#hm-n'), [['5', '5'], ['10', '10'], ['15', '15']], String(RK.hmN), (v) => { RK.hmN = +v; RK.hmPick = []; heatmap(); });
    seg($('#hm-ord'), [['secteur', 'par secteur'], ['corr', 'par corrélation']], RK.hmOrd, (v) => { RK.hmOrd = v; heatmap(); });
    $('#rk-fiche').onclick = () => ficheAnalyse([...RK.hl], 'Risque et corrélations');
  }
  rkAll();
}
function rkAll() { rkSecChips(); rkKpis(); rkSynthese(); scatter(); rkSide(); rkChosen(); rkSecteurs(); rkDist(); rkTable(); heatmap(); rkDoc(); }
function rkSecChips() {
  $('#rk-secs').replaceChildren(el('span', { class: 'note' }, 'Secteurs :'), ...SECTORS.map((x) => el('button', { class: 'chip' + (!RK.secs.size || RK.secs.has(x) ? ' on' : ''), onclick: () => {
    if (!RK.secs.size) { RK.secs = new Set([x]); } else if (RK.secs.has(x)) { RK.secs.delete(x); } else RK.secs.add(x);
    rkSecChips(); scatter(); rkSynthese(); } }, el('i', { style: `background:${secColor(x)}` }), x)),
  ...(RK.secs.size ? [el('button', { class: 'linkbtn', onclick: () => { RK.secs = new Set(); rkSecChips(); scatter(); rkSynthese(); } }, 'tous')] : []));
}
function rkChosen() {
  $('#rk-chosen').replaceChildren(...[...RK.hl].map((s) => el('span', { class: 'chip on x' }, s, el('button', { 'aria-label': 'Retirer ' + s, onclick: () => { RK.hl.delete(s); if (RK.sel === s) RK.sel = null; scatter(); rkSide(); rkChosen(); } }, '×'))),
    ...(RK.hl.size >= 2 ? [el('button', { class: 'linkbtn', onclick: () => { CP.sel = [...RK.hl].slice(0, CP_MAX); showTab('comparer'); } }, `Comparer (${Math.min(RK.hl.size, CP_MAX)})`)] : []));
  const b = $('#rk-fiche'); b.disabled = !RK.hl.size; b.title = RK.hl.size ? 'Fiche PDF ou Excel des titres choisis' : 'Choisissez des titres sur la carte';
}
function rkKpis() {
  const pts = TIT.map((t) => rkM(t.symbole)).filter(rkOk);
  const C = D.correlations || {};
  const vals = []; (C.matrice || []).forEach((r, i) => r.forEach((v, j) => { if (j > i && ok(v)) vals.push(v); }));
  const sm = (l, v, sub) => el('div', { class: 's' }, el('div', { class: 'l' }, l), el('div', { class: 'v' }, v), sub ? el('div', { class: 'note' }, sub) : null);
  $('#rk-kpis').replaceChildren(
    sm(`Volatilité médiane · ${rkLib()}`, F.pct(d3.median(pts, (m) => m.vol), 0), `${pts.length} titres aux mesures fiables`),
    sm(`Performance médiane · ${rkLib()}`, F.spct(d3.median(pts, (m) => m.perf), 1), 'cours, hors dividendes'),
    sm('Bêta médian · 1 an', F.n2(d3.median(TIT.filter((t) => t.risque_fiabilite === 'fiable'), (t) => t.beta_1a)), '1 = suit le marché'),
    sm('Corrélation moyenne · 1 an', F.n2(d3.mean(vals)), `entre deux titres · ${(C.symboles || []).length} titres retenus`),
    sm('Hors analyse', `${TIT.length - pts.length} / ${TIT.length}`, 'mesures peu fiables ou historique trop court'));
}
function rkQuadOf(m, vmed) { return m.perf >= 0 ? (m.vol <= vmed ? 'pf' : 'pe') : (m.vol <= vmed ? 'nf' : 'ne'); }
const RK_Q = { pf: ['Performance positive, risque faible', 'Hausse sur la période avec des variations plus modérées que la moitié des titres'],
  pe: ['Performance positive, risque élevé', 'Hausse sur la période avec des variations plus fortes que la moitié des titres'],
  nf: ['Performance négative, risque faible', 'Baisse sur la période avec des variations plus modérées que la moitié des titres'],
  ne: ['Performance négative, risque élevé', 'Baisse sur la période avec des variations plus fortes que la moitié des titres'] };
function scatter() {
  const box = $('#scatter');
  const custom = RK.custom;
  const ax = Object.fromEntries(AXES.map((a) => [a[0], a]));
  let pts, X, Y, fX, fY, lX, lY;
  if (!custom) {
    pts = rkPoints().filter((p) => rkOk(p.m)).map((p) => ({ ...p, x: p.m.vol, y: p.m.perf }));
    fX = (v) => F.pct(v, 0); fY = (v) => F.pct(v, 0); lX = `Volatilité ${rkLib()}`; lY = `Performance ${rkLib()}`;
  } else {
    pts = rkPoints().filter((p) => ok(p.t[S.sx]) && ok(p.t[S.sy]) && !(S.sx === 'per' && p.t.per > 80) && !(S.sy === 'per' && p.t.per > 80)).map((p) => ({ ...p, x: p.t[S.sx], y: p.t[S.sy] }));
    const fx = (k) => ax[k][2] === 'pct' ? (v) => F.pct(v, 0) : (v) => F.n1(v);
    fX = fx(S.sx); fY = fx(S.sy); lX = ax[S.sx][1]; lY = ax[S.sy][1];
  }
  const excl = rkPoints().filter((p) => !rkOk(p.m));
  $('#rk-note').textContent = custom ? `Axes personnalisés (mesures à 1 an). ${pts.length} titres affichés.`
    : `${pts.length} titres sur ${rkPoints().length} · période ${rkLib()} au ${F.date(D.resume.seance)} · taille : capitalisation · couleur : secteur. ${excl.length ? `${excl.length} titre(s) non affichés : mesures peu fiables ou titre coté après le début de la période.` : ''} Cliquez sur une bulle pour le détail.`;
  if (!pts.length) { empty(box, 'Aucun titre aux mesures fiables pour ces filtres'); $('#rk-quads').replaceChildren(); return; }
  const h = 500;
  const { svg, w } = svgIn(box, h);
  const y = d3.scaleLinear(d3.extent(pts, (p) => p.y), [h - 30, 16]).nice();
  const ml = d3.max(y.ticks(6), (t) => tw(svg, fY(t))) + 14;
  const x = d3.scaleLinear(d3.extent(pts, (p) => p.x), [ml + 14, w - 24]).nice();
  const r = d3.scaleSqrt([0, d3.max(TIT, (d) => d.capitalisation || 0)], [4, 28]);
  const vmed = d3.median(pts, (p) => p.x);
  // zones descriptives (volatilité / performance seulement)
  if (!custom) {
    const x0 = x(vmed), y0 = y(Math.max(y.domain()[0], Math.min(0, y.domain()[1])));
    const zc = { pf: css('--up'), pe: css('--c2'), nf: css('--c1'), ne: css('--down') };
    [['pf', ml, 16, x0, y0], ['pe', x0, 16, w - 24, y0], ['nf', ml, y0, x0, h - 30], ['ne', x0, y0, w - 24, h - 30]].forEach(([k, x1, y1, x2, y2]) => {
      if (x2 > x1 && y2 > y1) svg.append('rect').attr('x', x1).attr('y', y1).attr('width', x2 - x1).attr('height', y2 - y1).attr('fill', zc[k]).attr('opacity', 0.05); });
    const lab = (tx, ty, t, an) => w < 620 ? null : svg.append('text').attr('x', tx).attr('y', ty).attr('text-anchor', an).style('font-size', '11px').style('fill', css('--muted')).style('font-weight', 600).text(t);
    lab(ml + 8, 32, RK_Q.pf[0], 'start'); lab(w - 28, 32, RK_Q.pe[0], 'end');
    if (y0 < h - 50) { lab(ml + 8, h - 38, RK_Q.nf[0], 'start'); lab(w - 28, h - 38, RK_Q.ne[0], 'end'); }
  }
  svg.append('g').attr('class', 'grid').attr('transform', `translate(${ml - 4},0)`).call(d3.axisLeft(y).ticks(6).tickFormat(fY).tickSize(-(w - ml - 20)));
  svg.append('g').attr('class', 'grid').attr('transform', `translate(0,${h - 26})`).call(d3.axisBottom(x).ticks(7).tickFormat(fX).tickSize(-(h - 42)));
  if (y.domain()[0] < 0 && y.domain()[1] > 0) svg.append('line').attr('x1', ml).attr('x2', w - 24).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', css('--muted-line')).attr('stroke-dasharray', '4 3');
  svg.append('line').attr('x1', x(vmed)).attr('x2', x(vmed)).attr('y1', 16).attr('y2', h - 26).attr('stroke', css('--muted-line')).attr('stroke-dasharray', '2 4');
  svg.append('text').attr('x', x(vmed) + 4).attr('y', h - 32).style('font-size', '10px').style('fill', css('--faint')).text(custom ? 'médiane' : `volatilité médiane ${fX(vmed)}`);
  svg.append('text').attr('x', w - 24).attr('y', 12).attr('text-anchor', 'end').style('font-size', '11.5px').text(lX + ' →');
  svg.append('text').attr('x', ml + 4).attr('y', 12).style('font-size', '11.5px').text('↑ ' + lY);
  const hl = RK.hl.size > 0;
  // grosses bulles d'abord : les petites restent visibles et cliquables par-dessus
  const order = pts.slice().sort((a, b) => (b.t.capitalisation || 0) - (a.t.capitalisation || 0));
  order.forEach((p) => {
    const d = p.t, c = secColor(d.secteur), on = RK.hl.has(d.symbole) || RK.sel === d.symbole;
    svg.append('circle').attr('cx', x(p.x)).attr('cy', y(p.y)).attr('r', r(d.capitalisation || 0)).attr('fill', c).attr('fill-opacity', hl && !on ? 0.12 : 0.45).attr('stroke', on ? css('--fg') : c).attr('stroke-width', on ? 2.5 : 1).style('cursor', 'pointer')
      .on('mousemove', (ev) => showTip(ev, `${d.nom} (${d.symbole})`, [{ c, t: d.secteur }, { t: `${lY} : ${fY(p.y)}` }, { t: `${lX} : ${fX(p.x)}` }, { t: `Capitalisation : ${F.big(d.capitalisation)} FCFA` }, { t: `Bêta 1 an : ${F.n2(d.beta_1a)} · qualité des données : ${rkQual(d)}` }, ...(!custom ? [{ t: `Zone : ${RK_Q[rkQuadOf(p.m, vmed)][0].toLowerCase()}` }] : [])]))
      .on('mouseleave', hideTip).on('click', () => { RK.sel = d.symbole; scatter(); rkSide(); });
  });
  // étiquettes sans chevauchement : titres choisis d'abord, puis les plus grosses capitalisations
  const boxes = [];
  const fits = (b) => b.x1 > ml && b.x2 < w - 4 && b.y1 > 14 && b.y2 < h - 28 && !boxes.some((o) => !(b.x2 < o.x1 || b.x1 > o.x2 || b.y2 < o.y1 || b.y1 > o.y2));
  const cand = [...order.filter((p) => RK.hl.has(p.t.symbole) || RK.sel === p.t.symbole), ...order.filter((p) => !RK.hl.has(p.t.symbole) && RK.sel !== p.t.symbole).slice(0, hl ? 0 : 18)];
  cand.forEach((p) => {
    const cx = x(p.x), cy = y(p.y), rr = r(p.t.capitalisation || 0), t = p.t.symbole, tw0 = t.length * 6.6 + 4, on = RK.hl.has(t) || RK.sel === t;
    for (const [dx, dy, an] of [[rr + 3, 4, 'start'], [-rr - 3, 4, 'end'], [0, -rr - 4, 'middle'], [0, rr + 12, 'middle']]) {
      const x1 = an === 'start' ? cx + dx : an === 'end' ? cx + dx - tw0 : cx - tw0 / 2;
      const b = { x1, x2: x1 + tw0, y1: cy + dy - 10, y2: cy + dy + 2 };
      if (fits(b) || (on && dx === rr + 3 && !fits(b) && boxes.length === 0)) {
        boxes.push(b);
        svg.append('text').attr('class', 'lbl').attr('x', cx + dx).attr('y', cy + dy).attr('text-anchor', an).style('pointer-events', 'none').style('font-weight', on ? 700 : 500).style('paint-order', 'stroke').style('stroke', css('--panel')).style('stroke-width', 3).text(t);
        break;
      }
    }
  });
  // effectifs des zones
  if (!custom) {
    const n = { pf: [], pe: [], nf: [], ne: [] };
    pts.forEach((p) => n[rkQuadOf(p.m, vmed)].push(p.t.symbole));
    $('#rk-quads').replaceChildren(...['pf', 'pe', 'nf', 'ne'].map((k) => el('div', { class: 'z' }, el('b', {}, RK_Q[k][0]), el('span', { class: 'n' }, String(n[k].length)), ' titre(s)',
      el('div', { class: 'l' }, RK_Q[k][1] + ` (seuil : volatilité médiane ${F.pct(vmed, 0)}). ` + (n[k].length ? n[k].slice(0, 8).join(', ') + (n[k].length > 8 ? '…' : '') : '')))),
      el('p', { class: 'note', style: 'grid-column:1/-1;margin:0' }, 'Ces zones décrivent le passé de chaque titre sur la période ; elles ne constituent pas une recommandation d\'achat ou de vente.'));
  } else $('#rk-quads').replaceChildren();
}
function rkSide() {
  const box = $('#rk-side');
  const t = RK.sel && TIT.find((x) => x.symbole === RK.sel);
  if (!t) { box.replaceChildren(el('h3', {}, 'Détail d\'un titre'), el('p', { class: 'note' }, 'Cliquez sur une bulle, ou choisissez un titre au-dessus de la carte, pour afficher ses informations ici.')); return; }
  const m = rkM(t.symbole) || {};
  const lq = (D.diagnostic?.titres || []).find((x) => x.symbole === t.symbole)?.dimensions?.liquidite || {};
  const dg = (D.diagnostic?.titres || []).find((x) => x.symbole === t.symbole);
  const row = (k, v) => [el('dt', {}, k), el('dd', {}, v)];
  const watched = watchHas(t.symbole);
  box.replaceChildren(el('h3', {}, t.nom), el('div', { class: 'sub' }, `${t.symbole} · ${t.secteur} · ${paysDe(t.symbole)}`),
    el('dl', {}, ...row(`Performance ${rkLib()}`, ok(m.perf) ? F.spct(m.perf, 1) : 'n.d.'), ...row(`Volatilité ${rkLib()}`, ok(m.vol) ? F.pct(m.vol, 1) : 'n.d.'),
      ...row(`Perte max. ${rkLib()}`, ok(m.max_dd) ? F.pct(m.max_dd, 1) : 'n.d.'), ...row('Capitalisation', F.big(t.capitalisation) + ' FCFA'),
      ...row('Bêta 1 an (réf.)', F.n2(t.beta_1a)), ...row('Bêta corrigé', F.n2(t.beta_dimson_1a)),
      ...row('Liquidité', lq.niveau ? `${lq.niveau}${ok(lq.valeur_mediane) ? ' · ' + F.big(lq.valeur_mediane) : ''}` : 'n.d.'),
      ...row('Observations', `${m.n_obs ?? '—'} rendements`)),
    el('div', { class: 'q' }, el('b', {}, 'Qualité des données : '), rkQual(t), m.fiabilite && m.fiabilite !== 'fiable' ? ` · mesures ${m.fiabilite}${m.motif ? ' (' + m.motif + ')' : ''}` : ''),
    el('div', { class: 'q' }, el('b', {}, 'Signal analytique : '), dg ? catPill(dg.categorie) : 'indisponible'),
    el('p', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 0' },
      el('button', { class: 'btn', onclick: () => openTitle(t.symbole) }, 'Analyse du titre →'),
      el('button', { class: 'btn', onclick: () => { RK.hl.has(t.symbole) ? RK.hl.delete(t.symbole) : RK.hl.add(t.symbole); scatter(); rkChosen(); rkSide(); } }, RK.hl.has(t.symbole) ? 'Retirer de la sélection' : 'Ajouter à la sélection'),
      el('button', { class: 'btn', onclick: () => { watchToggle(t.symbole); rkSide(); } }, watched ? '★ Surveillé' : '☆ Surveiller')));
}
function rkSynthese() {
  const pts = rkPoints().filter((p) => rkOk(p.m));
  const out = [];
  $('#rk-syn-note').textContent = `Généré automatiquement à partir des calculs de la séance du ${F.date(D.resume.seance)} · période ${rkLib()}${RK.secs.size ? ' · secteurs : ' + [...RK.secs].join(', ') : ''}. Description du passé, pas un conseil.`;
  if (pts.length < 5) { $('#rk-syn').replaceChildren(el('li', {}, `Seulement ${pts.length} titre(s) aux mesures fiables pour ces choix : pas de conclusion.`)); return; }
  const by = (f, d) => pts.slice().sort((a, b) => d * (f(b) - f(a)));
  const nm = (p) => `${p.t.symbole} (${F.pct(p.m.vol, 0)})`;
  out.push(`Volatilité la plus forte sur ${rkLib()} : ${by((p) => p.m.vol, 1).slice(0, 3).map(nm).join(', ')} ; la plus faible : ${by((p) => p.m.vol, -1).slice(0, 3).map(nm).join(', ')}. Volatilité médiane : ${F.pct(d3.median(pts, (p) => p.m.vol), 0)}.`);
  const bp = by((p) => p.m.perf, 1);
  out.push(`Meilleures performances : ${bp.slice(0, 3).map((p) => `${p.t.symbole} (${F.spct(p.m.perf, 0)})`).join(', ')} ; moins bonnes : ${bp.slice(-3).reverse().map((p) => `${p.t.symbole} (${F.spct(p.m.perf, 0)})`).join(', ')}. ${pts.filter((p) => p.m.perf >= 0).length} titre(s) sur ${pts.length} sont en hausse.`);
  const C = D.correlations || {}, S_ = C.symboles || [], inSel = new Set(pts.map((p) => p.t.symbole));
  const pairs = [];
  (C.matrice || []).forEach((r, i) => r.forEach((v, j) => { if (j > i && ok(v) && inSel.has(S_[i]) && inSel.has(S_[j])) pairs.push([S_[i], S_[j], v]); }));
  if (pairs.length >= 10) {
    pairs.sort((a, b) => b[2] - a[2]);
    const fort = pairs.filter((p) => p[2] >= 0.5);
    out.push(fort.length ? `Couples fortement corrélés (1 an, ≥ 0,50) : ${fort.slice(0, 4).map((p) => `${p[0]}–${p[1]} (${F.n2(p[2])})`).join(', ')}${fort.length > 4 ? ` et ${fort.length - 4} autre(s)` : ''}. Détenus ensemble, ils diversifient peu.`
      : `Aucun couple n'atteint une corrélation de 0,50 sur 1 an ; le plus élevé est ${pairs[0][0]}–${pairs[0][1]} (${F.n2(pairs[0][2])}).`);
    const avg = d3.mean(pairs, (p) => p[2]);
    out.push(`Corrélation moyenne entre deux titres : ${F.n2(avg)}. ${avg < 0.2 ? 'Les titres évoluent largement de façon indépendante : un portefeuille de plusieurs valeurs peut réduire les variations d\'ensemble.' : 'Les titres évoluent souvent dans le même sens : la diversification par le nombre de titres est limitée.'} Limites : les corrélations sont mesurées sur le passé, elles changent dans le temps, elles n'indiquent aucune relation de cause à effet, et un titre peu échangé peut paraître faussement indépendant (les titres trop souvent inchangés sont exclus du calcul).`);
  } else out.push('Pas assez de couples de titres fiables pour commenter les corrélations.');
  $('#rk-syn').replaceChildren(...out.map((t) => el('li', {}, t)));
}
function rkSecteurs() {
  const k = RK.secM, f = TIT.filter((t) => t.risque_fiabilite === 'fiable' && ok(t[k]));
  const rows = SECTORS.map((x) => { const g = f.filter((t) => t.secteur === x); return { label: x, value: d3.median(g, (t) => t[k]), c: secColor(x), extra: [`${g.length} titre(s) aux mesures fiables`] }; }).filter((r) => ok(r.value))
    .sort((a, b) => (k === 'max_dd_1a' ? a.value - b.value : b.value - a.value));
  hbars($('#rk-sec'), rows, { f: k === 'beta_1a' ? F.n2 : (v) => F.pct(v, 0) });
}
function rkDist() {
  const box = $('#rk-dist'), h = 280;
  const v = TIT.filter((t) => ok(t.vol_1a)).map((t) => ({ t, v: t.vol_1a }));
  if (!v.length) return empty(box, 'Pas de données');
  const { svg, w } = svgIn(box, h);
  const bins = d3.bin().value((d) => d.v).thresholds(d3.range(0, Math.max(0.8, d3.max(v, (d) => d.v)) + 0.1, 0.1))(v);
  const x = d3.scaleBand(bins.map((b) => b.x0), [36, w - 8]).padding(0.15), y = d3.scaleLinear([0, d3.max(bins, (b) => b.length)], [h - 26, 10]).nice();
  svg.append('g').attr('class', 'grid').attr('transform', 'translate(32,0)').call(d3.axisLeft(y).ticks(4).tickSize(-(w - 40)));
  svg.append('g').attr('transform', `translate(0,${h - 22})`).call(d3.axisBottom(x).tickSize(0).tickFormat((d) => { const a = Math.floor(d * 10 + 1e-9) / 10; return `${Math.round(a * 100)}–${Math.round(a * 100) + 10} %`; }));
  bins.forEach((b) => svg.append('rect').attr('x', x(b.x0)).attr('width', x.bandwidth()).attr('y', y(b.length)).attr('height', h - 26 - y(b.length)).attr('rx', 3).attr('fill', css('--c1')).attr('opacity', 0.75)
    .on('mousemove', (ev) => showTip(ev, `Volatilité de ${F.pct(b.x0, 0)} à ${F.pct(b.x1, 0)}`, [{ t: `${b.length} titre(s)` }, { t: b.map((d) => d.t.symbole).join(', ') }])).on('mouseleave', hideTip));
}
function rkTable() {
  const q = $('#rk-q').value.trim().toLowerCase(), sv = $('#rk-fsec').value, fo = $('#rk-fiab').checked;
  const rows = TIT.filter((t) => (!q || (t.symbole + ' ' + t.nom).toLowerCase().includes(q)) && (!sv || t.secteur === sv) && (!fo || t.risque_fiabilite === 'fiable'));
  const { k, dir } = RK.sort;
  rows.sort((a, b) => { const x = a[k], y = b[k]; if (typeof x === 'string') return dir * x.localeCompare(y, 'fr'); if (!ok(x)) return 1; if (!ok(y)) return -1; return dir * (x - y); });
  table($('#rk-table'), rows, [{ k: 'symbole', h: 'Symbole', l: true, sym: true }, { k: 'nom', h: 'Titre', l: true, nm: true }, { k: 'secteur', h: 'Secteur', l: true, nm: true },
    { k: 'vol_1a', h: 'Volat. 1 an', f: (v) => F.pct(v), bar: true }, { k: 'downside_dev_1a', h: 'Downside dev.', f: (v) => F.pct(v) }, { k: 'beta_1a', h: 'Bêta (réf.)', f: F.n2 },
    { k: 'beta_dimson_1a', h: 'Bêta corrigé', f: F.n2 }, { k: 'correl_marche_1a', h: 'Corrél. marché', f: F.n2 }, { k: 'max_dd_1a', h: 'Perte max.', f: (v) => F.pct(v) },
    { k: 'seances_inchangees', h: 'Séances inch.', f: (v) => F.pct(v, 0) }, { k: 'n_obs_1a', h: 'Obs.', f: F.n0 },
    { k: 'risque_fiabilite', h: 'Fiabilité', l: true, f: (v) => v === 'fiable' ? '✓ fiable' : v ? '⚠ ' + v : '—' }],
  { sort: RK.sort, onSort: (kk) => { RK.sort = { k: kk, dir: RK.sort.k === kk ? -RK.sort.dir : -1 }; rkTable(); }, click: (r) => openTitle(r.symbole) });
}
const hmCol = () => d3.scaleLinear([-0.4, 0, 0.3, 1], [css('--down'), css('--panel'), '#9fb6d3', css('--c1')]).clamp(true);
function hmLecture(v) { return !ok(v) ? 'non calculée (moins de 120 observations communes)' : v >= 0.7 ? 'très forte : évoluent presque toujours ensemble' : v >= 0.5 ? 'forte' : v >= 0.3 ? 'modérée' : v > -0.1 ? 'faible : évoluent de façon largement indépendante' : 'négative : tendent à évoluer en sens inverse'; }
function heatmap() {
  const C = D.correlations || {}, S_ = C.symboles || [];
  const pos = new Map(S_.map((s, i) => [s, i]));
  const val = (a, b) => (pos.has(a) && pos.has(b) ? C.matrice[pos.get(a)][pos.get(b)] : null);
  const nco = (a, b) => (C.n_communs && pos.has(a) && pos.has(b) ? C.n_communs[pos.get(a)][pos.get(b)] : null);
  const ex = C.exclus || {};
  $('#hm-note').textContent = `Rendements quotidiens sur ${C.periode || '1 an'} · ${S_.length} titres retenus · au moins ${C.min_obs || 120} observations communes par couple. Une corrélation mesure un lien statistique passé, jamais une relation de cause à effet.`;
  $('#hm-excl').textContent = Object.keys(ex).length ? `Titres exclus du calcul : ${Object.entries(ex).map(([s, r]) => `${s} (${r})`).join(' ; ')}.` : '';
  const det = RK.hm === 'det';
  $('#hm-det').hidden = !det; $('#hm-syn').hidden = det;
  if (!S_.length) { $('#hm-syn').replaceChildren(el('p', { class: 'note' }, 'Matrice non disponible.')); return; }
  const pairs = [];
  S_.forEach((a, i) => S_.forEach((b, j) => { const v = C.matrice[i][j]; if (j > i && ok(v)) pairs.push([a, b, v]); }));
  if (!det) {
    const col = hmCol();
    const pr = (a, b, v) => el('div', { class: 'pr', title: `${a} × ${b} : ${hmLecture(v)} · ${nco(a, b)} observations communes`, onclick: () => { RK.hm = 'det'; RK.hmPick = [a, b]; $('#hm-mode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === 'det')); heatmap(); } },
      el('span', {}, `${a} – ${b}`), el('span', { class: 'bar' }, el('i', { style: `width:${Math.round(Math.abs(v) * 100)}%;background:${col(v)}` })), el('span', {}, F.n2(v)));
    const s = pairs.slice().sort((a, b) => b[2] - a[2]);
    const avg = S_.map((a) => ({ a, v: d3.mean(S_.filter((b) => b !== a).map((b) => val(a, b)).filter(ok)) })).filter((x) => ok(x.v)).sort((p, q) => p.v - q.v);
    $('#hm-syn').replaceChildren(el('div', { class: 'hm-syn' },
      el('div', {}, el('h3', {}, 'Les plus corrélés'), ...s.slice(0, 8).map((p) => pr(...p))),
      el('div', {}, el('h3', {}, 'Les moins corrélés'), ...s.slice(-8).reverse().map((p) => pr(...p))),
      el('div', {}, el('h3', {}, 'Les plus indépendants du reste'), ...avg.slice(0, 8).map((x) => el('div', { class: 'pr', onclick: () => openTitle(x.a), title: 'Corrélation moyenne avec les autres titres retenus' }, el('span', {}, `${x.a} · ${(TIT.find((t) => t.symbole === x.a) || {}).secteur || ''}`), el('span', { class: 'bar' }, el('i', { style: `width:${Math.round(Math.max(0, x.v) * 100)}%;background:${col(x.v)}` })), el('span', {}, F.n2(x.v)))))),
    el('p', { class: 'note', style: 'margin-top:8px' }, 'Cliquez sur un couple pour l\'ouvrir dans la vue détaillée.'));
    return;
  }
  // vue détaillée : 5, 10 ou 15 titres (par capitalisation), filtre sectoriel, ou titres choisis
  const fs = $('#hm-sec').value;
  let order;
  if (RK.hmPick.length) order = RK.hmPick.filter((s) => pos.has(s));
  else order = TIT.filter((t) => pos.has(t.symbole) && (!fs || t.secteur === fs)).sort((a, b) => (b.capitalisation || 0) - (a.capitalisation || 0)).slice(0, RK.hmN).map((t) => t.symbole);
  const notIn = RK.hmPick.filter((s) => !pos.has(s));
  $('#hm-chosen').replaceChildren(...RK.hmPick.map((s) => el('span', { class: 'chip on x' }, s, el('button', { 'aria-label': 'Retirer ' + s, onclick: () => { RK.hmPick = RK.hmPick.filter((x) => x !== s); heatmap(); } }, '×'))),
    ...(RK.hmPick.length ? [el('button', { class: 'linkbtn', onclick: () => { RK.hmPick = []; heatmap(); } }, 'revenir à la sélection automatique')] : []),
    ...(notIn.length ? [el('span', { class: 'note' }, ` ${notIn.join(', ')} : exclu(s) du calcul`)] : []));
  if (RK.hmOrd === 'secteur') {
    const sec = (s) => (TIT.find((t) => t.symbole === s) || {}).secteur || '';
    order.sort((a, b) => SECTORS.indexOf(sec(a)) - SECTORS.indexOf(sec(b)));
  } else if (order.length > 2) {   // chaîne : chaque titre est suivi du titre restant qui lui est le plus corrélé
    const rest = new Set(order), chain = [];
    let cur = order.slice().sort((a, b) => d3.mean(order.map((x) => val(b, x)).filter(ok)) - d3.mean(order.map((x) => val(a, x)).filter(ok)))[0];
    while (cur) { chain.push(cur); rest.delete(cur); let best = null, bv = -2; rest.forEach((x) => { const v = val(cur, x); if (ok(v) && v > bv) { bv = v; best = x; } }); cur = best || [...rest][0]; }
    order = chain;
  }
  const col = hmCol();
  $('#hm-leg').replaceChildren(el('span', {}, '−0,4 ou moins'), el('span', { class: 'bar', style: `background:linear-gradient(90deg, ${col(-0.4)}, ${col(0)}, ${col(0.3)}, ${col(1)})` }), el('span', {}, '+1'),
    el('span', {}, ' · rouge : sens inverse · blanc : indépendants · bleu foncé : évoluent ensemble · case grise : non calculée'));
  const box = $('#heatmap'), n = order.length;
  if (n < 2) return empty(box, 'Choisissez au moins deux titres retenus dans le calcul');
  const lab = 64;
  const cell = Math.max(18, Math.min(56, Math.floor((Math.min(760, Math.max(320, box.clientWidth)) - lab - 10) / n)));
  const { svg } = svgIn(box, lab + n * cell + 6);
  order.forEach((s, i) => {
    const t = TIT.find((x) => x.symbole === s) || {}, c = secColor(t.secteur);
    svg.append('text').attr('x', lab - 6).attr('y', lab + i * cell + cell / 2 + 4).attr('text-anchor', 'end').style('fill', c).style('font-size', '11px').style('font-weight', 600).text(s).style('cursor', 'pointer').on('click', () => openTitle(s));
    svg.append('text').attr('transform', `translate(${lab + i * cell + cell / 2 + 4},${lab - 6}) rotate(-60)`).style('fill', c).style('font-size', '11px').style('font-weight', 600).text(s);
  });
  order.forEach((a, i) => order.forEach((b, j) => {
    const v = i === j ? 1 : val(a, b);
    const g = svg.append('rect').attr('x', lab + j * cell).attr('y', lab + i * cell).attr('width', cell - 2).attr('height', cell - 2).attr('rx', 3)
      .attr('fill', i === j ? css('--grid') : ok(v) ? col(v) : css('--grid')).attr('stroke', ok(v) || i === j ? 'none' : css('--line'));
    if (i !== j) g.on('mousemove', (ev) => showTip(ev, `${a} × ${b}`, [{ t: `Corrélation : ${ok(v) ? F.n2(v) : 'n.d.'}` }, { t: hmLecture(v) }, { t: `${nco(a, b) ?? '—'} séances communes · 1 an` }])).on('mouseleave', hideTip);
    if (i !== j && cell >= 30 && ok(v)) svg.append('text').attr('x', lab + j * cell + cell / 2 - 1).attr('y', lab + i * cell + cell / 2 + 4).attr('text-anchor', 'middle').style('font-size', cell >= 44 ? '12px' : '10px').style('pointer-events', 'none').style('fill', v > 0.55 ? '#fff' : css('--fg')).text(F.n2(v));
  }));
}
function rkDoc() {
  const box = $('#rk-doc');
  if (box.dataset.ok) return;
  box.dataset.ok = '1';
  const rows = [
    ['Performance', 'cours de clôture / cours à la date de début − 1', '6 mois, 1, 2 ou 3 ans', '%', 'cours BRVM ajustés des opérations sur titres', 'titre coté au début de la période, sinon non affiché'],
    ['Volatilité', 'écart-type des rendements quotidiens × √252', 'idem', '% par an', 'idem', '≥ 120 rendements et ≤ 30 % de séances inchangées'],
    ['Perte maximale', 'plus forte baisse d\'un plus haut à un plus bas', 'idem', '%', 'idem', 'idem'],
    ['Bêta (référence)', 'covariance(titre, BRVM Composite) / variance(BRVM Composite)', '1 an', 'nombre', 'idem', 'idem'],
    ['Bêta corrigé (Dimson)', 'somme des coefficients sur le marché de la veille, du jour et du lendemain', '1 an', 'nombre', 'idem', 'complément du bêta, pour les titres peu échangés'],
    ['Corrélation', 'Pearson des rendements quotidiens de deux titres', '1 an', 'de −1 à +1', 'idem', 'titres éligibles et ≥ 120 séances communes ; aucune causalité'],
    ['Zones descriptives', 'performance ≥ 0 ou < 0 ; volatilité ≤ ou > médiane des titres affichés', 'période choisie', '—', 'calcul', 'description du passé, pas une recommandation'],
  ];
  box.append(el('div', { class: 'scroll' }, el('table', { class: 'tbl compact' }, el('thead', {}, el('tr', {}, ...['Indicateur', 'Formule', 'Période', 'Unité', 'Source', 'Contrôle qualité'].map((h) => el('th', { class: 'l' }, h)))),
    el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.map((c) => el('td', { class: 'l nm' }, c))))))),
  el('p', { class: 'note' }, `Date de référence : séance du ${F.date(D.resume.seance)}. Rendements simples quotidiens ; un rendement calculé à travers une séance manquante non fériée est exclu ; aucune donnée manquante n'est remplacée par zéro.`));
}

// ------------------------------------------------------------------ DIVIDENDES
const DV = { sort: { k: 'd2025', dir: -1 } };
function dividendes() {
  const p = TIT.filter((t) => ok(t.rendement) && t.rendement > 0);   // dividende de référence positif et daté
  const best = p.slice().sort((a, b) => b.rendement - a.rendement)[0];
  const today = new Date().toISOString().slice(0, 10);
  // événements à venir : AGO, ex-cote, paiement
  const ev = [];
  TIT.forEach((t) => [['ago', 'AGO', 'ago'], ['ex_cote', 'Détachement (ex-cote)', 'ex'], ['date_valeur', 'Paiement', 'pay']].forEach(([k, l, c]) => { if (t[k] && t[k] >= today) ev.push({ d: t[k], l, c, t }); }));
  ev.sort((a, b) => a.d.localeCompare(b.d));
  // sans événement annoncé : les plus récents (90 derniers jours), signalés comme passés
  const past = [];
  if (ev.length < 4) TIT.forEach((t) => [['ago', 'AGO', 'ago'], ['ex_cote', 'Détachement (ex-cote)', 'ex'], ['date_valeur', 'Paiement', 'pay']].forEach(([k, l, c]) => {
    if (t[k] && t[k] < today && t[k] >= new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)) past.push({ d: t[k], l, c: c + ' past', t }); }));
  past.sort((a, b) => b.d.localeCompare(a.d));
  const jours = (d) => Math.round((new Date(d + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 864e5);
  const sm = (l, v, sub) => el('div', { class: 's' }, el('div', { class: 'l' }, l), el('div', { class: 'v' }, v), sub ? el('div', { class: 'note' }, sub) : null);
  const nx = ev.find((e) => e.c === 'ex');
  $('#dv-kpis').replaceChildren(sm('Sociétés versant un dividende', `${p.length}`, `sur ${TIT.length} cotées`),
    sm('Rendement médian', F.pct(d3.median(p, (t) => t.rendement), 2), 'dividende de référence / cours'),
    sm('Meilleur rendement', best ? `${best.symbole} ${F.pct(best.rendement, 1)}` : '—', best?.nom),
    sm('Dividendes distribués (estim.)', F.big(d3.sum(p, (t) => t.dividende_ref * (t.nb_actions || 0))), 'FCFA · dividende de référence × actions'),
    sm('Prochain détachement', nx ? `${nx.t.symbole} · ${nx.d.split('-').reverse().slice(0, 2).join('/')}` : 'aucun annoncé', nx ? `dans ${jours(nx.d)} jour(s) · ${F.n2(nx.t.dividende_ref)} FCFA` : ''));
  $('#dv-next-note').textContent = ev.length ? 'AGO, détachements (ex-cote) et paiements annoncés, à partir d\'aujourd\'hui' : 'Aucun événement annoncé à partir d\'aujourd\'hui dans les données collectées : voici les plus récents (90 derniers jours).';
  const evs = ev.length ? ev : past;
  $('#dv-next').replaceChildren(...(evs.length ? evs.slice(0, 20).map((e) => el('div', { class: 'dv-ev ' + e.c, onclick: () => openTitle(e.t.symbole), title: e.t.dividende_detail || '' },
    el('div', { class: 'd' }, F.date(e.d)), el('div', { class: 't' }, e.l), el('div', { class: 'n' }, `${e.t.symbole} · ${e.t.nom}`),
    el('div', { class: 'm' }, ok(e.t.dividende_ref) && e.t.dividende_ref > 0 ? `${F.n2(e.t.dividende_ref)} FCFA (${e.t.dividende_statut || ''})` : e.t.dividende_statut || ''),
    el('div', { class: 'j' }, jours(e.d) === 0 ? 'aujourd\'hui' : jours(e.d) > 0 ? `dans ${jours(e.d)} jour(s)` : `il y a ${-jours(e.d)} jour(s)`)))
    : [el('p', { class: 'note' }, 'Aucune AGO, aucun détachement ni paiement annoncé à partir d\'aujourd\'hui dans les données collectées (Bulletin Officiel de la Cote et référentiel).')]));
  const fs = $('#dv-fsec');
  if (!fs.options.length) {
    fs.replaceChildren(new Option('Tous les secteurs', ''), ...SECTORS.map((x) => new Option(x, x)));
    fs.addEventListener('input', dvBars);
    ['#dv-q', '#dv-st'].forEach((id) => $(id).addEventListener('input', dvCal));
    $('#dv-hq').addEventListener('input', dvHist);
  }
  dvBars();
  hbars($('#dv-sec'), SECTORS.map((x) => { const g = p.filter((t) => t.secteur === x); return { label: x, value: d3.median(g, (t) => t.rendement), c: secColor(x), extra: [`${g.length} société(s) versant un dividende`] }; })
    .filter((r) => ok(r.value)).sort((a, b) => b.value - a.value), { f: (v) => F.pct(v, 2) });
  const H = D.historique_titres || {};
  const reg = [0, 1, 2, 3, 4].map((n) => ({ label: `${n} sur 4`, value: TIT.filter((t) => { const d = (H[t.symbole]?.dividendes || []).filter((x) => ok(x.dividende)); return d.length && d.filter((x) => x.dividende > 0).length === n; }).length, c: n === 4 ? css('--up') : n === 0 ? css('--down') : css('--c1') }));
  hbars($('#dv-reg'), reg, { f: (v) => `${v} société(s)` });
  dvHist(); dvCal();
}
function dvBars() {
  const fs = $('#dv-fsec').value;
  const p = TIT.filter((t) => ok(t.rendement) && t.rendement > 0 && (!fs || t.secteur === fs));
  hbars($('#dv-chart'), p.slice().sort((a, b) => b.rendement - a.rendement).slice(0, 20).map((t) => ({ label: t.symbole, value: t.rendement, c: secColor(t.secteur), title: t.nom, extra: [`Dividende de référence : ${F.n2(t.dividende_ref)} FCFA`, t.dividende_detail || '', `Cours : ${F.n0(t.cours)}`] })), { f: (v) => F.pct(v, 2), click: (d) => openTitle(d.label) });
}
function dvHist() {
  const H = D.historique_titres || {}, q = $('#dv-hq').value.trim().toLowerCase();
  const ex = [2022, 2023, 2024, 2025];
  const rows = TIT.filter((t) => H[t.symbole] && (!q || (t.symbole + ' ' + t.nom).toLowerCase().includes(q))).map((t) => {
    const d = Object.fromEntries((H[t.symbole].dividendes || []).map((x) => [x.exercice, x.dividende]));
    const k = ex.map((e) => d[e]).filter(ok);
    const r = { symbole: t.symbole, nom: t.nom, secteur: t.secteur, rendement: t.rendement, reg: k.length ? k.filter((v) => v > 0).length : null, nreg: k.length };
    ex.forEach((e) => { r['d' + e] = ok(d[e]) ? d[e] : null; });
    r.croiss = ok(d[2025]) && ok(d[2024]) && d[2024] > 0 ? d[2025] / d[2024] - 1 : null;
    return r;
  });
  const { k, dir } = DV.sort;
  rows.sort((a, b) => { const x = a[k], y = b[k]; if (typeof x === 'string') return dir * x.localeCompare(y, 'fr'); if (!ok(x)) return 1; if (!ok(y)) return -1; return dir * (x - y); });
  const fd = (v) => (v === null ? 'n.d.' : v === 0 ? 'aucun' : F.n0(v));
  table($('#dv-hist'), rows, [{ k: 'symbole', h: 'Symbole', l: true, sym: true }, { k: 'nom', h: 'Titre', l: true, nm: true },
    ...ex.map((e) => ({ k: 'd' + e, h: String(e), f: fd })), { k: 'croiss', h: '2025 / 2024', f: (v) => F.spct(v, 1), cls: true },
    { k: 'reg', h: 'Régularité', f: (v) => (ok(v) ? `${v} / 4` : '—') }, { k: 'rendement', h: 'Rdt actuel', f: (v) => F.pct(v, 2) }, { k: 'secteur', h: 'Secteur', l: true, nm: true }],
  { sort: DV.sort, onSort: (kk) => { DV.sort = { k: kk, dir: DV.sort.k === kk ? -DV.sort.dir : -1 }; dvHist(); }, click: (r) => openTitle(r.symbole) });
  // petite barre proportionnelle au plus haut dividende de la société
  [...$('#dv-hist').querySelectorAll('tbody tr')].forEach((tr, i) => { const r = rows[i]; const mx = d3.max(ex, (e) => r['d' + e]) || 0;
    ex.forEach((e, j) => { const v = r['d' + e]; if (ok(v) && v > 0 && mx > 0) tr.children[2 + j].prepend(el('span', { class: 'db', style: `width:${Math.round(4 + 26 * v / mx)}px` })); }); });
}
function dvCal() {
  const q = $('#dv-q').value.trim().toLowerCase(), st = $('#dv-st').value;
  const cal = TIT.filter((t) => t.dividende_statut && t.dividende_statut !== 'inconnu' && (!st || t.dividende_statut === st) && (!q || (t.symbole + ' ' + t.nom).toLowerCase().includes(q)))
    .sort((a, b) => String(b.ex_cote || '').localeCompare(String(a.ex_cote || '')));
  const dsh = (v) => (v ? F.dshort(new Date(v + 'T00:00:00Z')) : '—');
  table($('#dv-table'), cal, [
    { k: 'symbole', h: 'Symbole', l: true, sym: true }, { k: 'nom', h: 'Titre', l: true, nm: true },
    { k: 'dividende_ref', h: 'Div. de réf.', f: F.n2 }, { k: 'dividende_ref_exercice', h: 'Exercice', f: (v) => v || '—' }, { k: 'rendement', h: 'Rdt', f: (v) => ok(v) ? F.pct(v, 2) : '—' },
    { k: 'dividende_statut', h: 'Statut', l: true, f: (v) => ({ 'payé': 'payé', 'décidé': 'décidé', 'aucun dividende': 'aucun', 'ancien': '⚠ ancien' }[v] || v) },
    { k: 'ago', h: 'AGO', f: dsh }, { k: 'ex_cote', h: 'Ex-cote', f: dsh }, { k: 'date_valeur', h: 'Paiement', f: dsh },
  ], { click: (r) => openTitle(r.symbole) });
  [...$('#dv-table').querySelectorAll('tbody tr')].forEach((tr, i) => { const t = cal[i]; tr.title = (t.dividende_detail || '') + (t.dividende_ecart_sources ? ' · ' + t.dividende_ecart_sources : ''); });
}

// ------------------------------------------------------------------ OBLIGATIONS
const OB = { hidden: new Set(), sort: { k: 'annees_restantes', dir: 1 } };
function obligations() {
  const rows = (D.obligations || []).map((o) => ({ ...o, traite: String(o.traite).toLowerCase() === 'true',
    fiab_tip: [o.fiabilite_motif, o.alertes, o.hypotheses ? 'Hypothèses : ' + o.hypotheses : ''].filter(Boolean).join('\n') }));
  const retenue = (o) => !o.fiabilite || o.fiabilite === 'fiable' || o.fiabilite === 'estimation';   // lot 5
  const R = D.obligations_resume || {};
  if (!rows.length) {
    $('#ob-src').textContent = 'Les données obligataires apparaîtront après la prochaine collecte du robot (lecture du Bulletin Officiel de la Cote).';
    return;
  }
  $('#ob-src').textContent = `Cours du Bulletin Officiel de la Cote du ${F.date(R.date)} (publié le lendemain de la séance).`;
  const k = (l, v, n) => el('div', { class: 's' }, el('div', { class: 'l' }, l), el('div', { class: 'v' }, v), n ? el('div', { class: 'note' }, n) : null);
  $('#ob-kpis').replaceChildren(
    k('Capitalisation obligataire', ok(R.capitalisation_obligations) ? F.big(R.capitalisation_obligations) + ' FCFA' : '—'),
    k('Valeur échangée', ok(R.valeur_obligations) ? F.big(R.valeur_obligations) + ' FCFA' : '—', ok(R.nb_obligations_traitees) ? `${R.nb_obligations_traitees} lignes échangées` : ''),
    k('Lignes cotées', String(R.nb_lignes ?? rows.length), ok(R.nb_traitees) ? `${R.nb_traitees} cotées ce jour-là` : ''),
    k('Rendement médian souverain', F.pct(R.rendement_median_souverain, 2), ok(R.nb_souverain_median) ? `actuariel estimé · ${R.nb_souverain_median} lignes retenues` : 'actuariel estimé'),
    k('Duration médiane', F.n1(R.duration_mediane), 'sensibilité aux taux'),
    ...(R.fiabilite ? [k('Calculs exploitables', `${(R.fiabilite.fiable || 0) + (R.fiabilite.estimation || 0)} / ${R.nb_lignes}`,
      `${R.fiabilite.fiable || 0} fiables · ${R.fiabilite['non significatif'] || 0} non significatifs · ${R.fiabilite['non calculable'] || 0} non calculables`)] : []),
  );
  const pays = [...new Set(rows.filter((o) => o.type === 'Souverain').map((o) => o.pays))].sort();
  const pcol = (p) => palette()[pays.indexOf(p) % 7];
  $('#ob-pays').replaceChildren(...pays.map((p) => el('button', {
    class: 'chip' + (OB.hidden.has(p) ? '' : ' on'), onclick: (e) => { OB.hidden.has(p) ? OB.hidden.delete(p) : OB.hidden.add(p); e.currentTarget.classList.toggle('on'); curve(); },
  }, el('i', { style: `background:${pcol(p)}` }), p)));
  const curve = () => {
    const box = $('#ob-curve');
    const pts = rows.filter((o) => o.type === 'Souverain' && !OB.hidden.has(o.pays) && ok(o.annees_restantes) && o.annees_restantes > 0 && ok(o.rendement_actuariel) && retenue(o) && (o.fiabilite || o.rendement_actuariel > 0 && o.rendement_actuariel < 0.2));
    if (!pts.length) return empty(box, 'Aucune obligation à afficher');
    const h = 420; const { svg, w } = svgIn(box, h);
    const y = d3.scaleLinear(d3.extent(pts, (o) => o.rendement_actuariel), [h - 30, 14]).nice();
    const ml = d3.max(y.ticks(6), (t) => tw(svg, F.pct(t, 1))) + 14;
    const x = d3.scaleLinear([0, d3.max(pts, (o) => o.annees_restantes)], [ml, w - 20]).nice();
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${ml - 4},0)`).call(d3.axisLeft(y).ticks(6).tickFormat((v) => F.pct(v, 1)).tickSize(-(w - ml - 16)));
    svg.append('g').attr('transform', `translate(0,${h - 26})`).call(d3.axisBottom(x).ticks(8).tickFormat((v) => v + ' an' + (v > 1 ? 's' : '')).tickSize(0));
    svg.append('text').attr('x', w - 20).attr('y', h - 32).attr('text-anchor', 'end').text('Durée restante →');
    svg.append('text').attr('x', ml + 4).attr('y', 24).text('↑ Rendement actuariel');
    for (const p of pays) {   // courbe ajustée : y = a + b·ln(1+T)
      const g = pts.filter((o) => o.pays === p);
      if (g.length < 4) continue;
      const X = g.map((o) => Math.log(1 + o.annees_restantes)), Y = g.map((o) => o.rendement_actuariel);
      const mx = d3.mean(X), my = d3.mean(Y);
      const b = d3.sum(X.map((v, i) => (v - mx) * (Y[i] - my))) / (d3.sum(X.map((v) => (v - mx) ** 2)) || 1);
      const a = my - b * mx;
      const T = d3.range(d3.min(g, (o) => o.annees_restantes), d3.max(g, (o) => o.annees_restantes) + 0.01, 0.1);
      svg.append('path').attr('d', d3.line().x((t) => x(t)).y((t) => y(a + b * Math.log(1 + t)))(T)).attr('fill', 'none').attr('stroke', pcol(p)).attr('stroke-width', 2).attr('opacity', .8);
    }
    pts.forEach((o) => svg.append('circle').attr('cx', x(o.annees_restantes)).attr('cy', y(o.rendement_actuariel)).attr('r', o.traite ? 6 : 4.5)
      .attr('fill', pcol(o.pays)).attr('fill-opacity', o.traite ? .9 : .45).attr('stroke', pcol(o.pays))
      .on('mousemove', (ev) => showTip(ev, `${o.titre} (${o.symbole})`, [{ c: pcol(o.pays), t: o.pays }, { t: `Rendement actuariel : ${F.pct(o.rendement_actuariel, 2)} · coupon ${F.pct(o.taux_coupon, 2)}` }, { t: `Cours ${F.n0(o.cours)} (${F.pct(o.cours_pct, 1)} du nominal)${o.traite ? ' · échangée ce jour' : ''}` }, { t: `Échéance ${o.echeance ? F.dshort(new Date(o.echeance + 'T00:00:00Z')) : '—'} · duration ${F.n2(o.duration_modifiee)}` }, ...(o.fiabilite ? [{ t: `Fiabilité : ${o.fiabilite}${o.alertes ? ' · ' + o.alertes : ''}` }] : [])]))
      .on('mouseleave', hideTip));
  };
  curve();
  hbars($('#ob-bars'), (R.par_pays || []).filter((p) => ok(p.rendement_median)).sort((a, b) => b.rendement_median - a.rendement_median)
    .map((p) => ({ label: p.pays, value: p.rendement_median, c: pcol(p.pays), extra: [ok(p.lignes_retenues) ? `${p.lignes_retenues} lignes retenues sur ${p.lignes}` : `${p.lignes} lignes`] })), { f: (v) => F.pct(v, 2) });
  // échéancier : lignes par année d'échéance et type d'émetteur
  const types = [...new Set(rows.map((o) => o.type).filter(Boolean))].sort();
  const tcol = (t) => palette()[(types.indexOf(t) + 2) % 7];
  const yrs = rows.filter((o) => o.echeance).map((o) => +o.echeance.slice(0, 4));
  if (yrs.length) {
    const box = $('#ob-ech'), h = 260, { svg, w } = svgIn(box, h);
    const Y = d3.range(d3.min(yrs), d3.max(yrs) + 1);
    const data = Y.map((y) => { const r = { y }; types.forEach((t) => { r[t] = rows.filter((o) => o.type === t && o.echeance && +o.echeance.slice(0, 4) === y).length; }); return r; });
    const st = d3.stack().keys(types)(data);
    const x = d3.scaleBand(Y, [34, w - 6]).padding(0.15), yy = d3.scaleLinear([0, d3.max(data, (r) => d3.sum(types, (t) => r[t]))], [h - 24, 8]).nice();
    svg.append('g').attr('class', 'grid').attr('transform', 'translate(30,0)').call(d3.axisLeft(yy).ticks(4).tickSize(-(w - 36)));
    svg.append('g').attr('transform', `translate(0,${h - 20})`).call(d3.axisBottom(x).tickSize(0).tickValues(Y.filter((y, i) => Y.length < 14 || i % 2 === 0)));
    st.forEach((layer) => layer.forEach((d) => { if (d[1] > d[0]) svg.append('rect').attr('x', x(d.data.y)).attr('width', x.bandwidth()).attr('y', yy(d[1])).attr('height', yy(d[0]) - yy(d[1])).attr('fill', tcol(layer.key))
      .on('mousemove', (ev) => showTip(ev, `Échéance ${d.data.y}`, types.filter((t) => d.data[t]).map((t) => ({ c: tcol(t), t: `${t} : ${d.data[t]} ligne(s)` })))).on('mouseleave', hideTip); }));
    $('#ob-ech-leg').replaceChildren(...types.map((t) => el('span', {}, el('i', { style: `background:${tcol(t)}` }), t)));
  } else empty($('#ob-ech'), 'Échéances non disponibles');
  const tyRows = types.map((t) => { const g = rows.filter((o) => o.type === t), gr = g.filter((o) => retenue(o) && ok(o.rendement_actuariel));
    return { type: t, n: g.length, coupon: d3.mean(g.filter((o) => ok(o.taux_coupon)), (o) => o.taux_coupon), rdt: d3.median(gr, (o) => o.rendement_actuariel), dur: d3.median(gr, (o) => o.duration_modifiee) }; });
  table($('#ob-types'), tyRows, [{ k: 'type', h: 'Émetteur', l: true }, { k: 'n', h: 'Lignes', f: F.n0 }, { k: 'coupon', h: 'Coupon moyen', f: (v) => F.pct(v, 2) }, { k: 'rdt', h: 'Rdt médian', f: (v) => F.pct(v, 2) }, { k: 'dur', h: 'Duration méd.', f: F.n2 }]);
  const lim = new Date(new Date(R.date + 'T00:00:00Z').getTime() + 60 * 864e5).toISOString().slice(0, 10);
  const cal = rows.filter((o) => o.date_prochain_coupon && o.date_prochain_coupon <= lim).sort((a, b) => a.date_prochain_coupon.localeCompare(b.date_prochain_coupon));
  table($('#ob-cal'), cal, [{ k: 'date_prochain_coupon', h: 'Date', l: true, f: (v) => F.dshort(new Date(v + 'T00:00:00Z')) }, { k: 'symbole', h: 'Symbole', l: true, sym: true, title: 'titre' }, { k: 'pays', h: 'Pays', l: true }, { k: 'prochain_coupon', h: 'Coupon', f: F.n2 }, { k: 'amortissement', h: 'Rembt', l: true }]);
  const ts = $('#ob-type'), ps = $('#ob-pays-sel');
  if (!ts.options.length) {
    ts.replaceChildren(new Option('Tous les émetteurs', ''), ...[...new Set(rows.map((o) => o.type))].sort().map((t) => new Option(t, t)));
    ps.replaceChildren(new Option('Tous les pays', ''), ...[...new Set(rows.map((o) => o.pays))].filter((p) => p && p !== '—').sort().map((p) => new Option(p, p)));
    ['#ob-q', '#ob-type', '#ob-pays-sel', '#ob-fiab'].forEach((id) => $(id).addEventListener('input', obTable));
  }
  function obTable() {
    const q = $('#ob-q').value.trim().toLowerCase(), tv = ts.value, pv = ps.value;
    const { k: sk, dir } = OB.sort;
    const fv = $('#ob-fiab').value;
    const list = rows.filter((o) => (!q || (o.symbole + ' ' + o.titre).toLowerCase().includes(q)) && (!tv || o.type === tv) && (!pv || o.pays === pv) && (!fv || o.fiabilite === fv))
      .sort((a, b) => { const x = a[sk], y = b[sk]; if (typeof x === 'string') return dir * x.localeCompare(y, 'fr'); if (!ok(x)) return 1; if (!ok(y)) return -1; return dir * (x - y); });
    $('#ob-count').textContent = `${list.length} ligne(s)`;
    table($('#ob-table'), list, [
      { k: 'symbole', h: 'Symbole', l: true, sym: true }, { k: 'titre', h: 'Intitulé', l: true, nm: true }, { k: 'pays', h: 'Pays', l: true },
      { k: 'taux_coupon', h: 'Coupon', f: (v) => F.pct(v, 2) }, { k: 'annees_restantes', h: 'Années rest.', f: F.n1 },
      { k: 'nominal', h: 'Nominal rest.', f: F.n0 }, { k: 'cours', h: 'Cours', f: F.n0 }, { k: 'cours_pct', h: '% nominal', f: (v) => F.pct(v, 1) },
      { k: 'rendement_courant', h: 'Rdt courant', f: (v) => F.pct(v, 2) }, { k: 'rendement_actuariel', h: 'Rdt actuariel', f: (v) => F.pct(v, 2), bar: true },
      ...(rows.some((o) => o.fiabilite) ? [{ k: 'fiabilite', h: 'Fiabilité', l: true, title: 'fiab_tip', f: (v) => v ? (v === 'fiable' ? '✓ fiable' : v === 'estimation' ? '≈ estimation' : '⚠ ' + v) : '—' }] : []),
      { k: 'duration_modifiee', h: 'Duration', f: F.n2 }, { k: 'date_prochain_coupon', h: 'Proch. coupon', f: (v) => v ? F.dshort(new Date(v + 'T00:00:00Z')) : '—' },
      { k: 'amortissement_lib', h: 'Remboursement', l: true },
    ], { sort: OB.sort, onSort: (kk) => { OB.sort = { k: kk, dir: OB.sort.k === kk ? -OB.sort.dir : 1 }; obTable(); } });
  }
  obTable();
}

// ------------------------------------------------------------------ HISTORIQUE
function historique() {
  const ret = new Map(D.mensuel.map((m) => [m.annee * 100 + (m.mois - 1), m.rendement]));
  gridYM($('#monthly'), ret);
  const mk = (D.marche_historique || []).filter((m) => ok(m.capitalisation_actions));
  if (mk.length >= 2) lineChart($('#capi'), [{ n: 'Capitalisation', c: css('--c1'), v: mk.map((m) => m.capitalisation_actions), d: mk.map((m) => new Date(m.date + 'T00:00:00Z')) }], { fy: F.big, h: 260, end: false, area: true });
  else empty($('#capi'), 'La courbe se construit à chaque séance collectée par le robot');
  $('#journal').replaceChildren(...(D.journal || []).slice().reverse().map((l) => el('li', {}, l)));
  qualiteDetail();
}

// ------------------------------------------------------------------ onglets, thème
const RENDER = { marche, titre, comparer, screener, recos, risque, dividendes, obligations, historique };
const done = new Set();
function showTab(name) {
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  if (name === 'comparer') cpHash(); else history.replaceState(null, '', '#' + name);
  if (!done.has(name) || name === 'titre' || name === 'comparer') { RENDER[name](); done.add(name); }
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
const ICON_T = { dark: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  light: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>' };
const setTheme = (t) => { document.documentElement.dataset.theme = t; $('#theme').innerHTML = ICON_T[t] || ICON_T.light; $('#theme').title = t === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'; try { localStorage.setItem('brvm-theme', t); } catch (e) { /* stockage indisponible */ } };
let theme = 'light';
try { theme = localStorage.getItem('brvm-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (e) { /* défaut */ }
setTheme(theme);
$('#theme').onclick = () => { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); redraw(); };
const redraw = () => { header(); const cur = document.querySelector('#tabs button.on').dataset.tab; done.clear(); RENDER[cur](); done.add(cur); };
let rt;
addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(redraw, 200); });

// ------------------------------------------------------------------ chargement
const bust = '?t=' + Date.now();
Promise.all(['data/dashboard.json', 'data/prix.json', 'data/volumes.json'].map((u) => fetch(u + bust).then((r) => { if (!r.ok) throw new Error(u); return r.json(); })))
  .then(([d, p, v]) => {
    D = d; P = p; V = v;
    DATES = P.dates.map((s) => new Date(s + 'T00:00:00Z'));
    TIT = D.titres;
    const i5 = startIdx('5A');
    TIT.forEach((t) => { const v = series(t.symbole), a = v[i5], b = v.filter(ok).at(-1); t.perf_5a = ok(a) && a > 0 && ok(b) ? b / a - 1 : null; });   // 5 ans : titre coté au début de la fenêtre seulement
    const QT = Object.fromEntries(((D.qualite || {}).titres || []).map((x) => [x.symbole, x]));
    TIT.forEach((t) => { t.qualite = QT[t.symbole]?.niveau; t.qualite_motifs = (QT[t.symbole]?.motifs || []).join(' ; '); });
    S.sel = TIT.slice().sort((a, b) => b.capitalisation - a.capitalisation)[0].symbole;
    header();
    const [h, arg] = location.hash.slice(1).split('=');
    if (h === 'comparer' && arg) CP.sel = decodeURIComponent(arg).split(',').map((x) => x.trim().toUpperCase()).filter((x) => cpT(x)).slice(0, CP_MAX);
    showTab(RENDER[h] ? h : 'marche');
  })
  .catch((e) => {
    $('#loading')?.remove(); $('#kpis').replaceChildren();
    document.querySelector('main').prepend(el('div', { class: 'card error', role: 'alert' }, el('h2', {}, 'Données indisponibles'),
      el('p', { class: 'note' }, 'Le fichier ' + e.message + ' n\'a pas pu être lu. Ouvrez le dashboard depuis son adresse GitHub Pages (pas en double-cliquant sur le fichier).')));
  });
})();
