// Capa de datos local (IndexedDB). Todo queda guardado en el propio equipo y funciona sin internet.
// Si la sincronización está activa, cada cambio se apunta también en "outbox" (en la misma transacción)
// para subirlo a la nube cuando haya conexión.
const NAME = 'janaj-bodega';
const VERSION = 2;
export const STORES = ['products', 'sales', 'purchases', 'customers', 'ledger', 'closings', 'kv'];
export const SYNCED = ['products', 'sales', 'purchases', 'customers', 'ledger', 'closings'];
export const syncKv = k => k === 'settings' || String(k).startsWith('fondo:');
// Ids únicos entre equipos (caben de sobra en un número exacto de JavaScript).
export const newId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

let tracking = false;
export const setTracking = v => { tracking = !!v; };
let commitListener = null;
export const onCommit = fn => { commitListener = fn; };

let _db;
export function open() {
  if (_db) return _db;
  _db = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      const mk = (n, idx = []) => {
        if (d.objectStoreNames.contains(n)) return;
        const s = n === 'kv' ? d.createObjectStore(n) : d.createObjectStore(n, { keyPath: 'id', autoIncrement: true });
        idx.forEach(i => s.createIndex(i, i));
      };
      mk('products', ['barcode']);
      mk('sales', ['ts', 'day']);
      mk('purchases', ['ts']);
      mk('customers');
      mk('ledger', ['customerId', 'day', 'saleId']);
      mk('closings', ['day']);
      mk('kv');
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'k' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return _db;
}

export const P = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

function queue(t, store, id, doc, del) {
  t.objectStore('outbox').put({ k: `${store}~${id}`, s: store, id, doc: del ? null : structuredClone(doc), del, du: del ? Date.now() : 0, q: Math.random() });
}

// Envuelve un almacén para: asignar id, marcar la hora de cambio (_u) y apuntar el cambio en outbox.
function wrapStore(t, name, remote, info) {
  const st = t.objectStore(name);
  if (!SYNCED.includes(name) && name !== 'kv') return st;
  return new Proxy(st, {
    get(target, prop) {
      if (prop === 'put' || prop === 'add') {
        return (v, k) => {
          const key = name === 'kv' ? k : (v.id ??= newId());
          const tracked = !remote && (name !== 'kv' || syncKv(k));
          if (tracked) {
            if (v && typeof v === 'object') v._u = Date.now();
            if (tracking) { queue(t, name, key, v, false); info.queued++; }
          }
          return k === undefined ? target[prop](v) : target[prop](v, k);
        };
      }
      if (prop === 'delete') {
        return k => {
          if (!remote && tracking && (name !== 'kv' || syncKv(k))) { queue(t, name, k, null, true); info.queued++; }
          return target.delete(k);
        };
      }
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
}

// Ejecuta fn dentro de una transacción; devuelve su resultado cuando la transacción se confirma.
// opts.remote = true: cambios que vienen de la nube (no se vuelven a subir ni cambian _u).
export async function run(stores, mode, fn, opts = {}) {
  const d = await open();
  const list = [...stores];
  if (mode === 'readwrite' && tracking && !opts.remote && list.some(s => SYNCED.includes(s) || s === 'kv') && !list.includes('outbox')) list.push('outbox');
  return new Promise((res, rej) => {
    const t = d.transaction(list, mode);
    const info = { queued: 0 };
    let result;
    t.oncomplete = () => { res(result); if (info.queued && commitListener) commitListener(); };
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Transacción cancelada'));
    const w = mode === 'readwrite'
      ? new Proxy(t, { get(target, prop) { if (prop === 'objectStore') return n => wrapStore(target, n, !!opts.remote, info); const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v; } })
      : t;
    try {
      Promise.resolve(fn(w)).then(v => { result = v; }, e => { try { t.abort(); } catch { /* ya cerrada */ } rej(e); });
    } catch (e) { try { t.abort(); } catch { /* ya cerrada */ } rej(e); }
  });
}

export const all = s => run([s], 'readonly', t => P(t.objectStore(s).getAll()));
export const get = (s, k) => run([s], 'readonly', t => P(t.objectStore(s).get(k)));
export const put = (s, v, k) => run([s], 'readwrite', t => P(k === undefined ? t.objectStore(s).put(v) : t.objectStore(s).put(v, k)));
export const del = (s, k) => run([s], 'readwrite', t => P(t.objectStore(s).delete(k)));
export const count = s => run([s], 'readonly', t => P(t.objectStore(s).count()));
export const kvGet = k => get('kv', k);
export const kvSet = (k, v) => put('kv', v, k);
export const range = (s, idx, lo, hi) => run([s], 'readonly', t => P(t.objectStore(s).index(idx).getAll(IDBKeyRange.bound(lo, hi))));
export const byIndex = (s, idx, val) => run([s], 'readonly', t => P(t.objectStore(s).index(idx).getAll(val)));

export async function exportAll() {
  const out = {};
  for (const s of STORES) {
    if (s === 'kv') {
      out.kv = await run(['kv'], 'readonly', async t => {
        const st = t.objectStore('kv');
        const keys = await P(st.getAllKeys());
        const vals = await P(st.getAll());
        return keys.map((k, i) => [k, vals[i]]).filter(([k]) => !LOCAL_KV.includes(k));
      });
    } else out[s] = await all(s);
  }
  return out;
}

// Claves propias de cada equipo: no van en las copias ni se pisan al restaurar.
const LOCAL_KV = ['deviceId', 'syncOn', 'syncCursor', 'lastBackup'];

export async function importAll(data) {
  await run([...STORES, 'outbox'], 'readwrite', async t => {
    for (const s of STORES) {
      const st = t.objectStore(s);
      const keep = s === 'kv' ? await Promise.all(LOCAL_KV.map(async k => [k, await P(st.get(k))])) : [];
      await P(st.clear());
      if (s === 'kv') {
        for (const [k, v] of data.kv || []) if (!LOCAL_KV.includes(k)) await P(st.put(v, k));
        for (const [k, v] of keep) if (v !== undefined) await P(st.put(v, k));
      }
      else for (const v of data[s] || []) await P(st.put(v));
    }
  }, { remote: true });
}
