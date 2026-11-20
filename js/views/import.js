// IMPORTAR / EXPORTAR productos en CSV (lo abre y guarda Excel).
// El archivo se revisa antes de guardar: qué se crea, qué se actualiza y qué filas tienen errores.
import { state, setStock, cacheProduct, findByBarcode } from '../store.js';
import * as db from '../db.js';
import { esc, norm, parseNum, numIn, r3, modal, toast, downloadFile, dayKey, icon } from '../ui.js';

// Nombre interno → cabeceras aceptadas (sin tildes ni mayúsculas).
const COLS = {
  name: ['nombre', 'producto', 'descripcion', 'articulo'],
  barcode: ['codigo', 'codigo de barras', 'cod barras', 'barcode', 'ean', 'codigo barras'],
  price: ['precio', 'precio venta', 'precio de venta', 'precio $', 'precio usd', 'pvp'],
  cost: ['costo', 'coste', 'costo $', 'costo usd', 'precio compra', 'precio de compra'],
  stock: ['stock', 'existencia', 'existencias', 'cantidad', 'inventario'],
  minStock: ['minimo', 'stock minimo', 'avisar si baja de', 'min'],
  category: ['categoria', 'rubro', 'familia', 'departamento'],
  unit: ['unidad', 'se vende por', 'medida'],
  expiry: ['vencimiento', 'vence', 'fecha vencimiento', 'fecha de vencimiento', 'caducidad'],
  exento: ['exento', 'exento iva', 'exento de iva'],
};
const HEAD = ['Nombre', 'Código', 'Precio', 'Costo', 'Stock', 'Mínimo', 'Categoría', 'Unidad', 'Vencimiento', 'Exento'];

// ---------- CSV ----------
function detectSep(line) {
  const n = c => line.split(c).length;
  return [';', ',', '\t'].reduce((a, b) => (n(b) > n(a) ? b : a));
}
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const sep = detectSep(text.split(/\r?\n/)[0] || '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  // Quita el ="..." que usamos al exportar para que Excel no estropee los códigos.
  return rows.map(r => r.map(v => v.trim().replace(/^="?([^"]*)"?$/, '$1'))).filter(r => r.some(Boolean));
}
const csvCell = v => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// ---------- Interpretar valores ----------
function parseDate(v) {
  if (!v) return null;
  let m;
  if ((m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  if (/^\d{5}$/.test(v)) { // número de serie de Excel
    const d = new Date(Date.UTC(1899, 11, 30) + Number(v) * 864e5);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return undefined;
}
function iso(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const yes = v => ['si', 's', 'x', '1', 'true', 'exento'].includes(norm(v));
const optNum = v => (v === '' ? null : parseNum(v));

// Convierte las filas en un plan: crear, actualizar, sin cambios y errores.
export function buildPlan(rows) {
  const [head, ...body] = rows;
  const idx = {};
  head.forEach((h, i) => {
    const k = norm(h).replace(/[*()]/g, '').replace(/\s+/g, ' ').trim();
    for (const [key, alias] of Object.entries(COLS)) if (idx[key] == null && alias.includes(k)) idx[key] = i;
  });
  const plan = { create: [], update: [], same: 0, errors: [], cols: idx };
  if (idx.name == null && idx.barcode == null) { plan.errors.push({ line: 1, msg: 'No encuentro la columna "Nombre" ni "Código". Usa la plantilla.' }); return plan; }
  if (idx.price == null) plan.errors.push({ line: 1, msg: 'No hay columna "Precio": los productos nuevos no se podrán crear.' });

  const byName = new Map([...state.products.values()].map(p => [norm(p.name), p]));
  const seen = new Set();
  body.forEach((r, i) => {
    const line = i + 2;
    const get = k => (idx[k] == null ? undefined : (r[idx[k]] ?? '').trim());
    const err = msg => plan.errors.push({ line, msg });
    const name = get('name') || '', barcode = get('barcode') || '';
    if (/e\+/i.test(barcode)) return err(`Código "${barcode}" estropeado por Excel. Formatea la columna como texto.`);
    const key = barcode ? 'c:' + barcode : 'n:' + norm(name);
    if (!name && !barcode) return err('Fila sin nombre ni código');
    if (seen.has(key)) return err(`Repetido en el archivo (${barcode || name})`);
    seen.add(key);
    const existing = (barcode && findByBarcode(barcode)) || (name && byName.get(norm(name))) || null;

    const ch = {};
    if (name) ch.name = name;
    if (barcode) ch.barcode = barcode;
    for (const k of ['price', 'cost', 'stock', 'minStock']) {
      const v = get(k); if (v === undefined || v === '') continue;
      const n = optNum(v);
      if (!Number.isFinite(n) || n < 0) return err(`Valor no válido en ${k === 'price' ? 'Precio' : k === 'cost' ? 'Costo' : k === 'stock' ? 'Stock' : 'Mínimo'}: "${v}"`);
      ch[k] = k === 'stock' || k === 'minStock' ? r3(n) : Math.round(n * 10000) / 10000;
    }
    const cat = get('category'); if (cat) ch.category = cat;
    const u = get('unit'); if (u) ch.unit = /^(kg|kilo|kilos|kilogramo|peso|granel)/.test(norm(u)) ? 'kg' : 'und';
    const ex = get('expiry');
    if (ex) { const d = parseDate(ex); if (d === undefined) return err(`Fecha no válida: "${ex}" (usa dd/mm/aaaa)`); ch.expiry = d; }
    const xe = get('exento'); if (xe !== undefined && xe !== '') ch.exento = yes(xe);

    if (!existing) {
      if (!name) return err(`El código ${barcode} no existe y la fila no tiene nombre`);
      if (ch.price == null) return err(`"${name}" es nuevo y no tiene precio`);
      const dup = barcode && plan.create.find(c => c.ch.barcode === barcode);
      if (dup) return err(`Código repetido (${barcode})`);
      plan.create.push({ line, ch });
      return;
    }
    // Solo lo que cambia de verdad.
    const diff = {};
    for (const [k, v] of Object.entries(ch)) {
      const cur = k === 'stock' ? r3(existing.stock ?? 0) : k === 'exento' ? !!existing.exento : k === 'unit' ? existing.unit || 'und' : existing[k];
      if ((cur ?? null) !== v && !(k === 'category' && (cur || '') === v)) diff[k] = v;
    }
    if (diff.barcode) {
      const other = findByBarcode(diff.barcode);
      if (other && other.id !== existing.id) return err(`El código ${diff.barcode} ya es de "${other.name}"`);
    }
    if (Object.keys(diff).length) plan.update.push({ line, p: existing, diff });
    else plan.same++;
  });
  return plan;
}

// ---------- Guardar ----------
async function applyPlan(plan, { stockToo }) {
  const now = Date.now();
  const saved = [];
  await db.run(['products'], 'readwrite', async t => {
    const st = t.objectStore('products');
    for (const { ch } of plan.create) {
      const obj = { createdAt: now, updatedAt: now, unit: 'und', category: '', cost: null, minStock: state.settings.lowStockDefault, expiry: null, exento: false, ...ch };
      delete obj.stock;
      setStock(obj, ch.stock ?? 0);
      obj.id = await db.P(st.put(obj));
      saved.push(obj);
    }
    for (const { p, diff } of plan.update) {
      const obj = { ...((await db.P(st.get(p.id))) || p) };
      const { stock, ...rest } = diff;
      Object.assign(obj, rest, { updatedAt: now });
      if (stock !== undefined && stockToo) setStock(obj, stock);
      await db.P(st.put(obj));
      saved.push(obj);
    }
  });
  saved.forEach(cacheProduct);
  return saved.length;
}

// ---------- Pantallas ----------
export function downloadTemplate() {
  const rows = [HEAD,
    ['Harina PAN 1 kg', '="7591002100017"', '1,20', '0,95', '24', '6', 'Víveres', 'und', '', 'si'],
    ['Queso blanco', '', '6,50', '5,10', '3,5', '1', 'Charcutería', 'kg', '30/11/2026', 'no']];
  downloadFile('plantilla-productos.csv', '﻿' + rows.map(r => r.join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}

export function exportProducts() {
  const list = [...state.products.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const rows = list.map(p => [p.name, p.barcode ? `="${p.barcode}"` : '', numIn(p.price, 4), numIn(p.cost, 4), numIn(p.stock ?? 0, 3), numIn(p.minStock, 3),
    p.category || '', p.unit === 'kg' ? 'kg' : 'und', p.expiry ? p.expiry.split('-').reverse().join('/') : '', p.exento ? 'si' : 'no'].map(csvCell));
  downloadFile(`productos-${dayKey()}.csv`, '﻿' + [HEAD, ...rows].map(r => r.join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  toast(`${list.length} productos exportados`);
}

const LABEL = { name: 'Nombre', barcode: 'Código', price: 'Precio', cost: 'Costo', stock: 'Stock', minStock: 'Mínimo', category: 'Categoría', unit: 'Unidad', expiry: 'Vence', exento: 'Exento' };
const show = (k, v) => v == null || v === '' ? '—' : k === 'exento' ? (v ? 'sí' : 'no') : k === 'expiry' ? v.split('-').reverse().join('/') : ['price', 'cost'].includes(k) ? '$' + numIn(v, 4) : String(v);

export function openImport() {
  return new Promise(resolve => {
    let plan = null, changed = 0;
    const m = modal({
      title: 'Importar productos (Excel / CSV)', wide: true,
      onClose: () => resolve(changed),
      body: `<p>Guarda tu hoja de Excel como <b>CSV UTF-8</b> o <b>CSV (delimitado por punto y coma)</b> y elígela aquí.
        Columnas: <b>Nombre</b>, <b>Código</b>, <b>Precio</b> ($) y, si quieres, Costo, Stock, Mínimo, Categoría, Unidad (und/kg), Vencimiento (dd/mm/aaaa) y Exento (si/no).</p>
        <p class="muted small">Si el producto ya existe (mismo código o, si no tiene código, mismo nombre) se actualiza. Las celdas vacías no borran nada.</p>
        <div class="row">
          <label class="btn primary">${icon('upload')} Elegir archivo<input type="file" id="csvf" accept=".csv,.txt,text/csv" hidden></label>
          <button class="btn" id="tpl">${icon('download')} Descargar plantilla</button>
          ${state.products.size ? `<button class="btn" id="exp">${icon('download')} Exportar productos actuales</button>` : ''}
        </div>
        <div id="prev"></div>`,
      actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Importar', cls: 'primary', id: 'impOk', onClick: close => go(close) }],
    });
    const B = m.body;
    const okBtn = m.el.querySelector('#impOk');
    if (okBtn) okBtn.disabled = true;
    B.querySelector('#tpl').addEventListener('click', downloadTemplate);
    B.querySelector('#exp')?.addEventListener('click', exportProducts);
    B.querySelector('#csvf').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      let text;
      try { text = await f.text(); } catch (er) { return toast('No se pudo leer el archivo', 'bad'); }
      // Excel en Windows a veces guarda en ANSI (Windows-1252): si aparecen caracteres rotos, se relee así.
      if (text.includes('�')) text = new TextDecoder('windows-1252').decode(await f.arrayBuffer());
      const rows = parseCsv(text);
      if (rows.length < 2) { B.querySelector('#prev').innerHTML = '<p class="pill bad">El archivo está vacío o solo tiene cabecera.</p>'; return; }
      plan = buildPlan(rows);
      drawPreview(f.name);
    });

    function drawPreview(fname) {
      const hasStock = plan.update.some(u => 'stock' in u.diff);
      const total = plan.create.length + plan.update.length;
      if (okBtn) okBtn.disabled = !total;
      const ign = Object.keys(COLS).filter(k => plan.cols[k] == null).map(k => LABEL[k]);
      B.querySelector('#prev').innerHTML = `
        <h3>${esc(fname)}</h3>
        <div class="stats">
          <div class="stat"><span>Nuevos</span><b>${plan.create.length}</b></div>
          <div class="stat"><span>Se actualizan</span><b>${plan.update.length}</b></div>
          <div class="stat"><span>Sin cambios</span><b>${plan.same}</b></div>
          <div class="stat ${plan.errors.length ? 'bad' : ''}"><span>Con errores (se saltan)</span><b>${plan.errors.length}</b></div>
        </div>
        ${ign.length ? `<p class="muted small">Columnas no encontradas (se ignoran): ${ign.join(', ')}.</p>` : ''}
        ${hasStock ? `<label class="check"><input type="checkbox" id="stockToo" checked> Poner el stock del archivo en los productos que ya existen (cuenta como un conteo nuevo)</label>` : ''}
        ${plan.errors.length ? `<details open><summary><b>Errores</b></summary><ul class="small">${plan.errors.slice(0, 50).map(e => `<li>Fila ${e.line}: ${esc(e.msg)}</li>`).join('')}${plan.errors.length > 50 ? `<li>… y ${plan.errors.length - 50} más</li>` : ''}</ul></details>` : ''}
        ${plan.create.length ? `<details><summary><b>Nuevos (${plan.create.length})</b></summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Código</th><th class="num">Precio</th><th class="num">Stock</th></tr></thead><tbody>
          ${plan.create.slice(0, 200).map(({ ch }) => `<tr><td>${esc(ch.name)}</td><td class="mono small">${esc(ch.barcode || '—')}</td><td class="num">${show('price', ch.price)}</td><td class="num">${esc(show('stock', ch.stock ?? 0))}</td></tr>`).join('')}
          </tbody></table></div></details>` : ''}
        ${plan.update.length ? `<details><summary><b>Cambios (${plan.update.length})</b></summary><ul class="small">
          ${plan.update.slice(0, 200).map(({ p, diff }) => `<li><b>${esc(p.name)}</b>: ${Object.entries(diff).map(([k, v]) => `${LABEL[k]} ${esc(show(k, k === 'stock' ? r3(p.stock ?? 0) : p[k]))} → ${esc(show(k, v))}`).join(' · ')}</li>`).join('')}
          </ul></details>` : ''}`;
    }

    async function go(close) {
      if (!plan || !(plan.create.length + plan.update.length)) return toast('No hay nada que importar', 'bad');
      const stockToo = B.querySelector('#stockToo')?.checked ?? true;
      try {
        changed = await applyPlan(plan, { stockToo });
        toast(`Importados: ${plan.create.length} nuevos, ${plan.update.length} actualizados ✓`, 'ok', 4000);
        close();
      } catch (e) { toast('Error al importar: ' + e.message, 'bad', 5000); }
    }
  });
}
