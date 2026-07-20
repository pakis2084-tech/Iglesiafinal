window.addEventListener('load', () => {
    const preloader = document.getElementById('preloader');
    if (!preloader) return;
    preloader.classList.add('fade-out');
    setTimeout(() => preloader.remove(), 500);
});

let fechaVistaCalendario = new Date();

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeHttpUrl(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
        const url = new URL(text, window.location.origin);
        if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
    } catch (error) {
        return '';
    }
    return '';
}

function normalizeImageUrl(value, fallbackUrl) {
    const text = String(value || '').trim();
    if (!text) return fallbackUrl;
    if (text.startsWith('/uploads/eventos/')) return text;
    return normalizeHttpUrl(text) || fallbackUrl;
}

function getYouTubeVideoInfo(url) {
    const normalizedUrl = normalizeHttpUrl(url);
    const match = normalizedUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|live\/|shorts\/))([^&?]{11})/);
    const videoId = match && match[1] ? match[1] : 'default';
    return {
        videoId,
        externalUrl: normalizedUrl || '#',
        embedUrl: `https://www.youtube.com/embed/${videoId}?rel=0`,
        thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        heroThumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
    };
}

function parseDateValue(value) {
    const timestamp = Date.parse(String(value || ''));
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

async function shareOrPrompt(payload, promptMessage) {
    if (navigator.share) {
        try {
            await navigator.share(payload);
            return;
        } catch (error) {
            return;
        }
    }
    prompt(promptMessage, payload.url);
}

function generarCalendarioLimpieza() {
    const calGrid = document.getElementById('cal-grid');
    const mesAnioDisplay = document.getElementById('mes-anio-display');
    if (!calGrid || !mesAnioDisplay) return;

    const equipo = [
        'Hna. Teofila y familia', 'Hna. Roxana y familia', 'Hna. Florita y familia',
        'Hna. Wendy y familia', 'Hna. Laura y familia', 'Hna. Mary y familia',
        'Hna. Ruth y familia', 'Hna. Maria y familia', 'Hna. Julia y familia',
        'Hno. Agustin y Hno. Cecilio', 'Hna. Delia y familia', 'Hna. Prima y familia',
        'Hna. Miriam y familia', 'Hna. Elsa y familia'
    ];

    const year = fechaVistaCalendario.getFullYear();
    const month = fechaVistaCalendario.getMonth();
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    mesAnioDisplay.innerText = `${meses[month]} ${year}`;
    calGrid.innerHTML = '';

    const fechaBase = new Date(2026, 2, 2);
    const indiceBase = 10;
    const primerDiaMes = new Date(year, month, 1);
    const ultimoDiaMes = new Date(year, month + 1, 0);
    const diaSemanaInicio = primerDiaMes.getDay();
    const celdasVaciasInicio = diaSemanaInicio === 0 ? 6 : diaSemanaInicio - 1;

    for (let i = 0; i < celdasVaciasInicio; i += 1) {
        calGrid.innerHTML += '<div class="cal-celda vacia"></div>';
    }

    for (let dia = 1; dia <= ultimoDiaMes.getDate(); dia += 1) {
        const fechaIteracion = new Date(year, month, dia);
        const diaSemana = fechaIteracion.getDay();
        let turnoHTML = '';

        if ([0, 2, 4, 6].includes(diaSemana)) {
            const diasParaRestar = diaSemana === 0 ? 6 : diaSemana - 1;
            const lunesEstaSemana = new Date(fechaIteracion);
            lunesEstaSemana.setDate(fechaIteracion.getDate() - diasParaRestar);
            lunesEstaSemana.setHours(0, 0, 0, 0);

            const semanasPasadas = Math.floor((lunesEstaSemana.getTime() - fechaBase.getTime()) / (1000 * 60 * 60 * 24 * 7));
            let offsetDia = 0;
            if (diaSemana === 4) offsetDia = 1;
            if (diaSemana === 6) offsetDia = 2;
            if (diaSemana === 0) offsetDia = 3;

            let indiceSemanaAct = (indiceBase + (semanasPasadas * 4)) % equipo.length;
            if (indiceSemanaAct < 0) indiceSemanaAct = (indiceSemanaAct % equipo.length) + equipo.length;
            const indiceFinal = (indiceSemanaAct + offsetDia) % equipo.length;
            turnoHTML = `<div class="turno-badge">${equipo[indiceFinal]}</div>`;
        }

        calGrid.innerHTML += `<div class="cal-celda"><span class="numero-dia">${dia}</span>${turnoHTML}</div>`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const countdownElement = document.getElementById('countdown');
    if (countdownElement) {
        const horariosCultos = [
            { day: 2, hour: 19, minute: 30 },
            { day: 4, hour: 19, minute: 30 },
            { day: 6, hour: 19, minute: 30 },
            { day: 0, hour: 10, minute: 30 },
            { day: 0, hour: 19, minute: 30 }
        ];

        const obtenerProximoCulto = () => {
            const ahora = new Date();
            let fechaProxima = null;
            let menorDistancia = Number.POSITIVE_INFINITY;
            for (let i = 0; i <= 7; i += 1) {
                const fechaPrueba = new Date(ahora);
                fechaPrueba.setDate(ahora.getDate() + i);
                horariosCultos.forEach((horario) => {
                    if (horario.day !== fechaPrueba.getDay()) return;
                    const posibleFecha = new Date(fechaPrueba);
                    posibleFecha.setHours(horario.hour, horario.minute, 0, 0);
                    const distancia = posibleFecha.getTime() - ahora.getTime();
                    if (distancia > 0 && distancia < menorDistancia) {
                        menorDistancia = distancia;
                        fechaProxima = posibleFecha;
                    }
                });
            }
            return fechaProxima;
        };

        const renderCountdown = () => {
            const nextService = obtenerProximoCulto();
            if (!nextService) return;
            const distancia = nextService.getTime() - Date.now();
            const days = Math.floor(distancia / (1000 * 60 * 60 * 24));
            const hours = Math.floor((distancia % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((distancia % (1000 * 60 * 60)) / (1000 * 60));
            countdownElement.innerHTML = `${days}<span style="font-size:0.4em;">dias</span> : ${hours}<span style="font-size:0.4em;">hrs</span> : ${minutes}<span style="font-size:0.4em;">min</span>`;
        };

        setInterval(renderCountdown, 1000);
        renderCountdown();
    }

    const contactForm = document.querySelector('form');
    if (contactForm && window.location.pathname.includes('contacto')) {
        contactForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const btn = contactForm.querySelector('button');
            const originalText = btn.innerText;
            btn.innerText = 'Enviando mensaje...';
            btn.disabled = true;

            try {
                const response = await fetch('/api/mensajes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nombre: document.getElementById('nombre').value,
                        contacto: document.getElementById('contacto').value,
                        mensaje: document.getElementById('mensaje').value,
                        website: document.getElementById('website') ? document.getElementById('website').value : ''
                    })
                });
                const data = await response.json();
                if (data.success) {
                    alert('Gracias. Tu mensaje fue enviado correctamente.');
                    contactForm.reset();
                }
            } catch (error) {
                alert('No pudimos enviar tu mensaje en este momento. Intenta nuevamente en unos instantes.');
            } finally {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        });
    }

    const navbar = document.querySelector('.navbar');
    if (navbar) {
        window.addEventListener('scroll', () => navbar.classList.toggle('scrolled', window.scrollY > 50));
    }

    const contenedorSermones = document.getElementById('contenedor-sermones');
    if (contenedorSermones) {
        fetch('/api/sermones')
            .then((respuesta) => respuesta.json())
            .then((sermones) => {
                contenedorSermones.innerHTML = '';
                if (!sermones.length) {
                    contenedorSermones.innerHTML = '<p class="text-center text-muted w-100">Muy pronto compartiremos mensajes recientes en esta seccion.</p>';
                    return;
                }

                sermones.reverse().slice(0, 3).forEach((sermon) => {
                    const video = getYouTubeVideoInfo(sermon.youtubeUrl);
                    contenedorSermones.innerHTML += `
                        <div class="col-md-4 mb-4">
                            <div class="sermon-card h-100 shadow-sm border-0 position-relative">
                                <div class="card-img-wrap position-relative">
                                    <img src="${video.heroThumbnailUrl}" alt="${escapeHtml(sermon.titulo)}" class="img-fluid w-100" style="height: 220px; object-fit: cover;">
                                    <a href="${video.externalUrl}" target="_blank" rel="noopener noreferrer" class="play-btn-overlay"><i class="fas fa-play"></i></a>
                                </div>
                                <div class="card-body p-4">
                                    <div class="meta-date text-primary small mb-2"><i class="far fa-calendar-alt"></i> ${escapeHtml(sermon.fecha)} | <i class="far fa-user"></i> ${escapeHtml(sermon.predicador)}</div>
                                    <h4 class="card-title fw-bold mb-3">${escapeHtml(sermon.titulo)}</h4>
                                    <p class="card-text text-muted small mb-0">${escapeHtml(sermon.descripcion)}</p>
                                </div>
                            </div>
                        </div>
                    `;
                });
            })
            .catch(() => {
                contenedorSermones.innerHTML = '<p class="text-center text-danger w-100">No fue posible cargar los mensajes en este momento.</p>';
            });
    }

    const eventosCarouselTrack = document.getElementById('eventosCarouselTrack');
    if (eventosCarouselTrack) {
        const categoriasCarousel = {
            general: { label: 'General', chipClass: 'events-carousel-card__chip--general' },
            jovenes: { label: 'Jovenes', chipClass: 'events-carousel-card__chip--jovenes' },
            damas: { label: 'Damas Dorcas', chipClass: 'events-carousel-card__chip--damas' },
            escuela: { label: 'Escuela Dominical', chipClass: 'events-carousel-card__chip--escuela' }
        };
        const prevBtn = document.getElementById('eventosCarouselPrev');
        const nextBtn = document.getElementById('eventosCarouselNext');

        const actualizarNavCarousel = () => {
            if (!prevBtn || !nextBtn) return;
            prevBtn.disabled = eventosCarouselTrack.scrollLeft <= 4;
            nextBtn.disabled = eventosCarouselTrack.scrollLeft + eventosCarouselTrack.clientWidth >= eventosCarouselTrack.scrollWidth - 4;
        };

        fetch('/api/eventos')
            .then((respuesta) => respuesta.json())
            .then((eventos) => {
                if (!eventos.length) {
                    eventosCarouselTrack.innerHTML = '<div class="events-carousel-empty"><i class="fas fa-calendar-plus fa-2x text-primary mb-3"></i><p class="mb-0 text-muted">La proxima agenda se publicara aqui.</p></div>';
                    return;
                }

                const proximos = [...eventos].sort((a, b) => parseDateValue(a.fecha) - parseDateValue(b.fecha)).slice(0, 6);

                eventosCarouselTrack.innerHTML = proximos.map((evento) => {
                    const meta = categoriasCarousel[evento.categoria || 'general'] || categoriasCarousel.general;
                    const imagen = normalizeImageUrl(evento.imagen, '');
                    const placeholderHtml = '<div class="events-carousel-card__placeholder"><i class="fas fa-calendar-alt" aria-hidden="true"></i><span>Foto pr&oacute;ximamente</span></div>';
                    const media = imagen
                        ? `<img src="${imagen}" alt="${escapeHtml(evento.titulo || 'Evento')}" loading="lazy" data-fallback="true">`
                        : placeholderHtml;
                    const idSeguro = String(evento.id || 'evento').replace(/[^a-zA-Z0-9_-]/g, '');

                    return `<article class="events-carousel-card">
                        <div class="events-carousel-card__media">
                            ${media}
                            <span class="events-carousel-card__date">${escapeHtml(evento.fecha || 'Por confirmar')} &middot; ${escapeHtml(evento.hora || 'Por confirmar')}</span>
                            <span class="events-carousel-card__chip ${meta.chipClass}">${meta.label}</span>
                        </div>
                        <div class="events-carousel-card__body">
                            <h3 class="events-carousel-card__title">${escapeHtml(evento.titulo || 'Evento')}</h3>
                            <p class="events-carousel-card__excerpt">${escapeHtml(evento.descripcion || 'Pronto compartiremos mas detalles de esta actividad.')}</p>
                            <a href="/eventos?evento=${idSeguro}" class="events-carousel-card__link">Ver evento <i class="fas fa-arrow-right" aria-hidden="true"></i></a>
                        </div>
                    </article>`;
                }).join('');

                eventosCarouselTrack.querySelectorAll('img[data-fallback="true"]').forEach((img) => {
                    img.addEventListener('error', () => {
                        img.outerHTML = '<div class="events-carousel-card__placeholder"><i class="fas fa-calendar-alt" aria-hidden="true"></i><span>Foto pr&oacute;ximamente</span></div>';
                    }, { once: true });
                });

                if (prevBtn && nextBtn) {
                    const paso = () => (eventosCarouselTrack.querySelector('.events-carousel-card')?.offsetWidth || 340) + 28;
                    prevBtn.addEventListener('click', () => eventosCarouselTrack.scrollBy({ left: -paso(), behavior: 'smooth' }));
                    nextBtn.addEventListener('click', () => eventosCarouselTrack.scrollBy({ left: paso(), behavior: 'smooth' }));
                    eventosCarouselTrack.addEventListener('scroll', actualizarNavCarousel);
                    actualizarNavCarousel();
                }
            })
            .catch(() => {
                eventosCarouselTrack.innerHTML = '<div class="events-carousel-empty"><p class="mb-0 text-muted">No fue posible cargar la agenda. Intenta recargar la pagina.</p></div>';
            });
    }

    const contenedorEventos = document.getElementById('contenedor-eventos');
    if (contenedorEventos) {
        let listaEventosGlobal = [];
        const categorias = {
            general: { label: 'General', icon: 'fa-church', chipClass: 'event-chip--general' },
            jovenes: { label: 'Jovenes', icon: 'fa-fire', chipClass: 'event-chip--jovenes' },
            damas: { label: 'Damas Dorcas', icon: 'fa-praying-hands', chipClass: 'event-chip--damas' },
            escuela: { label: 'Escuela Dominical', icon: 'fa-child', chipClass: 'event-chip--escuela' }
        };

        if (!document.getElementById('modalMediaEvento')) {
            document.body.insertAdjacentHTML('beforeend', '<div class="modal fade" id="modalMediaEvento" tabindex="-1" aria-hidden="true"><div class="modal-dialog modal-dialog-centered modal-lg"><div class="modal-content bg-transparent border-0"><div class="modal-header border-0 pb-0 justify-content-end"><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Cerrar" style="filter: invert(1);"></button></div><div class="modal-body text-center"><div id="eventoMediaContent"></div><div class="mt-4"><button id="btnCompartirModal" class="btn btn-light rounded-pill px-4 py-2 fw-bold"><i class="fas fa-share-alt me-2" style="color: #D2102E;"></i> Compartir</button></div></div></div></div></div>');
        }

        const abrirMediaEvento = ({ tipo, src, titulo, idEvento }) => {
            const content = document.getElementById('eventoMediaContent');
            if (tipo === 'video-local') {
                content.innerHTML = `<video src="${escapeHtml(src)}" controls playsinline class="w-100 rounded shadow-lg" style="max-height: 80vh; background: #000;"></video>`;
            } else if (tipo === 'youtube') {
                const youtube = getYouTubeVideoInfo(src);
                content.innerHTML = `<div class="ratio ratio-16x9 rounded overflow-hidden shadow-lg"><iframe src="${youtube.embedUrl}" title="${escapeHtml(titulo)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
            } else {
                content.innerHTML = `<img src="${escapeHtml(src)}" class="img-fluid rounded shadow-lg" alt="${escapeHtml(titulo)}" style="max-height: 80vh; object-fit: contain;">`;
            }
            document.getElementById('btnCompartirModal').onclick = () => shareOrPrompt({ title: titulo, text: 'Acompananos a este evento en IPUB Tupiza', url: `${window.location.origin}/eventos?evento=${idEvento}` }, 'Copia este enlace para compartir el evento:');
            const modalElement = document.getElementById('modalMediaEvento');
            modalElement.addEventListener('hidden.bs.modal', () => {
                content.innerHTML = '';
            }, { once: true });
            new bootstrap.Modal(modalElement).show();
        };

        const renderizarEventos = (filtro) => {
            contenedorEventos.innerHTML = '';
            const eventos = filtro === 'todos' ? listaEventosGlobal : listaEventosGlobal.filter((item) => (item.categoria || 'general') === filtro);
            if (!eventos.length) {
                contenedorEventos.innerHTML = '<div class="col-12"><div class="events-empty-state"><i class="fas fa-calendar-xmark fa-2x text-primary mb-3"></i><h4 class="fw-bold mb-2">No encontramos actividades en esta categoria</h4><p class="mb-0 text-muted">Explora otra categoria para ver la agenda disponible.</p></div></div>';
                return;
            }

            eventos.forEach((evento) => {
                const meta = categorias[evento.categoria || 'general'] || categorias.general;
                const idSeguro = String(evento.id || 'evento').replace(/[^a-zA-Z0-9_-]/g, '');
                const imgFondo = normalizeImageUrl(evento.imagen, '/images/placeholders/evento-fallback.svg');
                const videoLocal = normalizeImageUrl(evento.video, '');
                const videoYoutube = normalizeHttpUrl(evento.youtubeUrl);
                const card = document.createElement('div');
                card.className = 'col-12';
                card.id = `tarjeta-${idSeguro}`;
                
                const videoBtn = videoYoutube ? '<button type="button" class="btn btn-danger px-4 ms-2" data-open-youtube="true"><i class="fab fa-youtube me-2"></i>Ver video</button>' : '';
                const localVideoBtn = videoLocal ? '<button type="button" class="btn btn-outline-danger px-4 ms-2" data-open-local-video="true"><i class="fas fa-video me-2"></i>Video adjunto</button>' : '';
                
                card.innerHTML = `<div class="event-board-card"><div class="row g-0 align-items-stretch"><div class="col-lg-5"><button type="button" class="event-board-card__media" data-open="true"><img src="${imgFondo}" alt="${escapeHtml(evento.titulo || 'Evento')}"><span class="event-zoom-badge"><i class="fas fa-expand me-2"></i>Ver panfleto</span></button></div><div class="col-lg-7"><div class="event-board-card__body"><div class="d-flex flex-wrap gap-2 mb-3 align-items-center"><span class="event-chip ${meta.chipClass}"><i class="fas ${meta.icon} me-1"></i>${meta.label}</span><span class="event-chip event-chip--date"><i class="far fa-calendar-alt me-1"></i>${escapeHtml(evento.fecha || 'Por confirmar')}</span><span class="event-chip event-chip--time"><i class="far fa-clock me-1"></i>${escapeHtml(evento.hora || 'Por confirmar')}</span></div><h2 class="card-title fw-bold mb-3">${escapeHtml(evento.titulo || 'Evento')}</h2><p class="event-board-card__description text-secondary mb-4">${escapeHtml(evento.descripcion || 'Pronto compartiremos mas detalles de esta actividad.')}</p><div class="event-meta-grid"><div><span>Lugar</span><strong>${escapeHtml(evento.lugar || 'Por confirmar')}</strong></div><div><span>Ministerio</span><strong>${meta.label}</strong></div><div><span>Compartir</span><strong>Enlace directo disponible</strong></div></div><div class="event-card-actions"><button type="button" class="btn btn-primary px-4" data-open="true"><i class="fas fa-image me-2"></i>Ver panfleto</button>${videoBtn}${localVideoBtn}<button type="button" class="btn btn-outline-primary px-4 ms-2" data-share="true"><i class="fas fa-share-alt me-2"></i>Compartir evento</button></div></div></div></div></div>`;
                card.querySelectorAll('[data-open="true"]').forEach((button) => button.addEventListener('click', () => abrirMediaEvento({ tipo: 'imagen', src: imgFondo, titulo: evento.titulo || 'Evento IPUB Tupiza', idEvento: idSeguro })));
                const localVideoButton = card.querySelector('[data-open-local-video="true"]');
                if (localVideoButton) {
                    localVideoButton.addEventListener('click', () => abrirMediaEvento({ tipo: 'video-local', src: videoLocal, titulo: evento.titulo || 'Evento IPUB Tupiza', idEvento: idSeguro }));
                }
                const youtubeButton = card.querySelector('[data-open-youtube="true"]');
                if (youtubeButton) {
                    youtubeButton.addEventListener('click', () => abrirMediaEvento({ tipo: 'youtube', src: videoYoutube, titulo: evento.titulo || 'Evento IPUB Tupiza', idEvento: idSeguro }));
                }
                card.querySelector('[data-share="true"]').addEventListener('click', () => shareOrPrompt({ title: evento.titulo || 'Evento IPUB Tupiza', text: 'Acompananos a este evento en IPUB Tupiza', url: `${window.location.origin}/eventos?evento=${idSeguro}` }, 'Copia este enlace para compartir el evento:'));
                contenedorEventos.appendChild(card);
            });
        };

        fetch('/api/eventos')
            .then((respuesta) => respuesta.json())
            .then((eventos) => {
                listaEventosGlobal = eventos.sort((a, b) => parseDateValue(a.fecha) - parseDateValue(b.fecha));
                if (!listaEventosGlobal.length) {
                    contenedorEventos.innerHTML = '<div class="col-12"><div class="events-empty-state"><i class="fas fa-calendar-plus fa-2x text-primary mb-3"></i><h4 class="fw-bold mb-2">La proxima agenda se publicara aqui</h4><p class="mb-0 text-muted">Cuando confirmemos nuevas actividades, apareceran en esta seccion con su informacion completa.</p></div></div>';
                    return;
                }
                document.querySelectorAll('.filtro-btn').forEach((btn) => btn.addEventListener('change', (event) => renderizarEventos(event.target.value)));
                renderizarEventos('todos');
                const eventoSolicitado = new URLSearchParams(window.location.search).get('evento');
                if (eventoSolicitado) {
                    const tarjetaTarget = document.getElementById(`tarjeta-${eventoSolicitado}`);
                    if (tarjetaTarget) setTimeout(() => { tarjetaTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }); tarjetaTarget.querySelector('[data-open="true"]').click(); }, 500);
                }
            })
            .catch(() => {
                contenedorEventos.innerHTML = '<div class="col-12"><div class="events-empty-state"><h4 class="fw-bold mb-2">No fue posible cargar la agenda</h4><p class="mb-0 text-muted">Recarga la pagina en unos segundos para intentarlo nuevamente.</p></div></div>';
            });
    }

    const contenedorPrincipal = document.getElementById('sermon-principal');
    const contenedorRecientes = document.getElementById('sermones-recientes');
    if (contenedorPrincipal && contenedorRecientes) {
        const inputBuscador = document.getElementById('sermon-search');
        const formularioBuscador = document.getElementById('sermon-search-form');
        const botonesOrden = document.querySelectorAll('.sermon-sort-chip');
        const badgeTotal = document.getElementById('sermones-total');
        let bibliotecaSermones = [];
        let terminoBusqueda = '';
        let orden = 'newest';
        let sermonActivoId = null;

        const actualizarTotal = (cantidad) => { if (badgeTotal) badgeTotal.textContent = `${cantidad} mensaje${cantidad === 1 ? '' : 's'}`; };
        const videoInfo = (url) => getYouTubeVideoInfo(url);
        const sermonesVisibles = () => {
            let resultado = [...bibliotecaSermones];
            const termino = terminoBusqueda.trim().toLowerCase();
            if (termino) resultado = resultado.filter((item) => `${item.titulo || ''} ${item.predicador || ''} ${item.descripcion || ''}`.toLowerCase().includes(termino));
            if (orden === 'oldest') resultado.sort((a, b) => parseDateValue(a.fecha) - parseDateValue(b.fecha));
            if (orden === 'title') resultado.sort((a, b) => String(a.titulo || '').localeCompare(String(b.titulo || ''), 'es'));
            if (orden === 'preacher') resultado.sort((a, b) => String(a.predicador || '').localeCompare(String(b.predicador || ''), 'es'));
            if (orden === 'newest') resultado.sort((a, b) => parseDateValue(b.fecha) - parseDateValue(a.fecha));
            return resultado;
        };

        const renderPrincipal = (sermon, shouldScroll = false) => {
            if (!sermon) return;
            sermonActivoId = sermon.id;
            const video = videoInfo(sermon.youtubeUrl);
            const shareId = escapeHtml(sermon.id);
            const primaryAction = video.externalUrl && video.externalUrl !== '#'
                ? `<a href="${video.externalUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary px-4"><i class="fab fa-youtube me-2"></i>Ver en YouTube</a>`
                : '<span class="btn btn-outline-primary px-4 disabled">Enlace no disponible</span>';
            contenedorPrincipal.innerHTML = `<div class="sermon-feature-card"><div class="sermon-feature-media"><iframe src="${video.embedUrl}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div><div class="sermon-feature-body"><div class="d-flex flex-wrap gap-2 mb-3"><span class="sermon-feature-badge"><i class="fas fa-star me-1"></i>Mensaje destacado</span><span class="sermon-feature-badge sermon-feature-badge--light"><i class="fas fa-book-open me-1"></i>Biblioteca IPUB Tupiza</span></div><h2 class="fw-bold mb-3">${escapeHtml(sermon.titulo || 'Mensaje')}</h2><div class="sermon-meta-row"><span><i class="far fa-calendar-alt text-primary"></i> ${escapeHtml(sermon.fecha || 'Fecha por confirmar')}</span><span><i class="far fa-user text-primary"></i> ${escapeHtml(sermon.predicador || 'Predicador por confirmar')}</span></div><div class="sermon-content text-secondary"><p>${escapeHtml(sermon.descripcion || 'Este mensaje ya esta disponible para verlo y compartirlo con la iglesia.')}</p></div><div class="sermon-actions">${primaryAction}<button type="button" class="btn btn-outline-primary px-4" data-sermon-share="${shareId}"><i class="fas fa-share-alt me-2"></i>Compartir mensaje</button></div></div></div>`;
            const shareButton = contenedorPrincipal.querySelector('[data-sermon-share]');
            if (shareButton) shareButton.addEventListener('click', () => shareOrPrompt({ title: sermon.titulo || 'Sermon IPUB Tupiza', text: 'Escucha este mensaje de IPUB Tupiza', url: video.externalUrl && video.externalUrl !== '#' ? video.externalUrl : window.location.href }, 'Copia este enlace para compartir el sermon:'));
            if (shouldScroll) window.scrollTo({ top: 120, behavior: 'smooth' });
        };

        const renderLista = () => {
            const visibles = sermonesVisibles();
            actualizarTotal(visibles.length);
            if (!visibles.length) {
                contenedorRecientes.innerHTML = '<div class="sermon-empty-state"><i class="fas fa-search text-primary fa-2x mb-3"></i><h5 class="fw-bold mb-2">No encontramos mensajes</h5><p class="mb-0 text-muted">Prueba otra busqueda o cambia el orden de la biblioteca.</p></div>';
                return;
            }
            if (!visibles.some((item) => String(item.id) === String(sermonActivoId))) renderPrincipal(visibles[0], false);
            contenedorRecientes.innerHTML = visibles.map((sermon) => {
                const video = videoInfo(sermon.youtubeUrl);
                const active = String(sermon.id) === String(sermonActivoId) ? 'is-active' : '';
                return `<button type="button" class="sermon-mini-card ${active}" data-sermon-id="${escapeHtml(sermon.id)}"><span class="sermon-mini-card__thumb"><img src="${video.thumbnailUrl}" alt="${escapeHtml(sermon.titulo || 'Mensaje')}"></span><span class="sermon-mini-card__body"><strong class="sermon-mini-card__title">${escapeHtml(sermon.titulo || 'Mensaje')}</strong><span class="sermon-mini-card__meta">${escapeHtml(sermon.fecha || 'Sin fecha')}</span><span class="sermon-mini-card__meta">${escapeHtml(sermon.predicador || 'Predicador')}</span></span></button>`;
            }).join('');
            contenedorRecientes.querySelectorAll('.sermon-mini-card').forEach((button) => button.addEventListener('click', () => { const sermon = bibliotecaSermones.find((item) => String(item.id) === String(button.dataset.sermonId)); if (sermon) { renderPrincipal(sermon, true); renderLista(); } }));
        };

        if (formularioBuscador) formularioBuscador.addEventListener('submit', (event) => { event.preventDefault(); terminoBusqueda = inputBuscador ? inputBuscador.value : ''; renderLista(); });
        if (inputBuscador) inputBuscador.addEventListener('input', (event) => { terminoBusqueda = event.target.value; renderLista(); });
        botonesOrden.forEach((boton) => boton.addEventListener('click', () => { orden = boton.dataset.sort || 'newest'; botonesOrden.forEach((item) => item.classList.toggle('is-active', item === boton)); renderLista(); }));

        fetch('/api/sermones')
            .then((respuesta) => respuesta.json())
            .then((sermones) => {
                bibliotecaSermones = sermones;
                if (!bibliotecaSermones.length) {
                    contenedorPrincipal.innerHTML = '<div class="sermon-empty-state"><i class="fas fa-video-slash fa-2x text-primary mb-3"></i><h4 class="fw-bold mb-2">La biblioteca estara disponible muy pronto</h4><p class="mb-0 text-muted">Los mensajes publicados apareceran aqui para verlos y compartirlos.</p></div>';
                    contenedorRecientes.innerHTML = '';
                    actualizarTotal(0);
                    return;
                }
                renderLista();
            })
            .catch(() => {
                contenedorPrincipal.innerHTML = '<div class="sermon-empty-state"><h4 class="fw-bold mb-2">No fue posible cargar los mensajes</h4><p class="mb-0 text-muted">Recarga la pagina en unos segundos para intentarlo nuevamente.</p></div>';
            });
    }

    generarCalendarioLimpieza();

    const btnPrev = document.getElementById('prev-month');
    const btnNext = document.getElementById('next-month');
    if (btnPrev && btnNext) {
        btnPrev.addEventListener('click', () => { fechaVistaCalendario.setMonth(fechaVistaCalendario.getMonth() - 1); generarCalendarioLimpieza(); });
        btnNext.addEventListener('click', () => { fechaVistaCalendario.setMonth(fechaVistaCalendario.getMonth() + 1); generarCalendarioLimpieza(); });
    }

    const btnCompartirLimpieza = document.getElementById('btnCompartirLimpieza');
    if (btnCompartirLimpieza) {
        btnCompartirLimpieza.addEventListener('click', () => shareOrPrompt({ title: 'Rol de Limpieza - IPUB Tupiza', text: 'Revisa el rol de limpieza actualizado de la iglesia', url: `${window.location.origin}/eventos?seccion=limpieza` }, 'Copia este enlace para compartir el calendario de limpieza:'));
    }

    if (new URLSearchParams(window.location.search).get('seccion') === 'limpieza') {
        setTimeout(() => {
            const seccionLimpieza = document.getElementById('rol-de-limpieza');
            if (!seccionLimpieza) return;
            seccionLimpieza.scrollIntoView({ behavior: 'smooth', block: 'center' });
            seccionLimpieza.style.transition = 'background-color 1s ease';
            seccionLimpieza.style.backgroundColor = '#fff3cd';
            setTimeout(() => { seccionLimpieza.style.backgroundColor = ''; }, 2000);
        }, 800);
    }
});
