// Sincronización entre equipos a través de la nube (Firebase).
// Cada equipo trabaja con sus datos locales; los cambios se suben cuando hay internet y los de los
// otros equipos llegan en tiempo real.
import * as db from './db.js';
import { state, cacheProduct, uncacheProduct, mergeProduct, applySettings, loadAll, saveCart, onCartSave } from './store.js';
import { firebaseConfig } from './firebase-config.js';

export const sync = { status: 'off', user: null, lastSync: null, pending: 0, error: null, cart: { status: 'off', error: null, lastIn: null, lastOut: null } };
let remote = null, unsub = null, pushing = false, pushAgain = false, timer = null;
const emit = () => document.dispatchEvent(new CustomEvent('sync-status'));

const mockUrl = () => {
  try { return ['localhost', '127.0.0.1'].includes(location.hostname) && localStorage.getItem('janaj-remote'); } catch { return null; }
};
export const syncConfigured = () => !!(firebaseConfig && firebaseConfig.apiKey) || !!mockUrl();

async function getRemote() {
  if (remote) return remote;
  const mod = await import(mockUrl() || './remote-firebase.js');
  remote = await mod.createRemote(firebaseConfig);
  return remote;
}

// Se llama al arrancar, antes de cualquier cambio, para que lo hecho sin internet quede en cola.
export async function prepareSync() {
  if (await db.kvGet('syncOn')) db.setTracking(true);
  db.onCommit(schedulePush);
}

export async function initSync() {
  if (!syncConfigured()) { sync.status = 'unconfigured'; return emit(); }
  if (!(await db.kvGet('syncOn'))) { sync.status = 'off'; return emit(); }
  sync.pending = await db.count('outbox');
  if (!navigator.onLine) { sync.status = 'offline'; emit(); window.addEventListener('online', initSync, { once: true }); return; }
  try {
    const r = await getRemote();
    const u = await r.currentUser();
    if (!u) { sync.status = 'signedout'; return emit(); }
    sync.user = u;
    start();
  } catch (e) {
    sync.status = 'error'; sync.error = e.message; emit();
    setTimeout(initSync, 60e3);
  }
}

// ---------- Carrito en vivo entre equipos ----------
// El último cambio gana. Si llega una línea de un producto que aún no está aquí, se guarda y se aplica cuando llegue.
let unsubCart = null, remoteCart = null, cartTimer = null;
function applyCart() {
  if (!remoteCart) return;
  state.cart = (remoteCart.lines || []).filter(l => state.products.has(l.pid));
  if (state.cart.length === (remoteCart.lines || []).length) remoteCart = null;
  saveCart(true);
  document.dispatchEvent(new CustomEvent('remote-changes'));
}
function watchCart() {
  if (unsubCart) unsubCart();
  if (!remote.watchCart) return;
  sync.cart.status = 'connecting';
  unsubCart = remote.watchCart(c => {
    sync.cart.status = 'ok'; sync.cart.error = null;
    if (c && c.dev !== state.deviceId) { sync.cart.lastIn = Date.now(); remoteCart = c; applyCart(); }
    emit();
  }, e => { sync.cart.status = 'error'; sync.cart.error = e.message; emit(); console.warn('Carrito en vivo:', e); });
}
onCartSave(cart => {
  remoteCart = null;
  if (!remote || !remote.putCart || !sync.user) return;
  clearTimeout(cartTimer);
  cartTimer = setTimeout(() => {
    const lines = JSON.parse(JSON.stringify(state.cart));
    remote.putCart({ lines, dev: state.deviceId, at: Date.now() })
      .then(() => { sync.cart.lastOut = Date.now(); sync.cart.error = null; emit(); })
      .catch(e => { sync.cart.status = 'error'; sync.cart.error = e.message; emit(); console.warn('Carrito en vivo:', e); });
  }, 250);
});

function start() {
  if (unsub) unsub();
  watchCart();
  sync.status = 'ok'; emit();
  db.kvGet('syncCursor').then(cursor => {
    let chain = Promise.resolve();
    unsub = remote.subscribe(cursor || null, (docs, cur) => {
      // En orden: un lote no empieza hasta que termina el anterior.
      chain = chain.then(async () => {
        try {
          await applyRemote(docs.filter(d => d.dev !== state.deviceId));
          await db.kvSet('syncCursor', cur);
          sync.lastSync = Date.now(); sync.status = 'ok'; sync.error = null; emit();
        } catch (e) { sync.status = 'error'; sync.error = e.message; emit(); }
      });
    }, e => { sync.status = 'error'; sync.error = e.message; emit(); });
  });
  push();
  clearInterval(timer);
  timer = setInterval(push, 60e3);
  window.addEventListener('online', push);
}

function schedulePush() {
  db.count('outbox').then(n => { sync.pending = n; emit(); });
  clearTimeout(schedulePush.t);
  schedulePush.t = setTimeout(push, 1200);
}

export async function push() {
  if (!remote || !sync.user || !navigator.onLine) return;
  if (pushing) { pushAgain = true; return; }
  pushing = true;
  try {
    const entries = await db.all('outbox');
    for (let i = 0; i < entries.length; i += 400) {
      const chunk = entries.slice(i, i + 400);
      await remote.push(chunk.map(e => ({ id: e.k, s: e.s, i: e.id, j: e.del ? null : JSON.stringify(e.doc), del: !!e.del, du: e.du || 0, dev: state.deviceId })));
      // Solo se borra de la cola si no cambió mientras se subía.
      await db.run(['outbox'], 'readwrite', async t => {
        const o = t.objectStore('outbox');
        for (const e of chunk) { const cur = await db.P(o.get(e.k)); if (cur && cur.q === e.q) await db.P(o.delete(e.k)); }
      });
    }
    sync.pending = await db.count('outbox');
    sync.lastSync = Date.now(); sync.status = 'ok'; sync.error = null;
  } catch (e) {
    sync.status = 'error'; sync.error = e.message;
  } finally {
    pushing = false; emit();
    if (pushAgain) { pushAgain = false; push(); }
  }
}

async function applyRemote(docs) {
  if (!docs.length) return;
  const products = [], removed = [];
  let settings = null;
  await db.run([...db.SYNCED, 'kv', 'outbox'], 'readwrite', async t => {
    for (const d of docs) {
      if (d.s === 'kv') {
        const st = t.objectStore('kv');
        if (d.del) { await db.P(st.delete(d.i)); continue; }
        const val = JSON.parse(d.j);
        const loc = await db.P(st.get(d.i));
        if (loc && (loc._u || 0) > (val._u || 0)) continue;
        await db.P(st.put(val, d.i));
        if (d.i === 'settings') settings = val;
        continue;
      }
      if (!db.SYNCED.includes(d.s)) continue;
      const st = t.objectStore(d.s);
      const loc = await db.P(st.get(d.i));
      if (d.del) {
        if (loc && (loc._u || 0) > d.du) continue;
        if (loc) await db.P(st.delete(d.i));
        if (d.s === 'products') removed.push(d.i);
        continue;
      }
      const doc = JSON.parse(d.j);
      if (d.s === 'products' && loc) {
        const [m, behind] = mergeProduct(loc, doc);
        await db.P(st.put(m));
        products.push(m);
        // La nube tenía una versión incompleta: se sube la fusionada.
        if (behind) t.objectStore('outbox').put({ k: `products~${m.id}`, s: 'products', id: m.id, doc: m, del: false, du: 0, q: Math.random() });
        continue;
      }
      if (loc && (loc._u || 0) >= (doc._u || 0)) continue;
      await db.P(st.put(doc));
      if (d.s === 'products') products.push(doc);
    }
  }, { remote: true });
  products.forEach(cacheProduct);
  removed.forEach(uncacheProduct);
  if (settings) applySettings(settings);
  state.cart = state.cart.filter(l => state.products.has(l.pid));
  applyCart();
  document.dispatchEvent(new CustomEvent('remote-changes'));
  schedulePush();
}

// ---------- Alta y entrada ----------
const localHasData = async () => (await db.count('products')) + (await db.count('sales')) + (await db.count('customers')) > 0;

// Paso 1: autenticar. Devuelve qué hay en la nube y en el equipo para que la pantalla decida.
export async function login(email, password, create) {
  const r = await getRemote();
  const u = create ? await r.signUp(email, password) : await r.signIn(email, password);
  return { user: u, cloudEmpty: await r.isEmpty(), localData: await localHasData() };
}

// Paso 2: activar. mode = 'upload' (subir lo de este equipo) | 'replace' (usar lo de la nube) | 'pull'.
export async function activate(user, mode) {
  if (mode === 'replace') await replaceLocal();
  await db.kvSet('syncOn', true);
  db.setTracking(true);
  if (mode === 'upload') await enqueueAll();
  sync.user = user;
  start();
}

async function enqueueAll() {
  await db.run([...db.SYNCED, 'kv', 'outbox'], 'readwrite', async t => {
    const o = t.objectStore('outbox');
    for (const s of db.SYNCED) {
      for (const doc of await db.P(t.objectStore(s).getAll())) {
        doc._u ||= Date.now();
        o.put({ k: `${s}~${doc.id}`, s, id: doc.id, doc, del: false, du: 0, q: Math.random() });
      }
    }
    const kv = t.objectStore('kv');
    const keys = (await db.P(kv.getAllKeys())).filter(db.syncKv);
    for (const k of keys) {
      const v = await db.P(kv.get(k));
      if (v && typeof v === 'object') v._u ||= Date.now();
      o.put({ k: `kv~${k}`, s: 'kv', id: k, doc: v, del: false, du: 0, q: Math.random() });
    }
  }, { remote: true });
}

async function replaceLocal() {
  await db.run([...db.SYNCED, 'kv', 'outbox'], 'readwrite', async t => {
    for (const s of [...db.SYNCED, 'outbox']) await db.P(t.objectStore(s).clear());
    const kv = t.objectStore('kv');
    for (const k of (await db.P(kv.getAllKeys())).filter(k => String(k).startsWith('fondo:'))) await db.P(kv.delete(k));
    await db.P(kv.delete('syncCursor'));
    // Identidad nueva: así lo que este equipo subió antes también se descarga.
    await db.P(kv.put('d' + Math.random().toString(36).slice(2, 10), 'deviceId'));
  }, { remote: true });
  state.cart = [];
  try { localStorage.removeItem('janaj-cart'); } catch { /* sin almacenamiento */ }
  await loadAll();
}

export async function logout() {
  if (unsub) { unsub(); unsub = null; }
  if (unsubCart) { unsubCart(); unsubCart = null; }
  clearInterval(timer);
  window.removeEventListener('online', push);
  try { await (await getRemote()).signOut(); } catch { /* sin conexión */ }
  await db.kvSet('syncOn', false);
  await db.run(['outbox'], 'readwrite', t => db.P(t.objectStore('outbox').clear()));
  db.setTracking(false);
  await db.kvSet('syncCursor', null);
  Object.assign(sync, { status: 'off', user: null, pending: 0, error: null });
  emit();
}

export function friendlyError(e) {
  const c = (e && (e.code || e.message)) || '';
  if (c.includes('email-already-in-use')) return 'Ya existe una cuenta con ese correo. Usa “Entrar”.';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Correo o contraseña incorrectos.';
  if (c.includes('weak-password')) return 'La contraseña debe tener al menos 6 caracteres.';
  if (c.includes('invalid-email')) return 'El correo no es válido.';
  if (c.includes('network')) return 'Sin conexión a internet.';
  return e && e.message ? e.message : String(e);
}
