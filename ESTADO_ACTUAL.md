# JANAJ Bodega — Estado actual

_Última actualización: 21 de noviembre de 2026 · versión `janaj-v1.1.1`_

## Qué es

App de punto de venta e inventario para la bodega JANAJ (Venezuela). Es una web instalable (PWA) que funciona **sin internet**: los datos se guardan en cada equipo y, si hay conexión, se sincronizan entre ordenador y móvil mediante Firebase.

- **En producción:** https://adrimar8.github.io/janaj-bodega/
- **Repositorio:** https://github.com/Adrimar8/janaj-bodega (público; GitHub Pages desde `main`)
- **Proyecto Firebase:** `janaj-27925` (cuenta propietaria: la Gmail personal de Adrián)

## Requisitos de partida (respuestas del dueño)

| Tema | Decisión |
|---|---|
| Equipos | Sobre todo Windows, algo de Android |
| Conexión | Cortes de luz e internet frecuentes, así que tiene que funcionar offline |
| Usuarios | Uno solo |
| Lector de códigos | Aún no comprado (la app admite lector USB/Bluetooth y la cámara del móvil) |
| Venta a peso | Sí, tiene balanza |
| Precios | Se fijan en USD y se cobran en Bs según tasa (por defecto BCV) |
| Tasas | BCV $, BCV €, paralelo, USDT Binance y promedio (BCV + paralelo) ÷ 2 |
| Formas de pago | Punto Banesco débito, Biopago BDV, pago móvil, efectivo Bs, efectivo $ y pagos mixtos |
| Vuelto | En la misma moneda en que pagó el cliente |
| Comisiones | Las asume él; el % real todavía no se conoce |
| Impuestos | Empieza este año; sin IGTF ni impuesto municipal; pendiente de hablarlo con el contable |
| Otros | Fiado, cierre de caja, reportes, stock bajo, proveedores y vencimientos. **Sin** impresión de tickets |
| Marca | "JANAJ" en rojo oscuro |
| Alojamiento | Gratuito |

## Cómo funciona

### Tecnología
- HTML, CSS y JavaScript con módulos ES. **Sin dependencias ni paso de compilación**: se sube la carpeta tal cual.
- **IndexedDB** guarda productos, ventas, compras, clientes, movimientos de fiado, cierres y ajustes.
- **Service worker** (`sw.js`) cachea la app para que abra sin conexión.
- **Firebase** (Auth con correo/contraseña + Firestore) para la sincronización. Se carga desde el CDN de Google solo si la sincronización está activada.

### Pantallas
| Pantalla | Qué hace |
|---|---|
| **Vender** | Escanear o buscar productos, consultar precio, carrito (con productos a peso), cobro mixto y vuelto |
| **Inventario** | Alta y edición de productos, stock, stock mínimo, vencimientos, entradas de mercancía y proveedores |
| **Tasas** | Descarga BCV $/€ y paralelo (`ve.dolarapi.com`) y USDT (`criptoya.com`, Binance P2P). Sin internet usa las últimas guardadas o se meten a mano. Incluye conversor |
| **Fiado** | Cuentas de clientes. La deuda se guarda **en dólares** para que no pierda valor |
| **Caja** | Cierre diario: efectivo esperado por moneda y total por método de pago |
| **Reportes** | Ventas, ganancias, comisiones e IVA estimado por periodo |
| **Ajustes** | Tasa de cobro, comisiones por método, impuestos, avisos de inventario, copias de seguridad y sincronización |

### Valores por defecto (`js/store.js`)
- Tasa de cobro: BCV.
- Comisiones: punto 1,5 %, biopago 1,5 %, el resto 0 %. **Son estimaciones.**
- IVA 16 % incluido en el precio. IGTF desactivado (3 % si se activa).
- Aviso de stock bajo: 5 unidades. Aviso de vencimiento: 7 días antes.

### Sincronización
- Cada equipo trabaja con sus datos locales. Cada cambio se apunta en una cola (`outbox`) dentro de la misma transacción y se sube a Firestore cuando hay internet. Los cambios de otros equipos llegan en tiempo real.
- Conflictos: gana el último cambio. El **stock** no se pisa: cada equipo lleva su contador de movimientos y el stock es "último conteo + movimientos de todos los equipos desde ese conteo".
- Datos en `shops/{uid}/docs/{tabla~id}`. Hay una cuenta por bodega y se usa la misma en todos los equipos.
- Primer equipo: Ajustes → "Crear cuenta de la bodega" (sube sus datos). Los demás: "Entrar" (descargan los datos).

### Estructura de archivos
```
index.html, manifest.webmanifest, sw.js
css/app.css
icons/                 iconos de la PWA
js/main.js             arranque y navegación
js/db.js               IndexedDB + cola de cambios
js/sync.js             sincronización (subir, recibir, fusionar)
js/remote-firebase.js  adaptador Firebase Auth + Firestore
js/firebase-config.js  configuración pública del proyecto Firebase
js/store.js            ajustes, tasas, productos y cálculos (IVA, comisiones)
js/scanner.js          lector USB/Bluetooth (como teclado) y cámara (BarcodeDetector)
js/ui.js               formato, modales, iconos
js/views/*.js          vender, inventario, tasas, fiado, caja, reportes, ajustes
```

## Qué se ha hecho

1. **20 nov 2026 · v1** (`07fb30e`): TPV, inventario, tasas, fiado, caja, reportes y ajustes. PWA offline publicada en GitHub Pages.
2. **20 nov 2026 · sincronización** (`672a3fb`): cola `outbox`, fusión de cambios, stock por movimientos y pantalla de sincronización en Ajustes.
3. **20 nov 2026 · Firebase** (`f283eef`): creado el proyecto `janaj-27925` y puesta su configuración en `js/firebase-config.js`.
4. **21 nov 2026 · seguridad de la clave de API** (Google Cloud Console, sin cambios en el código):
   - Restricción de aplicaciones → Sitios web: `https://adrimar8.github.io/*`, `http://localhost/*`, `https://janaj-27925.firebaseapp.com/*`.
   - Restricción de API: solo Identity Toolkit API, Token Service API y Cloud Firestore API (antes tenía 25).
   - Comprobado con `curl`: sin Referer → 403 `ACCESS_DENIED`; Referer ajeno → 403 `API_KEY_HTTP_REFERRER_BLOCKED`; Referer de GitHub Pages → la clave pasa.

## Qué falta

### Por verificar en Firebase (no consta que esté hecho)
- [ ] Authentication → método **Correo electrónico/contraseña** habilitado.
- [ ] Firestore creado (ubicación `nam5` o `us-east1`) con las **reglas** del README publicadas. Es la protección real de los datos: la restricción de la clave se puede saltar falsificando el Referer.
- [ ] Authentication → Dominios autorizados → `adrimar8.github.io`.
- [ ] Prueba completa: crear la cuenta de la bodega en el ordenador, entrar desde el móvil y ver que una venta aparece en los dos.

### Pendiente con el dueño o el contable
- [ ] Comisiones reales de Banesco (punto) y BDV (biopago), sacadas del estado de cuenta. Después, marcar `commissionsVerified`.
- [ ] Régimen fiscal: IVA incluido o sumado, y si aplica IGTF.

### Funcionalidad
- [ ] Carga masiva de productos desde Excel/CSV.
- [ ] Si se prueba en local con puerto (p. ej. `localhost:8765`), añadir `http://localhost:*/*` a los sitios permitidos de la clave.

## Notas de mantenimiento
- **Publicar** = commit + push a `main`. GitHub Pages lo sirve en uno o dos minutos.
- **Cada vez que cambie un archivo hay que subir `VERSION` en `sw.js`.** Si no, los equipos siguen con la copia antigua. El cambio se aplica la segunda vez que se abre la app.
- Probar en local: `python3 -m http.server 8765` y abrir `http://localhost:8765`.
- La configuración de Firebase en `js/firebase-config.js` no es secreta. Lo que protege los datos son las reglas de Firestore y el inicio de sesión.
