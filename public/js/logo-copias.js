// Copias del logo animado fuera del encabezado (footer, paneles de ministerios, radio).
// Reusa el SVG que ya bajó js/logo-ipub.js; donde no hay encabezado lo descarga una vez.
// Si algo falla, queda el PNG original del HTML.
(function () {
    'use strict';
    var VERSION = '20261010'; // la misma que en logo-ipub.js
    var PASO_LETRA = 45;
    var LUGARES = [
        { sel: '.main-footer img.footer-brand', clase: 'lgc-footer' },
        { sel: '.ministry-visual-panel > img', clase: 'lgc-panel' },
        { sel: '.radio-brand > img', clase: 'lgc-radio', estatico: true }
    ];
    var n = 0; // prefijo de ids único por copia

    if (!window.DOMParser || !window.IntersectionObserver) return;
    var reducido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (window.IPUBLogoSVG) {
        montarTodo(window.IPUBLogoSVG);
    } else if (document.querySelector('script[src*="logo-ipub.js"]')) {
        document.addEventListener('ipub-logo-svg', function (e) { montarTodo(e.detail); });
    } else if (window.fetch) {
        fetch('/images/logo-ipub.svg?v=' + VERSION)
            .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error(r.status)); })
            .then(montarTodo)
            .catch(function () { /* se mantiene el PNG */ });
    }

    function montarTodo(texto) {
        LUGARES.forEach(function (lugar) {
            document.querySelectorAll(lugar.sel).forEach(function (img) {
                try { montar(texto, img, lugar); } catch (e) { /* se mantiene el PNG */ }
            });
        });
    }

    function montar(texto, img, lugar) {
        // Mismo renombre de ids que js/logo-intro.js: lg- pasa a lgcN-
        var pre = 'lgc' + (n++);
        var doc = new DOMParser().parseFromString(texto.replace(/(id="|url\(#|href="#)lg-/g, '$1' + pre + '-'), 'image/svg+xml');
        var svg = doc.documentElement;
        if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return;
        svg = document.importNode(svg, true);
        svg.setAttribute('class', 'lg lg--b lgc');
        // Gradientes de marca de esta copia (logo-ipub.css apunta a los del encabezado)
        svg.style.setProperty('--lgc-bg', 'url(#' + pre + '-bG)');
        svg.style.setProperty('--lgc-bc', 'url(#' + pre + '-bC)');
        // Sin brillo
        var brillo = svg.querySelector('.lg-sh');
        if (brillo) brillo.parentNode.parentNode.removeChild(brillo.parentNode);

        var caja = document.createElement('span');
        caja.className = 'lgc-brand ' + lugar.clase;
        caja.setAttribute('role', 'img');
        caja.setAttribute('aria-label', img.alt || 'IPUB Tupiza');
        caja.appendChild(svg);
        var nombre = document.createElement('span');
        nombre.className = 'lg-name';
        nombre.setAttribute('aria-hidden', 'true');
        nombre.innerHTML = '<span class="lg-name__ipub">IPUB</span> <span class="lg-name__tupiza">Tupiza</span>';
        caja.appendChild(nombre);

        img.parentNode.insertBefore(caja, img.nextSibling);
        img.classList.add('lgc-oculto');

        ajustarNombre(caja, nombre);
        var anchoCaja = caja.offsetWidth;
        window.addEventListener('resize', function () {
            if (caja.offsetWidth === anchoCaja) return;
            anchoCaja = caja.offsetWidth;
            ajustarNombre(caja, nombre);
        });
        if (document.fonts && document.fonts.load) {
            document.fonts.load('800 20px Alegreya').then(function () { ajustarNombre(caja, nombre); }, function () {});
        }

        if (reducido || lugar.estatico) return;

        // Giro y ola como en el encabezado, sin intro ni destello; solo mientras se ve
        var i = 0;
        ['.lg-ta', '.lg-tc', '.lg-tb'].forEach(function (sel) {
            svg.querySelectorAll(sel + ' path').forEach(function (letra) {
                letra.style.animationDelay = (i++ * PASO_LETRA) + 'ms';
            });
        });
        var duracionOla = (i - 1) * PASO_LETRA + 800;
        svg.classList.add('lg--anim', 'lg--paused');

        var temporizador = null, visible = false;
        var ola = function () {
            svg.classList.add('lg-ola');
            setTimeout(function () { svg.classList.remove('lg-ola'); }, duracionOla + 50);
        };
        var actualizar = function () {
            var activo = visible && !document.hidden;
            svg.classList.toggle('lg--paused', !activo);
            if (activo && !temporizador) {
                temporizador = setInterval(ola, 10000);
                setTimeout(ola, 600);
            } else if (!activo && temporizador) {
                clearInterval(temporizador);
                temporizador = null;
                svg.classList.remove('lg-ola');
            }
        };
        new IntersectionObserver(function (entradas) {
            visible = entradas[entradas.length - 1].isIntersecting; // la más reciente
            actualizar();
        }).observe(caja);
        document.addEventListener('visibilitychange', actualizar);
    }

    // "IPUB Tupiza" ocupa exactamente el ancho del logo (igual que en logo-ipub.js)
    function ajustarNombre(caja, nombre) {
        var ancho = caja.offsetWidth;
        if (!ancho) return;
        var tam = 20;
        for (var k = 0; k < 2; k++) {
            nombre.style.fontSize = tam + 'px';
            var medido = nombre.getBoundingClientRect().width;
            if (!medido) return;
            tam = +(tam * ancho / medido).toFixed(2);
        }
        nombre.style.fontSize = tam + 'px';
    }
})();
