// CAJA: cierre diario. Cuánto efectivo debería haber y cuánto entró por cada método.
import { state, methodName } from '../store.js';
import * as db from '../db.js';
import { $, esc, fmtBs, fmtUsd, fmtDay, fmtDateTime, numIn, parseNum, r2, toast, dayKey } from '../ui.js';
import { setViewScanHandler } from '../scanner.js';

let root, day = dayKey();

export function renderCaja(main) {
  root = main;
  setViewScanHandler(null);
  main.innerHTML = `<div class="page">
    <div class="page-h"><h1>Cierre de caja</h1><div class="actions"><input type="date" class="input" id="cday" value="${day}"></div></div>
    <div id="cBody"><p class="muted">Cargando…</p></div></div>`;
  $('#cday', main).addEventListener('change', e => { day = e.target.value || dayKey(); draw(); });
  draw();
}

export async function dayTotals(d) {
  const sales = (await db.byIndex('sales', 'day', d)).filter(s => !s.voided);
  const abonos = (await db.byIndex('ledger', 'day', d)).filter(l => l.type === 'abono');
  const by = {};
  const add = (method, currency, amount, bs, com, kind) => {
    const k = by[method] ||= { method, currency, amount: 0, bs: 0, commissionBs: 0, ventas: 0, abonos: 0 };
    k.amount = r2(k.amount + amount); k.bs = r2(k.bs + bs); k.commissionBs = r2(k.commissionBs + (com || 0));
    k[kind] = r2(k[kind] + amount);
  };
  let changeBs = 0, changeUsd = 0;
  for (const s of sales) {
    for (const p of s.payments) add(p.method, p.currency, p.amount, p.amountBs, p.commissionBs, 'ventas');
    if (s.change) { if (s.change.currency === 'USD') changeUsd = r2(changeUsd + s.change.amount); else changeBs = r2(changeBs + s.change.amount); }
  }
  for (const a of abonos) add(a.method, a.currency, a.amount, a.amountBs, a.commissionBs, 'abonos');
  return {
    sales, abonos, by, changeBs, changeUsd,
    totalUsd: r2(sales.reduce((s, x) => s + x.totalUsd, 0)),
    totalBs: r2(sales.reduce((s, x) => s + x.totalBs, 0)),
  };
}

async function draw() {
  const body = $('#cBody', root); if (!body) return;
  const T = await dayTotals(day);
  const fondo = (await db.kvGet('fondo:' + day)) || { bs: 0, usd: 0 };
  const closings = (await db.byIndex('closings', 'day', day)).sort((a, b) => b.ts - a.ts);
  const last = closings[0];
  const cashBsIn = T.by.efectivo_bs ? T.by.efectivo_bs.amount : 0;
  const cashUsdIn = T.by.efectivo_usd ? T.by.efectivo_usd.amount : 0;
  const expBs = r2((fondo.bs || 0) + cashBsIn - T.changeBs);
  const expUsd = r2((fondo.usd || 0) + cashUsdIn - T.changeUsd);
  const elec = state.settings.methods.filter(m => m.electronic).map(m => T.by[m.id] || { method: m.id, amount: 0, commissionBs: 0, ventas: 0, abonos: 0 });
  const fiado = T.by.fiado;
  const totalCom = r2(Object.values(T.by).reduce((s, x) => s + x.commissionBs, 0));

  body.innerHTML = `
    <div class="stats">
      <div class="stat"><span>Ventas del ${fmtDay(day)}</span><b>${T.sales.length}</b></div>
      <div class="stat"><span>Total vendido</span><b>${fmtUsd(T.totalUsd)}</b><small>${fmtBs(T.totalBs)}</small></div>
      <div class="stat ${totalCom ? 'bad' : ''}"><span>Comisiones bancarias</span><b>${fmtBs(totalCom)}</b></div>
      ${fiado ? `<div class="stat warn"><span>Fiado hoy</span><b>${fmtUsd(fiado.amount)}</b></div>` : ''}
    </div>
    <div class="cols2">
      <div class="card">
        <h2>Efectivo</h2>
        <table class="tbl"><thead><tr><th></th><th class="num">Bolívares</th><th class="num">Dólares</th></tr></thead><tbody>
          <tr><td>Fondo inicial</td><td class="num"><input class="input sm num" id="fBs" inputmode="decimal" value="${numIn(fondo.bs, 2)}"></td><td class="num"><input class="input sm num" id="fUsd" inputmode="decimal" value="${numIn(fondo.usd, 2)}"></td></tr>
          <tr><td>+ Cobrado en ventas</td><td class="num">${fmtBs(T.by.efectivo_bs ? T.by.efectivo_bs.ventas : 0)}</td><td class="num">${fmtUsd(T.by.efectivo_usd ? T.by.efectivo_usd.ventas : 0)}</td></tr>
          <tr><td>+ Abonos de fiado</td><td class="num">${fmtBs(T.by.efectivo_bs ? T.by.efectivo_bs.abonos : 0)}</td><td class="num">${fmtUsd(T.by.efectivo_usd ? T.by.efectivo_usd.abonos : 0)}</td></tr>
          <tr><td>− Vueltos dados</td><td class="num">${fmtBs(T.changeBs)}</td><td class="num">${fmtUsd(T.changeUsd)}</td></tr>
          <tr class="strong"><td>= Debería haber</td><td class="num">${fmtBs(expBs)}</td><td class="num">${fmtUsd(expUsd)}</td></tr>
          <tr><td>Contado en caja</td><td class="num"><input class="input sm num" id="kBs" inputmode="decimal" placeholder="0,00"></td><td class="num"><input class="input sm num" id="kUsd" inputmode="decimal" placeholder="0,00"></td></tr>
          <tr class="strong"><td>Diferencia</td><td class="num" id="dBs">—</td><td class="num" id="dUsd">—</td></tr>
        </tbody></table>
      </div>
      <div class="card">
        <h2>Pagos electrónicos</h2>
        <table class="tbl"><thead><tr><th>Método</th><th class="num">Cobrado</th><th class="num">Comisión</th><th class="num">Neto</th></tr></thead><tbody>
          ${elec.map(e => `<tr><td>${esc(methodName(e.method))}</td><td class="num">${fmtBs(e.amount)}</td><td class="num bad">${e.commissionBs ? '−' + fmtBs(e.commissionBs) : '—'}</td><td class="num">${fmtBs(e.amount - e.commissionBs)}</td></tr>`).join('')}
        </tbody></table>
        <p class="muted small">Compara estos montos con el cierre del punto y con los movimientos del banco.</p>
      </div>
    </div>
    <div class="row gap end"><button class="btn primary" id="saveC">Guardar cierre</button></div>
    ${closings.length ? `<div class="card"><h3>Cierres guardados este día</h3>${closings.map(c => `<div class="mrow"><span>${fmtDateTime(c.ts)}</span><span class="num">Dif. Bs ${diffTxt(c.diffBs, fmtBs)} · $ ${diffTxt(c.diffUsd, fmtUsd)}</span></div>`).join('')}</div>` : ''}`;

  const kBs = $('#kBs', body), kUsd = $('#kUsd', body);
  if (last) { kBs.value = numIn(last.countedBs, 2); kUsd.value = numIn(last.countedUsd, 2); }
  const upd = () => {
    const b = parseNum(kBs.value), u = parseNum(kUsd.value);
    $('#dBs', body).innerHTML = Number.isFinite(b) ? diffTxt(r2(b - expBs), fmtBs) : '—';
    $('#dUsd', body).innerHTML = Number.isFinite(u) ? diffTxt(r2(u - expUsd), fmtUsd) : '—';
  };
  kBs.addEventListener('input', upd); kUsd.addEventListener('input', upd); upd();
  const saveFondo = async () => {
    const bs = parseNum($('#fBs', body).value), usd = parseNum($('#fUsd', body).value);
    await db.kvSet('fondo:' + day, { bs: bs > 0 ? bs : 0, usd: usd > 0 ? usd : 0 });
    draw();
  };
  $('#fBs', body).addEventListener('change', saveFondo);
  $('#fUsd', body).addEventListener('change', saveFondo);
  $('#saveC', body).addEventListener('click', async () => {
    const b = parseNum(kBs.value), u = parseNum(kUsd.value);
    if (!Number.isFinite(b) && !Number.isFinite(u)) return toast('Escribe cuánto efectivo contaste', 'bad');
    await db.put('closings', {
      day, ts: Date.now(), fondo, expectedBs: expBs, expectedUsd: expUsd,
      countedBs: Number.isFinite(b) ? b : null, countedUsd: Number.isFinite(u) ? u : null,
      diffBs: Number.isFinite(b) ? r2(b - expBs) : null, diffUsd: Number.isFinite(u) ? r2(u - expUsd) : null,
      byMethod: T.by, totalUsd: T.totalUsd, totalBs: T.totalBs, salesCount: T.sales.length,
    });
    toast('Cierre guardado ✓'); draw();
  });
}

function diffTxt(d, f) {
  if (d == null) return '—';
  if (Math.abs(d) < 0.005) return '<span class="ok">Cuadra ✓</span>';
  return d > 0 ? `<span class="warn">Sobra ${f(d)}</span>` : `<span class="bad">Falta ${f(-d)}</span>`;
}
