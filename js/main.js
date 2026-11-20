// Arranque de la app y navegación entre pantallas.
import { state, loadAll, refreshRates, rateValue, rateLabel } from './store.js';
import * as db from './db.js';
import { $, esc, fmtNum, icon, closeAllModals } from './ui.js';
import { setViewScanHandler } from './scanner.js';
import { renderPOS } from './views/pos.js';
import { renderInventory } from './views/inventory.js';
import { renderRates } from './views/rates.js';
import { renderFiado } from './views/fiado.js';
import { renderCaja } from './views/caja.js';
import { renderReports } from './views/reports.js';
import { renderSettings } from './views/settings.js';

const routes = {
  vender: { label: 'Vender', icon: 'cart', render: renderPOS },
  inventario: { label: 'Inventario', icon: 'box', render: renderInventory },
  tasas: { label: 'Tasas', icon: 'rate', render: renderRates },
  fiado: { label: 'Fiado', icon: 'users', render: renderFiado },
  caja: { label: 'Caja', icon: 'cash', render: renderCaja },
  reportes: { label: 'Reportes', icon: 'report', render: renderReports },
  ajustes: { label: 'Ajustes', icon: 'gear', render: renderSettings, desktopOnly: true },
};

function renderNav() {
  $('#nav').innerHTML = Object.entries(routes).map(([k, r]) =>
    `<a href="#${k}" data-r="${k}" class="${r.desktopOnly ? 'desk-only' : ''}">${icon(r.icon)}<span>${r.label}</span></a>`).join('');
  $('#gear').innerHTML = icon('gear');
}

function route() {
  const k = location.hash.slice(1) || 'vender';
  const r = routes[k] || routes.vender;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.r === k));
  closeAllModals();
  setViewScanHandler(null);
  const main = $('#main');
  main.scrollTop = 0; window.scrollTo(0, 0);
  try { r.render(main); } catch (e) { console.error(e); main.innerHTML = `<p class="bad pad">Error: ${esc(e.message)}</p>`; }
}

function renderChips() {
  const k = state.settings.rateKey;
  const chips = [['bcv', rateValue('bcv')]];
  if (k !== 'bcv') chips.push([k, rateValue(k)]);
  chips.push(['paralelo', rateValue('paralelo')]);
  const uniq = [...new Map(chips).entries()];
  $('#rateChips').innerHTML = uniq.map(([key, v]) =>
    `<a href="#tasas" class="rchip ${key === k ? 'sel' : ''}" title="${key === k ? 'Tasa usada para cobrar' : ''}"><span>${rateLabel(key)}</span><b>${v ? fmtNum(v) : '—'}</b></a>`).join('');
}

function renderNet() {
  const on = navigator.onLine;
  const n = $('#net');
  n.className = 'net ' + (on ? 'on' : 'off');
  n.title = on ? 'Con internet' : 'Sin internet: la app sigue funcionando';
  n.textContent = on ? '' : 'Sin internet';
}

async function renderBanner() {
  const last = await db.kvGet('lastBackup');
  const sales = await db.run(['sales'], 'readonly', t => db.P(t.objectStore('sales').count()));
  const stale = (state.products.size || sales) && (!last || Date.now() - last > 7 * 864e5);
  $('#banner').innerHTML = stale ? `<div class="banner">Hace más de una semana que no haces copia de seguridad. <a href="#ajustes">Hacer copia</a></div>` : '';
}

async function boot() {
  try {
    await loadAll();
  } catch (e) {
    $('#main').innerHTML = `<p class="bad pad">No se pudo abrir la base de datos: ${esc(e.message)}</p>`;
    return;
  }
  renderNav();
  renderChips();
  renderNet();
  route();
  renderBanner();
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => { renderNet(); refreshRates(); });
  window.addEventListener('offline', renderNet);
  document.addEventListener('rates-updated', renderChips);
  document.addEventListener('backup-done', renderBanner);
  const tick = () => { if (navigator.onLine) refreshRates().catch(() => {}); };
  tick();
  setInterval(tick, 30 * 60 * 1000);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

boot();
