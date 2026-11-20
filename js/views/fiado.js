// FIADO: cuentas de clientes. Las deudas se guardan en dólares para que no pierdan valor.
import { state, activeRate, commissionFor, methodName } from '../store.js';
import * as db from '../db.js';
import { $, esc, fmtBs, fmtUsd, fmtNum, fmtDateTime, numIn, parseNum, r2, norm, modal, toast, confirmDialog, dayKey, icon } from '../ui.js';
import { setViewScanHandler } from '../scanner.js';

let root, q = '';

export async function renderFiado(main) {
  root = main;
  setViewScanHandler(null);
  main.innerHTML = `<div class="page">
    <div class="page-h"><h1>Fiado</h1><div class="actions"><button class="btn primary" id="newC">${icon('plus')} Nuevo cliente</button></div></div>
    <div id="fBody"><p class="muted">Cargando…</p></div></div>`;
  $('#newC', main).addEventListener('click', () => editCustomer());
  draw();
}

async function load() {
  const [cs, led] = await Promise.all([db.all('customers'), db.all('ledger')]);
  const bal = new Map();
  led.forEach(l => bal.set(l.customerId, r2((bal.get(l.customerId) || 0) + (l.type === 'abono' ? -l.usd : l.usd))));
  return { cs, led, bal };
}

async function draw() {
  const { cs, bal } = await load();
  const body = $('#fBody', root); if (!body) return;
  const rate = activeRate();
  const total = [...bal.values()].reduce((s, v) => s + Math.max(0, v), 0);
  const debtors = cs.filter(c => (bal.get(c.id) || 0) > 0.004).length;
  let list = cs.map(c => ({ ...c, bal: bal.get(c.id) || 0 }));
  if (q.trim()) list = list.filter(c => norm(c.name + ' ' + (c.phone || '')).includes(norm(q)));
  list.sort((a, b) => b.bal - a.bal || a.name.localeCompare(b.name, 'es'));
  body.innerHTML = `
    <div class="stats">
      <div class="stat ${total > 0 ? 'warn' : ''}"><span>Total por cobrar</span><b>${fmtUsd(total)}</b>${rate ? `<small>${fmtBs(total * rate)}</small>` : ''}</div>
      <div class="stat"><span>Clientes que deben</span><b>${debtors}</b></div>
      <div class="stat"><span>Clientes</span><b>${cs.length}</b></div>
    </div>
    <div class="toolbar"><input class="input" id="fq" placeholder="Buscar cliente" value="${esc(q)}"></div>
    ${!list.length ? `<p class="empty">${cs.length ? 'Sin resultados.' : 'Aún no hay clientes. Se crean aquí o al cobrar una venta con “Fiado”.'}</p>` : `
    <div class="tbl-wrap"><table class="tbl hover"><thead><tr><th>Cliente</th><th class="num">Debe</th></tr></thead><tbody>
      ${list.map(c => `<tr data-id="${c.id}"><td><div class="strong">${esc(c.name)}</div>${c.phone ? `<div class="muted small">${esc(c.phone)}</div>` : ''}</td>
        <td class="num">${c.bal > 0.004 ? `<b class="bad">${fmtUsd(c.bal)}</b>${rate ? `<div class="muted small">${fmtBs(c.bal * rate)}</div>` : ''}` : c.bal < -0.004 ? `<span class="ok">A favor ${fmtUsd(-c.bal)}</span>` : '<span class="muted">Al día</span>'}</td></tr>`).join('')}
    </tbody></table></div>`}`;
  const fq = $('#fq', body);
  fq.addEventListener('input', () => { q = fq.value; draw().then(() => { const n = $('#fq', root); n && (n.focus(), n.setSelectionRange(n.value.length, n.value.length)); }); });
  body.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => openCustomer(Number(tr.dataset.id))));
}

function editCustomer(c = null) {
  return new Promise(resolve => {
    let saved = null;
    const m = modal({
      title: c ? 'Editar cliente' : 'Nuevo cliente',
      body: `<label class="field"><span>Nombre *</span><input class="input" id="cn" value="${esc(c ? c.name : '')}"></label>
        <label class="field"><span>Teléfono</span><input class="input" id="cp" inputmode="tel" value="${esc(c ? c.phone || '' : '')}"></label>
        <label class="field"><span>Nota</span><input class="input" id="cnote" value="${esc(c ? c.note || '' : '')}" placeholder="Ej.: vecino del 3er piso"></label>`,
      actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Guardar', cls: 'primary', onClick: async close => {
        const name = $('#cn', m.body).value.trim();
        if (!name) return toast('Falta el nombre', 'bad');
        const obj = { ...(c || { createdAt: Date.now() }), name, phone: $('#cp', m.body).value.trim(), note: $('#cnote', m.body).value.trim() };
        obj.id = await db.put('customers', obj);
        saved = obj; close(); draw();
      } }],
      onClose: () => resolve(saved),
    });
  });
}

async function openCustomer(id) {
  const c = await db.get('customers', id);
  const led = (await db.byIndex('ledger', 'customerId', id)).sort((a, b) => b.ts - a.ts);
  const bal = r2(led.reduce((s, l) => s + (l.type === 'abono' ? -l.usd : l.usd), 0));
  const rate = activeRate();
  const m = modal({
    title: c.name, wide: true,
    body: `<div class="ck-head"><div><div class="lbl">Debe</div><div class="big ${bal > 0.004 ? 'bad' : 'ok'}">${fmtUsd(bal)}</div><div class="muted">${rate ? fmtBs(bal * rate) + ' a la tasa de hoy' : ''}</div></div>
        <div class="right muted small">${esc(c.phone || '')}<br>${esc(c.note || '')}</div></div>
      <div class="row gap"><button class="btn primary" id="abono">Registrar abono</button><button class="btn" id="cargo">Apuntar deuda</button><button class="btn ghost" id="edit">${icon('edit')} Editar</button>${Math.abs(bal) < 0.005 ? '<button class="btn ghost danger" id="delc">Eliminar</button>' : ''}</div>
      <h3>Movimientos</h3>
      ${!led.length ? '<p class="muted">Sin movimientos.</p>' : `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Detalle</th><th class="num">Monto</th></tr></thead><tbody>
        ${led.map(l => `<tr><td class="small">${fmtDateTime(l.ts)}</td><td>${l.type === 'abono' ? `Abono · ${esc(methodName(l.method))}${l.currency === 'VES' ? ` (${fmtBs(l.amount)} a ${fmtNum(l.rate)})` : ''}` : esc(l.note || 'Deuda')}</td>
          <td class="num ${l.type === 'abono' ? 'ok' : 'bad'}">${l.type === 'abono' ? '−' : '+'}${fmtUsd(l.usd)}</td></tr>`).join('')}
      </tbody></table></div>`}`,
  });
  $('#abono', m.body).addEventListener('click', () => { m.close(); abono(c, bal); });
  $('#cargo', m.body).addEventListener('click', () => { m.close(); cargo(c); });
  $('#edit', m.body).addEventListener('click', async () => { m.close(); await editCustomer(c); });
  const dl = $('#delc', m.body);
  dl && dl.addEventListener('click', async () => {
    if (!(await confirmDialog(`¿Eliminar a <b>${esc(c.name)}</b>?`, { ok: 'Eliminar', danger: true }))) return;
    await db.run(['customers', 'ledger'], 'readwrite', async t => {
      await db.P(t.objectStore('customers').delete(c.id));
      for (const l of led) await db.P(t.objectStore('ledger').delete(l.id));
    });
    m.close(); draw();
  });
}

function abono(c, bal) {
  const rate = activeRate();
  if (!rate) return toast('Primero configura la tasa', 'bad');
  const methods = state.settings.methods.filter(x => x.active);
  const m = modal({
    title: `Abono de ${c.name}`,
    body: `<p>Debe <b>${fmtUsd(bal)}</b> (${fmtBs(bal * rate)})</p>
      <label class="field"><span>Cómo paga</span><select class="input" id="am">${methods.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
      <label class="field"><span id="alab">Monto</span><input class="input lg" id="aa" inputmode="decimal"></label>
      <p class="small" id="aprev"></p>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Guardar abono', cls: 'primary', onClick: close => save(close) }],
  });
  const sel = $('#am', m.body), amt = $('#aa', m.body);
  const cur = () => methods.find(x => x.id === sel.value).currency;
  const upd = () => {
    const usd = cur() === 'USD';
    $('#alab', m.body).textContent = usd ? 'Monto en dólares ($)' : 'Monto en bolívares (Bs)';
    const a = parseNum(amt.value);
    const u = a > 0 ? (usd ? a : a / rate) : 0;
    const com = !usd && a > 0 ? commissionFor(sel.value, a).bs : 0;
    $('#aprev', m.body).innerHTML = a > 0 ? `Equivale a <b>${fmtUsd(u)}</b>. Queda debiendo ${fmtUsd(Math.max(0, bal - u))}.${com ? ` <span class="bad">Comisión ${fmtBs(com)}</span>` : ''}` : '';
  };
  sel.addEventListener('change', () => { amt.value = cur() === 'USD' ? numIn(bal, 2) : numIn(r2(bal * rate), 2); upd(); });
  amt.addEventListener('input', upd);
  amt.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(m.close); } });
  sel.dispatchEvent(new Event('change'));
  async function save(close) {
    const a = parseNum(amt.value);
    if (!(a > 0)) return toast('Monto no válido', 'bad');
    const usd = cur() === 'USD';
    const amountBs = usd ? r2(a * rate) : r2(a);
    await db.put('ledger', {
      customerId: c.id, ts: Date.now(), day: dayKey(), type: 'abono',
      usd: usd ? r2(a) : r2(a / rate), method: sel.value, currency: cur(), amount: r2(a), amountBs, rate,
      commissionBs: usd ? 0 : commissionFor(sel.value, a).bs,
    });
    toast('Abono registrado ✓'); close(); draw();
  }
}

function cargo(c) {
  const m = modal({
    title: `Apuntar deuda a ${c.name}`,
    body: `<p class="muted small">Para deudas que ya tenía apuntadas en la libreta o fiados fuera de una venta.</p>
      <label class="field"><span>Monto ($)</span><input class="input lg" id="ca" inputmode="decimal"></label>
      <label class="field"><span>Concepto</span><input class="input" id="cc" placeholder="Ej.: deuda de la libreta"></label>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Apuntar', cls: 'primary', onClick: async close => {
      const a = parseNum($('#ca', m.body).value);
      if (!(a > 0)) return toast('Monto no válido', 'bad');
      await db.put('ledger', { customerId: c.id, ts: Date.now(), day: dayKey(), type: 'cargo', usd: r2(a), note: $('#cc', m.body).value.trim() || 'Deuda manual' });
      toast('Deuda apuntada'); close(); draw();
    } }],
  });
}
