// Adaptador de nube: Firebase (Auth con correo y contraseña + Firestore).
// Datos en shops/{uid}/docs/{tabla~id}. Solo el usuario dueño puede leer y escribir (reglas en el README).
const V = '10.12.2';
const BASE = `https://www.gstatic.com/firebasejs/${V}/`;

export async function createRemote(config) {
  const [appM, authM, fsM] = await Promise.all([
    import(BASE + 'firebase-app.js'), import(BASE + 'firebase-auth.js'), import(BASE + 'firebase-firestore.js'),
  ]);
  const app = appM.initializeApp(config);
  const auth = authM.getAuth(app);
  const fs = fsM.getFirestore(app);
  const col = () => fsM.collection(fs, 'shops', auth.currentUser.uid, 'docs');
  const toUser = u => u ? { uid: u.uid, email: u.email } : null;

  return {
    currentUser: () => new Promise(res => { const off = authM.onAuthStateChanged(auth, u => { off(); res(toUser(u)); }); }),
    signUp: async (e, p) => toUser((await authM.createUserWithEmailAndPassword(auth, e, p)).user),
    signIn: async (e, p) => toUser((await authM.signInWithEmailAndPassword(auth, e, p)).user),
    signOut: () => authM.signOut(auth),
    isEmpty: async () => (await fsM.getDocs(fsM.query(col(), fsM.limit(1)))).empty,
    push: async entries => {
      const b = fsM.writeBatch(fs);
      for (const e of entries) {
        b.set(fsM.doc(col(), e.id), { s: e.s, i: e.i, j: e.j, del: e.del, du: e.du, dev: e.dev, t: fsM.serverTimestamp() });
      }
      await b.commit();
    },
    // Escucha en tiempo real los cambios posteriores al cursor (con 2 min de margen; aplicar dos veces no hace daño).
    subscribe: (cursor, onDocs, onErr) => {
      const q = cursor
        ? fsM.query(col(), fsM.where('t', '>', new fsM.Timestamp(Math.max(0, cursor.s - 120), 0)), fsM.orderBy('t'))
        : fsM.query(col(), fsM.orderBy('t'));
      let max = cursor;
      return fsM.onSnapshot(q, snap => {
        const docs = [];
        snap.docChanges().forEach(ch => {
          if (ch.type === 'removed') return;
          const d = ch.doc;
          if (d.metadata.hasPendingWrites) return;
          const x = d.data();
          if (!x.t) return;
          docs.push(x);
          if (!max || x.t.seconds > max.s || (x.t.seconds === max.s && x.t.nanoseconds > max.n)) max = { s: x.t.seconds, n: x.t.nanoseconds };
        });
        if (docs.length) onDocs(docs, max);
      }, onErr);
    },
  };
}
