const DIAS_VENTANA_EVENTOS = 7;
const BASE_URL = 'https://ipubtupiza.org';
const SITIO_EVENTOS_URL = `${BASE_URL}/eventos`;
const SITIO_SERMON_URL = `${BASE_URL}/sermon`;

function formatearFechaLocal(fecha) {
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
}

function sumarDias(fecha, dias) {
    const copia = new Date(fecha);
    copia.setDate(copia.getDate() + dias);
    return copia;
}

function asegurarColeccionAvisos(db) {
    if (!db.has('avisosEnviados').value()) {
        db.set('avisosEnviados', []).write();
    }
}

function yaFueAnunciado(db, tipo, id) {
    return Boolean(db.get('avisosEnviados').find({ tipo, id }).value());
}

function registrarAviso(db, tipo, id) {
    db.get('avisosEnviados')
        .push({ tipo, id, enviadoEn: new Date().toISOString() })
        .write();
}

function resolverUrlImagen(imagen) {
    if (/^https?:\/\//i.test(imagen)) {
        return imagen;
    }

    const rutaRelativa = imagen.startsWith('/') ? imagen : `/${imagen}`;
    return `${BASE_URL}${rutaRelativa}`;
}

function construirMensajeEvento(evento) {
    const lugar = evento.lugar ? `📍 ${evento.lugar}\n` : '';
    return (
        `🗓️ *Nuevo Evento*\n\n` +
        `*${evento.titulo}*\n` +
        `📅 ${evento.fecha}\n` +
        `⏰ ${evento.hora}\n` +
        `${lugar}\n` +
        `👉 Más info: ${SITIO_EVENTOS_URL}`
    );
}

function construirMensajeSermon(sermon) {
    return (
        `🎙️ *Nuevo Sermón*\n\n` +
        `*${sermon.titulo}*\n` +
        `🗣️ ${sermon.predicador}\n\n` +
        `👉 Escúchalo: ${SITIO_SERMON_URL}`
    );
}

function obtenerEventosPendientes(db, hoyStr, limiteStr) {
    const eventos = db.get('eventos').value() || [];
    return eventos.filter((evento) => {
        if (!evento || !evento.id || !evento.fecha) return false;
        if (evento.fecha < hoyStr || evento.fecha > limiteStr) return false;
        return !yaFueAnunciado(db, 'evento', evento.id);
    });
}

function obtenerSermonesPendientes(db, hoyStr, ayerStr) {
    const sermones = db.get('sermones').value() || [];
    return sermones.filter((sermon) => {
        if (!sermon || !sermon.id || !sermon.fecha) return false;
        if (sermon.fecha !== hoyStr && sermon.fecha !== ayerStr) return false;
        return !yaFueAnunciado(db, 'sermon', sermon.id);
    });
}

async function enviarMensajeSeguro(sock, idGrupo, texto, descripcionError) {
    try {
        await sock.sendMessage(idGrupo, { text: texto });
        return true;
    } catch (error) {
        console.error(`❌ Error enviando ${descripcionError}:`, error);
        return false;
    }
}

async function enviarEventoPendiente(sock, idGrupo, evento) {
    const texto = construirMensajeEvento(evento);
    const descripcionError = `recordatorio del evento "${evento.titulo}"`;

    if (evento.imagen) {
        try {
            await sock.sendMessage(idGrupo, { image: { url: resolverUrlImagen(evento.imagen) }, caption: texto });
            return true;
        } catch (error) {
            console.error(`❌ Error enviando imagen del ${descripcionError}, se intenta como texto plano:`, error);
        }
    }

    return enviarMensajeSeguro(sock, idGrupo, texto, descripcionError);
}

async function enviarRecordatoriosDiarios(db, sock, idGrupo) {
    let eventosPendientes = [];
    let sermonesPendientes = [];

    try {
        db.read();
        asegurarColeccionAvisos(db);

        const hoy = new Date();
        const hoyStr = formatearFechaLocal(hoy);
        const ayerStr = formatearFechaLocal(sumarDias(hoy, -1));
        const limiteStr = formatearFechaLocal(sumarDias(hoy, DIAS_VENTANA_EVENTOS));

        eventosPendientes = obtenerEventosPendientes(db, hoyStr, limiteStr);
        sermonesPendientes = obtenerSermonesPendientes(db, hoyStr, ayerStr);
    } catch (error) {
        console.error('❌ Error leyendo eventos/sermones para recordatorios diarios:', error);
        return 0;
    }

    let totalEnviados = 0;

    for (const evento of eventosPendientes) {
        const enviado = await enviarEventoPendiente(sock, idGrupo, evento);

        if (enviado) {
            totalEnviados += 1;
            try {
                registrarAviso(db, 'evento', evento.id);
            } catch (error) {
                console.error(`❌ Error registrando aviso del evento "${evento.titulo}":`, error);
            }
        }
    }

    for (const sermon of sermonesPendientes) {
        const enviado = await enviarMensajeSeguro(
            sock,
            idGrupo,
            construirMensajeSermon(sermon),
            `recordatorio del sermon "${sermon.titulo}"`
        );

        if (enviado) {
            totalEnviados += 1;
            try {
                registrarAviso(db, 'sermon', sermon.id);
            } catch (error) {
                console.error(`❌ Error registrando aviso del sermon "${sermon.titulo}":`, error);
            }
        }
    }

    return totalEnviados;
}

module.exports = {
    enviarRecordatoriosDiarios,
    // Exportadas para reusar en el comando interactivo de bot.js (lista de
    // eventos por WhatsApp) sin duplicar el calculo de fechas ni la
    // resolucion de URL de imagen. No tocar la logica interna de estas
    // funciones sin revisar tambien enviarRecordatoriosDiarios.
    resolverUrlImagen,
    formatearFechaLocal,
    sumarDias,
    DIAS_VENTANA_EVENTOS
};
