# Atril Local

Lector de partituras en PDF para iPad. Todo vive en el iPad: sin cuentas y sin servidor propio. Hay dos versiones del mismo código:

- **Web (GitHub Pages), para iOS 13 o posterior.** Se instala desde una dirección de GitHub y las partituras se añaden desde Archivos (Descargas, Drive…). No necesita el PC. Ver «Versión web en GitHub».
- **Local, para un iPad antiguo con iOS 10.3.3.** El PC solo se enciende para instalar o actualizar la app y para pasarle partituras o guardar copias. Es el resto de este documento.

**Versión 1.0.** Todo lo previsto está hecho y probado en Chrome sin las APIs que faltan en Safari 10. Lo que solo puede comprobarse en el iPad (AppCache, memoria, velocidad, selector de documentos, lápiz) está en «Qué probar en el iPad».

## Órdenes

| Orden | Qué hace |
|---|---|
| `npm install` | Descarga las herramientas (solo la primera vez) |
| `npm run pruebas` | Crea los PDFs de prueba en `test/pdfs` |
| `npm run build` | Genera `dist/` en ES5 |
| `npm run check` | Comprueba compatibilidad con Safari 10 y reglas de seguridad |
| `npm run serve` | Enciende el servidor temporal |
| `npm test` | Prueba la app en Chrome sin las APIs que le faltan a Safari 10 |
| `npm run build:web` | Genera `docs/`, la versión web que publica GitHub Pages |
| `npm run check:web` | Las mismas comprobaciones sobre `docs/` |
| `npm run test:web` | Prueba `docs/` en Chrome como si la sirviera GitHub: sin conexión y actualización |

## Versión web en GitHub (iOS 13 o posterior)

En iOS 15 y posteriores AppCache ya no funciona de forma fiable, así que la versión web guarda la app con un **service worker**, que solo funciona con HTTPS: por eso se publica en GitHub Pages y no desde el PC. Cambios respecto a la local:

- Las partituras entran con **«Añadir desde el iPad»**, que abre Archivos (Descargas, iCloud Drive, Google Drive si su app está instalada…). Se pueden elegir varias a la vez.
- No hay «Importar desde el PC» ni copias al PC. **«Guardar copia en el iPad»** prepara la copia (sin PDFs) y la guarda en Archivos con la hoja de Compartir; «Abrir archivo de copia» la recupera.
- Las actualizaciones llegan solas al abrir la app con conexión: aparece **«Actualizar ahora»** en «Copias y opciones».

### Publicar (una vez)

1. Crea una cuenta en github.com e instala **GitHub Desktop**.
2. `npm run build:web`. La carpeta `docs/` sí se sube: es lo que publica GitHub.
3. En GitHub Desktop: File › Add local repository › esta carpeta › «create a repository». Haz el primer commit y pulsa **Publish repository** quitando «Keep this code private» (GitHub Pages gratis exige repositorio público; `partituras/` y `copias/` no se suben).
4. En github.com, en el repositorio: Settings › Pages › Build and deployment › Source: **Deploy from a branch**, rama `main`, carpeta **`/docs`** › Save.
5. Al cabo de un minuto la app está en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/`.

### Instalar en el iPad

1. Abre esa dirección en **Safari** y espera a **«Lista: ya funciona sin conexión»**.
2. Compartir › **Añadir a pantalla de inicio**.
3. Abre Atril desde el icono **con conexión** y espera otra vez al aviso: el icono guarda sus datos aparte de Safari.

Usa siempre el icono. Los datos viven en el iPad: el repositorio público solo contiene el código.

### Pasar partituras

1. En el iPad, descarga los PDFs de Drive (en Safari: abrir el PDF › Descargar, o Compartir › Guardar en Archivos).
2. En Atril: **«Añadir desde el iPad»** › Explorar › Descargas, y elige las que quieras.

Si la app de Google Drive está instalada, también aparece en Archivos y se puede elegir directamente de ahí. Los PDFs idénticos se detectan y no se repiten.

### Actualizar

1. Cambia lo que haga falta, `npm run build:web` y, si quieres, `npm run test:web`.
2. En GitHub Desktop: commit y **Push origin**.
3. En el iPad, abre Atril con conexión, ve a «Copias y opciones» y pulsa **«Actualizar ahora»**. GitHub puede tardar hasta 10 minutos en servir la versión nueva.

No cambies el nombre del repositorio: el icono dejaría de recibir actualizaciones.

## Antes de instalar: una dirección fija para el PC

iOS guarda la app y las partituras asociadas a la dirección exacta, por ejemplo `http://192.168.1.39:8377`. Si la dirección del PC cambia, lo ya guardado se sigue abriendo sin conexión, pero ese icono no podrá actualizarse ni importar.

1. Entra en el router y crea una **reserva DHCP** para el PC.
2. Ejecuta `npm run serve` una vez. La dirección queda anotada en `atril.config.json`.

Si algún día el PC tiene otra dirección, el servidor no arranca y lo explica, para que no acabes con dos instalaciones separadas.

## Instalar en el iPad

1. En el PC: `npm run build` y después `npm run serve`.
2. En el iPad, con la misma WiFi, abre en **Safari** la dirección que muestra la consola.
3. Espera a que ponga **«Lista: ya funciona sin conexión»**.
4. Compartir › **Añadir a pantalla de inicio**.
5. **Con el servidor todavía encendido**, abre Atril desde el icono y espera otra vez al mismo aviso. El icono puede tener un almacén distinto del de Safari, así que este paso no es opcional.
6. Apaga el servidor con Ctrl+C.

Usa siempre el icono, nunca la pestaña de Safari.

## Actualizar la app sin perder datos

1. Cambia lo que haga falta y ejecuta `npm run build`. El manifiesto lleva una huella de todos los archivos, por lo que cualquier cambio se detecta.
2. `npm run serve`, con la **misma dirección y el mismo puerto**.
3. Abre Atril desde el icono. Descargará la versión nueva y mostrará **«Actualizar ahora»**.
4. Púlsalo y apaga el servidor.

Los datos van en IndexedDB, aparte de AppCache, y la actualización no los toca. No borres el icono ni los datos de Safari: eso sí los elimina.

## Pasar partituras: Drive → PC → iPad

1. En el PC, abre drive.google.com, selecciona las partituras o la carpeta y pulsa **Descargar**. Si llega un .zip, descomprímelo.
2. Copia los PDFs en la carpeta `partituras` (o la que pongas en `atril.config.json`). Las subcarpetas se respetan.
3. `npm run serve`. La consola muestra un código de 6 cifras, que sirve una sola vez.
4. En el iPad, abre Atril desde el icono, pulsa **Importar desde el PC** y escribe el código.
5. Elige las partituras («Solo nuevos» ya viene marcado) y pulsa **Importar**.
6. Apaga el servidor con Ctrl+C.

- Si cancelas o se corta la WiFi, vuelve a importar: continúa donde se quedó.
- Los PDFs idénticos se detectan por tamaño y SHA-256 y no se repiten.
- Si un PDF ha cambiado en el PC aparece como «modificado»; al actualizarlo se conservan anotaciones y ajustes.

**Directamente en el iPad:** «Añadir desde el iPad» abre el selector de documentos de iOS. Si la app de Google Drive instalada en el iPad aparece ahí (en iCloud Drive › Ubicaciones › Más), se puede traer de Drive sin el PC. Depende de que Drive siga funcionando en iOS 10: es lo que hay que comprobar.

## Uso

- **Lector:** tercio izquierdo, atrás; derecho, adelante; centro, barra. También deslizando y con pedal (flechas, AvPág/RePág, espacio).
- **Vista:** página entera, ajustada al ancho (cada toque baja una pantalla) o dos páginas en horizontal.
- **Anotar:** lápiz (6 colores, 4 grosores), resaltador (4 colores, 3 grosores), texto (4 tamaños), goma, deshacer y rehacer. Se guardan aparte del PDF.
- **Enlazar lápiz:** se toca 5 veces con la punta y la app aprende el tamaño del contacto para ignorar la palma. En un iPad Pro reconoce el Apple Pencil: entonces solo escribe el lápiz y el dedo pasa página.
- **Ajustes:** brillo, contraste, blanquear fondo, grises, invertir, girar, enderezar y recortar, para toda la partitura o una página.
- **Biblioteca:** carpetas, etiquetas, búsqueda sin tildes, orden y selección múltiple. Borrar una carpeta no borra sus partituras.
- **Conciertos:** se ordenan arrastrando por ≡. El modo concierto bloquea la edición y pasa solo a la obra siguiente.

## Copias de seguridad

**iOS puede borrar los datos de una web si falta espacio.** Haz copias.

- **Copia completa al PC:** carpetas, conciertos, anotaciones, ajustes y PDFs. Va a la carpeta `copias`; los PDFs ya enviados no se repiten.
- **Copia al PC sin PDFs:** solo los datos.
- **Recuperar del PC:** valida la copia, la une con lo que haya (lo de la copia manda y no se borra nada más) y trae los PDFs que falten.
- **Sin PC:** «Copiar como texto» para pegarlo en Notas o un correo (sin PDFs). Safari 10 no permite guardar archivos.

La copia anota las partituras por su huella: si faltan los PDFs, al volver a importarlos se unen solos a sus anotaciones.

## Configuración (`atril.config.json`)

| Clave | Por defecto | Significado |
|---|---|---|
| `puerto` | 8377 | No lo cambies después de instalar |
| `direccion` | la primera detectada | IP del PC en casa |
| `minutosInactivo` | 30 | Apagado automático |
| `carpeta` | ./partituras | PDFs del PC |
| `copias` | ./copias | Dónde se guardan las copias |
| `maxPdfMB` | 300 | Tamaño máximo de un PDF en el PC (el iPad tiene el suyo en Opciones) |
| `maxCopiaMB` | 20 | Tamaño máximo de una copia sin contar los PDFs |
| `maxCopiasMB` | 20000 | Total de la carpeta de copias |

Una VPN o una máquina virtual pueden hacer que se detecte la IP equivocada: corrígela aquí antes de instalar.

## Qué probar en el iPad

1. Instalar y abrir en modo avión (apartado «Instalar»).
2. Copias y opciones › **Diagnóstico**, sin tocar nada. Haz una captura.
3. Importar unas pocas partituras reales, cancelar a la mitad y repetir.
4. Pasar páginas con toques y con el pedal; girar el iPad.
5. Blanquear y enderezar un escaneo malo; recortarlo después de anotar.
6. Anotar con el dedo y con tu lápiz, y probar «Enlazar lápiz» apoyando la mano.
7. Crear un concierto, reordenarlo y tocarlo entero en modo avión.
8. Copia completa al PC.
9. «Añadir desde el iPad»: mirar si aparece Google Drive.

## PDF.js: por qué la 2.8.335

Es la versión más reciente de la rama 2.x cuyo código no depende de APIs gráficas que Safari 10 no tiene:

| Versión | Problema en Safari 10 |
|---|---|
| 2.9 | Empieza a usar `CanvasPattern.setTransform` y `DOMMatrix`; los patrones no se pueden dibujar bien ni con polyfill |
| 2.10 | `DOMMatrix` obligatorio y deja de incluir `padStart`, `Object.entries`… |
| 2.11–2.14 | Quita el polyfill de `ReadableStream` para navegadores |
| 2.16 | La versión «legacy» ya lleva clases nativas |
| **2.8.335** | Incluye sus polyfills; solo falta `resetTransform`, que añade `polyfills.js` |

Esta elección sale de revisar el código de cada versión y de ejecutarla en Chrome sin esas APIs. La confirmación definitiva es el diagnóstico en el iPad.

El build la vuelve a pasar a ES5 y le aplica parches que **fallan de forma visible** si el código no coincide:

- Elimina todo `eval` y `new Function`, incluido el de CVE-2024-4367, además de usar `isEvalSupported: false`. `npm audit` seguirá avisando de la vulnerabilidad, porque solo mira el número de versión.
- Quita un `Function(...)` de regenerator que impedía arrancar con la CSP estricta.
- Reduce en el worker las imágenes de más de 10 Mpx. Los JPEG normales se reducen mientras se decodifican, sin llegar a tener la imagen completa en memoria.

## Seguridad

- **No abras el puerto en el router ni expongas el servidor a internet.**
- Usa ese iPad solo para Atril: Safari 10 ya no recibe parches.
- El servidor solo escucha en la IP local, solo acepta direcciones privadas y comprueba `Host` y `Origin`.
- Sin el código de la consola solo entrega la app. El código sirve una vez. Cada equipo espera 30 segundos tras 5 fallos y queda bloqueado tras 20; el acceso solo vale para el equipo que escribió el código.
- Solo lee archivos .pdf auténticos de la carpeta configurada, por identificador (nunca por ruta) y sin seguir enlaces. Solo escribe copias, en su carpeta y con límites.
- La conexión va por HTTP sin cifrar (inevitable en iOS 10 sin certificados): instala, actualiza e importa solo en la WiFi de casa, con contraseña.
- Toda copia se valida entera con un esquema cerrado antes de escribir nada.
- Se apaga solo tras 30 minutos sin uso.

## Limitaciones conocidas

- AppCache no existe en los navegadores actuales: instalación, actualización y uso sin conexión **solo se pueden comprobar en el iPad**.
- Un manifiesto que responda 404 borra la app instalada. Este servidor responde 503 en su lugar; no pongas otro servidor web en el mismo puerto.
- La app se reinicia al volver a ella desde otra (iOS 10): vuelve a la misma partitura y página.
- El aviso de versión nueva aparece al abrir la app, no mientras se usa.
- iOS puede borrar los datos de una web si se queda sin espacio. Deja espacio libre.
- Los JPEG progresivos y los JPEG 2000 de 600 ppp pueden agotar la memoria.
- PDF.js se usa sin CMaps: los textos en chino, japonés o coreano con fuentes no incrustadas pueden verse mal.
- iOS 10 no tiene app Archivos. «Añadir desde el iPad» usa el selector de documentos.
- Safari no puede emparejar lápices Bluetooth ni leer su presión o sus botones (solo lo hacen apps nativas). Escriben como un dedo.
- «Blanquear fondo» usa un solo umbral: un escaneo con sombras muy fuertes puede quedar desigual.
- Deshacer funciona dentro de la página abierta; al pasar de página se vacía.
- El límite de espacio de IndexedDB en iOS 10 no está documentado: la app avisa si se llena y no pierde lo ya guardado.
