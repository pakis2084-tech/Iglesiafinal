// -----------------------------------------------------
// JUEGOS DEL GRUPO (talentos, Bendicion del dia, perfil, ranking semanal).
//
// Reglas anti-ban (no relajar sin pensarlo):
// - Solo responde a comandos exactos con prefijo "." y una sola vez por comando.
// - Nunca escribe sin que lo llamen (no hay crons aca) y nunca menciona a nadie.
// - Cooldown por persona: los comandos repetidos dentro de la ventana se ignoran en silencio.
// - Solo actua si juegosConfig.activo y el chat esta en juegosConfig.grupos
//   (excepcion: .idgrupo enviado desde el propio telefono del bot).
// - Ignora mensajes que no sean 'notify' (historial/offline/los que manda el propio bot).
//
// Las fechas se calculan SIEMPRE en hora de Bolivia, nunca con la zona del
// dispositivo (el bot corre en un celular cuya zona puede estar mal).
// -----------------------------------------------------

const mensajes = require('./mensajes.js');

const ZONA_HORARIA_JUEGOS = 'America/La_Paz';
const COOLDOWN_JUEGOS_MS = 3000;
const ALIAS_MIN = 3;
const ALIAS_MAX = 16;
const TALENTOS_BENDICION_BASE = 10;
const TALENTOS_POR_DIA_RACHA = 2;
const MAX_DIAS_BONUS_RACHA = 7;
const TOP_RANKING = 5;

// Umbrales por talentos TOTALES (no semanales). Ordenados de menor a mayor.
const NIVELES = [
    { nombre: 'Semilla', desde: 0 },
    { nombre: 'Brote', desde: 100 },
    { nombre: 'Árbol', desde: 300 },
    { nombre: 'Fruto', desde: 700 },
    { nombre: 'Columna', desde: 1500 }
];

const formateadorFechaBolivia = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA_JUEGOS,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});

function fechaBolivia(fecha) {
    const partes = {};
    formateadorFechaBolivia.formatToParts(fecha).forEach(({ type, value }) => {
        partes[type] = value;
    });
    return `${partes.year}-${partes.month}-${partes.day}`;
}

function sumarDiasAFechaStr(fechaStr, dias) {
    const [anio, mes, dia] = fechaStr.split('-').map(Number);
    const fecha = new Date(Date.UTC(anio, mes - 1, dia + dias));
    return fecha.toISOString().slice(0, 10);
}

// Semana ISO 8601 ("2026-W41") de una fecha YYYY-MM-DD ya en hora Bolivia.
function semanaIsoDeFecha(fechaStr) {
    const [anio, mes, dia] = fechaStr.split('-').map(Number);
    const fecha = new Date(Date.UTC(anio, mes - 1, dia));
    const diaSemana = (fecha.getUTCDay() + 6) % 7; // lunes = 0
    fecha.setUTCDate(fecha.getUTCDate() - diaSemana + 3); // jueves de esa semana
    const anioIso = fecha.getUTCFullYear();
    const semana = 1 + Math.floor((fecha - Date.UTC(anioIso, 0, 1)) / 86400000 / 7);
    return `${anioIso}-W${String(semana).padStart(2, '0')}`;
}

function nivelDeTalentos(talentos) {
    let indice = 0;
    NIVELES.forEach((nivel, i) => {
        if (talentos >= nivel.desde) indice = i;
    });
    return { actual: NIVELES[indice], siguiente: NIVELES[indice + 1] || null };
}

function talentosPorBendicion(racha) {
    return TALENTOS_BENDICION_BASE + TALENTOS_POR_DIA_RACHA * Math.min(racha, MAX_DIAS_BONUS_RACHA);
}

function normalizarAlias(texto) {
    return String(texto || '')
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim();
}

function claveAlias(alias) {
    return alias.toLocaleLowerCase('es');
}

// Devuelve un codigo de error ('largo' | 'caracteres' | 'telefono') o '' si
// el alias es valido. El texto lo arma mensajes.aliasInvalido.
function validarAlias(alias) {
    const largo = [...alias].length;
    if (largo < ALIAS_MIN || largo > ALIAS_MAX) {
        return 'largo';
    }
    if (!/^[\p{L}\p{N} _.-]+$/u.test(alias)) {
        return 'caracteres';
    }
    // Se quitan los separadores para que "71-234-567" tampoco pase.
    if (/\d{7,}/.test(alias.replace(/[ _.-]/g, ''))) {
        return 'telefono';
    }
    return '';
}

function extraerTexto(message) {
    if (!message) return '';
    if (message.conversation) return message.conversation;
    if (message.extendedTextMessage) return message.extendedTextMessage.text || '';
    if (message.ephemeralMessage) {
        const interno = message.ephemeralMessage.message || {};
        return interno.conversation || (interno.extendedTextMessage && interno.extendedTextMessage.text) || '';
    }
    return '';
}

// Separa "comando argumento". Devuelve null si no es un comando conocido
// o si un comando sin argumentos trae texto extra (".perfil hola" se ignora).
const COMANDOS_SIN_ARGUMENTO = {
    '.perfil': 'perfil',
    '.bendicion': 'bendicion',
    '.bendición': 'bendicion',
    '.ranking': 'ranking',
    '.salir': 'salir',
    '.ayuda': 'ayuda',
    '.idgrupo': 'idgrupo'
};

function parsearComando(texto) {
    const limpio = String(texto || '').trim();
    if (!limpio.startsWith('.')) return null;

    const [primero, ...resto] = limpio.split(/\s+/);
    const nombre = primero.toLowerCase();
    const argumento = resto.join(' ');

    if (nombre === '.unirme') {
        return { comando: 'unirme', argumento };
    }
    if (COMANDOS_SIN_ARGUMENTO[nombre] && !argumento) {
        return { comando: COMANDOS_SIN_ARGUMENTO[nombre], argumento: '' };
    }
    return null;
}

function leerJuegosConfig(db) {
    const config = db.get('juegosConfig').value();
    if (!config || typeof config !== 'object') {
        return { activo: false, grupos: [] };
    }
    return {
        activo: config.activo === true,
        grupos: Array.isArray(config.grupos) ? config.grupos : []
    };
}

function obtenerJugadores(db) {
    if (!db.has('jugadores').value()) {
        db.set('jugadores', []).write();
    }
    return db.get('jugadores');
}

function semanaVigente(jugador, semanaActual) {
    return jugador.semana && jugador.semana.id === semanaActual ? jugador.semana.talentos : 0;
}

// Ranking de competencia: empates comparten posicion (1, 2, 2, 4).
// Solo entran quienes sumaron talentos en la semana actual.
function calcularRanking(jugadores, semanaActual) {
    const conPuntos = jugadores
        .map((jugador) => ({ id: jugador.id, alias: jugador.alias, talentos: semanaVigente(jugador, semanaActual) }))
        .filter((fila) => fila.talentos > 0)
        .sort((a, b) => b.talentos - a.talentos || claveAlias(a.alias).localeCompare(claveAlias(b.alias), 'es'));

    let posicionAnterior = 0;
    return conPuntos.map((fila, indice) => {
        const posicion = indice > 0 && conPuntos[indice - 1].talentos === fila.talentos ? posicionAnterior : indice + 1;
        posicionAnterior = posicion;
        return { ...fila, posicion };
    });
}

function crearJuegos(opciones = {}) {
    const versiculos = Array.isArray(opciones.versiculos) ? opciones.versiculos : [];
    const ahora = typeof opciones.ahora === 'function' ? opciones.ahora : () => new Date();
    const cooldownMs = Number.isFinite(opciones.cooldownMs) ? opciones.cooldownMs : COOLDOWN_JUEGOS_MS;
    const ultimoComandoPorPersona = new Map();

    function enCooldown(id, ahoraMs) {
        const ultimo = ultimoComandoPorPersona.get(id);
        if (ultimo !== undefined && ahoraMs - ultimo < cooldownMs) {
            return true;
        }
        ultimoComandoPorPersona.set(id, ahoraMs);
        if (ultimoComandoPorPersona.size > 1000) {
            for (const [clave, momento] of ultimoComandoPorPersona) {
                if (ahoraMs - momento >= cooldownMs) ultimoComandoPorPersona.delete(clave);
            }
        }
        return false;
    }

    // Mismo versiculo para todo el grupo durante el dia (sin azar).
    function versiculoDelDia(hoy) {
        if (versiculos.length === 0) return '';
        const dias = Math.floor(Date.parse(`${hoy}T00:00:00Z`) / 86400000);
        return versiculos[dias % versiculos.length];
    }

    // Reinicio perezoso de la semana: se hace al primer uso de una semana nueva.
    function asegurarSemana(db, jugador, semanaActual) {
        if (jugador.semana && jugador.semana.id === semanaActual) return jugador;
        return obtenerJugadores(db).find({ id: jugador.id }).assign({ semana: { id: semanaActual, talentos: 0 } }).write();
    }

    function cmdUnirme(db, id, jugador, argumento) {
        if (jugador) {
            return mensajes.yaRegistrado(jugador.alias);
        }
        const alias = normalizarAlias(argumento);
        if (!alias) {
            return mensajes.aliasFaltante();
        }
        const codigoError = validarAlias(alias);
        if (codigoError) return mensajes.aliasInvalido(codigoError, ALIAS_MIN, ALIAS_MAX);

        const clave = claveAlias(alias);
        const repetido = obtenerJugadores(db).value().some((otro) => claveAlias(otro.alias) === clave);
        if (repetido) {
            return mensajes.aliasEnUso(alias);
        }

        const momento = ahora();
        obtenerJugadores(db).push({
            id,
            alias,
            talentos: 0,
            racha: 0,
            mejorRacha: 0,
            ultimaBendicion: '',
            semana: { id: semanaIsoDeFecha(fechaBolivia(momento)), talentos: 0 },
            creadoEn: momento.toISOString()
        }).write();
        return mensajes.bienvenida(alias, nivelDeTalentos(0).actual.nombre);
    }

    function cmdBendicion(db, jugador, hoy, semanaActual) {
        if (jugador.ultimaBendicion === hoy) {
            return mensajes.bendicionYaRecibida(jugador.racha);
        }

        const ayer = sumarDiasAFechaStr(hoy, -1);
        const racha = jugador.ultimaBendicion === ayer ? jugador.racha + 1 : 1;
        const ganados = talentosPorBendicion(racha);
        const actualizado = obtenerJugadores(db).find({ id: jugador.id }).assign({
            talentos: jugador.talentos + ganados,
            racha,
            mejorRacha: Math.max(jugador.mejorRacha || 0, racha),
            ultimaBendicion: hoy,
            semana: { id: semanaActual, talentos: semanaVigente(jugador, semanaActual) + ganados }
        }).write();

        return mensajes.bendicion({
            alias: actualizado.alias,
            versiculo: versiculoDelDia(hoy),
            ganados,
            total: actualizado.talentos,
            racha
        });
    }

    function cmdPerfil(db, jugador, semanaActual) {
        const { actual, siguiente } = nivelDeTalentos(jugador.talentos);
        const ranking = calcularRanking(obtenerJugadores(db).value(), semanaActual);
        const fila = ranking.find((item) => item.id === jugador.id);
        return mensajes.perfil({
            alias: jugador.alias,
            talentosTotales: jugador.talentos,
            racha: jugador.racha,
            mejorRacha: jugador.mejorRacha,
            nivel: actual.nombre,
            siguienteNivel: siguiente,
            posicion: fila ? { posicion: fila.posicion, total: ranking.length, talentos: fila.talentos } : null
        });
    }

    function cmdRanking(db, jugador, semanaActual) {
        const ranking = calcularRanking(obtenerJugadores(db).value(), semanaActual);
        return mensajes.ranking({
            numeroSemana: Number(semanaActual.split('-W')[1]),
            filas: ranking.slice(0, TOP_RANKING),
            total: ranking.length,
            miFila: jugador ? ranking.find((item) => item.id === jugador.id) || null : null,
            registrado: Boolean(jugador)
        });
    }

    function cmdSalir(db, jugador) {
        obtenerJugadores(db).remove({ id: jugador.id }).write();
        return mensajes.despedida(jugador.alias);
    }

    function responderComando(db, id, comando, argumento) {
        const momento = ahora();
        const hoy = fechaBolivia(momento);
        const semanaActual = semanaIsoDeFecha(hoy);
        let jugador = obtenerJugadores(db).find({ id }).value() || null;

        if (comando === 'ayuda') return mensajes.ayuda();
        if (comando === 'unirme') return cmdUnirme(db, id, jugador, argumento);
        if (comando === 'ranking') return cmdRanking(db, jugador, semanaActual);

        if (!jugador) return mensajes.noRegistrado();
        if (comando === 'salir') return cmdSalir(db, jugador);

        jugador = asegurarSemana(db, jugador, semanaActual);
        if (comando === 'perfil') return cmdPerfil(db, jugador, semanaActual);
        if (comando === 'bendicion') return cmdBendicion(db, jugador, hoy, semanaActual);
        return '';
    }

    // Devuelve true si el mensaje era un comando de juegos que este modulo
    // reclama (aunque lo haya ignorado por cooldown), para que bot.js no lo
    // pase ademas al menu numerico (".unirme hola" no debe abrir el menu).
    async function manejarMensaje(sock, db, msg, tipoUpsert) {
        if (!msg || !msg.key || !msg.message) return false;
        if (tipoUpsert !== undefined && tipoUpsert !== 'notify') return false;

        const chat = msg.key.remoteJid;
        if (!chat) return false;

        const parseado = parsearComando(extraerTexto(msg.message));
        if (!parseado) return false;

        if (parseado.comando === 'idgrupo') {
            if (!msg.key.fromMe) return false;
            await sock.sendMessage(chat, { text: mensajes.idGrupo(chat) }, { quoted: msg });
            return true;
        }

        // Todo mensaje propio del bot se ignora (incluye sus propias respuestas).
        if (msg.key.fromMe) return false;

        db.read();
        const config = leerJuegosConfig(db);
        if (!config.activo || !config.grupos.includes(chat)) return false;

        const id = msg.key.participant || msg.key.remoteJid;
        if (enCooldown(id, ahora().getTime())) return true;

        const texto = responderComando(db, id, parseado.comando, parseado.argumento);
        if (texto) {
            await sock.sendMessage(chat, { text: texto }, { quoted: msg });
        }
        return true;
    }

    return { manejarMensaje };
}

module.exports = {
    crearJuegos,
    fechaBolivia,
    semanaIsoDeFecha,
    sumarDiasAFechaStr,
    talentosPorBendicion,
    nivelDeTalentos,
    validarAlias,
    parsearComando,
    NIVELES
};
