# JANAJ Bodega

App web instalable (PWA) para la bodega JANAJ: inventario, tasas (BCV $, BCV €, paralelo, USDT, promedio), venta con lector de códigos, cobro mixto (punto, biopago, pago móvil, efectivo Bs/$, fiado), comisiones, IVA estimado, fiado y cierre de caja.

- Sin dependencias ni compilación: HTML + CSS + JavaScript (módulos ES).
- Funciona sin internet (service worker + IndexedDB). Los datos se guardan en el propio equipo.
- Tasas: `ve.dolarapi.com` (BCV y paralelo) y `criptoya.com` (USDT Binance P2P). Sin conexión se usan las últimas guardadas o se ponen a mano.

## Probar en local

```bash
python3 -m http.server 8765
# abrir http://localhost:8765
```

## Publicar (gratis)

Necesita HTTPS para instalarse y usar la cámara. Cualquiera de estos sirve: GitHub Pages, Cloudflare Pages o Netlify. Basta con subir la carpeta tal cual.

Instalar en el equipo:
- **Windows**: abrir la URL en Chrome o Edge → icono "Instalar" en la barra de direcciones.
- **Android**: abrir en Chrome → menú ⋮ → "Instalar aplicación".

## Actualizar la app

Al cambiar cualquier archivo, sube el número de `VERSION` en `sw.js`. Si no lo haces, los equipos seguirán usando la copia guardada. El cambio se aplica la segunda vez que se abre la app.

## Estructura

```
index.html, manifest.webmanifest, sw.js
css/app.css
js/main.js        arranque y navegación
js/db.js          IndexedDB
js/store.js       ajustes, tasas, productos, cálculos (IVA, comisiones)
js/scanner.js     lector USB/Bluetooth (teclado) y cámara (BarcodeDetector)
js/ui.js          formato, modales, iconos
js/views/*.js     vender, inventario, tasas, fiado, caja, reportes, ajustes
```

## Pendiente

- Confirmar las comisiones reales de Banesco (punto) y BDV (biopago). Ahora son estimaciones: 1,5 %.
- Confirmar el régimen fiscal con el contable (IVA incluido o sumado, IGTF).
- Sincronización PC ↔ móvil (fase 2: Firebase o Supabase, capa gratuita).
- Carga masiva de productos desde Excel/CSV.
