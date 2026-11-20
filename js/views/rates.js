// TASAS: BCV $, BCV €, paralelo, USDT Binance y promedio. Conversor rápido.
import { state, RATES, rateValue, refreshRates, setManualRate, saveSettings } from '../store.js';
import * as db from '../db.js';
import { $, esc, fmtBs, fmtUsd, fmtNum, fmtDay, numIn, parseNum, modal, toast, icon } from '../ui.js';
import { setViewScanHandler } from '../scanner.js';

let root;

export function renderRates(main) {
  root = main;
  setViewScanHandler(null);
  main.innerHTML = `<div class="page">
    <div class="page-h"><h1>Tasas del día</h1><div class="actions"><button class="btn" id="refresh">${icon('refresh')} Actualizar</button></div></div>
    <div id="rCards"></div>
    <div class="cols2">
      <div class="card"><h2>Conversor</h2>
        <div class="grid2">
          <label class="field"><span>Dólares ($)</span><input class="input lg" id="cvU" inputmode="decimal" placeholder="1"></label>
          <label class="field"><span>Bolívares (Bs)</span><input class="input lg" id="cvB" inputmode="decimal" placeholder="0,00"></label>
        </div>
        <div id="cvOut"></div>
      </div>
      <div class="card"><h2>Historial</h2><div id="hist"></div></div>
    </div></div>`;
  $('#refresh', main).addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true;
    const ok = await refreshRates();
    b.disabled = false;
    toast(ok ? 'Tasas actualizadas' : 'Sin conexión: se mantienen las últimas tasas', ok ? 'ok' : 'warn');
  });
  const u = $('#cvU', main), bs = $('#cvB', main);
  u.addEventListener('input', () => { bs.value = ''; conv(); });
  bs.addEventListener('input', () => { u.value = ''; conv(); });
  document.addEventListener('rates-updated', onUpd);
  draw();
}
function onUpd() { if (root && root.isConnected && $('#rCards', root)) draw(); else document.removeEventListener('rates-updated', onUpd); }

function srcTxt(k) {
  const R = state.rates;
  if (k === 'promedio') return 'Calculado';
  const d = R.dates && R.dates[k];
  if (!d) return 'Sin datos';
  const dt = new Date(d);
  const when = dt.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' }) + (k === 'bcv' || k === 'eur' ? '' : ' ' + dt.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }));
  return (R.src[k] === 'manual' ? 'Manual · ' : '') + when;
}

async function draw() {
  const sel = state.settings.rateKey;
  $('#rCards', root).innerHTML = `<div class="rate-grid">${RATES.map(r => {
    const v = rateValue(r.key);
    return `<div class="rate-card ${sel === r.key ? 'sel' : ''}">
      <div class="rc-h"><span>${esc(r.label)}</span>${r.key !== 'promedio' ? `<button class="icon-btn" data-edit="${r.key}" title="Poner a mano" aria-label="Editar ${esc(r.label)}">${icon('edit')}</button>` : ''}</div>
      <div class="rc-v">${v ? fmtNum(v, 2) : '—'}<small> Bs/${r.key === 'eur' ? '€' : '$'}</small></div>
      <div class="muted small">${srcTxt(r.key)}</div>
      ${r.cobro ? (sel === r.key ? '<div class="pill ok">Se usa para cobrar</div>' : `<button class="btn sm ghost" data-use="${r.key}">Usar para cobrar</button>`) : ''}
    </div>`;
  }).join('')}</div>
  <p class="muted small">Última consulta: ${state.rates.fetchedAt ? new Date(state.rates.fetchedAt).toLocaleString('es-VE') : 'nunca'} · Sin internet se usan las últimas tasas guardadas. Fuentes: BCV y paralelo (dolarapi), USDT (Binance P2P vía CriptoYa).</p>`;
  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editRate(b.dataset.edit)));
  root.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', async () => {
    state.settings.rateKey = b.dataset.use; await saveSettings();
    document.dispatchEvent(new CustomEvent('rates-updated'));
    toast('Ahora se cobra con ' + RATES.find(r => r.key === b.dataset.use).label);
  }));
  conv();
  const h = (await db.kvGet('rateHistory')) || {};
  const days = Object.keys(h).sort().reverse().slice(0, 15);
  $('#hist', root).innerHTML = !days.length ? '<p class="muted">Aún no hay historial.</p>' : `<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Día</th><th class="num">BCV $</th><th class="num">BCV €</th><th class="num">Paralelo</th><th class="num">USDT</th></tr></thead><tbody>
    ${days.map(d => `<tr><td>${fmtDay(d)}</td>${['bcv', 'eur', 'paralelo', 'usdt'].map(k => `<td class="num">${h[d][k] ? fmtNum(h[d][k]) : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function conv() {
  const u = parseNum($('#cvU', root).value), b = parseNum($('#cvB', root).value);
  const rows = RATES.filter(r => rateValue(r.key)).map(r => {
    const v = rateValue(r.key);
    const cur = r.key === 'eur' ? '€' : '$';
    if (b > 0) return `<div class="mrow"><span>${esc(r.label)}</span><b class="num">${cur === '€' ? '€' + fmtNum(b / v) : fmtUsd(b / v)}</b></div>`;
    const x = u > 0 ? u : 1;
    return `<div class="mrow"><span>${cur === '€' ? '€' : '$'}${fmtNum(x)} a ${esc(r.label)}</span><b class="num">${fmtBs(x * v)}</b></div>`;
  });
  $('#cvOut', root).innerHTML = rows.join('') || '<p class="muted">Sin tasas todavía.</p>';
}

function editRate(k) {
  const r = RATES.find(x => x.key === k);
  const m = modal({
    title: 'Tasa manual: ' + r.label,
    body: `<p class="muted small">Úsalo si no hay internet o si la tasa automática no es la correcta. Durante 12 h no se reemplaza por la automática.</p>
      <label class="field"><span>Bs por ${k === 'eur' ? 'euro' : 'dólar'}</span><input class="input lg" id="mr" inputmode="decimal" value="${numIn(rateValue(k), 4)}"></label>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Guardar', cls: 'primary', onClick: async c => {
      const v = parseNum($('#mr', m.body).value);
      if (!(v > 0)) return toast('Valor no válido', 'bad');
      await setManualRate(k, v); c(); toast('Tasa guardada');
    } }],
  });
  $('#mr', m.body).addEventListener('keydown', e => { if (e.key === 'Enter') m.footer.lastChild.click(); });
}
