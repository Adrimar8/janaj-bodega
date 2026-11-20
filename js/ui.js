// Utilidades de interfaz: formato de números, modales, avisos e iconos.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nf2 = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fin = n => Number.isFinite(n) ? n : 0;
export const fmtBs = n => (fin(n) < -0.004 ? '−' : '') + 'Bs ' + nf2.format(Math.abs(fin(n)));
export const fmtUsd = n => (fin(n) < -0.004 ? '−' : '') + '$' + nf2.format(Math.abs(fin(n)));
export const fmtNum = (n, d = 2) => new Intl.NumberFormat('es-VE', { maximumFractionDigits: d }).format(Number.isFinite(n) ? n : 0);
// Formato para poner dentro de un input (sin separador de miles para que se pueda volver a leer).
export const numIn = (n, d = 2) => (n == null || !Number.isFinite(Number(n))) ? '' : new Intl.NumberFormat('es-VE', { maximumFractionDigits: d, useGrouping: false }).format(n);
export const fmtQty = (q, unit) => unit === 'kg' ? fmtNum(q, 3) + ' kg' : fmtNum(q, 3);

// Acepta "1.234,56", "1234,56", "1234.56" y "0,35".
export function parseNum(v) {
  if (typeof v === 'number') return v;
  v = String(v ?? '').trim().replace(/\s|\$|Bs\.?/gi, '');
  if (!v) return NaN;
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  return Number(v);
}
// Número corto para mostrar (los ids nuevos son muy largos para que no choquen entre equipos).
export const shortId = id => { const t = String(id); return t.length > 6 ? t.slice(-6) : t; };
export const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
export const r3 = n => Math.round((n + Number.EPSILON) * 1000) / 1000;

export const dayKey = (d = new Date()) => {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};
export const fmtDay = k => { if (!k) return ''; const [y, m, d] = k.split('-'); return `${d}/${m}/${y}`; };
export const fmtTime = ts => new Date(ts).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = ts => new Date(ts).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ---------- Modales ----------
const modalStack = [];
export function modal({ title, body = '', actions = [], wide = false, onClose }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <header class="modal-h"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Cerrar">${icon('x')}</button></header>
    <div class="modal-body"></div>
    ${actions.length ? '<footer class="modal-f"></footer>' : ''}
  </div>`;
  const bodyEl = back.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.append(body);
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    back.remove();
    const i = modalStack.indexOf(api); if (i >= 0) modalStack.splice(i, 1);
    onClose && onClose();
  };
  const api = { el: back, body: bodyEl, close, footer: back.querySelector('.modal-f') };
  actions.forEach(a => {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.cls || '');
    b.type = 'button';
    b.innerHTML = a.label;
    if (a.id) b.id = a.id;
    b.addEventListener('click', () => a.onClick ? a.onClick(close, b) : close());
    api.footer.append(b);
  });
  back.querySelector('[data-close]').addEventListener('click', close);
  back.addEventListener('mousedown', e => { if (e.target === back) back.dataset.down = '1'; });
  back.addEventListener('click', e => { if (e.target === back && back.dataset.down) close(); delete back.dataset.down; });
  document.body.append(back);
  modalStack.push(api);
  setTimeout(() => { const f = bodyEl.querySelector('[autofocus],input:not([type=checkbox]):not([type=radio]),select'); f && f.focus(); }, 30);
  return api;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalStack.length) { e.preventDefault(); modalStack[modalStack.length - 1].close(); } });
export const modalOpen = () => modalStack.length > 0;
export const closeAllModals = () => { while (modalStack.length) modalStack[modalStack.length - 1].close(); };

export function confirmDialog(msg, { ok = 'Sí', cancel = 'Cancelar', danger = false } = {}) {
  return new Promise(res => {
    let v = false;
    modal({
      title: 'Confirmar', body: `<p>${msg}</p>`,
      actions: [{ label: cancel, cls: 'ghost' }, { label: ok, cls: danger ? 'danger' : 'primary', onClick: c => { v = true; c(); } }],
      onClose: () => res(v),
    });
  });
}

export function toast(msg, type = 'ok', ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// ---------- Iconos (SVG en línea) ----------
const P = {
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.2a1 1 0 0 0 1 .8h9.6a1 1 0 0 0 1-.8L21 7H6"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  rate: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M22 21c0-3-1.8-5.6-4.5-6.6"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/>',
  report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  camera: '<path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  inbox: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  alert: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.5"/>',
};
export const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

// Descarga de un archivo generado en el navegador.
export function downloadFile(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
