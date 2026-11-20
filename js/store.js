// Estado de la app: ajustes, tasas, productos en memoria, carrito y cálculos.
import * as db from './db.js';
import { r2, norm, dayKey } from './ui.js';

export const RATES = [
  { key: 'bcv', label: 'Dólar BCV', short: 'BCV $', cobro: true },
  { key: 'eur', label: 'Euro BCV', short: 'BCV €', cobro: false },
  { key: 'paralelo', label: 'Dólar paralelo', short: 'Paralelo', cobro: true },
  { key: 'usdt', label: 'USDT Binance', short: 'USDT', cobro: true },
  { key: 'promedio', label: 'Promedio (BCV + paralelo) ÷ 2', short: 'Promedio', cobro: true },
];

// Las comisiones son estimaciones iniciales: hay que confirmarlas con el estado de cuenta del banco.
export const DEFAULT_METHODS = [
  { id: 'punto', name: 'Punto (Banesco débito)', currency: 'VES', pct: 1.5, fixed: 0, active: true, electronic: true },
  { id: 'biopago', name: 'Biopago (BDV)', currency: 'VES', pct: 1.5, fixed: 0, active: true, electronic: true },
  { id: 'pagomovil', name: 'Pago móvil', currency: 'VES', pct: 0, fixed: 0, active: true, electronic: true },
  { id: 'efectivo_bs', name: 'Efectivo Bs', currency: 'VES', pct: 0, fixed: 0, active: true, electronic: false },
  { id: 'efectivo_usd', name: 'Efectivo $', currency: 'USD', pct: 0, fixed: 0, active: true, electronic: false },
];

export const DEFAULT_SETTINGS = {
  businessName: 'JANAJ',
  rateKey: 'bcv',
  methods: DEFAULT_METHODS,
  commissionsVerified: false,
  ivaPct: 16,
  ivaMode: 'incluido', // 'incluido' | 'sumar' | 'no'
  igtfOn: false,
  igtfPct: 3,
  lowStockDefault: 5,
  expiryWarnDays: 7,
};

export const state = {
  settings: null,
  rates: null,
  products: new Map(),
  byBarcode: new Map(),
  cart: [],
  deviceId: null,
};

export function applySettings(saved = {}) {
  const s = { ...DEFAULT_SETTINGS, ...saved };
  // Mezcla métodos guardados con los predeterminados (por si se añaden nuevos en futuras versiones).
  s.methods = DEFAULT_METHODS.map(d => ({ ...d, ...(saved.methods || []).find(m => m.id === d.id) }));
  state.settings = s;
}

export async function loadAll() {
  state.deviceId = await db.kvGet('deviceId');
  if (!state.deviceId) { state.deviceId = 'd' + Math.random().toString(36).slice(2, 10); await db.kvSet('deviceId', state.deviceId); }
  applySettings((await db.kvGet('settings')) || {});
  state.rates = (await db.kvGet('rates')) || { values: {}, src: {}, dates: {}, fetchedAt: null };
  const prods = await db.all('products');
  state.products.clear(); state.byBarcode.clear();
  prods.forEach(cacheProduct);
  try { state.cart = JSON.parse(localStorage.getItem('janaj-cart') || '[]'); } catch { state.cart = []; }
  state.cart = state.cart.filter(l => state.products.has(l.pid));
}

export const saveSettings = () => db.kvSet('settings', state.settings);
export function saveCart() { try { localStorage.setItem('janaj-cart', JSON.stringify(state.cart)); } catch { /* sin almacenamiento */ } }

// ---------- Productos ----------
export function cacheProduct(p) {
  const old = state.products.get(p.id);
  if (old && old.barcode) state.byBarcode.delete(old.barcode);
  state.products.set(p.id, p);
  if (p.barcode) state.byBarcode.set(p.barcode, p);
}
export function uncacheProduct(id) {
  const p = state.products.get(id);
  if (p && p.barcode) state.byBarcode.delete(p.barcode);
  state.products.delete(id);
}
export const findByBarcode = code => state.byBarcode.get(String(code).trim());

export function searchProducts(q, limit = 30) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const p of state.products.values()) {
    const hay = norm(`${p.name} ${p.category || ''} ${p.barcode || ''}`);
    if (words.every(w => hay.includes(w))) out.push(p);
  }
  const first = words[0];
  out.sort((a, b) => (norm(b.name).startsWith(first) - norm(a.name).startsWith(first)) || a.name.localeCompare(b.name, 'es'));
  return out.slice(0, limit);
}

// ---------- Stock sincronizable ----------
// stock = base (último conteo manual) + lo que cada equipo ha movido desde ese conteo.
// Cada equipo solo toca su propio contador, así dos equipos vendiendo sin conexión no se pisan.
function normStock(p) {
  if (!p.base) p.base = { v: p.stock || 0, at: 0, snap: {} };
  if (!p.deltas) p.deltas = {};
  return p;
}
export function calcStock(p) {
  normStock(p);
  let s = p.base.v;
  for (const [d, x] of Object.entries(p.deltas)) s += x.v - (p.base.snap[d] || 0);
  return Math.round(s * 1000) / 1000;
}
export function adjustStock(p, qty) {
  normStock(p);
  const o = p.deltas[state.deviceId] || { v: 0, n: 0 };
  p.deltas[state.deviceId] = { v: Math.round((o.v + qty) * 1000) / 1000, n: o.n + 1 };
  p.stock = calcStock(p);
}
export function setStock(p, value) {
  normStock(p);
  const snap = {};
  for (const [d, x] of Object.entries(p.deltas)) snap[d] = x.v;
  p.base = { v: value, at: Date.now(), snap };
  p.stock = calcStock(p);
}
// Une la versión local y la remota de un producto. Devuelve [fusionado, la remota estaba incompleta].
export function mergeProduct(local, remote) {
  normStock(local); normStock(remote);
  const m = { ...((remote._u || 0) >= (local._u || 0) ? remote : local) };
  m.deltas = { ...remote.deltas };
  let behind = false;
  for (const [d, x] of Object.entries(local.deltas)) if (!m.deltas[d] || x.n > m.deltas[d].n) { m.deltas[d] = x; behind = true; }
  if (local.base.at > remote.base.at) { m.base = local.base; behind = true; } else m.base = remote.base;
  m._u = Math.max(local._u || 0, remote._u || 0);
  if (m._u !== (remote._u || 0)) behind = true;
  m.stock = calcStock(m);
  return [m, behind];
}

export const isLow = p => (p.stock ?? 0) <= (p.minStock ?? state.settings.lowStockDefault);
export function expiryStatus(p) {
  if (!p.expiry) return null;
  const days = Math.round((new Date(p.expiry + 'T00:00') - new Date(dayKey() + 'T00:00')) / 864e5);
  if (days < 0) return { days, label: 'Vencido', cls: 'bad' };
  if (days <= state.settings.expiryWarnDays) return { days, label: days === 0 ? 'Vence hoy' : `Vence en ${days} d`, cls: 'warn' };
  return { days, label: '', cls: '' };
}

// ---------- Tasas ----------
export function rateValue(k) {
  const v = state.rates.values || {};
  if (k === 'promedio') return v.bcv && v.paralelo ? (v.bcv + v.paralelo) / 2 : null;
  return v[k] || null;
}
export const activeRate = () => rateValue(state.settings.rateKey);
export const rateLabel = k => (RATES.find(r => r.key === k) || {}).short || k;

async function fetchJ(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// Descarga las tasas. Si falla (sin internet) se conservan las últimas guardadas.
export async function refreshRates() {
  const R = state.rates;
  R.values ||= {}; R.src ||= {}; R.dates ||= {};
  const [usd, eur, usdt] = await Promise.allSettled([
    fetchJ('https://ve.dolarapi.com/v1/dolares'),
    fetchJ('https://ve.dolarapi.com/v1/euros'),
    fetchJ('https://criptoya.com/api/binancep2p/USDT/VES/1'),
  ]);
  const now = Date.now();
  let ok = 0;
  const set = (k, v, date) => {
    if (!(v > 0)) return;
    // Un valor puesto a mano en las últimas 12 h no se pisa.
    if (R.src[k] === 'manual' && R.dates[k] && now - new Date(R.dates[k]).getTime() < 12 * 3600e3) return;
    R.values[k] = Number(v); R.src[k] = 'auto'; R.dates[k] = date || new Date(now).toISOString(); ok++;
  };
  if (usd.status === 'fulfilled' && Array.isArray(usd.value)) {
    const o = usd.value.find(x => x.fuente === 'oficial');
    const p = usd.value.find(x => x.fuente === 'paralelo');
    o && set('bcv', o.promedio, o.fechaActualizacion);
    p && set('paralelo', p.promedio, p.fechaActualizacion);
  }
  if (eur.status === 'fulfilled' && Array.isArray(eur.value)) {
    const o = eur.value.find(x => x.fuente === 'oficial');
    o && set('eur', o.promedio, o.fechaActualizacion);
  }
  if (usdt.status === 'fulfilled' && usdt.value && usdt.value.ask) {
    const { ask, bid } = usdt.value;
    set('usdt', bid ? (ask + bid) / 2 : ask, usdt.value.time ? new Date(usdt.value.time * 1000).toISOString() : null);
  }
  const anyFetched = [usd, eur, usdt].some(x => x.status === 'fulfilled');
  if (anyFetched) R.fetchedAt = now;
  await db.kvSet('rates', R);
  await saveRateHistory();
  document.dispatchEvent(new CustomEvent('rates-updated'));
  return anyFetched;
}

export async function setManualRate(k, v) {
  const R = state.rates;
  R.values[k] = v; R.src[k] = 'manual'; R.dates[k] = new Date().toISOString();
  await db.kvSet('rates', R);
  await saveRateHistory();
  document.dispatchEvent(new CustomEvent('rates-updated'));
}

async function saveRateHistory() {
  const h = (await db.kvGet('rateHistory')) || {};
  const v = state.rates.values;
  h[dayKey()] = { bcv: v.bcv || null, eur: v.eur || null, paralelo: v.paralelo || null, usdt: v.usdt || null };
  const keys = Object.keys(h).sort();
  while (keys.length > 90) delete h[keys.shift()];
  await db.kvSet('rateHistory', h);
}

// ---------- Cálculos de venta ----------
export function commissionFor(methodId, amountBs) {
  const m = state.settings.methods.find(x => x.id === methodId);
  if (!m || m.currency !== 'VES' || !(amountBs > 0)) return { bs: 0, pct: m ? m.pct : 0, fixed: m ? m.fixed : 0 };
  return { bs: r2(amountBs * (m.pct || 0) / 100 + (m.fixed || 0)), pct: m.pct, fixed: m.fixed };
}

export function cartTotals(cart = state.cart) {
  const s = state.settings;
  const lines = [];
  let sub = 0, grav = 0;
  for (const l of cart) {
    const p = state.products.get(l.pid);
    if (!p) continue;
    const t = r2(p.price * l.qty);
    sub += t;
    if (!p.exento) grav += t;
    lines.push({ ...l, p, totalUsd: t });
  }
  sub = r2(sub);
  let iva = 0, total = sub;
  if (s.ivaMode === 'incluido') iva = grav * s.ivaPct / (100 + s.ivaPct);
  else if (s.ivaMode === 'sumar') { iva = grav * s.ivaPct / 100; total = sub + iva; }
  iva = r2(iva); total = r2(total);
  const rate = activeRate();
  return { lines, subtotalUsd: sub, ivaUsd: iva, totalUsd: total, rate, rateKey: s.rateKey, totalBs: rate ? r2(total * rate) : null };
}

export const methodName = id => id === 'fiado' ? 'Fiado' : ((state.settings.methods.find(m => m.id === id) || {}).name || id);
