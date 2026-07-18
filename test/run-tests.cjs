const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createApp, hashPassword } = require('../server');

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

        const damasEvent = await requestJson(baseUrl, '/api/eventos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo: 'Reunion Dorcas',
                categoria: 'general',
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

    if (process.exitCode) {
        process.exit(process.exitCode);
    }
}

main().catch((error) => {
    console.error('FAIL runner');
    console.error(error);
    process.exit(1);
});
