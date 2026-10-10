// Logo animado del encabezado. Si algo falla, queda el PNG original del HTML.
(function () {
    'use strict';
    var VERSION = '20261010';
    var NOMBRE = 'IPUB Tupiza, Iglesia Pentecostal Unida de Bolivia. Un Señor, una fe, un bautismo. Todo el evangelio por todo el mundo. Ir al inicio';
    var PASO_LETRA = 45; // ms entre letras en la ola de luz

    var brand = document.querySelector('.navbar .navbar-brand');
    if (!brand || !window.fetch || !window.DOMParser) return;
    var reducido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    fetch('/images/logo-ipub.svg?v=' + VERSION)
        .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error(r.status)); })
        .then(montar)
        .catch(function () { /* se mantiene el logo PNG */ });

    function montar(texto) {
        var doc = new DOMParser().parseFromString(texto, 'image/svg+xml');
        var svg = doc.documentElement;
        if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return;
        svg = document.importNode(svg, true);
        svg.classList.add('lg--b');

        var contenedor = document.createElement('span');
        contenedor.className = 'lg-brand';
        contenedor.appendChild(svg);
        var nombre = document.createElement('span');
        nombre.className = 'lg-name';
        nombre.setAttribute('aria-hidden', 'true');
        nombre.innerHTML = '<span class="lg-name__ipub">IPUB</span> <span class="lg-name__tupiza">Tupiza</span>';
        contenedor.appendChild(nombre);

        brand.appendChild(contenedor);
        brand.classList.add('lg-on');
        brand.setAttribute('aria-label', NOMBRE);

        ajustarNombre(contenedor, nombre);
        // la caja cambia de ancho al cruzar los 480 px
        var anchoCaja = contenedor.offsetWidth;
        window.addEventListener('resize', function () {
            if (contenedor.offsetWidth === anchoCaja) return;
            anchoCaja = contenedor.offsetWidth;
            ajustarNombre(contenedor, nombre);
        });
        if (document.fonts && document.fonts.load) {
            document.fonts.load('800 20px Alegreya').then(function () { ajustarNombre(contenedor, nombre); }, function () {});
        }

        if (reducido) return;

        // Ola de luz: arco superior, cinta y arco inferior, cada grupo ordenado de izquierda a derecha.
        // La clase lg-ola solo está puesta mientras pasa la ola (~3 s de cada 10 s).
        var i = 0;
        ['.lg-ta', '.lg-tc', '.lg-tb'].forEach(function (sel) {
            svg.querySelectorAll(sel + ' path').forEach(function (letra) {
                letra.style.animationDelay = (i++ * PASO_LETRA) + 'ms';
            });
        });
        var duracionOla = (i - 1) * PASO_LETRA + 800;
        svg.classList.add('lg--anim');

        var temporizador = null;
        var ola = function () {
            svg.classList.add('lg-ola');
            setTimeout(function () { svg.classList.remove('lg-ola'); }, duracionOla + 50);
        };
        var iniciarOlas = function () {
            if (temporizador) return;
            temporizador = setInterval(ola, 10000);
            setTimeout(ola, 1500);
        };
        iniciarOlas();

        document.addEventListener('visibilitychange', function () {
            svg.classList.toggle('lg--paused', document.hidden);
            if (document.hidden) {
                clearInterval(temporizador);
                temporizador = null;
                svg.classList.remove('lg-ola');
            } else {
                iniciarOlas();
            }
        });

        var destello = function () {
            if (svg.classList.contains('lg-flash')) return;
            svg.classList.add('lg-flash');
        };
        brand.addEventListener('pointerenter', destello);
        brand.addEventListener('focus', destello);
        brand.addEventListener('touchstart', destello, { passive: true });
        svg.addEventListener('animationend', function (e) {
            if (e.animationName === 'lg-sheen-once') svg.classList.remove('lg-flash');
        });
    }

    // "IPUB Tupiza" ocupa exactamente el ancho del logo (medido en la caja sin escalar)
    function ajustarNombre(contenedor, nombre) {
        var ancho = contenedor.offsetWidth;
        if (!ancho) return;
        var escala = contenedor.getBoundingClientRect().width / ancho;
        var tam = 20;
        // dos pasadas: el ancho del texto no escala exactamente lineal con el tamaño
        for (var k = 0; k < 2; k++) {
            nombre.style.fontSize = tam + 'px';
            var medido = nombre.getBoundingClientRect().width / escala;
            if (!medido) return;
            tam = +(tam * ancho / medido).toFixed(2);
        }
        nombre.style.fontSize = tam + 'px';
    }
})();
