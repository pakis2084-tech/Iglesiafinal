const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createApp, hashPassword, migratePermisos } = require('../server');
const {
    crearJuegos,
    cargarBancoPreguntas,
    validarBanco,
    validarPregunta,
    normalizarRespuesta,
    TALENTOS_PREGUNTA
} = require('../juegos');
const BANCO_REAL_FILE = path.join(__dirname, '..', 'preguntas-doctrina.json');

const GRUPO_JUEGOS = '120363000000000001@g.us';

// Sock simulado: guarda cada mensaje que el bot intentaria mandar.
function crearSockSimulado() {
    const enviados = [];
    return {
        enviados,
        async sendMessage(jid, contenido, opciones) {
            enviados.push({ jid, texto: contenido.text, opciones });
        }
    };
}

function crearMsgJuego(texto, { autor = 'ana@lid', chat = GRUPO_JUEGOS, fromMe = false } = {}) {
    return {
        key: { remoteJid: chat, participant: chat.endsWith('@g.us') ? autor : undefined, fromMe, id: Math.random().toString(36).slice(2) },
        message: { conversation: texto }
    };
}

// Arma un entorno de juegos con un reloj controlable (ISO UTC). Los cierres
// de pregunta no usan setTimeout: quedan en `timers` y se disparan con cerrar().
function crearEntornoJuegos(db, inicioIso, opciones = {}) {
    const reloj = { ahora: new Date(inicioIso) };
    const timers = [];
    let semilla = 12345;
    const juegos = crearJuegos({
        versiculos: ['Verso A', 'Verso B'],
        ahora: () => reloj.ahora,
        bancoPreguntas: opciones.banco === undefined ? null : opciones.banco,
        aleatorio: () => {
            semilla = (semilla * 1103515245 + 12345) % 2147483648;
            return semilla / 2147483648;
        },
        programar: (fn, ms) => timers.push({ fn, ms })
    });
    const sock = opciones.sock || crearSockSimulado();
    async function enviar(texto, opciones) {
        const antes = sock.enviados.length;
        const reclamado = await juegos.manejarMensaje(sock, db, crearMsgJuego(texto, opciones), 'notify');
        const nuevos = sock.enviados.slice(antes);
        assert.ok(nuevos.length <= 1, 'nunca mas de una respuesta por comando');
        if (nuevos[0]) verificarEstilo(nuevos[0].texto, { esIdGrupo: texto === '.idgrupo' });
        return { reclamado, respuesta: nuevos[0] ? nuevos[0].texto : null };
    }
    function avanzar(ms) {
        reloj.ahora = new Date(reloj.ahora.getTime() + ms);
    }
    function irA(iso) {
        reloj.ahora = new Date(iso);
    }
    // Dispara el cierre pendiente y devuelve el mensaje que manda el bot.
    async function cerrar() {
        assert.equal(timers.length, 1, 'debe haber exactamente un cierre programado');
        const antes = sock.enviados.length;
        await timers.shift().fn();
        const nuevos = sock.enviados.slice(antes);
        assert.equal(nuevos.length, 1, 'el cierre manda exactamente un mensaje');
        assert.equal(nuevos[0].opciones, undefined, 'el cierre no cita ni menciona a nadie');
        verificarEstilo(nuevos[0].texto);
        return nuevos[0].texto;
    }
    return { reloj, sock, timers, juegos, enviar, avanzar, irA, cerrar };
}

// Reglas de estilo de mensajes.js que se verifican en CADA respuesta de los tests.
const EMOJIS_PERMITIDOS = new Set(['✦', '✿', '✝', '🕊', '📖', '🌱', '🔥', '🏆', '🥇', '🥈', '🥉', '⏳']);
function verificarEstilo(texto, { esIdGrupo = false } = {}) {
    const lineas = texto.split('\n');
    assert.ok(lineas.length <= 8, `mas de 8 lineas:\n${texto}`);
    if (!esIdGrupo) {
        assert.ok(!texto.includes('@'), `no debe haber ids ni menciones:\n${texto}`);
    }
    lineas.forEach((linea) => {
        const emojis = linea.match(/\p{Extended_Pictographic}/gu) || [];
        emojis.forEach((emoji) => assert.ok(EMOJIS_PERMITIDOS.has(emoji), `emoji no permitido ${emoji} en: ${linea}`));
        assert.ok(emojis.length <= 1, `mas de un emoji en: ${linea}`);
    });
}

// Banco chico para los tests de mecanica (el real se valida aparte).
const PREGUNTAS_TEST = [
    { id: 'c1', tipo: 'completar', tema: 't', pregunta: 'Yo y el Padre ____ somos.', correcta: 'uno', respuestas: ['uno'], referencia: 'Juan 10:30' },
    { id: 'c2', tipo: 'completar', tema: 't', pregunta: 'Un Señor, una fe, un ____.', correcta: 'bautismo', respuestas: ['bautismo'], referencia: 'Efesios 4:5' },
    { id: 'p1', tipo: 'personaje', tema: 't', pregunta: '¿Quién exclamó: «¡Señor mío, y Dios mío!»?', correcta: 'Tomás', respuestas: ['tomas'], referencia: 'Juan 20:28' },
    { id: 'd1', tipo: 'dato', tema: 't', pregunta: '¿Qué significa «Emanuel»?', correcta: 'Dios con nosotros', respuestas: ['dios con nosotros'], referencia: 'Mateo 1:23' }
];
function bancoTest(ids) {
    const fuente = ids ? PREGUNTAS_TEST.filter((p) => ids.includes(p.id)) : PREGUNTAS_TEST;
    return validarBanco({ preguntas: fuente }).preguntas;
}

async function registrarJugadores(j, aliases) {
    for (const alias of aliases) {
        await j.enviar(`.unirme ${alias}`, { autor: `${alias.toLowerCase()}@lid` });
    }
}

function ultimaPreguntaDelMazo(db) {
    const mazo = db.get(['juegosMazos', GRUPO_JUEGOS]).value();
    return mazo.ids[mazo.indice - 1];
}

function activarJuegos(db) {
    db.set('juegosConfig', { activo: true, grupos: [GRUPO_JUEGOS] }).write();
}

async function requestJson(baseUrl, route, options = {}, cookie = '') {
    const headers = { ...(options.headers || {}) };
    if (cookie) {
        headers.Cookie = cookie;
    }

    const response = await fetch(`${baseUrl}${route}`, {
        ...options,
        headers
    });

    const responseText = await response.text();
    let data = null;

    try {
        data = responseText ? JSON.parse(responseText) : null;
    } catch (error) {
        data = responseText;
    }

    const setCookie = response.headers.get('set-cookie');

    return {
        response,
        data,
        cookie: setCookie ? setCookie.split(';')[0] : '',
        setCookie
    };
}

async function withTestServer(run, appOptions = {}) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ipub-sec-'));
    const dbFile = path.join(tempRoot, 'db.json');
    const uploadsDir = path.join(tempRoot, 'uploads');

    fs.writeFileSync(dbFile, JSON.stringify({
        usuarios: [],
        sermones: [],
        eventos: [],
        mensajes: []
    }, null, 2));

    const { app, db } = createApp({
        dbFile,
        uploadsDir,
        seedAdminPassword: 'Admin123!',
        sessionSecret: 'test-session-secret',
        ...appOptions
    });

    db.get('usuarios')
        .push({
            usuario: 'jovenes',
            passwordHash: hashPassword('Editor123!'),
            rol: 'editor'
        })
        .push({
            usuario: 'damas',
            passwordHash: hashPassword('Dorcas123!'),
            rol: 'damas_admin'
        })
        .write();

    // Los usuarios de arriba se agregan DESPUES de createApp(), que es donde
    // corre migratePermisos() en un arranque real. Se vuelve a correr para
    // que estos usuarios de prueba tengan `permisos`, igual que tendria
    // cualquier usuario real que ya existiera en db.json antes del deploy.
    migratePermisos(db);

    const server = await new Promise((resolve) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
        await run({ baseUrl, db, uploadsDir });
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });

        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

async function runTest(name, fn, appOptions = {}) {
    try {
        await withTestServer(fn, appOptions);
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}`);
        console.error(error);
        process.exitCode = 1;
    }
}

async function main() {
    await runTest('editor puede gestionar contenido pero no mensajes privados', async ({ baseUrl }) => {
        const login = await requestJson(baseUrl, '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario: 'jovenes', password: 'Editor123!' })
        });

        assert.equal(login.response.status, 200);
        assert.equal(login.data.rol, 'editor');
        assert.ok(login.cookie);

        const sermon = await requestJson(baseUrl, '/api/sermones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo: 'Mensaje de prueba',
                predicador: 'Pastor Test',
                fecha: '2026-03-18',
                youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                descripcion: 'Contenido valido'
            })
        }, login.cookie);

        assert.equal(sermon.response.status, 200);
        assert.equal(sermon.data.success, true);

        const messages = await requestJson(baseUrl, '/api/mensajes', {}, login.cookie);
        assert.equal(messages.response.status, 403);
    });

    await runTest('mensajes y campos peligrosos se sanitizan antes de almacenarse', async ({ baseUrl }) => {
        const createMessage = await requestJson(baseUrl, '/api/mensajes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nombre: '<img src=x onerror=alert(1)>Sonia',
                contacto: 'sonia@example.com',
                mensaje: '<script>alert(1)</script>Hola iglesia'
            })
        });

        assert.equal(createMessage.response.status, 200);

        const adminLogin = await requestJson(baseUrl, '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario: 'admin', password: 'Admin123!' })
        });

        const messages = await requestJson(baseUrl, '/api/mensajes', {}, adminLogin.cookie);
        assert.equal(messages.response.status, 200);
        assert.equal(messages.data.length, 1);
        assert.equal(messages.data[0].nombre.includes('<'), false);
        assert.equal(messages.data[0].mensaje.includes('<'), false);
    });

    await runTest('un usuario autenticado puede cambiar su contrasena con validacion', async ({ baseUrl }) => {
        const adminLogin = await requestJson(baseUrl, '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario: 'admin', password: 'Admin123!' })
        });

        const changePassword = await requestJson(baseUrl, '/api/cuenta/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currentPassword: 'Admin123!',
                newPassword: 'NuevaClave123',
                confirmPassword: 'NuevaClave123'
            })
        }, adminLogin.cookie);

        assert.equal(changePassword.response.status, 200);
        assert.equal(changePassword.data.success, true);

        const oldLogin = await requestJson(baseUrl, '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario: 'admin', password: 'Admin123!' })
        });
        assert.equal(oldLogin.response.status, 401);

        const newLogin = await requestJson(baseUrl, '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario: 'admin', password: 'NuevaClave123' })
        });
        assert.equal(newLogin.response.status, 200);
        assert.equal(newLogin.data.success, true);
    });

    await runTest('imagenes de eventos se guardan como archivo y no como data URL en la base', async ({ baseUrl, db, uploadsDir }) => {
        const editorLogin = await requestJson(baseUrl, '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario: 'jovenes', password: 'Editor123!' })
        });

        const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';
        const createdEvent = await requestJson(baseUrl, '/api/eventos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo: 'Campana de prueba',
                categoria: 'general',
                lugar: 'Templo central',
                fecha: '2026-03-20',
                hora: '19:30',
                imagen: tinyPng,
                descripcion: 'Evento de prueba'
            })
        }, editorLogin.cookie);

        assert.equal(createdEvent.response.status, 200);
        assert.match(createdEvent.data.evento.imagen, /^\/uploads\/eventos\//);

        const storedEvent = db.get('eventos').first().value();
        assert.equal(storedEvent.imagen.startsWith('data:image/'), false);

        const savedFile = path.join(uploadsDir, path.basename(storedEvent.imagen));
        assert.equal(fs.existsSync(savedFile), true);
    });

    await runTest('admin de damas solo puede gestionar eventos de su ministerio', async ({ baseUrl }) => {
        const damasLogin = await requestJson(baseUrl, '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario: 'damas', password: 'Dorcas123!' })
        });

        assert.equal(damasLogin.response.status, 200);
        assert.equal(damasLogin.data.rol, 'damas_admin');
        assert.equal(damasLogin.data.permissions.canManageEvents, true);
        assert.equal(damasLogin.data.permissions.canManageSermons, false);
        assert.equal(damasLogin.data.permissions.lockedEventCategory, 'damas');

        const sermonAttempt = await requestJson(baseUrl, '/api/sermones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo: 'No deberia crear',
                predicador: 'Test',
                fecha: '2026-03-18',
                youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                descripcion: 'Sin permiso'
            })
        }, damasLogin.cookie);
        assert.equal(sermonAttempt.response.status, 403);

        // Desde la migracion a permisos granulares (Fase 2, Grupo 3B), pedir una
        // categoria fuera del subconjunto permitido se RECHAZA con 403 en vez de
        // forzarse silenciosamente a la categoria bloqueada.
        const damasEventCategoriaInvalida = await requestJson(baseUrl, '/api/eventos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo: 'No deberia crear',
                categoria: 'general',
                lugar: 'Salon Dorcas',
                fecha: '2026-03-25',
                hora: '18:30',
                descripcion: 'Actividad del ministerio'
            })
        }, damasLogin.cookie);
        assert.equal(damasEventCategoriaInvalida.response.status, 403);

        const damasEvent = await requestJson(baseUrl, '/api/eventos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo: 'Reunion Dorcas',
                categoria: 'damas',
                lugar: 'Salon Dorcas',
                fecha: '2026-03-25',
                hora: '18:30',
                descripcion: 'Actividad del ministerio'
            })
        }, damasLogin.cookie);

        assert.equal(damasEvent.response.status, 200);
        assert.equal(damasEvent.data.evento.categoria, 'damas');

        const messages = await requestJson(baseUrl, '/api/mensajes', {}, damasLogin.cookie);
        assert.equal(messages.response.status, 403);
    });

    await runTest('videos de eventos se guardan como archivo y el enlace de YouTube se mantiene', async ({ baseUrl, db, uploadsDir }) => {
        const editorLogin = await requestJson(baseUrl, '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario: 'jovenes', password: 'Editor123!' })
        });

        const tinyVideo = 'data:video/mp4;base64,AAAA';
        const createdEvent = await requestJson(baseUrl, '/api/eventos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo: 'Vigilia con video',
                categoria: 'general',
                lugar: 'Templo central',
                fecha: '2026-03-28',
                hora: '20:00',
                video: tinyVideo,
                youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                descripcion: 'Evento con recursos multimedia'
            })
        }, editorLogin.cookie);

        assert.equal(createdEvent.response.status, 200);
        assert.match(createdEvent.data.evento.video, /^\/uploads\/eventos\//);
        assert.equal(createdEvent.data.evento.youtubeUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

        const storedEvent = db.get('eventos').find({ id: createdEvent.data.evento.id }).value();
        const savedFile = path.join(uploadsDir, path.basename(storedEvent.video));
        assert.equal(fs.existsSync(savedFile), true);
    });

    await runTest('el login limita intentos repetidos por IP y usuario', async ({ baseUrl }) => {
        const firstAttempt = await requestJson(baseUrl, '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario: 'admin', password: 'Incorrecta1' })
        });
        assert.equal(firstAttempt.response.status, 401);

        const secondAttempt = await requestJson(baseUrl, '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario: 'admin', password: 'Incorrecta2' })
        });
        assert.equal(secondAttempt.response.status, 401);

        const thirdAttempt = await requestJson(baseUrl, '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario: 'admin', password: 'Incorrecta3' })
        });
        assert.equal(thirdAttempt.response.status, 429);
        assert.ok(thirdAttempt.response.headers.get('retry-after'));
    }, {
        rateLimits: {
            loginPerIp: { windowMs: 60 * 1000, max: 2 },
            loginPerUser: { windowMs: 60 * 1000, max: 2 }
        }
    });

    await runTest('el formulario de contacto ignora el honeypot y limita envios repetidos', async ({ baseUrl, db }) => {
        const spamAttempt = await requestJson(baseUrl, '/api/mensajes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nombre: 'Bot',
                contacto: 'bot@example.com',
                mensaje: 'Spam automatizado',
                website: 'https://spam.example'
            })
        });

        assert.equal(spamAttempt.response.status, 200);
        assert.equal(spamAttempt.data.success, true);
        assert.equal(db.get('mensajes').size().value(), 0);

        const firstMessage = await requestJson(baseUrl, '/api/mensajes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nombre: 'Sonia',
                contacto: 'sonia@example.com',
                mensaje: 'Necesito oracion por mi familia'
            })
        });

        assert.equal(firstMessage.response.status, 200);
        assert.equal(db.get('mensajes').size().value(), 1);

        const secondMessage = await requestJson(baseUrl, '/api/mensajes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nombre: 'Sonia',
                contacto: 'sonia@example.com',
                mensaje: 'Segundo mensaje muy seguido'
            })
        });

        assert.equal(secondMessage.response.status, 429);
        assert.ok(secondMessage.response.headers.get('retry-after'));
    }, {
        rateLimits: {
            messages: { windowMs: 60 * 1000, max: 2 }
        }
    });

    await runTest('la sesion se marca Secure cuando llega por HTTPS detras del proxy local', async ({ baseUrl }) => {
        const secureLogin = await requestJson(baseUrl, '/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Forwarded-Proto': 'https'
            },
            body: JSON.stringify({ usuario: 'admin', password: 'Admin123!' })
        });

        assert.equal(secureLogin.response.status, 200);
        assert.ok(secureLogin.setCookie);
        assert.match(secureLogin.setCookie, /;\s*Secure/i);
        assert.match(secureLogin.setCookie, /;\s*HttpOnly/i);
    });

    await runTest('juegos: .unirme valida alias y .perfil pide registrarse', async ({ db }) => {
        activarJuegos(db);
        const j = crearEntornoJuegos(db, '2026-10-08T15:00:00Z');
        const PASO = 3100;

        let r = await j.enviar('.perfil');
        assert.match(r.respuesta, /`\.unirme alias`/);

        j.avanzar(PASO);
        r = await j.enviar('.unirme Ab');
        assert.match(r.respuesta, /entre 3 y 16/);

        j.avanzar(PASO);
        r = await j.enviar('.unirme Juan71234567');
        assert.match(r.respuesta, /número de teléfono/);

        j.avanzar(PASO);
        r = await j.enviar('.unirme 712-345-67');
        assert.match(r.respuesta, /número de teléfono/);

        j.avanzar(PASO);
        r = await j.enviar('.unirme Gedeon');
        assert.match(r.respuesta, /Bienvenido\/a, Gedeon!/);

        r = await j.enviar('.unirme gedeon', { autor: 'beto@lid' });
        assert.match(r.respuesta, /ya está en uso/);

        const jugador = db.get('jugadores').find({ id: 'ana@lid' }).value();
        assert.equal(jugador.alias, 'Gedeon');
        assert.equal(jugador.semana.id, '2026-W41');
        assert.equal(db.get('jugadores').size().value(), 1);
    });

    await runTest('juegos: bendicion una vez por dia, racha y medianoche Bolivia', async ({ db }) => {
        activarJuegos(db);
        // 2026-10-08 23:59 hora Bolivia (UTC-4) = 2026-10-09T03:59Z
        const j = crearEntornoJuegos(db, '2026-10-09T03:58:00Z');
        await j.enviar('.unirme Maria');

        j.avanzar(60 * 1000);
        let r = await j.enviar('.bendicion');
        assert.match(r.respuesta, /\+12 · total ✦ 12/);
        assert.match(r.respuesta, /Racha ›\* 🔥 1 día$/m);
        assert.equal(db.get('jugadores').find({ id: 'ana@lid' }).value().ultimaBendicion, '2026-10-08');

        j.avanzar(5000);
        r = await j.enviar('.bendicion');
        assert.match(r.respuesta, /Ya recibiste tu Bendición de hoy/);

        // Pasa la medianoche de Bolivia: 00:00:30 del 9 -> dia nuevo, racha 2.
        j.irA('2026-10-09T04:00:30Z');
        r = await j.enviar('.bendicion');
        assert.match(r.respuesta, /\+14 · /);
        assert.match(r.respuesta, /🔥 2 días/);

        // Dias consecutivos hasta superar el tope de bonus (7 dias = +24).
        for (let dia = 10; dia <= 17; dia += 1) {
            j.irA(`2026-10-${dia}T15:00:00Z`);
            r = await j.enviar('.bendición');
        }
        assert.match(r.respuesta, /\+24 · /);
        assert.match(r.respuesta, /🔥 10 días/);

        // Salta el 18: el 19 la racha vuelve a 1.
        j.irA('2026-10-19T15:00:00Z');
        r = await j.enviar('.bendicion');
        assert.match(r.respuesta, /\+12 · /);
        assert.match(r.respuesta, /🔥 1 día$/m);

        const jugador = db.get('jugadores').find({ id: 'ana@lid' }).value();
        assert.equal(jugador.mejorRacha, 10);
        assert.equal(jugador.talentos, 12 + 14 + 16 + 18 + 20 + 22 + 24 + 24 + 24 + 24 + 12);
        // Lunes 19 = semana ISO nueva: la semanal se reinicio y solo tiene lo de hoy.
        assert.deepEqual(jugador.semana, { id: '2026-W43', talentos: 12 });
    });

    await runTest('juegos: ranking top 5 con 12 jugadores y tu posicion', async ({ db }) => {
        activarJuegos(db);
        const semana = '2026-W41';
        const jugadores = [];
        for (let i = 1; i <= 12; i += 1) {
            jugadores.push({
                id: `j${i}@lid`, alias: `Jugador${String(i).padStart(2, '0')}`, talentos: i * 10, racha: 1, mejorRacha: 1,
                ultimaBendicion: '2026-10-07', semana: { id: semana, talentos: i * 10 }, creadoEn: '2026-10-01T00:00:00.000Z'
            });
        }
        // Uno con puntos de la semana pasada no debe aparecer.
        jugadores.push({
            id: 'viejo@lid', alias: 'Viejo', talentos: 999, racha: 0, mejorRacha: 3,
            ultimaBendicion: '2026-10-01', semana: { id: '2026-W40', talentos: 999 }, creadoEn: '2026-09-01T00:00:00.000Z'
        });
        db.set('jugadores', jugadores).write();

        const j = crearEntornoJuegos(db, '2026-10-08T15:00:00Z');
        let r = await j.enviar('.ranking', { autor: 'j2@lid' });
        const lineas = r.respuesta.split('\n');
        assert.equal(lineas.length, 7);
        assert.equal(lineas[1], '🥇 *Jugador12* ✦ 120');
        assert.equal(lineas[2], '🥈 *Jugador11* ✦ 110');
        assert.equal(lineas[3], '🥉 *Jugador10* ✦ 100');
        assert.equal(lineas[4], '4. Jugador09 ✦ 90');
        assert.equal(lineas[5], '5. Jugador08 ✦ 80');
        assert.ok(!r.respuesta.includes('Jugador07'));
        assert.ok(!r.respuesta.includes('Viejo'));
        assert.match(r.respuesta, /Tu posición ›\* #11 de 12 · ✦ 20/);

        r = await j.enviar('.perfil', { autor: 'j12@lid' });
        assert.match(r.respuesta, /#1 de 12/);
        assert.match(r.respuesta, /Nivel ›\* Brote/);
    });

    await runTest('juegos: ignora chats no permitidos, desactivado, propios y cooldown', async ({ db }) => {
        const j = crearEntornoJuegos(db, '2026-10-08T15:00:00Z');

        // Por defecto (migracion) esta desactivado.
        assert.deepEqual(db.get('juegosConfig').value(), { activo: false, grupos: [] });
        let r = await j.enviar('.ayuda');
        assert.equal(r.respuesta, null);
        assert.equal(r.reclamado, false);

        activarJuegos(db);
        r = await j.enviar('.ayuda', { chat: '120363999999999999@g.us' });
        assert.equal(r.respuesta, null);

        r = await j.enviar('.ayuda', { fromMe: true });
        assert.equal(r.respuesta, null);

        r = await j.enviar('hola .ayuda');
        assert.equal(r.respuesta, null);
        r = await j.enviar('.perfil extra');
        assert.equal(r.respuesta, null);

        r = await j.enviar('.ayuda');
        assert.match(r.respuesta, /`\.unirme alias`/);
        r = await j.enviar('.ayuda');
        assert.equal(r.respuesta, null, 'cooldown de 3 s');
        assert.equal(r.reclamado, true, 'en cooldown igual no pasa al menu');
        j.avanzar(3000);
        r = await j.enviar('.ayuda');
        assert.ok(r.respuesta);

        // Mensajes que no son 'notify' (historial, los que manda el propio bot) se ignoran.
        const juegos = crearJuegos({ versiculos: [] });
        const sock = crearSockSimulado();
        assert.equal(await juegos.manejarMensaje(sock, db, crearMsgJuego('.ayuda'), 'append'), false);
        assert.equal(sock.enviados.length, 0);
    });

    await runTest('juegos: .idgrupo solo responde a fromMe y .salir borra al jugador', async ({ db }) => {
        const j = crearEntornoJuegos(db, '2026-10-08T15:00:00Z');
        const chatPrueba = '120363555555555555@g.us';

        let r = await j.enviar('.idgrupo', { chat: chatPrueba });
        assert.equal(r.respuesta, null);
        r = await j.enviar('.idgrupo', { chat: chatPrueba, fromMe: true });
        assert.equal(r.respuesta, chatPrueba);

        activarJuegos(db);
        await j.enviar('.unirme Pedro');
        j.avanzar(3000);
        r = await j.enviar('.salir');
        assert.match(r.respuesta, /Borramos todos tus datos/);
        assert.equal(db.get('jugadores').size().value(), 0);
    });

    await runTest('preguntas: normalizacion y validacion del banco real (60)', async () => {
        assert.equal(normalizarRespuesta('  ¡Jesús,   CRISTO!  '), 'jesus cristo');
        assert.equal(normalizarRespuesta('Señor'), 'senor');
        assert.equal(normalizarRespuesta('3.000'), '3000');
        assert.equal(normalizarRespuesta('«Éfeso».'), 'efeso');
        assert.equal(normalizarRespuesta('El\tEspíritu\n Santo'), 'el espiritu santo');

        const datos = JSON.parse(fs.readFileSync(BANCO_REAL_FILE, 'utf8'));
        assert.equal(datos.meta.revision_pastoral, true);
        assert.equal(datos.preguntas.length, 60);
        const { preguntas, errores } = validarBanco(datos);
        assert.deepEqual(errores, []);
        assert.equal(preguntas.length, 60);
        assert.equal(new Set(datos.preguntas.map((p) => p.id)).size, 60, 'ids unicos');
        datos.preguntas.filter((p) => p.tipo === 'completar').forEach((p) => {
            assert.equal(p.pregunta.split('____').length, 2, `${p.id}: un solo ____`);
        });
        datos.preguntas.forEach((p) => {
            assert.ok(p.respuestas.map(normalizarRespuesta).includes(normalizarRespuesta(p.correcta)), `${p.id}: correcta en respuestas`);
        });

        const base = PREGUNTAS_TEST[0];
        assert.match(validarPregunta({ ...base, pregunta: 'Yo ____ y ____.' }), /exactamente un/);
        assert.match(validarPregunta({ ...base, respuestas: ['dos'] }), /correcta/);
        assert.match(validarPregunta({ ...base, tipo: 'acertijo' }), /tipo/);
        assert.match(validarPregunta({ ...base, tipo: 'dato' }), /solo las preguntas "completar"/);
    });

    await runTest('preguntas: a tiempo, 15 s exactos, gracia de 1 s, tarde y un solo intento', async ({ db }) => {
        activarJuegos(db);
        const j = crearEntornoJuegos(db, '2026-10-10T15:00:00Z', { banco: bancoTest(['c1']) });
        await registrarJugadores(j, ['Ana', 'Beto', 'Carla', 'Dani', 'Eva']);
        j.avanzar(3100);

        let r = await j.enviar('.trivia', { autor: 'ana@lid' });
        assert.match(r.respuesta, /Completá el versículo/);
        assert.match(r.respuesta, /\*____\*/);
        assert.match(r.respuesta, /⏳ 15 segundos — respondé con `\.r <tu respuesta>`/);
        assert.ok(!r.respuesta.includes('Juan 10:30'), 'la referencia no se muestra antes del cierre');
        assert.equal(j.timers[0].ms, 16000);

        j.avanzar(5000);
        r = await j.enviar('.r UNO!', { autor: 'beto@lid' });
        assert.equal(r.respuesta, null, 'un acierto no genera respuesta');
        j.avanzar(1000);
        r = await j.enviar('.r dos', { autor: 'ana@lid' });
        assert.equal(r.respuesta, null, 'un error no genera respuesta');
        r = await j.enviar('.r uno', { autor: 'ana@lid' });
        assert.equal(r.respuesta, null);
        j.avanzar(9000); // 15 000 ms exactos
        await j.enviar('.r uno', { autor: 'carla@lid' });
        j.avanzar(1000); // 16 000 ms: dentro de la gracia
        await j.enviar('.r uno', { autor: 'dani@lid' });
        j.avanzar(1); // 16 001 ms: tarde
        await j.enviar('.r uno', { autor: 'eva@lid' });

        const cierre = await j.cerrar();
        assert.match(cierre, /Tiempo cumplido/);
        assert.match(cierre, /Respuesta ›\* uno/);
        assert.match(cierre, /Referencia ›\* 📖 Juan 10:30/);
        assert.match(cierre, /Acertaron ›\* Beto, Carla y Dani$/m);
        assert.match(cierre, /Premio ›\* ✦ 15 c\/u/);

        const talentos = (id) => db.get('jugadores').find({ id }).value().talentos;
        assert.equal(talentos('beto@lid'), 15);
        assert.equal(talentos('carla@lid'), 15);
        assert.equal(talentos('dani@lid'), 15);
        assert.equal(talentos('ana@lid'), 0, 'solo cuenta el primer intento');
        assert.equal(talentos('eva@lid'), 0, 'pasada la gracia no cuenta');
        assert.equal(db.get('jugadores').find({ id: 'beto@lid' }).value().semana.talentos, 15, 'suma al ranking semanal');

        r = await j.enviar('.r uno', { autor: 'eva@lid' });
        assert.equal(r.respuesta, null, 'sin pregunta activa, .r se ignora');
    });

    await runTest('preguntas: una sola activa por grupo, recordatorio y falla de envio', async ({ db }) => {
        activarJuegos(db);
        let liberar;
        const enviados = [];
        let fallarProximo = false;
        const sock = {
            enviados,
            async sendMessage(jid, contenido, opciones) {
                if (fallarProximo) {
                    fallarProximo = false;
                    throw new Error('sin conexion');
                }
                enviados.push({ jid, texto: contenido.text, opciones });
                if (/segundos/.test(contenido.text) && !liberar) {
                    await new Promise((resolve) => { liberar = resolve; });
                }
            }
        };
        const j = crearEntornoJuegos(db, '2026-10-10T15:00:00Z', { banco: bancoTest(), sock });
        await registrarJugadores(j, ['Ana', 'Beto']);
        j.avanzar(3100);

        // Mientras la pregunta se esta enviando, nadie puede pedir otra ni responder.
        // (directo a manejarMensaje: enviar() contaria tambien la respuesta a Beto)
        const enCurso = j.juegos.manejarMensaje(sock, db, crearMsgJuego('.trivia', { autor: 'ana@lid' }), 'notify');
        await new Promise((resolve) => setImmediate(resolve));
        let r = await j.enviar('.personaje', { autor: 'beto@lid' });
        assert.match(r.respuesta, /Ya hay una pregunta en curso/);
        r = await j.enviar('.r algo', { autor: 'beto@lid' });
        assert.equal(r.respuesta, null);
        liberar();
        await enCurso;
        assert.equal(enviados.filter((e) => /segundos/.test(e.texto)).length, 1, 'una sola pregunta enviada');

        // .r de alguien sin .unirme: recordatorio una sola vez por pregunta.
        r = await j.enviar('.r tomas', { autor: 'zoe@lid' });
        assert.match(r.respuesta, /primero unite al juego/);
        r = await j.enviar('.r otra', { autor: 'zoe@lid' });
        assert.equal(r.respuesta, null);
        // .trivia de alguien sin .unirme.
        r = await j.enviar('.trivia', { autor: 'zoe@lid' });
        assert.match(r.respuesta, /Todavía no estás en el juego/);

        const cierre = await j.cerrar();
        assert.match(cierre, /Nadie acertó esta vez/);
        assert.ok(!/Acertaron/.test(cierre));

        // Si sendMessage falla, el grupo no queda bloqueado con una pregunta fantasma.
        j.avanzar(3100);
        fallarProximo = true;
        await assert.rejects(j.juegos.manejarMensaje(sock, db, crearMsgJuego('.trivia', { autor: 'ana@lid' }), 'notify'), /sin conexion/);
        assert.equal(j.timers.length, 0, 'sin cierre programado');
        j.avanzar(3100);
        r = await j.enviar('.trivia', { autor: 'ana@lid' });
        assert.match(r.respuesta, /segundos/, 'se puede pedir otra pregunta');
    });

    await runTest('preguntas: mazo sin repetir, re-mezcla, filtros y preguntas nuevas', async ({ db }) => {
        activarJuegos(db);
        const j = crearEntornoJuegos(db, '2026-10-10T15:00:00Z', { banco: bancoTest() });
        await registrarJugadores(j, ['Ana']);

        async function jugar(comando) {
            j.avanzar(3100);
            const r = await j.enviar(comando, { autor: 'ana@lid' });
            assert.match(r.respuesta, /segundos/);
            await j.cerrar();
            return ultimaPreguntaDelMazo(db);
        }

        const vueltaUno = [];
        for (let i = 0; i < 4; i += 1) vueltaUno.push(await jugar('.trivia'));
        assert.deepEqual([...vueltaUno].sort(), ['c1', 'c2', 'd1', 'p1'], 'no repite hasta agotar el mazo');
        await jugar('.trivia');
        assert.equal(db.get(['juegosMazos', GRUPO_JUEGOS]).value().indice, 1, 're-mezcla al agotarse');

        assert.equal(await jugar('.personaje'), 'p1');
        const versiculo = await jugar('.versiculo');
        assert.ok(['c1', 'c2'].includes(versiculo));

        // Una pregunta nueva en el JSON entra al mazo sin romper el estado; una
        // borrada se saltea.
        db.set(['juegosMazos', GRUPO_JUEGOS], { ids: ['c1', 'c2', 'p1', 'd1'], indice: 2 }).write();
        const nuevas = [...PREGUNTAS_TEST.filter((p) => p.id !== 'd1'),
            { id: 'd2', tipo: 'dato', tema: 't', pregunta: '¿En qué ciudad se derramó el Espíritu Santo?', correcta: 'Jerusalén', respuestas: ['jerusalen'], referencia: 'Hechos 2:1-5' }];
        const j2 = crearEntornoJuegos(db, '2026-10-10T16:00:00Z', { banco: validarBanco({ preguntas: nuevas }).preguntas });
        const restantes = [];
        for (let i = 0; i < 2; i += 1) {
            j2.avanzar(3100);
            await j2.enviar('.trivia', { autor: 'ana@lid' });
            await j2.cerrar();
            restantes.push(ultimaPreguntaDelMazo(db));
        }
        assert.deepEqual([...restantes].sort(), ['d2', 'p1'], 'sale la nueva, no la borrada ni las ya vistas');
    });

    await runTest('preguntas: tope diario de 5 premiadas y cambio de dia en La Paz', async ({ db }) => {
        activarJuegos(db);
        // 2026-10-09 22:00 hora Bolivia
        const j = crearEntornoJuegos(db, '2026-10-10T02:00:00Z', { banco: bancoTest(['p1']) });
        await registrarJugadores(j, ['Ana']);
        const premio = TALENTOS_PREGUNTA.personaje;

        async function ronda() {
            j.avanzar(3100);
            await j.enviar('.personaje', { autor: 'ana@lid' });
            j.avanzar(2000);
            await j.enviar('.r Tomás', { autor: 'ana@lid' });
            return j.cerrar();
        }

        for (let i = 0; i < 5; i += 1) {
            const cierre = await ronda();
            assert.ok(!/tope/.test(cierre));
        }
        const jugador = () => db.get('jugadores').find({ id: 'ana@lid' }).value();
        assert.equal(jugador().talentos, 5 * premio);

        let cierre = await ronda();
        assert.match(cierre, /Acertaron ›\* Ana/);
        assert.match(cierre, /Ana ya llegó al tope de 5 preguntas premiadas de hoy/);
        assert.equal(jugador().talentos, 5 * premio, 'pasado el tope no suma');
        cierre = await ronda();
        assert.ok(!/tope/.test(cierre), 'el aviso sale una sola vez');
        assert.equal(jugador().preguntasDia.fecha, '2026-10-09');

        // 00:00:30 del 10/10 en Bolivia: dia nuevo, vuelve a sumar.
        j.irA('2026-10-10T04:00:30Z');
        await ronda();
        assert.equal(jugador().talentos, 6 * premio);
        assert.deepEqual(jugador().preguntasDia, { fecha: '2026-10-10', premiadas: 1, avisado: false });
    });

    await runTest('preguntas: banco invalido no rompe el arranque ni el resto del juego', async ({ db }) => {
        const logs = [];
        const log = { error: (m) => logs.push(['error', m]), warn: (m) => logs.push(['warn', m]) };
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banco-'));
        try {
            assert.equal(cargarBancoPreguntas(path.join(dir, 'no-existe.json'), log), null);
            fs.writeFileSync(path.join(dir, 'roto.json'), '{ "preguntas": [');
            assert.equal(cargarBancoPreguntas(path.join(dir, 'roto.json'), log), null);
            fs.writeFileSync(path.join(dir, 'vacio.json'), JSON.stringify({ preguntas: [] }));
            assert.equal(cargarBancoPreguntas(path.join(dir, 'vacio.json'), log), null);
            assert.equal(logs.filter(([nivel]) => nivel === 'error').length, 3);

            fs.writeFileSync(path.join(dir, 'mixto.json'), JSON.stringify({ preguntas: [PREGUNTAS_TEST[0], { ...PREGUNTAS_TEST[1], respuestas: [] }] }));
            const mixto = cargarBancoPreguntas(path.join(dir, 'mixto.json'), log);
            assert.equal(mixto.length, 1, 'una pregunta mala se descarta sola');
            assert.ok(logs.some(([nivel, m]) => nivel === 'warn' && m.includes('c2')));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }

        activarJuegos(db);
        const j = crearEntornoJuegos(db, '2026-10-10T15:00:00Z', { banco: null });
        await registrarJugadores(j, ['Ana']);
        j.avanzar(3100);
        let r = await j.enviar('.trivia', { autor: 'ana@lid' });
        assert.equal(r.reclamado, true);
        assert.equal(r.respuesta, null);
        r = await j.enviar('.r hola', { autor: 'ana@lid' });
        assert.equal(r.reclamado, true, '.r hola no debe caer al menu');
        assert.equal(r.respuesta, null);
        j.avanzar(3100);
        r = await j.enviar('.bendicion', { autor: 'ana@lid' });
        assert.match(r.respuesta, /Bendición del día/, 'el resto del juego sigue funcionando');
    });

    await runTest('juegos-config: GET/PUT con permiso bot y validacion 400', async ({ baseUrl }) => {
        const anon = await requestJson(baseUrl, '/api/juegos-config');
        assert.equal(anon.response.status, 401);

        const login = await requestJson(baseUrl, '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario: 'admin', password: 'Admin123!' })
        });
        assert.equal(login.response.status, 200);

        const inicial = await requestJson(baseUrl, '/api/juegos-config', {}, login.cookie);
        assert.equal(inicial.response.status, 200);
        assert.deepEqual(inicial.data, { activo: false, grupos: [], jugadoresRegistrados: 0 });

        const invalidos = [
            {},
            { activo: 'si', grupos: [] },
            { activo: true },
            { activo: true, grupos: 'abc@g.us' },
            { activo: true, grupos: ['59171234567@s.whatsapp.net'] },
            { activo: true, grupos: [123] },
            { activo: true, grupos: Array.from({ length: 21 }, (_, i) => `1203630000000000${String(i).padStart(2, '0')}@g.us`) }
        ];
        for (const payload of invalidos) {
            const res = await requestJson(baseUrl, '/api/juegos-config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }, login.cookie);
            assert.equal(res.response.status, 400, `payload ${JSON.stringify(payload).slice(0, 60)}`);
        }

        const ok = await requestJson(baseUrl, '/api/juegos-config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activo: true, grupos: [GRUPO_JUEGOS, GRUPO_JUEGOS] })
        }, login.cookie);
        assert.equal(ok.response.status, 200);
        assert.deepEqual(ok.data.juegosConfig, { activo: true, grupos: [GRUPO_JUEGOS], jugadoresRegistrados: 0 });
    });

    if (process.exitCode) {
        process.exit(process.exitCode);
    }
}

main().catch((error) => {
    console.error('FAIL runner');
    console.error(error);
    process.exit(1);
});
