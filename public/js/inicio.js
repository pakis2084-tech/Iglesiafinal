// Hero del inicio: próximo culto / culto en curso (hora de Bolivia), AVISO, posición de la llama en celular,
// botón flotante de WhatsApp y movimiento reducido. No pide nada a la API: Eventos y Mensajes los pinta app.js.
// Si algo falla, el hero queda con su contenido fijo.
(function () {
    'use strict';

    // Si tiene texto, reemplaza la línea del próximo culto (ej.: 'El jueves no hay culto por feriado.')
    var AVISO = '';

    // A CONFIRMAR con la iglesia: minutos que un culto se muestra "en curso" después de empezar
    var EN_CURSO_MIN = 90;

    // Hora de Bolivia, sin importar la zona del visitante. Día: 0 = domingo.
    var CULTOS = [
        { dia: 2, h: 19, m: 30 },
        { dia: 4, h: 19, m: 30 },
        { dia: 6, h: 19, m: 30 },
        { dia: 0, h: 10, m: 30 },
        { dia: 0, h: 19, m: 30 }
    ];
    var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    var SEMANA = 7 * 1440;
    var NBSP = ' '; // la hora no se separa de AM/PM al cortar la línea

    // --- Hora de Bolivia ---
    var formato = null;
    try {
        formato = new Intl.DateTimeFormat('en-US', { timeZone: 'America/La_Paz', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    } catch (e) { /* navegador sin zonas horarias: se usa UTC-4 fijo */ }
    function laPaz(fecha) {
        if (formato) {
            var p = {};
            formato.formatToParts(fecha).forEach(function (x) { p[x.type] = x.value; });
            var dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
            if (dia >= 0) return { dia: dia, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
        }
        // Bolivia no tiene horario de verano: UTC-4 todo el año
        var b = new Date(fecha.getTime() - 4 * 3600000);
        return { dia: b.getUTCDay(), min: b.getUTCHours() * 60 + b.getUTCMinutes() };
    }
    function hora12(h, m) {
        return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + NBSP + (h < 12 ? 'AM' : 'PM');
    }

    // Culto en curso (dentro de EN_CURSO_MIN desde que empezó) o el próximo
    function estado(fecha) {
        var a = laPaz(fecha), desde = a.dia * 1440 + a.min, curso = null, prox = null;
        CULTOS.forEach(function (c) {
            var inicio = c.dia * 1440 + c.h * 60 + c.m;
            var hace = (desde - inicio + SEMANA) % SEMANA;
            if (hace < EN_CURSO_MIN && (!curso || hace < curso.hace)) curso = { c: c, hace: hace };
            var falta = (inicio - desde + SEMANA) % SEMANA || SEMANA;
            if (!prox || falta < prox.falta) prox = { c: c, falta: falta };
        });
        if (curso) return { enCurso: true, c: curso.c };
        return { enCurso: false, c: prox.c, dias: Math.floor((a.min + prox.falta) / 1440) };
    }

    function pintarCulto() {
        var linea = document.getElementById('heroProximo');
        if (!linea) return;
        linea.textContent = '';
        if (AVISO) {
            linea.textContent = AVISO;
            linea.classList.add('hv-next--aviso');
        } else {
            var e = estado(new Date()), hora = hora12(e.c.h, e.c.m);
            var cuando = e.dias === 0 ? 'Hoy' : e.dias === 1 ? 'Mañana' : 'El ' + DIAS[e.c.dia];
            var valor = document.createElement('strong');
            linea.appendChild(document.createTextNode(e.enCurso ? 'Culto en curso ' : 'Próximo culto '));
            valor.textContent = e.enCurso ? 'Comenzó a las ' + hora : cuando + ', ' + hora;
            linea.appendChild(valor);
        }
        linea.hidden = false;
    }

    // --- Celular: la llama sube lo justo para que su núcleo quede arriba del texto (y de su degradé),
    // mida lo que mida el bloque de texto. Sin JS quedan los desplazamientos fijos del CSS.
    var NUCLEO = 0.58;          // borde inferior del núcleo de la llama, medido en todo el loop (fracción del alto del video)
    var VIDEO_W = 1280, VIDEO_H = 692;
    var DEGRADE = 56 + 8;       // alto del desvanecido sobre el texto (.hv-body::before) + margen
    function acomodarLlama() {
        var v = document.getElementById('bg-video'), cuerpo = document.querySelector('.hv .hv-body');
        if (!v || !cuerpo) return;
        if (window.innerWidth >= 992) { v.style.transform = ''; return; }
        var hero = v.parentNode, ancho = hero.clientWidth, alto = hero.clientHeight;
        var escala = Math.max(ancho / VIDEO_W, alto / VIDEO_H);
        var nucleo = (alto - VIDEO_H * escala) / 2 + NUCLEO * VIDEO_H * escala;
        var sube = Math.min(0, cuerpo.offsetTop - DEGRADE - nucleo);
        v.style.transform = 'translateY(' + Math.round(Math.max(sube, -0.4 * alto)) + 'px)';
    }

    // --- Movimiento reducido: el script inline del hero ya dejó la llama en el poster sin descargar el video ---
    var reducido = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    var video = document.getElementById('bg-video');
    function aplicarMovimiento() {
        if (!video || !reducido) return;
        if (reducido.matches) {
            video.autoplay = false;
            video.pause();
            return;
        }
        var guardadas = video.querySelectorAll('source[data-src]');
        if (guardadas.length) {
            [].forEach.call(guardadas, function (s) { s.setAttribute('src', s.getAttribute('data-src')); s.removeAttribute('data-src'); });
            video.load();
        }
        video.autoplay = true;
        // La intro (logo-intro.js) es la que lo reanuda mientras está en pantalla
        if (document.documentElement.classList.contains('lgi-cubre')) return;
        var p = video.play();
        if (p) p.catch(function () { /* sin video: queda el poster */ });
    }
    if (reducido) {
        if (reducido.addEventListener) reducido.addEventListener('change', aplicarMovimiento);
        else if (reducido.addListener) reducido.addListener(aplicarMovimiento);
    }

    function iniciar() {
        pintarCulto();
        acomodarLlama();
        if (!AVISO) setInterval(function () { pintarCulto(); acomodarLlama(); }, 30000);
        var espera = null;
        window.addEventListener('resize', function () { clearTimeout(espera); espera = setTimeout(acomodarLlama, 100); });
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(acomodarLlama);

        // El flotante de WhatsApp se oculta mientras se ve el botón del hero
        var cta = document.querySelector('.hv .hv-cta');
        if (cta && 'IntersectionObserver' in window) {
            new IntersectionObserver(function (en) {
                document.documentElement.classList.toggle('hero-cta-visible', en[0].isIntersecting);
            }).observe(cta);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})();
