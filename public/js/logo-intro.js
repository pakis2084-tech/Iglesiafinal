// Intro del logo (en el <head>). Si falla o tarda, el sitio sigue normal.
(function () {
    'use strict';
    // Intro completa: 'sesion' una vez por sesión, 'diaria' una vez por día (el resto, la corta), 'siempre'
    var POLITICA = 'sesion';
    var ESPERA_SVG = 2500;

    var raiz = document.documentElement;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var completa = true;
    try {
        var guardado = POLITICA === 'diaria' ? localStorage : sessionStorage;
        var marca = POLITICA === 'diaria' ? new Date().toDateString() : '1';
        if (POLITICA !== 'siempre') completa = guardado.getItem('ipub-intro') !== marca;
        guardado.setItem('ipub-intro', marca);
    } catch (e) {
        return; // sin almacenamiento no se muestra
    }

    if (!completa) {
        window.IPUBLogoIntro = function (texto, svg) {
            try { corta(svg); } catch (e) { svg.classList.remove('lgi-corta'); }
        };
        return;
    }

    // El video del hero espera a la portada
    var video, videoListo = false;
    var frenar = function (e) { if (e.target.id === 'bg-video') e.target.pause(); };
    function reanudarVideo() {
        if (videoListo) return;
        videoListo = true;
        document.removeEventListener('play', frenar, true);
        video = document.getElementById('bg-video');
        if (!video || !video.paused) return;
        try { video.currentTime = 0; } catch (e) { /* sin datos */ }
        intentar(3);
    }
    function intentar(n) {
        var p = video.play();
        if (p) p.catch(function () {
            var otra = function () {
                video.removeEventListener('canplay', otra);
                if (n-- > 1) intentar(n);
                n = 0;
            };
            video.addEventListener('canplay', otra);
            setTimeout(otra, 600);
        });
    }
    var limpiar = function () { raiz.classList.remove('lgi-cubre'); reanudarVideo(); };
    var alError = function (e) { if (/logo-(intro|ipub)\.js/.test(e.filename || '')) limpiar(); };

    document.addEventListener('play', frenar, true);
    window.addEventListener('error', alError);
    raiz.classList.add('lgi-cubre');
    var esperaSvg = setTimeout(function () { limpiar(); }, ESPERA_SVG);

    // logo-ipub.js la llama con el SVG que ya descargó
    window.IPUBLogoIntro = function (texto, svgEncabezado, brand) {
        clearTimeout(esperaSvg);
        if (!raiz.classList.contains('lgi-cubre')) return;
        try {
            correr(texto, svgEncabezado, brand);
        } catch (e) {
            limpiar();
        }
    };

    function correr(texto, svgEncabezado, brand) {
        // Salida primero: un error deja todo como estaba
        var capa, ocultos = [], corte = new AbortController(), op = { signal: corte.signal, passive: true };
        var vigilante = setTimeout(terminar, 12000);
        limpiar = terminar;
        function terminar() {
            clearTimeout(vigilante);
            corte.abort();
            removeEventListener('error', alError);
            ocultos.forEach(function (el) { el.removeAttribute('aria-hidden'); });
            brand.classList.remove('lgi-espera');
            svgEncabezado.classList.remove('lg--paused');
            if (capa && capa.parentNode) capa.parentNode.removeChild(capa);
            raiz.classList.remove('lgi-cubre');
            reanudarVideo();
        }

        // Copia con los colores del encabezado, visible durante el vuelo: llega idéntico
        var marca = document.importNode(new DOMParser().parseFromString(texto.replace(/(id="|url\(#|href="#)lg-/g, '$1lgb-'), 'image/svg+xml').documentElement, true);
        marca.setAttribute('class', 'lg lg--b lgi-marca');

        // Copia del SVG: otros ids, continentes quietos, recorte de la cinta
        var continentes = texto.match(/<g id="lg-ct">([\s\S]*?)<\/g>/)[1];
        texto = texto.replace(/(<g class="lg-tr">)[\s\S]*?<\/g>/, '$1' + continentes + '</g>')
            .replace('</defs>', '<clipPath id="lg-cinta"><rect x="32" y="50" width="162" height="40"/></clipPath></defs>')
            .replace('<g class="lg-rib">', '<g class="lg-rib" clip-path="url(#lg-cinta)">')
            .replace(/(id="|url\(#|href="#)lg-/g, '$1lgi-');
        var svg = document.importNode(new DOMParser().parseFromString(texto, 'image/svg+xml').documentElement, true);
        svg.setAttribute('class', 'lgi-orig');

        // Tiempos (ms): contorno, malla, continentes y letras por arco
        retrasar(svg, ['.lg-grid'], 415, 35);
        svg.querySelector('.lg-grid path').style.setProperty('--lgi-d', '150ms');
        retrasar(svg, ['.lg-tr'], 1350, 90);
        retrasar(svg, ['.lg-ta'], 2750, 45);
        retrasar(svg, ['.lg-tc'], 3000, 30);
        retrasar(svg, ['.lg-tb'], 3550, 45);

        capa = document.createElement('div');
        capa.innerHTML = '<div class="lgi" role="img" aria-label="IPUB Tupiza. Un Señor, una fe, un bautismo. ' +
            'Todo el evangelio por todo el mundo"><div class="lgi-fondo"></div><div class="lgi-logo"></div></div>';
        capa = capa.firstChild;
        var caja = capa.lastChild;
        caja.appendChild(svg);
        caja.appendChild(marca);

        // Oculto a lectores de pantalla
        ocultos = [].filter.call(document.body.children, function (el) {
            return el.tagName !== 'SCRIPT' && !el.hasAttribute('aria-hidden');
        });
        ocultos.forEach(function (el) { el.setAttribute('aria-hidden', 'true'); });
        brand.classList.add('lgi-espera');
        svgEncabezado.classList.add('lg--paused');
        var preloader = document.getElementById('preloader');
        if (preloader) preloader.classList.add('fade-out');

        // Destino: el logo del encabezado (arriba o con scroll)
        function ubicar() {
            var ancho = raiz.clientWidth, alto = capa.clientHeight || innerHeight;
            var w = Math.min(ancho * 0.86, 560, alto * 1.05);
            var x = (ancho - w) / 2, y = (alto - w * 84 / 160.6) / 2;
            var d = svgEncabezado.getBoundingClientRect(), cs = getComputedStyle(svgEncabezado);
            // Colores del encabezado en su estado actual (oscuro o con scroll)
            marca.style.cssText = '--lg-line:' + cs.getPropertyValue('--lg-line') + ';--lg-text:' + cs.getPropertyValue('--lg-text');
            caja.style.cssText = 'width:' + w + 'px;left:' + x + 'px;top:' + y + 'px;--tx:' + (d.left - x) +
                'px;--ty:' + (d.top - y) + 'px;--s:' + d.width / w;
        }

        function saltar() {
            if (capa.classList.contains('lgi-salir')) return;
            brand.classList.remove('lgi-espera');
            capa.classList.add('lgi-salir');
            reanudarVideo();
            setTimeout(terminar, 500);
        }
        function pausar() {
            capa.classList.toggle('lgi-pausa', document.hidden);
            clearTimeout(vigilante);
            if (!document.hidden) vigilante = setTimeout(terminar, 8000);
        }

        capa.firstChild.addEventListener('animationstart', reanudarVideo);
        caja.addEventListener('animationstart', function (e) {
            if (e.target !== caja) return;
            if (e.animationName === 'lgi-asentar') ubicar();
            // Cruce con el logo del encabezado
            else brand.classList.remove('lgi-espera');
        });
        caja.addEventListener('animationend', function (e) {
            if (e.target === caja && e.animationName === 'lgi-fuera') terminar();
        });
        capa.addEventListener('pointerdown', saltar);
        document.addEventListener('keydown', saltar, op);
        document.addEventListener('visibilitychange', pausar, op);
        addEventListener('resize', ubicar, op);
        addEventListener('scroll', ubicar, op);
        document.body.appendChild(capa);
        ubicar();
        raiz.classList.remove('lgi-cubre');
    }

    function retrasar(svg, grupos, desde, paso) {
        var n = 0;
        grupos.forEach(function (sel) {
            svg.querySelectorAll(sel + ' path').forEach(function (p) {
                // Variable propia: logo-ipub.js pisa animationDelay (su ola) en el encabezado
                p.style.setProperty('--lgi-d', (desde + n++ * paso) + 'ms');
                // Largo normalizado: todas las líneas se dibujan al mismo ritmo
                if (sel === '.lg-grid') p.setAttribute('pathLength', '1');
            });
        });
    }

    // Versión corta (~1,5 s) en el logo del encabezado; un toque la termina
    function corta(svg) {
        retrasar(svg, ['.lg-grid'], 0, 25);
        retrasar(svg, ['.lg-ta'], 600, 30);
        retrasar(svg, ['.lg-tc'], 750, 15);
        retrasar(svg, ['.lg-tb'], 1000, 30);
        var t = setTimeout(fin, 1650);
        function fin() {
            svg.classList.remove('lgi-corta');
            document.removeEventListener('pointerdown', fin);
            clearTimeout(t);
        }
        svg.classList.add('lgi-corta');
        document.addEventListener('pointerdown', fin, { passive: true });
    }
})();
