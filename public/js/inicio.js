// Inicio: próximo culto y cuenta regresiva (hora de Bolivia), Eventos y Mensajes desde la API,
// botón flotante de WhatsApp y entradas suaves. Si algo falla, la página queda con el contenido fijo.
(function () {
    'use strict';

    // Si tiene texto, reemplaza la línea del próximo culto y la cuenta regresiva (ej.: 'El jueves no hay culto por feriado.')
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
    var ESPERA_API = 6000;

    var reducido = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;

    // --- Hora de Bolivia ---
    var formato = null;
    try {
        formato = new Intl.DateTimeFormat('en-US', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    } catch (e) { /* navegador sin zonas horarias: se usa UTC-4 fijo */ }
    function laPaz(fecha) {
        if (formato) {
            var p = {};
            formato.formatToParts(fecha).forEach(function (x) { p[x.type] = x.value; });
            var dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
            if (dia >= 0) return { dia: dia, min: (Number(p.hour) % 24) * 60 + Number(p.minute), iso: p.year + '-' + p.month + '-' + p.day };
        }
        // Bolivia no tiene horario de verano: UTC-4 todo el año
        var b = new Date(fecha.getTime() - 4 * 3600000);
        return { dia: b.getUTCDay(), min: b.getUTCHours() * 60 + b.getUTCMinutes(), iso: b.toISOString().slice(0, 10) };
    }
    function hora12(h, m) {
        return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM');
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
        return { enCurso: false, c: prox.c, falta: prox.falta, dias: Math.floor((a.min + prox.falta) / 1440) };
    }
    function cuando(e) {
        return e.dias === 0 ? 'hoy' : e.dias === 1 ? 'mañana' : 'el ' + DIAS[e.c.dia];
    }
    function faltaTexto(min) {
        var d = Math.floor(min / 1440), h = Math.floor(min % 1440 / 60), m = min % 60;
        if (d) return (d === 1 ? '1 día' : d + ' días') + (h ? ' y ' + h + ' h' : '');
        if (h) return h + ' h' + (m ? ' ' + m + ' min' : '');
        return m + ' min';
    }
    function mayuscula(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

    function pintarCulto() {
        var e = estado(new Date()), hora = hora12(e.c.h, e.c.m);

        var linea = document.getElementById('heroProximo');
        if (linea) {
            linea.textContent = '';
            if (AVISO) {
                linea.textContent = AVISO;
                linea.classList.add('hv-next--aviso');
            } else {
                var valor = document.createElement('strong');
                linea.appendChild(document.createTextNode(e.enCurso ? 'Culto en curso ' : 'Próximo culto '));
                valor.textContent = e.enCurso ? 'Comenzó a las ' + hora : mayuscula(cuando(e)) + ', ' + hora;
                linea.appendChild(valor);
            }
            linea.hidden = false;
        }

        var filas = document.querySelectorAll('#lpDias li');
        [].forEach.call(filas, function (li) {
            var es = !AVISO && li.getAttribute('data-dias').split(' ').indexOf(String(e.c.dia)) >= 0;
            var nota = li.querySelector('.lp-falta');
            li.classList.toggle('es-proximo', es);
            if (!es) { if (nota) li.removeChild(nota); return; }
            if (!nota) { nota = document.createElement('span'); nota.className = 'lp-falta'; li.appendChild(nota); }
            nota.textContent = e.enCurso
                ? 'Hay culto ahora: comenzó a las ' + hora + '.'
                : 'El próximo culto es ' + cuando(e) + ' a las ' + hora + '. Faltan ' + faltaTexto(e.falta) + '.';
        });
        var aviso = document.getElementById('lpAviso');
        if (aviso) { aviso.textContent = AVISO; aviso.hidden = !AVISO; }
    }

    // --- Eventos y Mensajes: nacen ocultos y solo aparecen con datos ---
    function escapar(v) {
        return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function urlSegura(v) {
        var t = String(v || '').trim();
        if (!t) return '';
        if (t.indexOf('/uploads/eventos/') === 0) return t;
        try { var u = new URL(t, location.origin); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : ''; } catch (e) { return ''; }
    }
    function pedir(url) {
        var corte = window.AbortController ? new AbortController() : null;
        var reloj = setTimeout(function () { if (corte) corte.abort(); }, ESPERA_API);
        return fetch(url, corte ? { signal: corte.signal } : {})
            .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
            .then(function (d) { clearTimeout(reloj); if (!Array.isArray(d)) throw new Error('formato'); return d; });
    }
    function fechaLarga(iso) {
        var p = String(iso || '').split('-');
        if (p.length !== 3) return escapar(iso);
        var meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        return Number(p[2]) + ' de ' + (meses[Number(p[1]) - 1] || '');
    }
    function horaEvento(t) {
        var m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
        return m ? hora12(Number(m[1]), Number(m[2])) : escapar(t);
    }

    function cargarEventos() {
        var sec = document.getElementById('lpEventos'), lista = document.getElementById('lpEventosLista');
        if (!sec || !lista) return;
        pedir('/api/eventos').then(function (eventos) {
            var hoy = laPaz(new Date()).iso;
            var proximos = eventos.filter(function (e) { return /^\d{4}-\d{2}-\d{2}$/.test(e.fecha || '') && e.fecha >= hoy; })
                .sort(function (a, b) { return (a.fecha + (a.hora || '')).localeCompare(b.fecha + (b.hora || '')); })
                .slice(0, 6);
            if (!proximos.length) return;
            lista.innerHTML = proximos.map(function (e) {
                var img = urlSegura(e.imagen);
                var id = String(e.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
                return '<li class="lp-evento">' +
                    (img ? '<img src="' + escapar(img) + '" alt="" loading="lazy" width="640" height="400">' : '') +
                    '<p class="lp-evento__fecha">' + fechaLarga(e.fecha) + (e.hora ? ' · ' + horaEvento(e.hora) : '') + '</p>' +
                    '<h3>' + escapar(e.titulo || 'Evento') + '</h3>' +
                    (e.lugar ? '<p class="lp-evento__lugar">' + escapar(e.lugar) + '</p>' : '') +
                    '<a href="/eventos' + (id ? '?evento=' + id : '') + '">Ver evento<span class="visually-hidden">: ' + escapar(e.titulo || '') + '</span></a>' +
                    '</li>';
            }).join('');
            sec.hidden = false;
            observar(sec);
        }).catch(function () { /* sin datos o sin respuesta: la sección sigue oculta */ });
    }

    function cargarMensajes() {
        var sec = document.getElementById('lpMensajes'), lista = document.getElementById('lpMensajesLista');
        if (!sec || !lista) return;
        pedir('/api/sermones').then(function (sermones) {
            var ultimos = sermones.slice().reverse().slice(0, 3);
            if (!ultimos.length) return;
            lista.innerHTML = ultimos.map(function (s) {
                var url = urlSegura(s.youtubeUrl);
                var m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|live\/|shorts\/))([^&?]{11})/);
                var miniatura = m ? '<img src="https://img.youtube.com/vi/' + m[1] + '/hqdefault.jpg" alt="" loading="lazy" width="480" height="360">' : '';
                return '<li class="lp-mensaje">' + miniatura +
                    '<p class="lp-mensaje__meta">' + escapar([s.fecha, s.predicador].filter(Boolean).join(' · ')) + '</p>' +
                    '<h3>' + escapar(s.titulo || 'Mensaje') + '</h3>' +
                    (url ? '<a href="' + escapar(url) + '" target="_blank" rel="noopener noreferrer">Ver el mensaje<span class="visually-hidden">: ' + escapar(s.titulo || '') + '</span></a>' : '') +
                    '</li>';
            }).join('');
            sec.hidden = false;
            observar(sec);
        }).catch(function () { /* sin datos o sin respuesta: la sección sigue oculta */ });
    }

    // --- Entradas suaves: solo con IntersectionObserver y sin movimiento reducido ---
    var io = null;
    if ('IntersectionObserver' in window && !(reducido && reducido.matches)) {
        document.documentElement.classList.add('lp-rv');
        io = new IntersectionObserver(function (entradas) {
            entradas.forEach(function (en) {
                if (en.isIntersecting) { en.target.classList.add('ok'); io.unobserve(en.target); }
            });
        }, { rootMargin: '0px 0px -8% 0px' });
    }
    function observar(raiz) {
        if (!io) return;
        [].forEach.call(raiz.querySelectorAll('.rv'), function (el) { io.observe(el); });
    }

    // --- Movimiento reducido: el script inline del hero ya dejó la llama en el poster sin descargar el video ---
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
        setInterval(pintarCulto, 30000);
        cargarEventos();
        cargarMensajes();
        observar(document);

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
