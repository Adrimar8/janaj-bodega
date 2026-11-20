// Capa de datos local (IndexedDB). Todo queda guardado en el propio equipo y funciona sin internet.
const NAME = 'janaj-bodega';
const VERSION = 1;
export const STORES = ['products', 'sales', 'purchases', 'customers', 'ledger', 'closings', 'kv'];

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
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return _db;
}

export const P = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// Ejecuta fn dentro de una transacción; devuelve su resultado cuando la transacción se confirma.
export async function run(stores, mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(stores, mode);
    let result;
    t.oncomplete = () => res(result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Transacción cancelada'));
    try {
      Promise.resolve(fn(t)).then(v => { result = v; }, e => { try { t.abort(); } catch { /* ya cerrada */ } rej(e); });
    } catch (e) { try { t.abort(); } catch { /* ya cerrada */ } rej(e); }
  });
}

export const all = s => run([s], 'readonly', t => P(t.objectStore(s).getAll()));
export const get = (s, k) => run([s], 'readonly', t => P(t.objectStore(s).get(k)));
export const put = (s, v, k) => run([s], 'readwrite', t => P(k === undefined ? t.objectStore(s).put(v) : t.objectStore(s).put(v, k)));
export const del = (s, k) => run([s], 'readwrite', t => P(t.objectStore(s).delete(k)));
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
        return keys.map((k, i) => [k, vals[i]]);
      });
    } else out[s] = await all(s);
  }
  return out;
}

export async function importAll(data) {
  await run(STORES, 'readwrite', async t => {
    for (const s of STORES) {
      const st = t.objectStore(s);
      await P(st.clear());
      if (s === 'kv') { for (const [k, v] of data.kv || []) await P(st.put(v, k)); }
      else for (const v of data[s] || []) await P(st.put(v));
    }
  });
}
