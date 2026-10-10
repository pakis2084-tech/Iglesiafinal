// -----------------------------------------------------
// JUEGOS DEL GRUPO (talentos, Bendicion del dia, perfil, ranking semanal y
// preguntas con tiempo limite: .trivia / .versiculo / .personaje / .r).
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

const fs = require('fs');
const mensajes = require('./mensajes.js');

const ZONA_HORARIA_JUEGOS = 'America/La_Paz';
const COOLDOWN_JUEGOS_MS = 3000;
const ALIAS_MIN = 3;
const ALIAS_MAX = 16;
const TALENTOS_BENDICION_BASE = 10;
const TALENTOS_POR_DIA_RACHA = 2;
const MAX_DIAS_BONUS_RACHA = 7;
const TOP_RANKING = 5;

// ---------- Preguntas con tiempo limite ----------
// Talentos por acierto segun el tipo de pregunta (sin bonus por rapidez).
const TALENTOS_PREGUNTA = { completar: 15, personaje: 20, dato: 10 };
const TIPOS_PREGUNTA = Object.keys(TALENTOS_PREGUNTA);
// Tiempo anunciado en la pregunta. Se mide con el reloj del bot desde que el
// mensaje de la pregunta termino de enviarse.
const LIMITE_PREGUNTA_MS = 15000;
// Margen extra (no anunciado) para la latencia de WhatsApp: una respuesta
// cuenta si llega hasta LIMITE + GRACIA. El cierre se programa en ese momento.
const GRACIA_RESPUESTA_MS = 1000;
// Preguntas premiadas por persona y por dia (hora Bolivia). Pasado el tope
// se puede seguir jugando, pero sin talentos.
const TOPE_PREGUNTAS_PREMIADAS_DIA = 5;
// Comando -> tipo de pregunta (null = cualquier tipo).
const COMANDOS_PREGUNTA = { trivia: null, versiculo: 'completar', personaje: 'personaje' };

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
    '.idgrupo': 'idgrupo',
    '.trivia': 'trivia',
    '.versiculo': 'versiculo',
    '.versículo': 'versiculo',
    '.personaje': 'personaje'
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
    if (nombre === '.r') {
        return argumento ? { comando: 'responder', argumento } : null;
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

// ---------- Banco de preguntas ----------

// Minusculas, sin tildes (tambien ñ -> n), sin signos de puntuacion,
// espacios colapsados. Se aplica a lo que escribe la persona Y a las
// respuestas del banco, asi "3.000" y "3000" son lo mismo.
function normalizarRespuesta(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function textoNoVacio(valor) {
    return typeof valor === 'string' && valor.trim() !== '';
}

// Devuelve '' si la pregunta es valida, o el motivo si no lo es.
function validarPregunta(pregunta) {
    if (!pregunta || typeof pregunta !== 'object') return 'no es un objeto';
    if (!textoNoVacio(pregunta.id)) return 'falta "id"';
    if (!TIPOS_PREGUNTA.includes(pregunta.tipo)) return `tipo "${pregunta.tipo}" no valido`;
    if (!textoNoVacio(pregunta.tema)) return 'falta "tema"';
    if (!textoNoVacio(pregunta.pregunta)) return 'falta "pregunta"';
    if (!textoNoVacio(pregunta.correcta)) return 'falta "correcta"';
    if (!textoNoVacio(pregunta.referencia)) return 'falta "referencia"';

    const huecos = pregunta.pregunta.match(/_+/g) || [];
    if (pregunta.tipo === 'completar' && (huecos.length !== 1 || huecos[0] !== '____')) {
        return 'una pregunta "completar" debe tener exactamente un "____"';
    }
    if (pregunta.tipo !== 'completar' && huecos.length > 0) {
        return 'solo las preguntas "completar" llevan "____"';
    }

    if (!Array.isArray(pregunta.respuestas) || pregunta.respuestas.length === 0) return 'sin "respuestas"';
    const normalizadas = pregunta.respuestas.map(normalizarRespuesta);
    if (normalizadas.some((respuesta) => !respuesta)) return 'hay una respuesta vacia';
    if (!normalizadas.includes(normalizarRespuesta(pregunta.correcta))) return '"correcta" no esta en "respuestas"';
    return '';
}

// Valida el contenido ya parseado. Las preguntas invalidas o con id repetido
// se descartan una por una (no apagan el juego). Devuelve preguntas: null si
// el banco entero no sirve (estructura rota o ninguna pregunta valida).
function validarBanco(datos) {
    if (!datos || typeof datos !== 'object' || !Array.isArray(datos.preguntas)) {
        return { preguntas: null, errores: ['el archivo no tiene una lista "preguntas"'] };
    }

    const errores = [];
    const ids = new Set();
    const preguntas = [];
    datos.preguntas.forEach((pregunta, indice) => {
        const motivo = validarPregunta(pregunta);
        const etiqueta = pregunta && textoNoVacio(pregunta.id) ? pregunta.id : `#${indice + 1}`;
        if (motivo) {
            errores.push(`${etiqueta}: ${motivo}`);
            return;
        }
        if (ids.has(pregunta.id)) {
            errores.push(`${etiqueta}: id repetido`);
            return;
        }
        ids.add(pregunta.id);
        preguntas.push({
            id: pregunta.id,
            tipo: pregunta.tipo,
            pregunta: pregunta.pregunta,
            correcta: pregunta.correcta,
            referencia: pregunta.referencia,
            respuestas: new Set(pregunta.respuestas.map(normalizarRespuesta))
        });
    });

    if (preguntas.length === 0) {
        errores.push('ninguna pregunta valida');
        return { preguntas: null, errores };
    }
    return { preguntas, errores };
}

// Nunca lanza: si el archivo falta o no sirve, loguea y devuelve null, y
// crearJuegos deshabilita solo los comandos de preguntas.
function cargarBancoPreguntas(ruta, log = console) {
    let datos;
    try {
        datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    } catch (error) {
        log.error(`❌ Banco de preguntas no disponible (${ruta}): ${error.message}. Los comandos de preguntas quedan deshabilitados.`);
        return null;
    }

    const { preguntas, errores } = validarBanco(datos);
    if (!preguntas) {
        log.error(`❌ Banco de preguntas invalido (${ruta}): ${errores.join('; ')}. Los comandos de preguntas quedan deshabilitados.`);
        return null;
    }
    errores.forEach((errorPregunta) => log.warn(`⚠️ Pregunta descartada del banco: ${errorPregunta}`));
    return preguntas;
}

function crearJuegos(opciones = {}) {
    const versiculos = Array.isArray(opciones.versiculos) ? opciones.versiculos : [];
    const ahora = typeof opciones.ahora === 'function' ? opciones.ahora : () => new Date();
    const cooldownMs = Number.isFinite(opciones.cooldownMs) ? opciones.cooldownMs : COOLDOWN_JUEGOS_MS;
    const ultimoComandoPorPersona = new Map();
    const banco = Array.isArray(opciones.bancoPreguntas) && opciones.bancoPreguntas.length > 0 ? opciones.bancoPreguntas : null;
    const preguntasPorId = new Map((banco || []).map((pregunta) => [pregunta.id, pregunta]));
    const aleatorio = typeof opciones.aleatorio === 'function' ? opciones.aleatorio : Math.random;
    const programar = typeof opciones.programar === 'function' ? opciones.programar : (fn, ms) => setTimeout(fn, ms);
    // El cierre llega 15 s despues: si hubo una reconexion en el medio, el
    // socket vigente es otro. bot.js pasa obtenerSock; si no, se usa el original.
    const obtenerSock = typeof opciones.obtenerSock === 'function' ? opciones.obtenerSock : null;
    // Pregunta activa por grupo. Vive solo en memoria: si el bot se reinicia, se pierde.
    const preguntasActivas = new Map();

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

    // ---------- Mazo por grupo (db.json: juegosMazos[jid] = { ids, indice }) ----------

    function mezclar(lista) {
        const copia = [...lista];
        for (let i = copia.length - 1; i > 0; i -= 1) {
            const j = Math.floor(aleatorio() * (i + 1));
            [copia[i], copia[j]] = [copia[j], copia[i]];
        }
        return copia;
    }

    // Saca la proxima pregunta sin repetir hasta agotar el mazo. Las preguntas
    // nuevas del JSON se mezclan en la parte que todavia no salio; las que ya
    // no existen se saltean. Con filtro de tipo, se trae la proxima de ese tipo
    // a la posicion actual; si no queda ninguna, se re-mezcla el mazo entero.
    function sacarPregunta(db, chat, tipo) {
        const ruta = ['juegosMazos', chat];
        const guardado = db.get(ruta).value();
        const valido = guardado && Array.isArray(guardado.ids) && Number.isInteger(guardado.indice) && guardado.indice >= 0;
        let ids = valido ? guardado.ids : [];
        let indice = valido ? Math.min(guardado.indice, ids.length) : 0;

        const vistos = ids.slice(0, indice).filter((id) => preguntasPorId.has(id));
        let pendientes = ids.slice(indice).filter((id) => preguntasPorId.has(id));
        const enMazo = new Set(ids);
        const nuevas = [...preguntasPorId.keys()].filter((id) => !enMazo.has(id));
        if (nuevas.length > 0) {
            pendientes = mezclar([...pendientes, ...nuevas]);
        }
        ids = [...vistos, ...pendientes];
        indice = vistos.length;

        const coincide = (id) => !tipo || preguntasPorId.get(id).tipo === tipo;
        let posicion = ids.findIndex((id, i) => i >= indice && coincide(id));
        if (posicion === -1) {
            ids = mezclar([...preguntasPorId.keys()]);
            indice = 0;
            posicion = ids.findIndex(coincide);
            if (posicion === -1) return null; // no hay preguntas de ese tipo en el banco
        }

        [ids[indice], ids[posicion]] = [ids[posicion], ids[indice]];
        const pregunta = preguntasPorId.get(ids[indice]);
        db.set(ruta, { ids, indice: indice + 1 }).write();
        return pregunta;
    }

    // ---------- Pregunta activa ----------

    async function iniciarPregunta(sock, db, chat, jugador, comando, msg) {
        if (!jugador) {
            await sock.sendMessage(chat, { text: mensajes.noRegistrado() }, { quoted: msg });
            return;
        }
        if (preguntasActivas.has(chat)) {
            await sock.sendMessage(chat, { text: mensajes.preguntaEnCurso() }, { quoted: msg });
            return;
        }

        const pregunta = sacarPregunta(db, chat, COMANDOS_PREGUNTA[comando]);
        if (!pregunta) return;

        // Se marca ANTES del await para que nadie pueda pedir otra mientras se envia.
        const activa = {
            pregunta,
            estado: 'enviando',
            inicioMs: null,
            intentos: new Set(),
            aciertos: [],
            recordados: new Set()
        };
        preguntasActivas.set(chat, activa);

        try {
            await sock.sendMessage(chat, {
                text: mensajes.pregunta({
                    tipo: pregunta.tipo,
                    texto: pregunta.pregunta,
                    segundos: LIMITE_PREGUNTA_MS / 1000,
                    premio: TALENTOS_PREGUNTA[pregunta.tipo]
                })
            }, { quoted: msg });
        } catch (error) {
            // Si no se pudo mandar, no queda una pregunta "fantasma" bloqueando el grupo.
            if (preguntasActivas.get(chat) === activa) preguntasActivas.delete(chat);
            throw error;
        }

        // El reloj arranca recien ahora, con el mensaje ya enviado.
        activa.inicioMs = ahora().getTime();
        activa.estado = 'abierta';
        // Devuelve la promesa para que los tests puedan esperar el cierre.
        programar(() => cerrarPregunta(sock, db, chat, activa).catch((error) => {
            console.error('❌ Error cerrando la pregunta de juegos:', error);
        }), LIMITE_PREGUNTA_MS + GRACIA_RESPUESTA_MS);
    }

    // Devuelve el texto a responder (solo el recordatorio de .unirme) o ''.
    // Aciertos y errores NO generan respuesta: todo se ve en el cierre.
    function registrarRespuesta(db, chat, id, jugador, texto) {
        const activa = preguntasActivas.get(chat);
        if (!activa || activa.estado !== 'abierta') return '';

        if (!jugador) {
            if (activa.recordados.has(id)) return '';
            activa.recordados.add(id);
            return mensajes.recordatorioUnirme();
        }

        if (activa.intentos.has(id)) return '';
        activa.intentos.add(id);

        const transcurrido = ahora().getTime() - activa.inicioMs;
        if (transcurrido > LIMITE_PREGUNTA_MS + GRACIA_RESPUESTA_MS) return '';
        if (activa.pregunta.respuestas.has(normalizarRespuesta(texto))) {
            activa.aciertos.push(id);
        }
        return '';
    }

    async function cerrarPregunta(sockOriginal, db, chat, activa) {
        if (preguntasActivas.get(chat) !== activa) return;
        preguntasActivas.delete(chat);

        db.read();
        const hoy = fechaBolivia(ahora());
        const semanaActual = semanaIsoDeFecha(hoy);
        const premio = TALENTOS_PREGUNTA[activa.pregunta.tipo];
        const acertaron = [];
        const llegaronAlTope = [];

        activa.aciertos.forEach((id) => {
            let jugador = obtenerJugadores(db).find({ id }).value();
            if (!jugador) return; // hizo .salir mientras corria la pregunta
            jugador = asegurarSemana(db, jugador, semanaActual);

            const dia = jugador.preguntasDia && jugador.preguntasDia.fecha === hoy
                ? jugador.preguntasDia
                : { fecha: hoy, premiadas: 0, avisado: false };

            if (dia.premiadas < TOPE_PREGUNTAS_PREMIADAS_DIA) {
                obtenerJugadores(db).find({ id }).assign({
                    talentos: jugador.talentos + premio,
                    semana: { id: semanaActual, talentos: semanaVigente(jugador, semanaActual) + premio },
                    preguntasDia: { ...dia, premiadas: dia.premiadas + 1 }
                }).write();
            } else if (!dia.avisado) {
                llegaronAlTope.push(jugador.alias);
                obtenerJugadores(db).find({ id }).assign({ preguntasDia: { ...dia, avisado: true } }).write();
            }
            acertaron.push(jugador.alias);
        });

        const sock = (obtenerSock && obtenerSock()) || sockOriginal;
        await sock.sendMessage(chat, {
            text: mensajes.cierrePregunta({
                correcta: activa.pregunta.correcta,
                referencia: activa.pregunta.referencia,
                acertaron,
                premio,
                llegaronAlTope,
                tope: TOPE_PREGUNTAS_PREMIADAS_DIA
            })
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
        const esDePreguntas = parseado.comando === 'responder' || parseado.comando in COMANDOS_PREGUNTA;

        if (esDePreguntas) {
            // Sin banco valido, estos comandos se reclaman en silencio (para que
            // ".r hola" no abra el menu) y el resto del juego sigue igual.
            if (!banco) return true;
            const jugador = obtenerJugadores(db).find({ id }).value() || null;

            // .r no usa ni activa el cooldown: ya tiene un solo intento por pregunta.
            if (parseado.comando === 'responder') {
                const aviso = registrarRespuesta(db, chat, id, jugador, parseado.argumento);
                if (aviso) await sock.sendMessage(chat, { text: aviso }, { quoted: msg });
                return true;
            }

            if (enCooldown(id, ahora().getTime())) return true;
            await iniciarPregunta(sock, db, chat, jugador, parseado.comando, msg);
            return true;
        }

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
    cargarBancoPreguntas,
    validarBanco,
    validarPregunta,
    normalizarRespuesta,
    TALENTOS_PREGUNTA,
    LIMITE_PREGUNTA_MS,
    GRACIA_RESPUESTA_MS,
    TOPE_PREGUNTAS_PREMIADAS_DIA,
    fechaBolivia,
    semanaIsoDeFecha,
    sumarDiasAFechaStr,
    talentosPorBendicion,
    nivelDeTalentos,
    validarAlias,
    parsearComando,
    NIVELES
};
