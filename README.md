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

## Sincronización (Firebase)

Cada equipo guarda sus datos y trabaja sin internet. Los cambios se apuntan en una cola (`outbox`) dentro de la misma transacción y se suben a Firestore cuando hay conexión. Los de otros equipos llegan en tiempo real.

- Conflictos: gana el último cambio (`_u`). El **stock** no se pisa: cada equipo lleva su propio contador de movimientos y el stock es `último conteo + movimientos de todos los equipos desde ese conteo`.
- Datos en `shops/{uid}/docs/{tabla~id}`. Hay una cuenta (correo y contraseña) por bodega y se usa la misma en todos los equipos.

Configurar (una sola vez):
1. https://console.firebase.google.com → **Crear proyecto** (sin Google Analytics).
2. **Authentication** → Comenzar → **Correo electrónico/contraseña** → Habilitar.
3. **Firestore Database** → Crear base de datos → modo producción, ubicación `nam5` o `us-east1` (la más cercana a Venezuela).
4. Firestore → **Reglas** → pegar y publicar:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /shops/{uid}/docs/{doc} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
5. Configuración del proyecto (⚙) → Tus apps → **Web (</>)** → registrar app → copiar `firebaseConfig` en `js/firebase-config.js`.
6. Authentication → Configuración → **Dominios autorizados** → añadir `adrimar8.github.io`.

Uso: en el primer equipo, Ajustes → "Crear cuenta de la bodega" (sube sus datos). En los demás, "Entrar" con la misma cuenta (descargan los datos de la nube).

## Estructura

```
index.html, manifest.webmanifest, sw.js
css/app.css
js/main.js        arranque y navegación
js/db.js          IndexedDB + cola de cambios para sincronizar
js/sync.js        sincronización (subir cola, recibir cambios, fusionar)
js/remote-firebase.js  adaptador Firebase Auth + Firestore
js/store.js       ajustes, tasas, productos, cálculos (IVA, comisiones)
js/scanner.js     lector USB/Bluetooth (teclado) y cámara (BarcodeDetector)
js/ui.js          formato, modales, iconos
js/views/*.js     vender, inventario, tasas, fiado, caja, reportes, ajustes
```

## Pendiente

- Confirmar las comisiones reales de Banesco (punto) y BDV (biopago). Ahora son estimaciones: 1,5 %.
- Confirmar el régimen fiscal con el contable (IVA incluido o sumado, IGTF).
- Crear el proyecto de Firebase y poner su configuración en `js/firebase-config.js`.
- Carga masiva de productos desde Excel/CSV.
