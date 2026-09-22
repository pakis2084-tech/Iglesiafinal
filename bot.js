const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { enviarRecordatoriosDiarios, resolverUrlImagen, formatearFechaLocal, sumarDias, DIAS_VENTANA_EVENTOS } = require('./recordatorios.js');

const FRASES_MOTIVADORAS_FILE = path.join(__dirname, 'frases-motivadoras.json');

const RECONNECT_BASE_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 60000;
const COMMAND_RATE_LIMIT_WINDOW_MS = 10 * 1000;
const COMMAND_RATE_LIMIT_MAX = 5;
const MOTIVO_MAX_LENGTH = 500;

const ID_GRUPO = '120363028628647608@g.us';

// Imagenes locales para el versiculo de la manana/noche (reemplazan los
// arrays hardcodeados de URLs de Pinterest, que Pinterest bloqueo con 403).
// Se suben/borran desde el panel (Bot WhatsApp) via server.js. El cron de
// "Domingo Imagen" reusa la carpeta de la manana (mismo horario/tematica),
// no tiene carpeta propia.
const UPLOADS_VERSICULOS_MANANA_DIR = path.join(__dirname, 'public', 'uploads', 'versiculos', 'manana');
const UPLOADS_VERSICULOS_NOCHE_DIR = path.join(__dirname, 'public', 'uploads', 'versiculos', 'noche');

const VERSICULOS_MANANA = [
    "Salmo 118:24: 'Este es el día que hizo Jehová; Nos gozaremos y alegraremos en él.'",
    "Lamentaciones 3:22-23: 'Nuevas son sus misericordias cada mañana; grande es tu fidelidad.'",
    "Salmo 5:3: 'Oh Jehová, de mañana oirás mi voz; de mañana me presentaré ante ti y esperaré.'",
    "Sofonías 3:17: 'Jehová está en medio de ti, poderoso, él salvará; se gozará sobre ti con alegría.'",
    "Salmo 143:8: 'Hazme oír por la mañana tu misericordia, porque en ti he confiado.'"
];

const VERSICULOS_NOCHE = [
    "Salmo 4:8: 'En paz me acostaré, y asimismo dormiré; Porque solo tú, Jehová, me haces vivir confiado.'",
    "Mateo 11:28: 'Venid a mí todos los que estáis trabajados y cargados, y yo os haré descansar.'",
    "Salmo 121:4: 'He aquí, no se adormecerá ni dormirá el que guarda a Israel.'",
    "Filipenses 4:13: 'Todo lo puedo en Cristo que me fortalece.'",
    "Juan 14:27: 'La paz os dejo, mi paz os doy; yo no os la doy como el mundo la da. No se turbe vuestro corazón.'"
];

// Horario de respaldo si botConfig no tiene una entrada valida para esta
// clave (no deberia pasar tras la migracion de server.js, pero por las dudas).
const HORA_POR_DEFECTO_BOT = {
    versiculoManana: '07:00',
    versiculoNoche: '21:00',
    limpieza: '08:00',
    eventosSermones: '08:30'
};

function sanitizeMotivo(value) {
    const text = String(value || '')
        .normalize('NFKC')
        .replace(/\0/g, '')
        .replace(/[<>]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    return text.slice(0, MOTIVO_MAX_LENGTH);
}

function createSenderRateLimiter(windowMs, max) {
    const store = new Map();

    return function isRateLimited(sender) {
        const now = Date.now();
        const entry = store.get(sender);

        if (!entry || entry.resetAt <= now) {
            store.set(sender, { count: 1, resetAt: now + windowMs });
            return false;
        }

        entry.count += 1;
        return entry.count > max;
    };
}

async function iniciarBot(db, sockHolderExterno) {
    const commandRateLimited = createSenderRateLimiter(COMMAND_RATE_LIMIT_WINDOW_MS, COMMAND_RATE_LIMIT_MAX);
    // sockHolderExterno la crea server.js (createApp) para que las rutas
    // /api/bot-estado y /api/bot-config/probar/:tipo puedan leer el socket
    // ya conectado y disparar tareas bajo demanda. Si no se pasa ninguno
    // (por ejemplo si algo llama iniciarBot directo), se crea uno local.
    const sockHolder = sockHolderExterno || { sock: null, conectado: false };

    async function connect(reconnectAttempt) {
        function scheduleReconnect() {
            const attempt = reconnectAttempt + 1;
            const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt, RECONNECT_MAX_DELAY_MS);
            console.log(`⏳ Reintentando conexion en ${Math.round(delay / 1000)}s (intento ${attempt})...`);
            setTimeout(() => {
                connect(attempt).catch((error) => {
                    console.error('❌ Error al reiniciar el bot:', error);
                    scheduleReconnect();
                });
            }, delay);
        }

        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

        const { version } = await fetchLatestBaileysVersion();
        console.log(`\n📡 Conectando a WhatsApp Web v${version.join('.')}...`);

        const sock = makeWASocket({
            auth: state,
            version: version,
            browser: ['IPUB Bot', 'Chrome', '1.0.0'],
            syncFullHistory: false,
            generateHighQualityLinkPreview: false
        });
        sockHolder.sock = sock;

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                console.log('\n=========================================');
                console.log('📱 ESCANEA ESTE CÓDIGO CON EL WHATSAPP DE LA IGLESIA');
                console.log('=========================================\n');
                qrcode.generate(qr, { small: true });
            }
            if (connection === 'close') {
                sockHolder.conectado = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== 401;
                console.log('⚠️ Conexion cerrada. ¿Reconectando?:', shouldReconnect);

                if (shouldReconnect) {
                    scheduleReconnect();
                } else {
                    console.log('🚪 Sesion cerrada (401). Es necesario volver a escanear el codigo QR para reconectar.');
                }
            } else if (connection === 'open') {
                sockHolder.conectado = true;
                console.log('✅ ¡Bot IPUB sincronizado y en línea!');
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async ({ messages }) => {
            try {
                await handleIncomingMessage(sock, db, messages[0], commandRateLimited);
            } catch (error) {
                console.error('❌ Error procesando mensaje entrante:', error);
            }
        });
    }

    await connect(0);
    registerScheduledJobs(sockHolder, db);
}

function construirLineaEvento(evento) {
    const enlace = evento.youtubeUrl && evento.youtubeUrl.trim() !== '' ? evento.youtubeUrl : 'https://ipubtupiza.org';
    return `🔹 *${evento.titulo}*\n📅 ${evento.fecha} - ⏰ ${evento.hora}\n🔗 ${enlace}`;
}

function filtrarEventosProximos(eventos) {
    // Mismo criterio de ventana (hoy..+7 dias) que usa enviarRecordatoriosDiarios
    // en recordatorios.js, para que el comando de WhatsApp y el cron diario
    // muestren siempre el mismo conjunto de eventos.
    const hoy = new Date();
    const hoyStr = formatearFechaLocal(hoy);
    const limiteStr = formatearFechaLocal(sumarDias(hoy, DIAS_VENTANA_EVENTOS));
    return eventos.filter((evento) => evento && evento.fecha && evento.fecha >= hoyStr && evento.fecha <= limiteStr);
}

async function enviarImagenEventoConFallback(sock, from, evento) {
    const caption = construirLineaEvento(evento);
    try {
        await sock.sendMessage(from, { image: { url: resolverUrlImagen(evento.imagen) }, caption });
    } catch (error) {
        console.error(`❌ Error enviando imagen del evento "${evento.titulo}" en el comando de eventos, se intenta como texto plano:`, error);
        try {
            await sock.sendMessage(from, { text: caption });
        } catch (textError) {
            console.error(`❌ Error enviando texto de respaldo del evento "${evento.titulo}":`, textError);
        }
    }
}

async function handleIncomingMessage(sock, db, msg, commandRateLimited) {
    if (!msg || !msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    if (!from) return;

    let body = '';
    if (msg.message.conversation) {
        body = msg.message.conversation;
    } else if (msg.message.extendedTextMessage) {
        body = msg.message.extendedTextMessage.text;
    } else if (msg.message.ephemeralMessage) {
        const emph = msg.message.ephemeralMessage.message;
        body = emph.conversation || emph.extendedTextMessage?.text || '';
    }

    if (!body) return;

    if (commandRateLimited(from)) {
        return;
    }

    const input = body.toLowerCase().trim();
    db.read();

    if (input.includes('hola') || input.includes('menu') || input === '!hola') {
        const menuText = '🙏 *BIENVENIDO A IPUB TUPIZA* 🙏\n\nResponde con el *NÚMERO*:\n\n1️⃣ 🗓️ Ver Eventos\n2️⃣ 🧹 Roles de Limpieza\n3️⃣ 🛐 Petición de Oración\n4️⃣ 📍 Ubicación\n5️⃣ 🌐 Página Oficial\n\n👉 _Escribe solo el número_';
        await sock.sendMessage(from, { text: menuText });
        return;
    }

    if (input === '1' || input.includes('eventos')) {
        const eventosProximos = filtrarEventosProximos(db.get('eventos').value() || []);
        let texto = '🗓️ *Próximos Eventos:*\n\n';
        eventosProximos.forEach((evento) => {
            texto += `${construirLineaEvento(evento)}\n\n`;
        });
        await sock.sendMessage(from, { text: texto });

        for (const evento of eventosProximos) {
            if (evento.imagen) {
                await enviarImagenEventoConFallback(sock, from, evento);
            }
        }
    } else if (input === '2' || input.includes('roles')) {
        const equipo = db.get('equipoLimpieza').value() || [];
        const fechaBaseStr = db.get('fechaBase').value() || '';
        const indiceBaseValor = Number(db.get('indiceBase').value());
        const indiceBase = Number.isInteger(indiceBaseValor) ? indiceBaseValor : 0;
        const turnoHoy = calcularTurnoLimpiezaHoy(new Date(), equipo, fechaBaseStr, indiceBase);
        const texto = turnoHoy
            ? `🧹 *Rol de Limpieza:*\n\nHoy le toca a: *${turnoHoy}*. ¡Gracias! 🙌`
            : '🧹 *Rol de Limpieza:*\n\nHoy no hay turno de limpieza asignado.';
        await sock.sendMessage(from, { text: texto });
    } else if (input === '5') {
        await sock.sendMessage(from, { text: '🌐 *Página Oficial*\n🔗 https://ipubtupiza.org' });
    }

    if (input.startsWith('!orar ')) {
        const motivo = sanitizeMotivo(body.substring(6));
        if (motivo) {
            db.get('peticiones_oracion')
                .push({ id: Date.now().toString(), motivo, fecha: new Date().toISOString(), numero: from.split('@')[0] })
                .write();
            await sock.sendMessage(from, { text: '🙏 Petición guardada. Dios te bendiga.' });
        }
    }
}

function calcularTurnoLimpiezaHoy(fecha, equipo, fechaBaseStr, indiceBase) {
    // Misma logica de rotacion que generarCalendarioLimpieza() en public/js/app.js:
    // NO cambiar este calculo sin cambiar tambien el de app.js, o se van a desincronizar.
    if (!Array.isArray(equipo) || equipo.length === 0 || !fechaBaseStr) {
        return '';
    }

    const diaSemana = fecha.getDay();
    if (![0, 2, 4, 6].includes(diaSemana)) {
        return '';
    }

    const [anioBase, mesBase, diaBase] = fechaBaseStr.split('-').map(Number);
    const fechaBase = new Date(anioBase, mesBase - 1, diaBase);

    const diasParaRestar = diaSemana === 0 ? 6 : diaSemana - 1;
    const lunesEstaSemana = new Date(fecha);
    lunesEstaSemana.setDate(fecha.getDate() - diasParaRestar);
    lunesEstaSemana.setHours(0, 0, 0, 0);

    const semanasPasadas = Math.floor((lunesEstaSemana.getTime() - fechaBase.getTime()) / (1000 * 60 * 60 * 24 * 7));
    let offsetDia = 0;
    if (diaSemana === 4) offsetDia = 1;
    if (diaSemana === 6) offsetDia = 2;
    if (diaSemana === 0) offsetDia = 3;

    let indiceSemanaAct = (indiceBase + (semanasPasadas * 4)) % equipo.length;
    if (indiceSemanaAct < 0) indiceSemanaAct = (indiceSemanaAct % equipo.length) + equipo.length;
    const indiceFinal = (indiceSemanaAct + offsetDia) % equipo.length;
    return equipo[indiceFinal] || '';
}

function obtenerFrasesMotivadoras() {
    try {
        const contenido = fs.readFileSync(FRASES_MOTIVADORAS_FILE, 'utf8');
        const frases = JSON.parse(contenido);
        if (!Array.isArray(frases)) {
            return [];
        }
        return frases.filter((frase) => typeof frase === 'string' && frase.trim() !== '');
    } catch (error) {
        return [];
    }
}

function barajarFrases(frases) {
    const copia = [...frases];
    for (let i = copia.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
}

function generarNuevoCicloFrases(frases, ultimaUsada) {
    const barajado = barajarFrases(frases);
    if (frases.length > 1 && barajado[0] === ultimaUsada) {
        // Evita que la primera frase del ciclo nuevo repita la ultima del ciclo anterior.
        const indiceSwap = 1 + Math.floor(Math.random() * (barajado.length - 1));
        [barajado[0], barajado[indiceSwap]] = [barajado[indiceSwap], barajado[0]];
    }
    return barajado;
}

function obtenerFraseDelDia(db, frases) {
    if (!frases.length) {
        return '';
    }

    if (!db.has('fraseState').value()) {
        db.set('fraseState', { pendientes: [], ultimaUsada: '' }).write();
    }

    const estado = db.get('fraseState').value() || {};
    // Si el archivo de frases cambio (el usuario reemplazo los placeholders),
    // descartamos pendientes que ya no existen en la lista actual.
    let pendientes = Array.isArray(estado.pendientes)
        ? estado.pendientes.filter((frase) => frases.includes(frase))
        : [];

    if (pendientes.length === 0) {
        pendientes = generarNuevoCicloFrases(frases, estado.ultimaUsada || '');
    }

    const [frase, ...resto] = pendientes;
    db.set('fraseState', { pendientes: resto, ultimaUsada: frase }).write();
    return frase;
}

function elegirImagenAleatoria(directorio) {
    try {
        const archivos = fs.readdirSync(directorio).filter((nombre) => /\.(jpe?g|png|webp|gif)$/i.test(nombre));
        if (archivos.length === 0) {
            return '';
        }
        const elegido = archivos[Math.floor(Math.random() * archivos.length)];
        return path.join(directorio, elegido);
    } catch (error) {
        // Carpeta inexistente u otro error de lectura: no es un fallo real,
        // simplemente no hay imagen disponible todavia -> cae al fallback de texto.
        return '';
    }
}

async function enviarConImagenLocalYFallback(sockHolder, directorioImagenes, caption, descripcionError) {
    const rutaImagen = elegirImagenAleatoria(directorioImagenes);

    if (rutaImagen) {
        try {
            await sockHolder.sock.sendMessage(ID_GRUPO, { image: { url: rutaImagen }, caption });
            return;
        } catch (error) {
            console.error(`❌ Error enviando imagen de ${descripcionError} (${rutaImagen}), se intenta como texto plano:`, error);
        }
    }

    try {
        await sockHolder.sock.sendMessage(ID_GRUPO, { text: caption });
    } catch (error) {
        console.error(`❌ Error enviando texto de respaldo de ${descripcionError}:`, error);
    }
}

// -----------------------------------------------------
// TAREAS DEL BOT: una funcion por cada entrada configurable de botConfig
// (db.json). Cada una recibe (sockHolder, db) en vez de cerrar sobre esas
// variables, para poder reusarse tanto desde el cron como desde el
// endpoint POST /api/bot-config/probar/:tipo (server.js) sin duplicar la
// logica de armado del mensaje.
// -----------------------------------------------------

async function enviarVersiculoManana(sockHolder, db) {
    const v = VERSICULOS_MANANA[Math.floor(Math.random() * VERSICULOS_MANANA.length)];

    let bloqueFrase = '';
    try {
        db.read();
        const frases = obtenerFrasesMotivadoras();
        const frase = obtenerFraseDelDia(db, frases);
        bloqueFrase = frase ? `\n\n💡 _${frase}_` : '';
    } catch (error) {
        console.error('❌ Error obteniendo la frase motivadora del dia, se envia el versiculo sin ella:', error);
    }

    const caption = `☀️ *¡BUENOS DÍAS IGLESIA!* ☀️\n\nEmpecemos este hermoso día con Su palabra:\n\n📖 ${v}\n\n¡Que tengas un día bendecido! 🙌\n🌐 https://ipubtupiza.org${bloqueFrase}`;
    await enviarConImagenLocalYFallback(sockHolder, UPLOADS_VERSICULOS_MANANA_DIR, caption, 'versiculo de la mañana');
}

async function enviarVersiculoNoche(sockHolder) {
    const v = VERSICULOS_NOCHE[Math.floor(Math.random() * VERSICULOS_NOCHE.length)];
    const caption = `🌙 *DIOS TE BENDIGA ESTA NOCHE* 🌙\n\nAntes de descansar, recuerda:\n\n📖 ${v}\n\nConfía en Su poder para los días difíciles. ¡Descansa en Su paz! ✨`;
    await enviarConImagenLocalYFallback(sockHolder, UPLOADS_VERSICULOS_NOCHE_DIR, caption, 'versiculo de la noche');
}

async function enviarRecordatorioLimpieza(sockHolder, db) {
    db.read();
    const equipo = db.get('equipoLimpieza').value() || [];
    const fechaBaseStr = db.get('fechaBase').value() || '';
    const indiceBaseValor = Number(db.get('indiceBase').value());
    const indiceBase = Number.isInteger(indiceBaseValor) ? indiceBaseValor : 0;
    const turnoHoy = calcularTurnoLimpiezaHoy(new Date(), equipo, fechaBaseStr, indiceBase);
    if (turnoHoy) {
        await sockHolder.sock.sendMessage(ID_GRUPO, { text: `📢 *RECORDATORIO*\n\nHoy le toca la limpieza a: *${turnoHoy}*. ¡Gracias! 🙌` });
    }
}

async function enviarRecordatoriosEventosSermones(sockHolder, db) {
    return enviarRecordatoriosDiarios(db, sockHolder.sock, ID_GRUPO);
}

const TAREAS_BOT = {
    versiculoManana: enviarVersiculoManana,
    versiculoNoche: enviarVersiculoNoche,
    limpieza: enviarRecordatorioLimpieza,
    eventosSermones: enviarRecordatoriosEventosSermones
};

function construirExpresionCron(horaStr) {
    const partes = String(horaStr || '').split(':');
    const hora = Number(partes[0]);
    const minuto = Number(partes[1]);
    if (!Number.isInteger(hora) || !Number.isInteger(minuto) || hora < 0 || hora > 23 || minuto < 0 || minuto > 59) {
        return null;
    }
    return `${minuto} ${hora} * * *`;
}

function registerScheduledJobs(sockHolder, db) {
    function safeCronJob(schedule, task) {
        cron.schedule(schedule, async () => {
            try {
                await task();
            } catch (error) {
                console.error(`❌ Error en tarea programada (${schedule}):`, error);
            }
        });
    }

    // Los horarios y el activo/inactivo de estas 4 tareas se leen de
    // botConfig (db.json, editable desde el panel) UNA SOLA VEZ aqui, al
    // arrancar el proceso. node-cron no soporta cambiar el horario de un
    // job ya registrado: si alguien edita la hora o el activo desde el
    // panel, el cambio queda guardado pero NO se aplica hasta reiniciar
    // el bot (pm2 restart). No se implemento recarga en caliente de cron
    // jobs a proposito (fuera de alcance).
    db.read();
    const botConfig = db.get('botConfig').value() || {};

    Object.keys(TAREAS_BOT).forEach((clave) => {
        const config = (botConfig[clave] && typeof botConfig[clave] === 'object') ? botConfig[clave] : {};
        const activo = config.activo === undefined ? true : Boolean(config.activo);

        if (!activo) {
            // Enfoque elegido: si esta inactivo, directamente NO se registra
            // el cron (nunca se dispara), en vez de registrarlo y que el
            // callback retorne de inmediato.
            return;
        }

        const expresion = construirExpresionCron(config.hora) || construirExpresionCron(HORA_POR_DEFECTO_BOT[clave]);
        const tarea = TAREAS_BOT[clave];
        safeCronJob(expresion, () => tarea(sockHolder, db));
    });

    // Domingo Imagen (8:30 AM) - no es configurable desde el panel, queda igual.
    // Reusa la carpeta de imagenes de la manana (mismo horario/tematica).
    safeCronJob('30 8 * * 0', async () => {
        const caption = '🌅 *¡FELIZ DOMINGO!* 🌅\n\nLos esperamos hoy en los servicios. 🙏⛪\n🔗 https://ipubtupiza.org';
        await enviarConImagenLocalYFallback(sockHolder, UPLOADS_VERSICULOS_MANANA_DIR, caption, 'imagen de Domingo');
    });
}

module.exports = { iniciarBot, TAREAS_BOT, UPLOADS_VERSICULOS_MANANA_DIR, UPLOADS_VERSICULOS_NOCHE_DIR };
