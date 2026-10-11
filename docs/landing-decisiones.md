# Landing del inicio — decisiones

Registro para retomar el trabajo en otra sesión. Se actualiza al aprobar cada fase.

- Sitio: ipubtupiza.org (inicio: `public/index.html`)
- Base del análisis: `main` en `b3e4a2e` (producción).
- La rama `claude/hero-inicio-diagnostico-g2tdlg` (video en banda + bloque azul) fue **descartada**:
  no se mergea. De ahí solo se reaprovechan: cálculo del próximo culto con `AVISO` (`public/js/hero.js`),
  `public/videos/fondo-720.mp4`, `public/videos/fondo-poster.webp`, el candado inline de
  movimiento reducido y ocultar las fotos de picsum.

## Reglas fijas

- Diseño: sin eyebrows ni píldoras, sin sellos ni círculos decorativos, sin gradientes decorativos,
  sin bloques diagonales, sin iconografía de stock, sin palabra clave en cursiva de color, sin tarjetas
  idénticas por reflejo. Cada elemento se justifica.
- Color: carmín `#D2102E` solo para la acción. El dorado `#E8A33D` nunca en texto ni botones
  (`less/variables.less`).
- Contraste AA verificado numéricamente, también sobre el video.
- Sin librerías de animación ni fuentes nuevas. `prefers-reduced-motion` en todo.
- 0 px de desborde con gestos táctiles reales a 320/360/390/412/480 px y en escritorio;
  nunca `overflow-x: hidden` como parche (el del `body` se ve aparte, no se toca).
- Contenido: nada inventado (testimonios, cifras, fotos, datos, doctrina). Textos nuevos = propuesta.
  Si algo requiere foto real, se marca el lugar y se indica qué foto conseguir.
- No tocar: `server.js`, `bot.js`, `juegos.js`, `mensajes.js`, `package.json`, `db.json`, la intro del
  logo, el logo animado, el encabezado, el preloader, el mecanismo que pausa/reanuda `#bg-video`
  durante la intro, los enlaces `tel:`/`wa.me` (57296426), las demás páginas.
- Estilos en `less/main.less`, compilar con `npm run build:css`.
- Sin commit ni push hasta que el dueño lo diga. Nada se aplica en `public/` sin aprobación.

## Fase 0 — Diagnóstico (aprobada)

### Mapa del inicio actual (alto a 360 px; página total 7.943 px ≈ 10,7 pantallas)

| # | Sección | Alto | Función para quien nunca vino | Diagnóstico |
|---|---|---|---|---|
| 1 | Hero | 740 | quién, cuándo, dónde, cómo escribir | No dice cuándo ni dónde. Título repite la cinta del logo, píldora "DESDE 1997", cursiva dorada, botón de contorno partido en 2 líneas, texto sobre el núcleo de la llama, velo que la apaga, barrido dorado animado |
| 2 | Quiénes somos | 598 | confianza ("desde 1997") | Foto picsum presentada como "la comunidad". Párrafo genérico. Eyebrow |
| 3 | Horarios + cuenta regresiva | 555 | lo más útil de la página | Recién en la 3.ª pantalla. Cuenta regresiva con hora del visitante. Eyebrows |
| 4 | Lo que se viene (eventos) | 473 | algo especial | Sin eventos queda un hueco con "se publicará aquí" |
| 5 | Ministerios | 1.890 | ¿hay algo para mis hijos / para mí? | 24 % de la página en celular. 3 tarjetas idénticas con picsum y etiquetas |
| 6 | Pastor | 477 | quién está a cargo | Foto picsum con alt "Ptr. Juan Mage". Píldora "PASTOR DESDE 2023" |
| 7 | Mensajes recientes | 290 | escuchar antes de ir | Vacío sin datos. Línea decorativa |
| 8 | Preguntas frecuentes (6) | 789 | dudas de la 1.ª visita | El mejor contenido para un visitante nuevo, escondido al final |
| 9 | Contacto | 1.105 | escribir | Formulario compite con WhatsApp. Ubicación solo plus code. Etiquetas mono |
| 10 | Footer | 639 | — | Repite ubicación, teléfono y correo |

Repeticiones: horarios ×3 (sección, FAQ 1, cuenta regresiva); ubicación ×3 (FAQ 5, contacto, footer);
5 puntos de contacto que compiten; ~8 eyebrows/píldoras.

Datos reales del sitio que el inicio no usa:
- `nosotros.html`: la obra "encendió la llama pentecostal en Tupiza" el 23 de febrero de 1997.
- `escuela.html`: los niños reciben enseñanza "mientras la iglesia participa del culto principal".
- Historia del lote y del templo propio.

### Peso actual del inicio

~2,9 MB con compresión (3,3 MB sin comprimir), 33 pedidos, más 5 fotos picsum (no medibles: el
proxy de la sesión bloquea picsum).

| Recurso | Peso | Nota |
|---|---|---|
| `fondo.mp4` | 2.304 KB (79 %) | audio inútil y franjas negras; `fondo-720.mp4` = 952 KB, poster 20 KB |
| Font Awesome (CSS + 2 fuentes) | 274 KB | para ~12 íconos |
| Bootstrap CSS + JS | 53 KB | en el inicio el JS es casi solo para el acordeón |
| Fuentes propias (9) | 199 KB | Alegreya 500 cursiva (24 KB) solo para la cursiva; JetBrains Mono (43 KB) para eyebrows y cuenta regresiva |
| PNG viejo del logo | 60 KB | se carga aunque el encabezado usa el SVG |
| HTML/CSS/JS propios | ~38 KB | |

Servidor (fuera de alcance, `server.js`): sin compresión y `Cache-Control: max-age=0`. Si producción
pasa por Cloudflare Tunnel, Cloudflare probablemente comprime en el borde (a confirmar).
Estimación sin tocar el servidor: ~2,9 MB → ~1,2 MB (a medir en Fase 3).

### Ajustes aprobados al cerrar la Fase 0

- La cuenta regresiva usa America/La_Paz, no la hora del visitante.
- Eventos y Mensajes se ocultan automáticamente cuando no hay contenido.
- Referencia del hero original: la captura de la primera sesión.
- Contacto: WhatsApp es la acción principal.

### Notas de contexto

- Formulario de contacto: se mantiene como **secundario** por ahora; se decide en la Fase 2.
- "Tu primera visita": **omitida** por ahora (no hay datos: duración, cómo es un culto, en qué culto
  funciona la Escuela Dominical, referencia para llegar). No se inventa.
- `ejemplo-landing-ipub.html` (referencia visual): no llegó a la sesión. Dirección tomada del mensaje:
  llama inmersiva a pantalla completa, texto abajo sin tapar el núcleo, "Próximo culto" arriba del
  todo, horarios tipográficos, carmín solo para la acción, sin eyebrows/píldoras/dorado en texto.
- Dirección en palabras: "Final Aniceto Arce, zona San Antonio, Tupiza" (dada por el dueño en la
  sesión anterior; en `main` solo está el plus code H78M+2HM).

## Fase 1 — Hero inmersivo (aprobada: **V1 · Al pie**)

Decisiones:
- Variante elegida: **V1**. Se aplica en la Fase 3, no antes.
- Bajada: "En Tupiza desde 1997. Puedes venir sin avisar."
- Las variantes V2 y V3 quedan descartadas (se describen abajo solo como registro).


Base común de las 3 variantes:
- Video `fondo-720.mp4` a pantalla completa (`object-fit: cover`), poster `fondo-poster.webp`,
  candado inline de movimiento reducido (no descarga el video). Se mantiene
  `<video id="bg-video" autoplay loop muted playsinline>`: la intro lo pausa y lo reanuda.
- Sin velo parejo ni barrido dorado. Degradé solo detrás del texto y acotado para no cruzar el núcleo
  de la llama (núcleo medido en el loop: x 40–62 %, y 0–58 % del video; la piedra es brillante, y 77–88 %).
- Orden: "Próximo culto" (calculado en America/La_Paz, con `AVISO`) → `<h1>` (con "IPUB Tupiza:" oculto
  y "Iglesia Pentecostal Unida de Bolivia" visible) → bajada → botón carmín "Escríbenos por WhatsApp"
  (blanco sobre #D2102E = 5,45:1; hover #A80C24 = 7,66:1) → dirección + "Ver en el mapa".
- Botón flotante de WhatsApp oculto mientras se ve el botón del hero.

Variantes:
- **V1 · Al pie**: texto abajo a la izquierda. Celular: video subido 12 % y degradé desde abajo hasta
  ~49 % del alto. Escritorio: columna sobre la pared izquierda, degradé horizontal con curva suave que
  termina al 40 % del ancho, desvanecido hacia arriba con máscara.
- **V2 · Horario tipográfico**: igual jerarquía + tabla de horarios (fila de hoy resaltada en blanco).
  Celular: video al 50 % del alto con su base fundida en la tinta (piedra visible, texto debajo).
  Escritorio: columna vertical centrada sobre la pared izquierda.
- **V3 · Inscripción bajo el altar**: celular centrado bajo la piedra. Escritorio: una fila de tres
  partes a lo ancho del pie (próximo culto · nombre · acción). Bajada propuesta: "La llama pentecostal
  encendida en Tupiza desde 1997" (frase basada en `nosotros.html`).

Verificación de las maquetas (cuadros exactos del MP4 a 0/1,5/3/4,5/6/7,5 s):
- Contraste AA: 0 fallas; peor caso por variante ≥ 4,4 (texto grande ≥ 3,0 / normal ≥ 4,5).
- Núcleo de la llama: brillo conservado 99–100 % en la peor fila (original: 34 %).
- Solape texto/núcleo: 0 px² de 320×568 a 1920×1080.
- Desborde: 0 px con gestos táctiles reales (320–480 px) y en escritorio; botón en 1 línea; botón en el
  primer pantallazo en todos los tamaños.
- Intro: video pausado durante la intro y avanza después. Reduced-motion: quieto y 0 pedidos de video.

### Código de la maqueta V1 aprobada (referencia para la Fase 3)

Es la maqueta tal como se verificó (CSS plano). En la Fase 3 se pasa a `less/main.less` con las
variables del sistema (`@dark-color`, `@primary-color`, `@primary-deep`, `@radius-control`) y se
compila. Clases `hv-*` de maqueta: se pueden renombrar al aplicar.

Importante: el `<header>` NO lleva la clase `hero-section`, porque `main` le aplica reglas viejas
(centrado, `padding: 80px`, barrido dorado). La intro (`logo-intro.js`) solo depende de `id="bg-video"`.

Markup:

```html
<header class="hv hv1">
    <video autoplay loop muted playsinline id="bg-video" aria-hidden="true" poster="videos/fondo-poster.webp"><source src="videos/fondo-720.mp4" type="video/mp4"></video>
        <script>(function (v) { if (!v || !window.matchMedia || !matchMedia("(prefers-reduced-motion: reduce)").matches) return; v.autoplay = false; [].forEach.call(v.querySelectorAll("source[src]"), function (s) { s.setAttribute("data-src", s.getAttribute("src")); s.removeAttribute("src"); }); })(document.getElementById("bg-video"));</script>
        <script src="js/hero.js?v=AAAAMMDD" defer></script>
    <div class="hv-scrim" aria-hidden="true"></div>
    <div class="hv-body">
        <p class="hv-next" id="heroProximo" hidden></p>
        <h1 class="hv-title"><span class="visually-hidden">IPUB Tupiza: </span>Iglesia Pentecostal Unida de Bolivia</h1>
        <p class="hv-lead">En Tupiza desde 1997. Puedes venir sin avisar.</p>
        <a href="https://wa.me/59157296426?text=Hola,%20me%20gustar%C3%ADa%20saber%20m%C3%A1s%20sobre%20IPUB%20Tupiza." class="hv-cta" target="_blank" rel="noopener noreferrer"><i class="fab fa-whatsapp" aria-hidden="true"></i>Escríbenos por WhatsApp</a>
        <p class="hv-where">Final Aniceto Arce, zona San Antonio, Tupiza · <a href="https://www.google.com/maps/search/?api=1&amp;query=H78M%2B2HM+Tupiza+Bolivia" target="_blank" rel="noopener noreferrer">Ver en el mapa</a></p>
    </div>
</header>
```

CSS base:

```css
/* Base común: la llama a pantalla completa, sin velo parejo */
.hv { position: relative; min-height: 100vh; min-height: 100svh; display: flex; color: #fff; background: #14192A; overflow: hidden; }
.hv #bg-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.hv-scrim { position: absolute; inset: 0; pointer-events: none; }
.hv-body { position: relative; z-index: 1; }
.hv-next { margin: 0 0 12px; font-size: 1rem; color: rgba(255,255,255,.88); }
.hv-next strong { display: block; font-family: 'Alegreya', Georgia, serif; font-weight: 800; font-size: 2.5rem; line-height: 1.05; color: #fff; }
.hv-next--aviso { font-family: 'Alegreya', Georgia, serif; font-weight: 700; font-size: 1.5rem; color: #fff; }
.hv-title { font-family: 'Alegreya', Georgia, serif; font-weight: 700; font-size: 1.35rem; line-height: 1.2; margin: 0 0 4px; color: #fff; }
.hv-lead { margin: 0 0 20px; color: rgba(255,255,255,.88); line-height: 1.45; }
/* Carmín: el mismo botón primario del sitio, solo para la acción */
.hv-cta { display: inline-flex; align-items: center; gap: 10px; padding: 14px 22px; border-radius: 8px; background: #D2102E; color: #fff; font-weight: 600; line-height: 1.2; white-space: nowrap; text-decoration: none; transition: background-color .2s ease; }
.hv-cta i { font-size: 1.25rem; }
.hv-cta:hover { background: #A80C24; color: #fff; }
.hv-cta:focus-visible, .hv-where a:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
.hv-where { margin: 14px 0 0; font-size: .95rem; line-height: 1.45; color: rgba(255,255,255,.88); }
.hv-where a { color: #fff; text-decoration: underline; text-underline-offset: 3px; }
@media (min-width: 992px) {
  .hv-next strong { font-size: 3.5rem; }
  .hv-title { font-size: 1.6rem; }
}
```

CSS de la V1:

```css
/* V1 — Al pie: texto abajo a la izquierda; degradé solo en la franja del texto */
.hv1 { align-items: flex-end; }
/* Celular: el video sube un poco; la base que queda libre la cubre el mismo degradé del texto */
.hv1 #bg-video { transform: translateY(-12%); }
.hv1 .hv-scrim { background: linear-gradient(to top, rgba(20,25,42,.96) 0%, rgba(20,25,42,.92) 36%, rgba(20,25,42,.6) 44%, rgba(20,25,42,0) 51%); }
.hv1 .hv-body { width: 100%; padding: 0 20px 28px; }
@media (min-width: 992px) {
  .hv1 #bg-video { transform: none; }
  /* Columna de texto oscurecida y desvanecida hacia arriba (máscara): sin bordes duros, termina antes del núcleo */
  .hv1 .hv-scrim { background: linear-gradient(to right, rgba(20,25,42,.93) 0%, rgba(20,25,42,.9) 24%, rgba(20,25,42,.8) 28%, rgba(20,25,42,.62) 31%, rgba(20,25,42,.42) 34%, rgba(20,25,42,.22) 36.5%, rgba(20,25,42,.08) 38.5%, rgba(20,25,42,0) 40%);
      -webkit-mask-image: linear-gradient(to top, #000 0%, #000 44%, transparent 72%); mask-image: linear-gradient(to top, #000 0%, #000 44%, transparent 72%); }
  .hv1 .hv-scrim::after { content: ''; position: absolute; inset: 0; background: linear-gradient(to top, rgba(20,25,42,.88) 0%, rgba(20,25,42,0) 22%); }
  .hv1 .hv-body { padding: 0 0 56px max(24px, calc((100% - 1116px) / 2)); max-width: 1116px; }
  .hv1 .hv-body > * { max-width: 340px; }
}
/* Pantallas bajas (≤ 620 px de alto): cifra más chica y video un poco más arriba */
@media (max-width: 991px) and (max-height: 620px) {
  .hv1 #bg-video { transform: translateY(-15%); }
  .hv1 .hv-next strong { font-size: 2rem; }
}
@media (min-width: 992px) and (max-width: 1199px) {
  .hv1 .hv-body > * { max-width: 330px; }
}
```

Archivos a recuperar de la rama descartada `claude/hero-inicio-diagnostico-g2tdlg` (está pusheada):

```bash
git checkout origin/claude/hero-inicio-diagnostico-g2tdlg -- public/js/hero.js public/videos/fondo-720.mp4 public/videos/fondo-poster.webp
```

En `hero.js` hay que cambiar el selector del botón (`.hero-section .hero-cta`) por el del hero nuevo,
para que el flotante de WhatsApp se oculte mientras se ve el botón del hero.

### Cómo se verificó (para repetirlo en la Fase 3)

- El Chromium de pruebas no reproduce H.264: el video se sirve como WebM del mismo recorte, y para
  medir se usan cuadros exactos del MP4 (`ffmpeg -ss T -i fondo-720.mp4 -frames:v 1`) puestos como
  poster, sin reproducir (al pausar a mitad de la decodificación el Chromium pinta artefactos y con
  respuestas simuladas no se puede saltar de cuadro).
- Contraste: texto transparente, se captura el fondo real y se calcula el contraste por píxel
  (percentil 2) contra el color del texto, solo sobre los nodos de texto propios de cada elemento.
- Núcleo de la llama: brillo por fila con y sin degradé (peor fila).
- Desborde: `Input.synthesizeScrollGesture` táctil (CDP) a varias alturas, con `body` sin el parche.
- Bootstrap 5.3.0 y Font Awesome 6.4.0 bajados de npm (los CDN y picsum están bloqueados por el proxy).

## Fase 2 — Landing completa (pendiente: propuesta, sin aplicar)

Reglas dadas por el dueño:
- Horarios y ubicación aparecen completos **una sola vez** (sección propia).
- Las preguntas frecuentes **suben**: tienen el mejor contenido para quien nunca vino.
- Eventos y Mensajes se **ocultan si están vacíos**.
- Sin fotos de relleno (picsum), sin testimonios ni cifras inventadas.
- Sin eyebrows, píldoras ni dorado en textos o botones.
- Formulario de contacto: secundario (se decide en esta fase).
- Entregable: estructura de secciones y jerarquía (qué entra, qué se funde, qué se elimina), con
  maqueta o esquema por sección, en 360 y 1366. NO aplicar nada hasta la aprobación.
