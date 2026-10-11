// Hero del inicio: movimiento reducido, próximo culto y botón flotante de WhatsApp.
// Si falla, el hero queda con los horarios fijos y el flotante de WhatsApp siempre visible.
(function () {
    'use strict';

    // Si tiene texto, reemplaza la línea del próximo culto (ej.: 'El jueves no hay culto por feriado.')
    var AVISO = '';

    // Hora de Bolivia, sin importar la zona del visitante. Día: 0 = domingo.
    var CULTOS = [
        { dia: 2, h: 19, m: 30 },
        { dia: 4, h: 19, m: 30 },
        { dia: 6, h: 19, m: 30 },
        { dia: 0, h: 10, m: 30 },
        { dia: 0, h: 19, m: 30 }
    ];
    var DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    var SEMANA = 7 * 1440;

    // Movimiento reducido: el script inline del hero ya dejó la llama en el poster sin descargar el video
    var video = document.getElementById('bg-video');
    var reducido = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
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

    // Día y minuto actuales en America/La_Paz
    var formato = null;
    try {
        formato = new Intl.DateTimeFormat('en-US', { timeZone: 'America/La_Paz', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    } catch (e) { /* navegador sin zonas horarias: se usa UTC-4 fijo */ }
    function ahoraLaPaz(fecha) {
        if (formato) {
            var partes = {};
            formato.formatToParts(fecha).forEach(function (p) { partes[p.type] = p.value; });
            var dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(partes.weekday);
            if (dia >= 0) return { dia: dia, min: (Number(partes.hour) % 24) * 60 + Number(partes.minute) };
        }
        // Bolivia no tiene horario de verano: UTC-4 todo el año
        var b = new Date(fecha.getTime() - 4 * 3600000);
        return { dia: b.getUTCDay(), min: b.getUTCHours() * 60 + b.getUTCMinutes() };
    }

    // Un culto deja de ser "próximo" en el minuto en que empieza
    function proximoCulto(fecha) {
        var ahora = ahoraLaPaz(fecha), desde = ahora.dia * 1440 + ahora.min, mejor = null;
        CULTOS.forEach(function (c) {
            var falta = (c.dia * 1440 + c.h * 60 + c.m - desde + SEMANA) % SEMANA || SEMANA;
            if (!mejor || falta < mejor.falta) mejor = { culto: c, falta: falta };
        });
        var dias = Math.floor((ahora.min + mejor.falta) / 1440);
        var c = mejor.culto, hora = (c.h % 12 || 12) + ':' + (c.m < 10 ? '0' : '') + c.m + (c.h < 12 ? ' AM' : ' PM');
        return (dias === 0 ? 'Hoy' : dias === 1 ? 'Mañana' : DIAS[c.dia]) + ', ' + hora;
    }

    function mostrarProximo(el) {
        el.textContent = '';
        if (AVISO) {
            el.textContent = AVISO;
            el.classList.add('hero-next--aviso');
        } else {
            var valor = document.createElement('strong');
            valor.textContent = proximoCulto(new Date());
            el.appendChild(document.createTextNode('Próximo culto '));
            el.appendChild(valor);
        }
        el.hidden = false;
    }

    function iniciar() {
        var el = document.getElementById('heroProximo');
        if (el) {
            mostrarProximo(el);
            if (!AVISO) setInterval(function () { mostrarProximo(el); }, 30000);
        }

        // El flotante de WhatsApp se oculta mientras se ve el botón del hero
        var cta = document.querySelector('.hero-section .hero-cta');
        if (cta && 'IntersectionObserver' in window) {
            new IntersectionObserver(function (entradas) {
                document.documentElement.classList.toggle('hero-cta-visible', entradas[0].isIntersecting);
            }).observe(cta);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})();
