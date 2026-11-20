// Arranque de la app y navegación entre pantallas.
import { state, loadAll, refreshRates, rateValue, rateLabel } from './store.js';
import * as db from './db.js';
import { $, esc, fmtNum, icon, closeAllModals, modalOpen } from './ui.js';
import { sync, prepareSync, initSync } from './sync.js';
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

function rerender() {
  const k = location.hash.slice(1) || 'vender';
  const r = routes[k] || routes.vender;
  try { r.render($('#main')); } catch (e) { console.error(e); }
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
  const synced = ['ok', 'error', 'offline'].includes(sync.status);
  n.className = 'net ' + (on ? 'on' : 'off') + (synced ? ' sync' : '') + (sync.status === 'error' && on && !sync.pending ? ' err' : '') + (sync.pending && on ? ' pend' : '');
  let txt = on ? '' : 'Sin internet';
  let title = on ? 'Con internet' : 'Sin internet: la app sigue funcionando';
  if (synced) {
    if (sync.pending) { txt = `${on ? '' : 'Sin internet · '}${sync.pending} por subir`; title = 'Cambios pendientes de subir a la nube'; }
    else if (on && sync.status === 'ok') { txt = 'Sincronizado'; title = 'Todo sincronizado con la nube'; }
    if (on && sync.status === 'error' && !sync.pending) { txt = 'Error de sincronización'; title = sync.error || ''; }
  }
  n.textContent = txt;
  n.title = title;
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
    await prepareSync();
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
  document.addEventListener('sync-status', renderNet);
  // Llegaron cambios de otro equipo: se refresca la pantalla si no se está escribiendo nada.
  document.addEventListener('remote-changes', () => {
    renderChips();
    const a = document.activeElement;
    const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') && a.value;
    if (!modalOpen() && !typing) rerender();
  });
  initSync();
  const tick = () => { if (navigator.onLine) refreshRates().catch(() => {}); };
  tick();
  setInterval(tick, 30 * 60 * 1000);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

boot();
