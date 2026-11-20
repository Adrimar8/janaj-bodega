// Pantalla de VENDER: escanear, consultar precio, carrito y cobro.
import { state, cartTotals, commissionFor, rateLabel, rateValue, RATES, findByBarcode, searchProducts, cacheProduct, saveCart, isLow, activeRate, methodName } from '../store.js';
import * as db from '../db.js';
import { $, esc, fmtBs, fmtUsd, fmtNum, fmtQty, numIn, parseNum, r2, r3, modal, toast, confirmDialog, dayKey, icon } from '../ui.js';
import { setViewScanHandler, pushScanHandler, camSupported, scanWithCamera } from '../scanner.js';
import { openProductForm } from './inventory.js';

let consulta = false;
let root;

export function renderPOS(main) {
  root = main;
  main.innerHTML = `<div class="pos">
    <section class="pos-left">
      <div class="card">
        <div class="scan-row">
          <input id="scan" class="input lg" data-scan-own placeholder="Escanea o escribe nombre / código" autocomplete="off" enterkeyhint="search">
          ${camSupported ? `<button class="btn lg" id="cam" title="Escanear con la cámara" aria-label="Escanear con la cámara">${icon('camera')}</button>` : ''}
        </div>
        <label class="check"><input type="checkbox" id="consulta" ${consulta ? 'checked' : ''}> Solo consultar precio (no añade al carrito)</label>
        <div id="results" class="results"></div>
      </div>
      <div class="card">
        <div class="card-h"><h2>Carrito</h2><span id="cartCount" class="muted"></span></div>
        <div id="cart"></div>
      </div>
    </section>
    <aside class="pos-right" id="totals"></aside>
  </div>`;

  const scan = $('#scan', main);
  scan.addEventListener('input', () => showResults(scan.value));
  scan.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); handleQuery(scan.value.trim()); }
    if (e.key === 'Escape') { scan.value = ''; showResults(''); }
    if (e.key === 'ArrowDown') { const b = $('#results button', main); if (b) { e.preventDefault(); b.focus(); } }
  });
  $('#consulta', main).addEventListener('change', e => { consulta = e.target.checked; scan.focus(); });
  const cam = $('#cam', main);
  cam && cam.addEventListener('click', async () => { const c = await scanWithCamera(); if (c) handleQuery(c, true); });
  $('#results', main).addEventListener('click', e => {
    const b = e.target.closest('[data-pid]'); if (!b) return;
    const p = state.products.get(Number(b.dataset.pid));
    scan.value = ''; showResults('');
    p && addProduct(p);
  });
  $('#results', main).addEventListener('keydown', e => {
    const bs = [...root.querySelectorAll('#results button')];
    const i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i < bs.length - 1) { e.preventDefault(); bs[i + 1].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? bs[i - 1] : scan).focus(); }
  });
  $('#cart', main).addEventListener('click', onCartClick);
  $('#cart', main).addEventListener('change', onCartChange);
  setViewScanHandler(code => handleQuery(code, true));
  renderCart();
  if (matchMedia('(pointer:fine)').matches) scan.focus();
}

function showResults(q) {
  const el = $('#results', root);
  if (!el) return;
  q = q.trim();
  if (q.length < 2) { el.innerHTML = ''; return; }
  const res = searchProducts(q, 12);
  const rate = activeRate();
  el.innerHTML = res.length ? res.map(p => `<button class="result" data-pid="${p.id}">
      <span class="r-name">${esc(p.name)}${p.unit === 'kg' ? ' <span class="badge">por kg</span>' : ''}</span>
      <span class="r-price">${fmtUsd(p.price)}${rate ? ` · ${fmtBs(p.price * rate)}` : ''}</span>
      <span class="r-stock ${isLow(p) ? 'bad' : 'muted'}">Stock: ${fmtQty(p.stock ?? 0, p.unit)}</span>
    </button>`).join('')
    : `<p class="muted small pad">Sin resultados para “${esc(q)}”.</p>`;
}

function handleQuery(q, fromScanner = false) {
  if (!q) return;
  const scan = $('#scan', root);
  const p = findByBarcode(q);
  if (p) { if (scan) scan.value = ''; showResults(''); return addProduct(p); }
  if (/^\d{4,}$/.test(q)) {
    if (scan) scan.value = ''; showResults('');
    return unknownCode(q);
  }
  if (fromScanner) return;
  const res = searchProducts(q, 2);
  if (res.length === 1) { scan.value = ''; showResults(''); addProduct(res[0]); }
  else showResults(q);
}

async function unknownCode(code) {
  const ok = await confirmDialog(`El código <b>${esc(code)}</b> no está registrado. ¿Quieres crear el producto ahora?`, { ok: 'Crear producto' });
  if (!ok) return;
  const p = await openProductForm({ barcode: code });
  if (p) addProduct(p);
}

async function addProduct(p) {
  if (consulta) return showPrice(p);
  if (p.unit === 'kg') {
    const w = await askWeight(p);
    if (!w) return;
    state.cart.push({ id: uid(), pid: p.id, qty: w });
  } else {
    const line = state.cart.find(l => l.pid === p.id);
    if (line) line.qty = r3(line.qty + 1);
    else state.cart.push({ id: uid(), pid: p.id, qty: 1 });
  }
  saveCart();
  renderCart();
  if ((p.stock ?? 0) <= 0) toast(`${p.name}: no queda stock registrado`, 'warn');
  const scan = $('#scan', root); if (scan && matchMedia('(pointer:fine)').matches) scan.focus();
}
const uid = () => Math.random().toString(36).slice(2, 9);

export function showPrice(p) {
  const rate = activeRate();
  const per = p.unit === 'kg' ? ' / kg' : '';
  const others = RATES.filter(r => r.key !== 'eur' && r.key !== state.settings.rateKey && rateValue(r.key))
    .map(r => `<tr><td>${esc(r.label)}</td><td class="num">${fmtBs(p.price * rateValue(r.key))}</td></tr>`).join('');
  let off = null;
  const m = modal({
    onClose: () => off && off(),
    title: 'Precio', body: `<div class="price-check">
      <div class="pc-name">${esc(p.name)}</div>
      <div class="pc-bs">${rate ? fmtBs(p.price * rate) : 'Sin tasa'}<small>${per}</small></div>
      <div class="pc-usd">${fmtUsd(p.price)}${per} · ${rateLabel(state.settings.rateKey)} ${rate ? fmtNum(rate) : '—'}</div>
      <div class="muted">Stock: ${fmtQty(p.stock ?? 0, p.unit)}${p.barcode ? ' · Código ' + esc(p.barcode) : ''}</div>
      ${others ? `<table class="tbl compact"><tbody>${others}</tbody></table>` : ''}
    </div>`,
    actions: [
      { label: 'Editar producto', cls: 'ghost', onClick: async c => { c(); const np = await openProductForm(p); if (np) renderCart(); } },
      { label: 'Añadir al carrito', cls: 'primary', onClick: c => { c(); const prev = consulta; consulta = false; addProduct(p); consulta = prev; } },
    ],
  });
  off = pushScanHandler(code => { m.close(); handleQuery(code, true); });
}

function askWeight(p, initial) {
  return new Promise(resolve => {
    const rate = activeRate();
    let result = null;
    const m = modal({
      title: p.name,
      body: `<p class="muted">Precio: ${fmtUsd(p.price)} por kg${rate ? ' · ' + fmtBs(p.price * rate) : ''}</p>
        <div class="grid2">
          <label class="field"><span>Peso (kg)</span><input class="input lg" id="w" inputmode="decimal" placeholder="0,000" value="${initial ? numIn(initial, 3) : ''}"></label>
          <label class="field"><span>o por monto ($)</span><input class="input lg" id="wu" inputmode="decimal" placeholder="0,00"></label>
        </div>
        <div class="chips">${[0.1, 0.25, 0.5, 1].map(g => `<button type="button" class="chip" data-g="${g}">${g < 1 ? g * 1000 + ' g' : '1 kg'}</button>`).join('')}</div>
        <div class="calc" id="wcalc"></div>`,
      actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Aceptar', cls: 'primary', onClick: () => ok() }],
      onClose: () => resolve(result),
    });
    const w = $('#w', m.body), wu = $('#wu', m.body), calc = $('#wcalc', m.body);
    const upd = () => {
      const kg = parseNum(w.value);
      calc.innerHTML = kg > 0 ? `<b>${fmtNum(kg, 3)} kg</b> = ${fmtUsd(r2(p.price * kg))}${rate ? ' · ' + fmtBs(r2(p.price * kg) * rate) : ''}` : '';
    };
    w.addEventListener('input', () => { wu.value = ''; upd(); });
    wu.addEventListener('input', () => { const u = parseNum(wu.value); w.value = u > 0 && p.price > 0 ? numIn(r3(u / p.price), 3) : ''; upd(); });
    m.body.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => { w.value = numIn(Number(b.dataset.g), 3); wu.value = ''; upd(); }));
    [w, wu].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }));
    upd();
    function ok() {
      const kg = parseNum(w.value);
      if (!(kg > 0)) return toast('Indica el peso', 'bad');
      result = r3(kg); m.close();
    }
  });
}

// ---------- Carrito ----------
function renderCart() {
  const T = cartTotals();
  const el = $('#cart', root);
  if (!el) return;
  $('#cartCount', root).textContent = T.lines.length ? `${T.lines.length} producto(s)` : '';
  el.innerHTML = !T.lines.length
    ? '<p class="empty">El carrito está vacío.<br>Escanea un producto o búscalo por nombre.</p>'
    : T.lines.map(l => `<div class="line" data-id="${l.id}">
        <div class="line-main">
          <div class="line-name">${esc(l.p.name)}</div>
          <div class="muted small">${fmtUsd(l.p.price)} / ${l.p.unit === 'kg' ? 'kg' : 'und'}${T.rate ? ' · ' + fmtBs(l.p.price * T.rate) : ''}</div>
        </div>
        <div class="qty">${l.p.unit === 'kg'
          ? `<button class="btn sm" data-act="weight" title="Cambiar peso">${fmtQty(l.qty, 'kg')}</button>`
          : `<button class="btn sm" data-act="dec" aria-label="Menos">−</button><input class="input qty-in" data-act="qty" value="${numIn(l.qty, 3)}" inputmode="numeric" aria-label="Cantidad"><button class="btn sm" data-act="inc" aria-label="Más">+</button>`}
        </div>
        <div class="line-tot"><div><b>${fmtUsd(l.totalUsd)}</b></div><div class="muted small">${T.rate ? fmtBs(l.totalUsd * T.rate) : ''}</div></div>
        <button class="icon-btn" data-act="del" title="Quitar" aria-label="Quitar">${icon('x')}</button>
      </div>`).join('');
  renderTotals(T);
}

async function onCartClick(e) {
  const b = e.target.closest('[data-act]'); if (!b || b.dataset.act === 'qty') return;
  const id = b.closest('.line').dataset.id;
  const line = state.cart.find(l => l.id === id); if (!line) return;
  const act = b.dataset.act;
  if (act === 'inc') line.qty = r3(line.qty + 1);
  if (act === 'dec') line.qty = r3(line.qty - 1);
  if (act === 'del' || line.qty <= 0) state.cart = state.cart.filter(l => l.id !== id);
  if (act === 'weight') {
    const w = await askWeight(state.products.get(line.pid), line.qty);
    if (w) line.qty = w;
  }
  saveCart(); renderCart();
}
function onCartChange(e) {
  if (e.target.dataset.act !== 'qty') return;
  const id = e.target.closest('.line').dataset.id;
  const line = state.cart.find(l => l.id === id); if (!line) return;
  const q = parseNum(e.target.value);
  if (q > 0) line.qty = r3(q); else state.cart = state.cart.filter(l => l.id !== id);
  saveCart(); renderCart();
}

function renderTotals(T) {
  const el = $('#totals', root);
  const s = state.settings;
  const methods = s.methods.filter(m => m.active);
  const ivaLine = s.ivaMode === 'no' ? '' : s.ivaMode === 'incluido'
    ? `<div class="muted small">IVA incluido (${s.ivaPct}%): ${fmtUsd(T.ivaUsd)}${T.rate ? ' · ' + fmtBs(T.ivaUsd * T.rate) : ''}</div>`
    : `<div class="muted small">Subtotal ${fmtUsd(T.subtotalUsd)} + IVA ${fmtUsd(T.ivaUsd)}</div>`;
  el.innerHTML = `<div class="card total-card">
      <div class="lbl">Total a cobrar</div>
      <div class="big">${T.rate ? fmtBs(T.totalBs) : '—'}</div>
      <div class="big2">${fmtUsd(T.totalUsd)}</div>
      <div class="muted small">${rateLabel(T.rateKey)}: ${T.rate ? fmtNum(T.rate) + ' Bs/$' : '<a href="#tasas">sin tasa, pulsa para ponerla</a>'}</div>
      ${ivaLine}
    </div>
    ${T.lines.length && T.rate ? `<div class="card">
      <h3>Según cómo pague</h3>
      ${methods.map(m => {
        if (m.currency === 'USD') return `<div class="mrow"><span>${esc(m.name)}</span><span class="num"><b>${fmtUsd(T.totalUsd)}</b><br><span class="ok small">sin comisión</span></span></div>`;
        const c = commissionFor(m.id, T.totalBs);
        return `<div class="mrow"><span>${esc(m.name)}</span><span class="num"><b>${fmtBs(T.totalBs)}</b><br>${c.bs > 0
          ? `<span class="bad small">−${fmtBs(c.bs)} (${fmtUsd(c.bs / T.rate)}) → recibes ${fmtBs(T.totalBs - c.bs)}</span>`
          : '<span class="ok small">sin comisión</span>'}</span></div>`;
      }).join('')}
      ${!s.commissionsVerified ? '<p class="warn small">Comisiones estimadas. Confírmalas en Ajustes.</p>' : ''}
    </div>` : ''}
    <button class="btn primary xl" id="pay" ${T.lines.length && T.rate ? '' : 'disabled'}>${icon('cash')} Cobrar</button>
    ${T.lines.length ? '<button class="btn ghost" id="clear">Vaciar carrito</button>' : ''}
    <div class="mobile-pay ${T.lines.length ? '' : 'hidden'}"><div><b>${T.rate ? fmtBs(T.totalBs) : '—'}</b><span class="muted small">${fmtUsd(T.totalUsd)}</span></div>
      <button class="btn primary" id="pay2" ${T.lines.length && T.rate ? '' : 'disabled'}>Cobrar</button></div>`;
  $('#pay', el).addEventListener('click', openCheckout);
  $('#pay2', el).addEventListener('click', openCheckout);
  const clr = $('#clear', el);
  clr && clr.addEventListener('click', async () => { if (await confirmDialog('¿Vaciar el carrito?')) { state.cart = []; saveCart(); renderCart(); } });
}

// ---------- Cobro ----------
async function openCheckout() {
  const T = cartTotals();
  if (!T.lines.length || !T.rate) return;
  const rate = T.rate;
  const tol = Math.max(0.01, rate * 0.005); // medio céntimo de dólar en Bs
  const pays = [];
  let sel = null, changeCur = null, customerId = null, saving = false;
  const customers = (await db.all('customers')).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const methods = [...state.settings.methods.filter(m => m.active), { id: 'fiado', name: 'Fiado', currency: 'USD' }];
  const m = modal({ title: 'Cobrar venta', wide: true, body: '<div class="ck"></div>' });
  const box = m.body.firstElementChild;
  const paidBs = () => r2(pays.reduce((s, p) => s + p.amountBs, 0));
  const remaining = () => { const r = r2(T.totalBs - paidBs()); return Math.abs(r) < tol ? 0 : r; };

  function render() {
    const rem = remaining();
    const change = rem < 0 ? -rem : 0;
    if (change > 0 && !changeCur) changeCur = pays.some(p => p.method === 'efectivo_usd') ? 'USD' : 'VES';
    if (change <= 0) changeCur = null;
    const selM = methods.find(x => x.id === sel);
    box.innerHTML = `
      <div class="ck-head">
        <div><div class="lbl">Total</div><div class="big">${fmtBs(T.totalBs)}</div><div class="muted">${fmtUsd(T.totalUsd)} · tasa ${fmtNum(rate)}</div></div>
        <div class="right"><div class="lbl">${rem > 0 ? 'Falta' : change > 0 ? 'Vuelto' : 'Pagado'}</div>
          <div class="big ${rem > 0 ? 'bad' : 'ok'}">${rem > 0 ? fmtBs(rem) : fmtBs(change)}</div>
          <div class="muted">${rem > 0 ? fmtUsd(rem / rate) : change > 0 ? fmtUsd(change / rate) : '✓'}</div></div>
      </div>
      ${pays.length ? `<table class="tbl"><thead><tr><th>Pago</th><th class="num">Monto</th><th class="num">Comisión</th><th></th></tr></thead><tbody>
        ${pays.map((p, i) => `<tr><td>${esc(methodName(p.method))}</td><td class="num">${p.currency === 'USD' ? fmtUsd(p.amount) : fmtBs(p.amount)}</td>
          <td class="num">${p.commissionBs ? fmtBs(p.commissionBs) : '—'}</td><td><button class="icon-btn" data-rm="${i}" aria-label="Quitar pago">${icon('x')}</button></td></tr>`).join('')}
      </tbody></table>` : ''}
      ${rem > 0 ? `<div class="lbl">${pays.length ? 'Añadir otro pago (pago mixto)' : 'Método de pago'}</div>
        <div class="mgrid">${methods.map(x => `<button class="btn mbtn ${sel === x.id ? 'sel' : ''}" data-m="${x.id}">${esc(x.name)}</button>`).join('')}</div>
        ${selM ? amountForm(selM, rem) : ''}` : ''}
      ${change > 0 ? `<div class="change-box">
        <div class="lbl">¿Cómo das el vuelto?</div>
        <div class="seg">
          <button class="btn ${changeCur === 'USD' ? 'sel' : ''}" data-cc="USD">En dólares: <b>${fmtUsd(change / rate)}</b></button>
          <button class="btn ${changeCur === 'VES' ? 'sel' : ''}" data-cc="VES">En bolívares: <b>${fmtBs(change)}</b></button>
        </div></div>` : ''}
      <div class="ck-actions"><button class="btn primary xl" id="ckOk" ${rem > 0 ? 'disabled' : ''}>Confirmar venta</button></div>`;
    bind(selM, rem);
  }

  function amountForm(x, rem) {
    if (x.id === 'fiado') {
      return `<div class="pay-form">
        <label class="field"><span>Cliente</span><select class="input" id="cust"><option value="">— Elegir —</option>${customers.map(c => `<option value="${c.id}" ${customerId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="new">+ Nuevo cliente…</option></select></label>
        <label class="field hidden" id="newCustWrap"><span>Nombre del nuevo cliente</span><input class="input" id="newCust"></label>
        <p>Se apuntan <b>${fmtUsd(rem / rate)}</b> (${fmtBs(rem)}) a la cuenta del cliente.</p>
        <button class="btn primary" id="addPay">Fiar ${fmtUsd(rem / rate)}</button></div>`;
    }
    const usd = x.currency === 'USD';
    const def = usd ? numIn(Math.ceil((rem / rate) * 100) / 100, 2) : numIn(rem, 2);
    const quick = usd ? [1, 5, 10, 20, 50, 100] : [];
    return `<div class="pay-form">
      <label class="field"><span>Monto recibido en ${usd ? 'dólares ($)' : 'bolívares (Bs)'}</span>
        <input class="input lg" id="amt" inputmode="decimal" value="${def}"></label>
      ${quick.length ? `<div class="chips"><button class="chip" data-q="exact">Exacto</button>${quick.map(q => `<button class="chip" data-q="${q}">$${q}</button>`).join('')}</div>` : ''}
      <div id="cprev" class="small"></div>
      <button class="btn primary" id="addPay">Añadir pago</button></div>`;
  }

  function bind(selM, rem) {
    box.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => { sel = b.dataset.m; render(); const a = $('#amt', box); a && (a.focus(), a.select()); }));
    box.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { pays.splice(Number(b.dataset.rm), 1); render(); }));
    box.querySelectorAll('[data-cc]').forEach(b => b.addEventListener('click', () => { changeCur = b.dataset.cc; render(); }));
    const ok = $('#ckOk', box); ok && ok.addEventListener('click', confirm);
    if (!selM) return;
    const add = $('#addPay', box);
    if (selM.id === 'fiado') {
      const cs = $('#cust', box), nw = $('#newCustWrap', box);
      cs.addEventListener('change', () => nw.classList.toggle('hidden', cs.value !== 'new'));
      add.addEventListener('click', async () => {
        let cid = cs.value === 'new' ? null : Number(cs.value);
        if (cs.value === 'new') {
          const name = $('#newCust', box).value.trim();
          if (!name) return toast('Escribe el nombre del cliente', 'bad');
          const c = { name, phone: '', createdAt: Date.now() };
          c.id = await db.put('customers', c);
          customers.push(c);
          cid = c.id;
        }
        if (!cid) return toast('Elige un cliente', 'bad');
        customerId = cid;
        pays.push({ method: 'fiado', currency: 'USD', amount: r2(rem / rate), amountBs: rem, commissionBs: 0 });
        sel = null; render();
      });
      return;
    }
    const amt = $('#amt', box), prev = $('#cprev', box);
    const usd = selM.currency === 'USD';
    let exact = false;
    const upd = () => {
      const a = parseNum(amt.value);
      if (!(a > 0)) { prev.textContent = ''; return; }
      const bs = usd ? a * rate : a;
      const c = commissionFor(selM.id, bs).bs;
      prev.innerHTML = (usd ? `= ${fmtBs(bs)}. ` : '') + (c > 0 ? `<span class="bad">Comisión: ${fmtBs(c)} → recibes ${fmtBs(bs - c)}</span>` : '<span class="ok">Sin comisión</span>');
    };
    amt.addEventListener('input', () => { exact = false; upd(); });
    amt.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add.click(); } });
    box.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.q === 'exact') { amt.value = numIn(rem / rate, 2); exact = true; } else { amt.value = b.dataset.q; exact = false; }
      upd();
    }));
    upd();
    add.addEventListener('click', () => {
      const a = parseNum(amt.value);
      if (!(a > 0)) return toast('Monto no válido', 'bad');
      let bs = usd ? r2(a * rate) : r2(a);
      if (exact || Math.abs(bs - rem) < tol) bs = rem;
      if (selM.electronic && bs > rem + tol) return toast('Un pago electrónico no puede ser mayor que lo que falta', 'bad');
      pays.push({ method: selM.id, currency: selM.currency, amount: r2(a), amountBs: bs, commissionBs: commissionFor(selM.id, bs).bs });
      sel = null; render();
    });
  }

  async function confirm() {
    if (saving || remaining() > 0) return;
    saving = true;
    const rem = remaining();
    const change = rem < 0 ? -rem : 0;
    const fiadoUsd = r2(pays.filter(p => p.method === 'fiado').reduce((s, p) => s + p.amount, 0));
    const now = Date.now();
    const sale = {
      ts: now, day: dayKey(),
      items: T.lines.map(l => ({ pid: l.pid, name: l.p.name, unit: l.p.unit, qty: l.qty, price: l.p.price, cost: l.p.cost ?? null, exento: !!l.p.exento, totalUsd: l.totalUsd })),
      subtotalUsd: T.subtotalUsd, ivaUsd: T.ivaUsd, totalUsd: T.totalUsd, rateKey: T.rateKey, rate, totalBs: T.totalBs,
      payments: pays,
      commissionBs: r2(pays.reduce((s, p) => s + (p.commissionBs || 0), 0)),
      change: change > 0 ? { currency: changeCur, amount: changeCur === 'USD' ? r2(change / rate) : r2(change), amountBs: r2(change) } : null,
      customerId: fiadoUsd > 0 ? customerId : null,
      fiadoUsd,
    };
    try {
      const updated = [];
      await db.run(['sales', 'products', 'ledger'], 'readwrite', async t => {
        const id = await db.P(t.objectStore('sales').add(sale));
        sale.id = id;
        const ps = t.objectStore('products');
        for (const it of sale.items) {
          const p = await db.P(ps.get(it.pid));
          if (!p) continue;
          p.stock = r3((p.stock || 0) - it.qty);
          await db.P(ps.put(p));
          updated.push(p);
        }
        if (fiadoUsd > 0) await db.P(t.objectStore('ledger').add({ customerId, ts: now, day: sale.day, type: 'cargo', usd: fiadoUsd, saleId: id, note: 'Venta #' + id }));
      });
      updated.forEach(cacheProduct);
      state.cart = []; saveCart();
      m.close();
      renderCart();
      toast('Venta registrada ✓');
      const low = updated.filter(isLow);
      if (low.length) setTimeout(() => toast('Stock bajo: ' + low.map(p => p.name).slice(0, 3).join(', ') + (low.length > 3 ? '…' : ''), 'warn', 4000), 600);
    } catch (e) {
      saving = false;
      console.error(e);
      toast('No se pudo guardar la venta: ' + e.message, 'bad', 5000);
    }
  }

  render();
}
