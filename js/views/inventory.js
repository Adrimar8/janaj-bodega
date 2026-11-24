// INVENTARIO: productos, stock, vencimientos y entradas de mercancía.
import { state, adjustStock, setStock, cacheProduct, uncacheProduct, findByBarcode, searchProducts, isLow, expiryStatus, activeRate } from '../store.js';
import * as db from '../db.js';
import { $, esc, fmtBs, fmtUsd, fmtQty, fmtDay, numIn, parseNum, r2, r3, modal, toast, confirmDialog, dayKey, icon } from '../ui.js';
import { openImport } from './import.js';
import { setViewScanHandler, pushScanHandler, camSupported, scanWithCamera } from '../scanner.js';

let root, tab = 'productos', filter = 'todos', query = '';

export function renderInventory(main) {
  root = main;
  main.innerHTML = `<div class="page">
    <div class="page-h"><h1>Inventario</h1>
      <div class="actions">
        <button class="btn" id="importar">${icon('upload')} Importar Excel</button>
        <button class="btn" id="entrada">${icon('inbox')} Entrada de mercancía</button>
        <button class="btn primary" id="nuevo">${icon('plus')} Nuevo producto</button>
      </div></div>
    <div class="tabs"><button class="tab" data-tab="productos">Productos</button><button class="tab" data-tab="compras">Compras</button></div>
    <div id="invBody"></div>
  </div>`;
  $('#nuevo', main).addEventListener('click', async () => { if (await openProductForm()) draw(); });
  $('#entrada', main).addEventListener('click', () => openPurchase());
  $('#importar', main).addEventListener('click', async () => { if (await openImport()) draw(); });
  main.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  setViewScanHandler(async code => {
    const p = findByBarcode(code);
    const r = await openProductForm(p || { barcode: code });
    if (r) draw();
  });
  draw();
}

function draw() {
  root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'compras') return drawPurchases();
  const body = $('#invBody', root);
  const all = [...state.products.values()];
  const low = all.filter(isLow), exp = all.filter(p => { const e = expiryStatus(p); return e && e.cls; });
  const valPrice = all.reduce((s, p) => s + Math.max(0, p.stock || 0) * (p.price || 0), 0);
  const withCost = all.filter(p => p.cost != null);
  const valCost = withCost.reduce((s, p) => s + Math.max(0, p.stock || 0) * p.cost, 0);
  const rate = activeRate();
  body.innerHTML = `
    <div class="stats">
      <div class="stat"><span>Productos</span><b>${all.length}</b></div>
      <div class="stat ${low.length ? 'bad' : ''}"><span>Stock bajo</span><b>${low.length}</b></div>
      <div class="stat ${exp.length ? 'warn' : ''}"><span>Vencidos / por vencer</span><b>${exp.length}</b></div>
      <div class="stat"><span>Valor a precio de venta</span><b>${fmtUsd(valPrice)}</b>${rate ? `<small>${fmtBs(valPrice * rate)}</small>` : ''}</div>
      ${withCost.length ? `<div class="stat"><span>Valor a costo</span><b>${fmtUsd(valCost)}</b><small>${withCost.length} con costo</small></div>` : ''}
    </div>
    <div class="toolbar">
      <input class="input" id="q" placeholder="Buscar por nombre, categoría o código" value="${esc(query)}" autocomplete="off">
      <div class="chips">${[['todos', 'Todos'], ['bajo', 'Stock bajo'], ['vence', 'Por vencer'], ['sincodigo', 'Sin código']]
        .map(([k, l]) => `<button class="chip ${filter === k ? 'sel' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
    </div>
    <div id="plist"></div>`;
  const q = $('#q', body);
  q.addEventListener('input', () => { query = q.value; drawList(); });
  body.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.f; draw(); }));
  drawList();
}

function drawList() {
  const el = $('#plist', root);
  let list = query.trim() ? searchProducts(query, 100000) : [...state.products.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (filter === 'bajo') list = list.filter(isLow);
  if (filter === 'vence') list = list.filter(p => { const e = expiryStatus(p); return e && e.cls; }).sort((a, b) => a.expiry.localeCompare(b.expiry));
  if (filter === 'sincodigo') list = list.filter(p => !p.barcode);
  const total = list.length;
  list = list.slice(0, 300);
  const rate = activeRate();
  if (!state.products.size) {
    el.innerHTML = `<div class="empty card">
      <p><b>Aún no hay productos.</b></p>
      <p>La forma más rápida de cargarlos: escanea cada producto con el lector desde esta pantalla. Si el código no existe, se abre el formulario con el código ya puesto.</p>
      <p>Si ya tienes la lista en Excel, usa <b>Importar Excel</b>.</p></div>`;
    return;
  }
  el.innerHTML = !total ? '<p class="empty">No hay productos con ese filtro.</p>' : `
    <div class="tbl-wrap"><table class="tbl hover">
      <thead><tr><th>Producto</th><th class="hide-sm">Código</th><th class="num">Precio</th><th class="num">Stock</th><th class="hide-sm">Vence</th></tr></thead>
      <tbody>${list.map(p => {
        const e = expiryStatus(p);
        return `<tr data-id="${p.id}">
          <td><div class="strong">${esc(p.name)}</div><div class="muted small">${esc(p.category || '')}${p.exento ? ' · exento IVA' : ''}${p.unit === 'kg' ? ' · por kg' : ''}</div></td>
          <td class="hide-sm mono small">${esc(p.barcode || '—')}</td>
          <td class="num">${fmtUsd(p.price)}${rate ? `<div class="muted small">${fmtBs(p.price * rate)}</div>` : ''}</td>
          <td class="num"><span class="${isLow(p) ? 'pill bad' : ''}">${fmtQty(p.stock ?? 0, p.unit)}</span></td>
          <td class="hide-sm">${p.expiry ? `<span class="${e && e.cls ? 'pill ' + e.cls : ''}">${fmtDay(p.expiry)}</span>` : '—'}</td>
        </tr>`;
      }).join('')}</tbody></table></div>
    ${total > list.length ? `<p class="muted small center">Mostrando ${list.length} de ${total}. Usa el buscador para encontrar el resto.</p>` : ''}`;
  el.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', async () => {
    const r = await openProductForm(state.products.get(Number(tr.dataset.id)));
    if (r !== undefined) draw();
  }));
}

// ---------- Formulario de producto ----------
export function openProductForm(prefill = {}) {
  return new Promise(resolve => {
    const p = { unit: 'und', stock: 0, minStock: state.settings.lowStockDefault, exento: false, ...prefill };
    const isNew = !p.id;
    let result = null, off = null;
    const cats = [...new Set([...state.products.values()].map(x => x.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const actions = [];
    if (!isNew) actions.push({ label: 'Eliminar', cls: 'danger push-left', onClick: async close => {
      if (!(await confirmDialog(`¿Eliminar <b>${esc(p.name)}</b>? Las ventas pasadas se conservan.`, { ok: 'Eliminar', danger: true }))) return;
      await db.del('products', p.id); uncacheProduct(p.id);
      state.cart = state.cart.filter(l => l.pid !== p.id);
      result = { deleted: true }; toast('Producto eliminado'); close();
    } });
    actions.push({ label: 'Cancelar', cls: 'ghost' }, { label: 'Guardar', cls: 'primary', onClick: () => save() });
    const m = modal({
      title: isNew ? 'Nuevo producto' : 'Editar producto', wide: true, actions,
      onClose: () => { off && off(); resolve(result); },
      body: `<form class="form-grid" autocomplete="off">
        <label class="field span2"><span>Nombre *</span><input class="input" name="name" value="${esc(p.name || '')}" placeholder="Ej.: Harina PAN 1 kg"></label>
        <label class="field"><span>Código de barras</span><span class="row"><input class="input" name="barcode" data-scan-own value="${esc(p.barcode || '')}" inputmode="numeric" placeholder="Escanéalo aquí">${camSupported ? `<button type="button" class="btn" id="pcam" aria-label="Escanear con la cámara">${icon('camera')}</button>` : ''}</span></label>
        <label class="field"><span>Categoría</span><input class="input" name="category" list="catlist" value="${esc(p.category || '')}" placeholder="Ej.: Víveres"><datalist id="catlist">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <label class="field"><span>Se vende por</span><select class="input" name="unit"><option value="und" ${p.unit !== 'kg' ? 'selected' : ''}>Unidad</option><option value="kg" ${p.unit === 'kg' ? 'selected' : ''}>Peso (kg)</option></select></label>
        <label class="field"><span id="priceLbl">Precio de venta *</span><span class="row"><input class="input" name="price" inputmode="decimal" value="${numIn(p.price, 4)}" placeholder="0,00"><select class="input cur" name="priceCur" aria-label="Moneda del precio"><option value="usd">$</option><option value="bs">Bs</option></select></span><small class="muted" id="priceBs"></small></label>
        <label class="field"><span>Costo <em class="muted">opcional</em></span><span class="row"><input class="input" name="cost" inputmode="decimal" value="${numIn(p.packQty > 1 && p.cost != null ? p.cost * p.packQty : p.cost, 4)}" placeholder="Para calcular ganancias"><select class="input cur" name="costCur" aria-label="Moneda del costo"><option value="usd">$</option><option value="bs">Bs</option></select></span><small class="muted" id="margin"></small></label>
        <label class="field"><span>El costo es por</span><select class="input" name="costPer"><option value="unit">Unidad</option><option value="pack" ${p.packQty > 1 ? 'selected' : ''}>Paquete / caja / oferta</option></select></label>
        <label class="field" id="packF"><span>Unidades que trae</span><input class="input" name="packQty" inputmode="decimal" value="${p.packQty > 1 ? numIn(p.packQty, 3) : ''}" placeholder="Ej.: 100 chicles, 20 harinas"></label>
        <label class="field"><span id="stockLbl">Stock actual</span><input class="input" name="stock" inputmode="decimal" value="${numIn(p.stock, 3)}"></label>
        <label class="field"><span>Avisar si baja de</span><input class="input" name="minStock" inputmode="decimal" value="${numIn(p.minStock, 3)}"></label>
        <label class="field"><span>Fecha de vencimiento <em class="muted">opcional</em></span><input class="input" type="date" name="expiry" value="${esc(p.expiry || '')}"></label>
        <label class="check span2"><input type="checkbox" name="exento" ${p.exento ? 'checked' : ''}> Exento de IVA (cesta básica)</label>
      </form>`,
    });
    const f = m.body.querySelector('form');
    const F = n => f.elements[n];
    const rate = activeRate();
    // Precio y costo se pueden escribir en $ o Bs; se guardan siempre en $ (costo por unidad).
    const toUsd = (v, cur) => cur === 'bs' ? (rate ? v / rate : NaN) : v;
    const priceUsd = () => toUsd(parseNum(F('price').value), F('priceCur').value);
    const pack = () => { const n = parseNum(F('packQty').value); return F('costPer').value === 'pack' ? n : 1; };
    const unitCost = () => toUsd(parseNum(F('cost').value), F('costCur').value) / pack();
    const upd = () => {
      const pr = priceUsd(), co = unitCost(), bsP = F('priceCur').value === 'bs';
      const kg = F('unit').value === 'kg';
      $('#priceLbl', f).textContent = kg ? 'Precio por kg *' : 'Precio de venta *';
      $('#stockLbl', f).textContent = kg ? 'Stock actual (kg)' : 'Stock actual';
      $('#packF', f).hidden = F('costPer').value !== 'pack';
      $('#priceBs', f).textContent = !(pr > 0) ? '' : bsP ? `= ${fmtUsd(pr)} (se guarda en $; en Bs cambiará con la tasa)` : rate ? `= ${fmtBs(pr * rate)} a la tasa actual` : '';
      const costTxt = co > 0 && pack() > 1 ? `= ${fmtUsd(co)} por unidad. ` : co > 0 && F('costCur').value === 'bs' ? `= ${fmtUsd(co)}. ` : '';
      $('#margin', f).textContent = costTxt + (pr > 0 && co > 0 ? `Ganancia: ${fmtUsd(pr - co)} (${Math.round((pr - co) / co * 100)}% sobre costo)` : '');
    };
    // Al cambiar de moneda se convierte la cifra escrita para que siga siendo el mismo importe.
    for (const [inp, sel] of [['price', 'priceCur'], ['cost', 'costCur']]) {
      F(sel).addEventListener('change', () => {
        if (!rate) { F(sel).value = 'usd'; return toast('No hay tasa guardada para convertir a Bs', 'bad'); }
        const v = parseNum(F(inp).value);
        if (v > 0) F(inp).value = numIn(F(sel).value === 'bs' ? v * rate : v / rate, F(sel).value === 'bs' ? 2 : 4);
        upd();
      });
    }
    f.addEventListener('input', upd);
    f.addEventListener('change', upd);
    f.addEventListener('submit', e => { e.preventDefault(); save(); });
    F('barcode').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); F('name').value ? F('price').focus() : F('name').focus(); } });
    const pc = $('#pcam', f);
    pc && pc.addEventListener('click', async () => { const c = await scanWithCamera(); if (c) F('barcode').value = c; });
    off = pushScanHandler(code => { F('barcode').value = code; toast('Código leído: ' + code); });
    upd();
    if (isNew && p.barcode) setTimeout(() => F('name').focus(), 50);

    async function save() {
      const name = F('name').value.trim();
      const price = Math.round(priceUsd() * 10000) / 10000;
      if (!name) return toast('Falta el nombre', 'bad');
      if (!(price >= 0)) return toast('Precio no válido', 'bad');
      const isPack = F('costPer').value === 'pack' && F('cost').value.trim();
      if (isPack && !(pack() > 1)) return toast('Pon cuántas unidades trae el paquete', 'bad');
      const barcode = F('barcode').value.trim();
      const dup = barcode && findByBarcode(barcode);
      if (dup && dup.id !== p.id) return toast(`Ese código ya es de “${dup.name}”`, 'bad', 4000);
      const cost = Math.round(unitCost() * 10000) / 10000, stock = parseNum(F('stock').value), minStock = parseNum(F('minStock').value);
      const obj = {
        ...(isNew ? { createdAt: Date.now() } : state.products.get(p.id) || p),
        name, price,
        packQty: isPack ? pack() : null,
        category: F('category').value.trim(),
        unit: F('unit').value,
        cost: cost >= 0 ? cost : null,
        minStock: Number.isFinite(minStock) ? minStock : state.settings.lowStockDefault,
        expiry: F('expiry').value || null,
        exento: F('exento').checked,
        updatedAt: Date.now(),
      };
      if (barcode) obj.barcode = barcode; else delete obj.barcode;
      // Solo se fija un nuevo conteo si el stock escrito es distinto del actual.
      const newStock = Number.isFinite(stock) ? r3(stock) : 0;
      if (isNew || newStock !== r3(obj.stock ?? 0)) setStock(obj, newStock);
      try {
        obj.id = await db.put('products', obj);
        cacheProduct(obj);
        result = obj;
        toast(isNew ? 'Producto creado ✓' : 'Producto guardado ✓');
        m.close();
      } catch (e) { toast('Error al guardar: ' + e.message, 'bad'); }
    }
  });
}

// ---------- Entrada de mercancía ----------
export async function openPurchase() {
  const lines = [];
  const prev = await db.all('purchases');
  const sups = [...new Set(prev.map(x => x.supplier).filter(Boolean))].sort();
  let off = null;
  const m = modal({
    title: 'Entrada de mercancía', wide: true,
    onClose: () => off && off(),
    body: `<div class="grid2">
        <label class="field"><span>Proveedor</span><input class="input" id="prov" list="provlist" placeholder="Ej.: Distribuidora…"><datalist id="provlist">${sups.map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
        <label class="field"><span>Fecha</span><input type="date" class="input" id="pdate" value="${dayKey()}"></label>
      </div>
      <label class="field"><span>Añadir producto: escanéalo o búscalo</span><span class="row"><input class="input" id="psearch" data-scan-own autocomplete="off" placeholder="Nombre o código">${camSupported ? `<button type="button" class="btn" id="pcam2">${icon('camera')}</button>` : ''}</span></label>
      <div id="pres" class="results"></div>
      <div id="plines"></div>
      <div id="ptotal" class="total-row"></div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Guardar entrada', cls: 'primary', onClick: close => save(close) }],
  });
  const B = m.body;
  const search = $('#psearch', B), res = $('#pres', B);

  const addByCode = async code => {
    let p = findByBarcode(code);
    if (!p) {
      if (!(await confirmDialog(`El código <b>${esc(code)}</b> no existe. ¿Crearlo?`, { ok: 'Crear' }))) return;
      p = await openProductForm({ barcode: code, stock: 0 });
      if (!p) return;
    }
    addLine(p);
  };
  off = pushScanHandler(addByCode);
  search.addEventListener('input', () => {
    const q = search.value.trim();
    res.innerHTML = q.length < 2 ? '' : searchProducts(q, 8).map(p => `<button class="result" data-pid="${p.id}"><span class="r-name">${esc(p.name)}</span><span class="r-stock muted">Stock ${fmtQty(p.stock ?? 0, p.unit)}</span></button>`).join('')
      + `<button class="result" data-new="1"><span class="r-name">${icon('plus')} Crear producto nuevo “${esc(q)}”</span></button>`;
  });
  search.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = search.value.trim(); if (!q) return;
    search.value = ''; res.innerHTML = '';
    if (findByBarcode(q) || /^\d{4,}$/.test(q)) return addByCode(q);
    const r = searchProducts(q, 2); if (r.length === 1) addLine(r[0]); else { search.value = q; search.dispatchEvent(new Event('input')); }
  });
  res.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const q = search.value.trim();
    search.value = ''; res.innerHTML = '';
    if (b.dataset.new) { const p = await openProductForm({ name: q, stock: 0 }); if (p) addLine(p); return; }
    addLine(state.products.get(Number(b.dataset.pid)));
  });
  const pc = $('#pcam2', B);
  pc && pc.addEventListener('click', async () => { const c = await scanWithCamera(); if (c) addByCode(c); });

  function addLine(p) {
    const ex = lines.find(l => l.pid === p.id);
    if (ex) ex.qty = r3(ex.qty + 1);
    else lines.push({ pid: p.id, qty: 1, cost: p.cost ?? '', price: p.price });
    drawLines();
    search.focus();
  }
  function drawLines() {
    const el = $('#plines', B);
    el.innerHTML = !lines.length ? '<p class="muted small">Aún no has añadido productos.</p>' : `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Producto</th><th>Cantidad</th><th>Costo unit. $</th><th>Precio venta $</th><th></th></tr></thead>
      <tbody>${lines.map((l, i) => { const p = state.products.get(l.pid); return `<tr data-i="${i}">
        <td>${esc(p ? p.name : '?')}<div class="muted small">Stock actual ${fmtQty(p ? p.stock ?? 0 : 0, p && p.unit)}</div></td>
        <td><input class="input sm" data-k="qty" inputmode="decimal" value="${numIn(l.qty, 3)}"></td>
        <td><input class="input sm" data-k="cost" inputmode="decimal" value="${numIn(l.cost === '' ? null : l.cost, 4)}" placeholder="opcional"></td>
        <td><input class="input sm" data-k="price" inputmode="decimal" value="${numIn(l.price, 4)}"></td>
        <td><button class="icon-btn" data-rm aria-label="Quitar">${icon('x')}</button></td></tr>`; }).join('')}</tbody></table></div>`;
    el.querySelectorAll('input[data-k]').forEach(inp => inp.addEventListener('input', () => {
      const l = lines[Number(inp.closest('tr').dataset.i)];
      const v = parseNum(inp.value);
      l[inp.dataset.k] = inp.dataset.k === 'cost' && inp.value.trim() === '' ? '' : v;
      drawTotal();
    }));
    el.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { lines.splice(Number(b.closest('tr').dataset.i), 1); drawLines(); }));
    drawTotal();
  }
  function drawTotal() {
    const t = lines.reduce((s, l) => s + (l.cost > 0 && l.qty > 0 ? l.cost * l.qty : 0), 0);
    $('#ptotal', B).innerHTML = lines.length ? `Total de la compra: <b>${fmtUsd(t)}</b>` : '';
  }
  drawLines();

  async function save(close) {
    const valid = lines.filter(l => l.qty > 0);
    if (!valid.length) return toast('Añade al menos un producto', 'bad');
    const day = $('#pdate', B).value || dayKey();
    const purchase = {
      ts: Date.now(), day, supplier: $('#prov', B).value.trim(),
      items: valid.map(l => ({ pid: l.pid, name: (state.products.get(l.pid) || {}).name, qty: l.qty, cost: l.cost > 0 ? l.cost : null })),
    };
    purchase.totalUsd = r2(purchase.items.reduce((s, i) => s + (i.cost ? i.cost * i.qty : 0), 0));
    try {
      const updated = [];
      await db.run(['purchases', 'products'], 'readwrite', async t => {
        await db.P(t.objectStore('purchases').add(purchase));
        const ps = t.objectStore('products');
        for (const l of valid) {
          const p = await db.P(ps.get(l.pid)); if (!p) continue;
          adjustStock(p, l.qty);
          if (l.cost > 0) p.cost = l.cost;
          if (l.price >= 0 && Number.isFinite(l.price)) p.price = l.price;
          p.updatedAt = Date.now();
          await db.P(ps.put(p)); updated.push(p);
        }
      });
      updated.forEach(cacheProduct);
      toast(`Entrada guardada: ${valid.length} producto(s) ✓`);
      close();
      if (root && root.isConnected && $('#invBody', root)) draw();
    } catch (e) { toast('Error: ' + e.message, 'bad'); }
  }
}

async function drawPurchases() {
  const body = $('#invBody', root);
  const list = (await db.all('purchases')).sort((a, b) => b.ts - a.ts);
  body.innerHTML = !list.length ? '<p class="empty">No hay compras registradas. Usa “Entrada de mercancía” cuando llegue un pedido.</p>' : `
    <div class="tbl-wrap"><table class="tbl hover"><thead><tr><th>Fecha</th><th>Proveedor</th><th class="num">Productos</th><th class="num">Total</th></tr></thead>
    <tbody>${list.map(p => `<tr data-id="${p.id}"><td>${fmtDay(p.day)}</td><td>${esc(p.supplier || '—')}</td><td class="num">${p.items.length}</td><td class="num">${fmtUsd(p.totalUsd)}</td></tr>`).join('')}</tbody></table></div>`;
  body.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => {
    const p = list.find(x => x.id === Number(tr.dataset.id));
    modal({
      title: `Compra del ${fmtDay(p.day)}`, wide: true,
      body: `<p>Proveedor: <b>${esc(p.supplier || '—')}</b></p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="num">Cantidad</th><th class="num">Costo</th><th class="num">Subtotal</th></tr></thead>
        <tbody>${p.items.map(i => `<tr><td>${esc(i.name)}</td><td class="num">${fmtQty(i.qty)}</td><td class="num">${i.cost ? fmtUsd(i.cost) : '—'}</td><td class="num">${i.cost ? fmtUsd(i.cost * i.qty) : '—'}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="3">Total</th><th class="num">${fmtUsd(p.totalUsd)}</th></tr></tfoot></table></div>`,
    });
  }));
}

