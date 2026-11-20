// AJUSTES: tasa de cobro, comisiones, impuestos, inventario y copias de seguridad.
import { state, RATES, saveSettings, loadAll } from '../store.js';
import * as db from '../db.js';
import { $, esc, numIn, parseNum, toast, confirmDialog, dayKey, downloadFile, icon, fmtDateTime } from '../ui.js';
import { setViewScanHandler } from '../scanner.js';

export async function renderSettings(main) {
  setViewScanHandler(null);
  const s = state.settings;
  const lastBackup = await db.kvGet('lastBackup');
  main.innerHTML = `<div class="page narrow">
    <div class="page-h"><h1>Ajustes</h1></div>

    <div class="card"><h2>Tasa para cobrar en bolívares</h2>
      <p class="muted small">Los precios están en dólares. Esta tasa convierte el total a bolívares.</p>
      <select class="input" id="rk">${RATES.filter(r => r.cobro).map(r => `<option value="${r.key}" ${s.rateKey === r.key ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
    </div>

    <div class="card"><h2>Comisiones por método de pago</h2>
      <p class="muted small">Lo que el banco descuenta de cada cobro. Míralo en el estado de cuenta de Banesco (punto) y del Banco de Venezuela (biopago).</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Activo</th><th>Método</th><th class="num">% comisión</th><th class="num">Fijo (Bs)</th></tr></thead><tbody>
      ${s.methods.map(m => `<tr data-m="${m.id}"><td><input type="checkbox" data-k="active" ${m.active ? 'checked' : ''} aria-label="Activo"></td>
        <td><input class="input sm" data-k="name" value="${esc(m.name)}"></td>
        <td class="num">${m.currency === 'VES' ? `<input class="input sm num" data-k="pct" inputmode="decimal" value="${numIn(m.pct, 3)}">` : '—'}</td>
        <td class="num">${m.currency === 'VES' ? `<input class="input sm num" data-k="fixed" inputmode="decimal" value="${numIn(m.fixed, 2)}">` : '—'}</td></tr>`).join('')}
      </tbody></table></div>
      <label class="check"><input type="checkbox" id="cv" ${s.commissionsVerified ? 'checked' : ''}> Ya confirmé las comisiones con el banco</label>
    </div>

    <div class="card"><h2>Impuestos</h2>
      <p class="warn small">${icon('alert')} Son cálculos orientativos. Confirma con tu contable qué régimen te aplica ante el SENIAT.</p>
      <div class="grid2">
        <label class="field"><span>IVA (%)</span><input class="input" id="iva" inputmode="decimal" value="${numIn(s.ivaPct, 2)}"></label>
        <label class="field"><span>Cómo se aplica el IVA</span><select class="input" id="ivam">
          <option value="incluido" ${s.ivaMode === 'incluido' ? 'selected' : ''}>Incluido en el precio (se calcula cuánto es)</option>
          <option value="sumar" ${s.ivaMode === 'sumar' ? 'selected' : ''}>Se suma al precio al cobrar</option>
          <option value="no" ${s.ivaMode === 'no' ? 'selected' : ''}>No calcular IVA</option></select></label>
      </div>
      <p class="muted small">Los productos marcados como “exentos” en el inventario no llevan IVA.</p>
      <label class="check"><input type="checkbox" id="igtf" ${s.igtfOn ? 'checked' : ''}> Calcular IGTF sobre pagos en efectivo en dólares</label>
      <label class="field"><span>IGTF (%)</span><input class="input" id="igtfp" inputmode="decimal" value="${numIn(s.igtfPct, 2)}"></label>
    </div>

    <div class="card"><h2>Inventario</h2>
      <div class="grid2">
        <label class="field"><span>Stock mínimo por defecto</span><input class="input" id="lsd" inputmode="decimal" value="${numIn(s.lowStockDefault, 3)}"></label>
        <label class="field"><span>Avisar vencimientos con (días)</span><input class="input" id="ewd" inputmode="numeric" value="${s.expiryWarnDays}"></label>
      </div>
    </div>

    <div class="row gap end"><button class="btn primary" id="saveS">Guardar ajustes</button></div>

    <div class="card"><h2>Copia de seguridad</h2>
      <p class="muted small">Todos los datos se guardan en este equipo. Haz una copia cada semana y guárdala en un pendrive, en Google Drive o mándatela por WhatsApp.</p>
      <p class="small">Última copia: <b>${lastBackup ? fmtDateTime(lastBackup) : 'nunca'}</b></p>
      <div class="row gap"><button class="btn" id="exp">${icon('download')} Descargar copia</button>
        <label class="btn">${icon('upload')} Restaurar copia<input type="file" id="imp" accept=".json,application/json" hidden></label></div>
    </div>

    <div class="card"><h2>Acerca de</h2>
      <p class="small">JANAJ Bodega · versión 1.0 · funciona sin internet. Los datos no salen de este equipo.</p>
      <p class="small muted">Próximamente: sincronización entre el ordenador y el móvil.</p>
    </div>
  </div>`;

  $('#saveS', main).addEventListener('click', async () => {
    s.rateKey = $('#rk', main).value;
    main.querySelectorAll('tr[data-m]').forEach(tr => {
      const m = s.methods.find(x => x.id === tr.dataset.m);
      tr.querySelectorAll('[data-k]').forEach(inp => {
        const k = inp.dataset.k;
        if (k === 'active') m.active = inp.checked;
        else if (k === 'name') m.name = inp.value.trim() || m.name;
        else { const v = parseNum(inp.value); m[k] = v >= 0 ? v : 0; }
      });
    });
    s.commissionsVerified = $('#cv', main).checked;
    const iva = parseNum($('#iva', main).value); s.ivaPct = iva >= 0 ? iva : 16;
    s.ivaMode = $('#ivam', main).value;
    s.igtfOn = $('#igtf', main).checked;
    const ig = parseNum($('#igtfp', main).value); s.igtfPct = ig >= 0 ? ig : 3;
    const l = parseNum($('#lsd', main).value); s.lowStockDefault = l >= 0 ? l : 5;
    const e = parseInt($('#ewd', main).value, 10); s.expiryWarnDays = e >= 0 ? e : 7;
    await saveSettings();
    document.dispatchEvent(new CustomEvent('rates-updated'));
    toast('Ajustes guardados ✓');
  });

  $('#exp', main).addEventListener('click', async () => {
    const data = await db.exportAll();
    downloadFile(`janaj-copia-${dayKey()}.json`, JSON.stringify({ app: 'janaj-bodega', version: 1, exportedAt: new Date().toISOString(), data }));
    await db.kvSet('lastBackup', Date.now());
    document.dispatchEvent(new CustomEvent('backup-done'));
    toast('Copia descargada ✓');
    renderSettings(main);
  });

  $('#imp', main).addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.app !== 'janaj-bodega' || !j.data) throw new Error('El archivo no es una copia de JANAJ');
      if (!(await confirmDialog(`Esto <b>reemplaza todos los datos actuales</b> por los de la copia del ${new Date(j.exportedAt).toLocaleString('es-VE')}. ¿Continuar?`, { ok: 'Restaurar', danger: true }))) return;
      await db.importAll(j.data);
      await loadAll();
      toast('Copia restaurada ✓');
      setTimeout(() => location.reload(), 600);
    } catch (err) { toast('No se pudo restaurar: ' + err.message, 'bad', 5000); }
    e.target.value = '';
  });
}
