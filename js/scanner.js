// Lectura de códigos de barras.
// 1) Lector USB/Bluetooth: se comporta como un teclado que escribe muy rápido y termina en Enter.
// 2) Cámara del móvil: usa BarcodeDetector (Chrome en Android).
import { modal, toast, modalOpen } from './ui.js';

const stack = [];
let viewHandler = null;
export const setViewScanHandler = fn => { viewHandler = fn; };
export function pushScanHandler(fn) {
  stack.push(fn);
  return () => { const i = stack.lastIndexOf(fn); if (i >= 0) stack.splice(i, 1); };
}
function dispatch(code) {
  if (stack.length) return stack[stack.length - 1](code);
  if (modalOpen()) return toast('Cierra esta ventana para escanear', 'warn');
  viewHandler && viewHandler(code);
}

let buf = '', last = 0, fastCount = 0;
document.addEventListener('keydown', e => {
  const now = performance.now();
  const el = document.activeElement;
  const inField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') && el.type !== 'checkbox' && el.type !== 'radio';
  if (e.key === 'Enter') {
    const isScan = buf.length >= 4 && fastCount >= buf.length - 1 && now - last < 80;
    // Los campos marcados con data-scan-own gestionan ellos mismos el código (p. ej. el buscador de Vender).
    if (isScan && !(inField && el.dataset.scanOwn !== undefined)) {
      e.preventDefault(); e.stopPropagation();
      // Si el lector escribió dentro de otro campo, quitamos ese texto.
      if (inField && typeof el.value === 'string' && el.value.endsWith(buf)) el.value = el.value.slice(0, -buf.length);
      dispatch(buf);
    }
    buf = ''; fastCount = 0;
    return;
  }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (now - last > 60) { buf = ''; fastCount = 0; } else fastCount++;
    buf += e.key;
    last = now;
  }
}, true);

export const camSupported = 'BarcodeDetector' in window && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

export function scanWithCamera() {
  return new Promise(resolve => {
    let stream, timer, done = false;
    const stop = () => { done = true; clearTimeout(timer); stream && stream.getTracks().forEach(t => t.stop()); };
    const m = modal({
      title: 'Escanear con la cámara',
      body: '<div class="cam-wrap"><video playsinline muted class="cam-video"></video><div class="cam-line"></div></div><p class="muted center">Apunta al código de barras</p>',
      onClose: () => { stop(); resolve(null); },
    });
    const video = m.body.querySelector('video');
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (done) return stop();
        video.srcObject = stream;
        await video.play();
        let formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
        try { const sup = await BarcodeDetector.getSupportedFormats(); formats = formats.filter(f => sup.includes(f)); } catch { /* usar lista base */ }
        const det = new BarcodeDetector({ formats });
        const loop = async () => {
          if (done) return;
          try {
            const codes = await det.detect(video);
            if (codes.length) {
              const v = codes[0].rawValue;
              navigator.vibrate && navigator.vibrate(60);
              stop(); resolve(v); m.close();
              return;
            }
          } catch { /* frame no listo */ }
          timer = setTimeout(loop, 120);
        };
        loop();
      } catch (e) {
        m.body.innerHTML = '<p>No se pudo abrir la cámara. Revisa que la app tenga permiso de cámara.</p>';
        toast('Cámara no disponible', 'bad');
      }
    })();
  });
}
