// REPORTES: ventas, ganancias, comisiones e impuestos estimados por periodo.
import { state, methodName, cacheProduct, adjustStock } from '../store.js';
import * as db from '../db.js';
import { $, esc, fmtBs, fmtUsd, fmtNum, fmtQty, fmtDay, fmtDateTime, r2, r3, modal, toast, confirmDialog, dayKey, downloadFile, shortId } from '../ui.js';
import { setViewScanHandler } from '../scanner.js';

let root, preset = 'hoy', from = dayKey(), to = dayKey();

function presetRange(p) {
  const d = new Date();
  const k = x => dayKey(x);
  if (p === 'hoy') return [k(d), k(d)];
  if (p === 'ayer') { d.setDate(d.getDate() - 1); return [k(d), k(d)]; }
  if (p === '7d') { const e = k(d); d.setDate(d.getDate() - 6); return [k(d), e]; }
  if (p === 'mes') return [k(new Date(d.getFullYear(), d.getMonth(), 1)), k(d)];
  if (p === 'mesant') return [k(new Date(d.getFullYear(), d.getMonth() - 1, 1)), k(new Date(d.getFullYear(), d.getMonth(), 0))];
  return [from, to];
}

export function renderReports(main) {
  root = main;
  setViewScanHandler(null);
  main.innerHTML = `<div class="page">
    <div class="page-h"><h1>Reportes</h1></div>
    <div class="toolbar">
      <div class="chips">${[['hoy', 'Hoy'], ['ayer', 'Ayer'], ['7d', '7 días'], ['mes', 'Este mes'], ['mesant', 'Mes pasado'], ['custom', 'Elegir fechas']]
        .map(([k, l]) => `<button class="chip ${preset === k ? 'sel' : ''}" data-p="${k}">${l}</button>`).join('')}</div>
      <div class="row gap ${preset === 'custom' ? '' : 'hidden'}" id="custom"><input type="date" class="input" id="rf" value="${from}"><span>a</span><input type="date" class="input" id="rt" value="${to}"></div>
    </div>
    <div id="rBody"><p class="muted">Cargando…</p></div></div>`;
  main.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => { preset = b.dataset.p; [from, to] = presetRange(preset); renderReports(main); }));
  $('#rf', main).addEventListener('change', e => { from = e.target.value; draw(); });
  $('#rt', main).addEventListener('change', e => { to = e.target.value; draw(); });
  [from, to] = presetRange(preset);
  draw();
}

async function draw() {
  const body = $('#rBody', root); if (!body) return;
  const lo = new Date(from + 'T00:00').getTime(), hi = new Date(to + 'T23:59:59.999').getTime();
  const allSales = await db.range('sales', 'ts', lo, hi);
  const sales = allSales.filter(s => !s.voided);
  const s = state.settings;
  const n = sales.length;
  const totUsd = r2(sales.reduce((a, x) => a + x.totalUsd, 0));
  const totBs = r2(sales.reduce((a, x) => a + x.totalBs, 0));
  const comBs = r2(sales.reduce((a, x) => a + (x.commissionBs || 0), 0));
  const comUsd = r2(sales.reduce((a, x) => a + (x.commissionBs || 0) / x.rate, 0));
  const ivaUsd = r2(sales.reduce((a, x) => a + (x.ivaUsd || 0), 0));
  const ivaBs = r2(sales.reduce((a, x) => a + (x.ivaUsd || 0) * x.rate, 0));
  const fiado = r2(sales.reduce((a, x) => a + (x.fiadoUsd || 0), 0));
  let profit = 0, revWithCost = 0, noCost = 0, ivaOnCost = 0, comOnCost = 0;
  const prod = new Map(), byDay = new Map(), byMethod = new Map();
  for (const x of sales) {
    byDay.set(x.day, r2((byDay.get(x.day) || 0) + x.totalUsd));
    for (const it of x.items) {
      if (it.cost != null) {
        profit += (it.price - it.cost) * it.qty; revWithCost += it.totalUsd;
        if (s.ivaMode === 'incluido' && !it.exento) ivaOnCost += it.totalUsd * s.ivaPct / (100 + s.ivaPct);
        comOnCost += x.totalUsd ? ((x.commissionBs || 0) / x.rate) * (it.totalUsd / x.totalUsd) : 0;
      } else noCost++;
      const p = prod.get(it.pid) || { name: it.name, unit: it.unit, qty: 0, usd: 0 };
      p.qty = r3(p.qty + it.qty); p.usd = r2(p.usd + it.totalUsd); prod.set(it.pid, p);
    }
    for (const p of x.payments) {
      const m = byMethod.get(p.method) || { currency: p.currency, amount: 0, bs: 0, com: 0, count: 0 };
      m.amount = r2(m.amount + p.amount); m.bs = r2(m.bs + p.amountBs); m.com = r2(m.com + (p.commissionBs || 0)); m.count++;
      byMethod.set(p.method, m);
    }
  }
  profit = r2(profit);
  const usdCash = byMethod.get('efectivo_usd');
  const igtfUsd = s.igtfOn && usdCash ? r2(usdCash.amount * s.igtfPct / 100) : 0;
  const top = [...prod.values()].sort((a, b) => b.usd - a.usd).slice(0, 10);
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const maxDay = Math.max(1, ...days.map(d => d[1]));

  body.innerHTML = `
    <div class="stats">
      <div class="stat"><span>Ventas</span><b>${fmtUsd(totUsd)}</b><small>${fmtBs(totBs)}</small></div>
      <div class="stat"><span>Nº de ventas</span><b>${n}</b><small>Ticket medio ${fmtUsd(n ? totUsd / n : 0)}</small></div>
      <div class="stat ${profit > 0 ? 'ok' : ''}"><span>Ganancia bruta</span><b>${fmtUsd(profit)}</b><small>${noCost ? `${noCost} artículo(s) sin costo no cuentan` : 'Precio − costo'}</small></div>
      <div class="stat bad"><span>Comisiones bancarias</span><b>${fmtBs(comBs)}</b><small>≈ ${fmtUsd(comUsd)}</small></div>
      ${s.ivaMode !== 'no' ? `<div class="stat warn"><span>IVA estimado (${s.ivaPct}%)</span><b>${fmtBs(ivaBs)}</b><small>≈ ${fmtUsd(ivaUsd)}</small></div>` : ''}
      ${s.igtfOn ? `<div class="stat warn"><span>IGTF estimado (${s.igtfPct}%)</span><b>${fmtUsd(igtfUsd)}</b></div>` : ''}
      ${fiado ? `<div class="stat warn"><span>Vendido fiado</span><b>${fmtUsd(fiado)}</b></div>` : ''}
    </div>
    ${profit && revWithCost ? `<p class="muted small">Ganancia neta aproximada de los productos con costo (bruta − su parte de comisiones e IVA): <b>${fmtUsd(profit - comOnCost - ivaOnCost)}</b>. Es una estimación: confírmala con tu contable.</p>` : ''}
    ${!n ? '<p class="empty">No hay ventas en este periodo.</p>' : `
    <div class="cols2">
      <div class="card"><h2>Por método de pago</h2>
        <table class="tbl"><thead><tr><th>Método</th><th class="num">Monto</th><th class="num">Comisión</th></tr></thead><tbody>
        ${[...byMethod.entries()].map(([k, m]) => `<tr><td>${esc(methodName(k))} <span class="muted small">(${m.count})</span></td><td class="num">${m.currency === 'USD' ? fmtUsd(m.amount) : fmtBs(m.amount)}</td><td class="num">${m.com ? fmtBs(m.com) : '—'}</td></tr>`).join('')}
        </tbody></table></div>
      <div class="card"><h2>Productos más vendidos</h2>
        <table class="tbl"><thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Total</th></tr></thead><tbody>
        ${top.map(p => `<tr><td>${esc(p.name)}</td><td class="num">${fmtQty(p.qty, p.unit)}</td><td class="num">${fmtUsd(p.usd)}</td></tr>`).join('')}
        </tbody></table></div>
    </div>
    ${days.length > 1 ? `<div class="card"><h2>Ventas por día ($)</h2><div class="bars">${days.map(([d, v]) => `<div class="bar" title="${fmtDay(d)}: ${fmtUsd(v)}"><div class="bar-v" style="height:${Math.max(2, v / maxDay * 100)}%"></div><span>${d.slice(8)}</span></div>`).join('')}</div></div>` : ''}
    <div class="card"><div class="card-h"><h2>Ventas</h2><button class="btn sm" id="csv">Exportar CSV</button></div>
      <div class="tbl-wrap"><table class="tbl hover"><thead><tr><th>#</th><th>Fecha</th><th>Pago</th><th class="num">Total</th></tr></thead><tbody>
      ${allSales.slice().reverse().slice(0, 200).map(x => `<tr data-id="${x.id}" class="${x.voided ? 'voided' : ''}"><td>${shortId(x.id)}</td><td class="small">${fmtDateTime(x.ts)}</td>
        <td class="small">${x.voided ? '<b class="bad">ANULADA</b>' : x.payments.map(p => esc(methodName(p.method))).join(' + ')}</td><td class="num">${fmtUsd(x.totalUsd)}<div class="muted small">${fmtBs(x.totalBs)}</div></td></tr>`).join('')}
      </tbody></table></div></div>`}`;

  body.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => saleDetail(allSales.find(x => x.id === Number(tr.dataset.id)))));
  const csv = $('#csv', body);
  csv && csv.addEventListener('click', () => {
    const rows = [['id', 'fecha', 'total_usd', 'total_bs', 'tasa', 'iva_usd', 'comision_bs', 'pagos', 'anulada']];
    allSales.forEach(x => rows.push([x.id, new Date(x.ts).toLocaleString('es-VE'), x.totalUsd, x.totalBs, x.rate, x.ivaUsd, x.commissionBs || 0, x.payments.map(p => `${methodName(p.method)} ${p.amount}`).join(' + '), x.voided ? 'si' : '']));
    const txt = rows.map(r => r.map(v => `"${(typeof v === 'number' ? String(v).replace('.', ',') : String(v)).replace(/"/g, '""')}"`).join(';')).join('\n');
    downloadFile(`janaj-ventas-${from}_${to}.csv`, '﻿' + txt, 'text/csv');
  });
}

function saleDetail(x) {
  const m = modal({
    title: `Venta #${shortId(x.id)}${x.voided ? ' (anulada)' : ''}`, wide: true,
    body: `<p class="muted">${fmtDateTime(x.ts)} · tasa ${fmtNum(x.rate)} (${esc(x.rateKey)})</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Total</th></tr></thead><tbody>
      ${x.items.map(i => `<tr><td>${esc(i.name)}</td><td class="num">${fmtQty(i.qty, i.unit)}</td><td class="num">${fmtUsd(i.price)}</td><td class="num">${fmtUsd(i.totalUsd)}</td></tr>`).join('')}
      </tbody><tfoot><tr><th colspan="3">Total</th><th class="num">${fmtUsd(x.totalUsd)}<br>${fmtBs(x.totalBs)}</th></tr></tfoot></table></div>
      <h3>Pagos</h3>${x.payments.map(p => `<div class="mrow"><span>${esc(methodName(p.method))}</span><span class="num">${p.currency === 'USD' ? fmtUsd(p.amount) : fmtBs(p.amount)}${p.commissionBs ? ` <span class="bad small">(comisión ${fmtBs(p.commissionBs)})</span>` : ''}</span></div>`).join('')}
      ${x.change ? `<div class="mrow"><span>Vuelto</span><span class="num">${x.change.currency === 'USD' ? fmtUsd(x.change.amount) : fmtBs(x.change.amount)}</span></div>` : ''}`,
    actions: x.voided ? [{ label: 'Cerrar', cls: 'ghost' }] : [{ label: 'Anular venta', cls: 'danger push-left', onClick: () => voidSale(x, m) }, { label: 'Cerrar', cls: 'ghost' }],
  });
}

async function voidSale(x, m) {
  if (!(await confirmDialog('¿Anular esta venta? Se devuelven los productos al stock y se borra el fiado asociado.', { ok: 'Anular', danger: true }))) return;
  try {
    const updated = [];
    await db.run(['sales', 'products', 'ledger'], 'readwrite', async t => {
      const ss = t.objectStore('sales');
      const sale = await db.P(ss.get(x.id));
      if (!sale || sale.voided) return;
      sale.voided = true; sale.voidedAt = Date.now();
      await db.P(ss.put(sale));
      const ps = t.objectStore('products');
      for (const it of sale.items) {
        const p = await db.P(ps.get(it.pid)); if (!p) continue;
        adjustStock(p, it.qty);
        await db.P(ps.put(p)); updated.push(p);
      }
      const ls = t.objectStore('ledger');
      const led = await db.P(ls.index('saleId').getAll(x.id));
      for (const l of led) await db.P(ls.delete(l.id));
    });
    updated.forEach(cacheProduct);
    m.close(); toast('Venta anulada'); draw();
  } catch (e) { toast('Error: ' + e.message, 'bad'); }
}
