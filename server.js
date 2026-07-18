const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const session = require('express-session');
// 1. IMPORTACIÓN DEL BOT (Añadido)
const { iniciarBot } = require('./bot.js');

const DEFAULT_DB_FILE = path.join(__dirname, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PRIVATE_PANEL_FILE = path.join(__dirname, 'privado', 'panel.html');
const DEFAULT_UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads', 'eventos');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const BODY_PAYLOAD_LIMIT = '75mb';
const CONTENT_ROLES = ['admin', 'pastor', 'editor'];
const EVENT_MANAGER_ROLES = [...CONTENT_ROLES, 'damas_admin'];
const MESSAGE_ROLES = ['admin', 'pastor'];
const EVENT_CATEGORIES = new Set(['general', 'jovenes', 'damas', 'escuela']);
const LOCKED_EVENT_CATEGORIES = {
    damas_admin: 'damas'
};
const DEFAULT_TRUST_PROXY = 'loopback';
const DEFAULT_RATE_LIMITS = {
    loginPerIp: {
        windowMs: 10 * 60 * 1000,
        max: 20,
        message: 'Demasiados intentos de inicio de sesion. Espera unos minutos y vuelve a intentar.'
    },
    loginPerUser: {
        windowMs: 10 * 60 * 1000,
        max: 6,
        message: 'Este usuario tiene demasiados intentos fallidos. Espera unos minutos y vuelve a intentar.'
    },
    messages: {
        windowMs: 15 * 60 * 1000,
        max: 4,
        message: 'Demasiados mensajes enviados desde esta conexion. Espera unos minutos y vuelve a intentar.'
    }
};
const ROLE_LABELS = {
    admin: 'Admin',
    pastor: 'Pastor',
    editor: 'Editor',
    damas_admin: 'Admin Damas'
};

function randomId() {
    return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
    return `scrypt:${salt}:${derivedKey}`;
}

function verifyPassword(password, storedValue) {
    if (typeof storedValue !== 'string' || storedValue.length === 0) {
        return false;
    }

    if (!storedValue.startsWith('scrypt:')) {
        return storedValue === password;
    }

    const parts = storedValue.split(':');
    if (parts.length !== 3) {
        return false;
    }

    const [, salt, storedHash] = parts;
    const incomingHash = crypto.scryptSync(password, salt, 64);
    const expectedHash = Buffer.from(storedHash, 'hex');

    if (incomingHash.length !== expectedHash.length) {
        return false;
    }

    return crypto.timingSafeEqual(incomingHash, expectedHash);
}

function sanitizeText(value, options = {}) {
    const maxLength = options.maxLength || 255;
    const multiline = options.multiline || false;
    let text = typeof value === 'string' ? value : '';

    text = text.normalize('NFKC').replace(/\0/g, '');
    text = text.replace(/[<>]/g, '');

    if (multiline) {
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        text = text
            .split('\n')
            .map((line) => line.trim())
            .filter((line, index, lines) => line.length > 0 || (index > 0 && index < lines.length - 1))
            .join('\n');
    } else {
        text = text.replace(/\s+/g, ' ').trim();
    }

    return text.slice(0, maxLength);
}

function sanitizeIdentifier(value) {
    return String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 80);
}

function sanitizeDate(value) {
    const date = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function sanitizeTime(value) {
    const time = String(value || '').trim();
    return /^\d{2}:\d{2}$/.test(time) ? time : '';
}

function validateHttpUrl(value, allowedHosts) {
    try {
        const url = new URL(String(value || '').trim());
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return '';
        }

        if (allowedHosts && !allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
            return '';
        }

        return url.toString();
    } catch (error) {
        return '';
    }
}

function normalizeYoutubeUrl(value) {
    return validateHttpUrl(value, ['youtube.com', 'youtu.be', 'www.youtube.com', 'm.youtube.com']);
}

function getRolePermissions(role) {
    const lockedEventCategory = LOCKED_EVENT_CATEGORIES[role] || '';
    const canManageSermons = CONTENT_ROLES.includes(role);
    const canManageEvents = EVENT_MANAGER_ROLES.includes(role);
    const canManageMessages = MESSAGE_ROLES.includes(role);

    return {
        canManageContent: canManageSermons || canManageEvents,
        canManageSermons,
        canManageEvents,
        canManageMessages,
        lockedEventCategory
    };
}

function getRoleLabel(role) {
    return ROLE_LABELS[role] || sanitizeText(role || 'usuario', { maxLength: 40 }) || 'Usuario';
}

function toPositiveInteger(value, fallbackValue) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? Math.floor(numericValue) : fallbackValue;
}

function resolveRateLimitConfig(options = {}) {
    const configuredRateLimits = options.rateLimits || {};

    return {
        loginPerIp: {
            windowMs: toPositiveInteger(configuredRateLimits.loginPerIp && configuredRateLimits.loginPerIp.windowMs, DEFAULT_RATE_LIMITS.loginPerIp.windowMs),
            max: toPositiveInteger(configuredRateLimits.loginPerIp && configuredRateLimits.loginPerIp.max, DEFAULT_RATE_LIMITS.loginPerIp.max),
            message: sanitizeText(configuredRateLimits.loginPerIp && configuredRateLimits.loginPerIp.message, { maxLength: 180 }) || DEFAULT_RATE_LIMITS.loginPerIp.message
        },
        loginPerUser: {
            windowMs: toPositiveInteger(configuredRateLimits.loginPerUser && configuredRateLimits.loginPerUser.windowMs, DEFAULT_RATE_LIMITS.loginPerUser.windowMs),
            max: toPositiveInteger(configuredRateLimits.loginPerUser && configuredRateLimits.loginPerUser.max, DEFAULT_RATE_LIMITS.loginPerUser.max),
            message: sanitizeText(configuredRateLimits.loginPerUser && configuredRateLimits.loginPerUser.message, { maxLength: 180 }) || DEFAULT_RATE_LIMITS.loginPerUser.message
        },
        messages: {
            windowMs: toPositiveInteger(configuredRateLimits.messages && configuredRateLimits.messages.windowMs, DEFAULT_RATE_LIMITS.messages.windowMs),
            max: toPositiveInteger(configuredRateLimits.messages && configuredRateLimits.messages.max, DEFAULT_RATE_LIMITS.messages.max),
            message: sanitizeText(configuredRateLimits.messages && configuredRateLimits.messages.message, { maxLength: 180 }) || DEFAULT_RATE_LIMITS.messages.message
        }
    };
}

function createAttemptTracker(config = {}) {
    const windowMs = toPositiveInteger(config.windowMs, 15 * 60 * 1000);
    const max = toPositiveInteger(config.max, 5);
    const keyGenerator = typeof config.keyGenerator === 'function'
        ? config.keyGenerator
        : (req) => String((req && req.ip) || (req && req.socket && req.socket.remoteAddress) || 'unknown');
    const store = new Map();
    let lastCleanupAt = 0;

    function cleanup(now) {
        if (now - lastCleanupAt < windowMs) {
            return;
        }

        lastCleanupAt = now;
        for (const [key, entry] of store.entries()) {
            if (!entry || entry.resetAt <= now) {
                store.delete(key);
            }
        }
    }

    function getKey(req) {
        const generatedKey = keyGenerator(req);
        return typeof generatedKey === 'string' && generatedKey.trim() ? generatedKey.trim() : 'unknown';
    }

    function getEntry(key, now) {
        const currentEntry = store.get(key);
        if (!currentEntry || currentEntry.resetAt <= now) {
            if (currentEntry) {
                store.delete(key);
            }

            return null;
        }

        return currentEntry;
    }

    function getRetryAfterSeconds(resetAt, now) {
        return Math.max(1, Math.ceil((resetAt - now) / 1000));
    }

    return {
        getState(req) {
            const now = Date.now();
            cleanup(now);
            const entry = getEntry(getKey(req), now);

            return {
                limited: Boolean(entry && entry.count >= max),
                retryAfterSeconds: entry ? getRetryAfterSeconds(entry.resetAt, now) : 0
            };
        },
        consume(req) {
            const now = Date.now();
            cleanup(now);
            const key = getKey(req);
            let entry = getEntry(key, now);

            if (!entry) {
                entry = {
                    count: 0,
                    resetAt: now + windowMs
                };
                store.set(key, entry);
            }

            entry.count += 1;

            return {
                limited: entry.count > max,
                retryAfterSeconds: getRetryAfterSeconds(entry.resetAt, now)
            };
        },
        reset(req) {
            store.delete(getKey(req));
        }
    };
}

function applyRateLimit(tracker, message) {
    return function rateLimitMiddleware(req, res, next) {
        const limitState = tracker.consume(req);
        if (limitState.limited) {
            res.setHeader('Retry-After', String(limitState.retryAfterSeconds));
            return sendApiError(res, 429, message);
        }

        return next();
    };
}

function getRequestIp(req) {
    return String((req && req.ip) || (req && req.socket && req.socket.remoteAddress) || 'unknown');
}

function getLoginAttemptKey(req) {
    const username = sanitizeText(req && req.body && req.body.usuario, { maxLength: 60 }).toLowerCase() || 'anon';
    return `${getRequestIp(req)}:${username}`;
}

function disableCaching(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    next();
}

function hasTriggeredContactHoneypot(payload) {
    return Boolean(sanitizeText(payload && payload.website, { maxLength: 120 }));
}

function createDb(dbFile) {
    const adapter = new FileSync(dbFile);
    const db = low(adapter);
    // 2. MODIFICACIÓN DE LA BASE DE DATOS (Añadido)
    db.defaults({ usuarios: [], sermones: [], eventos: [], mensajes: [], roles_limpieza: [], peticiones_oracion: [] }).write();
    return db;
}

function ensureDefaultAdmin(db, configuredPassword) {
    if (db.get('usuarios').size().value() > 0) {
        return;
    }

    const password = sanitizeText(configuredPassword, { maxLength: 120 }) || crypto.randomBytes(9).toString('base64url');
    db.get('usuarios')
        .push({
            usuario: 'admin',
            passwordHash: hashPassword(password),
            rol: 'admin',
            creadoEn: new Date().toISOString()
        })
        .write();

    console.log('=========================================');
    console.log('Usuario administrador creado.');
    console.log('Usuario: admin');
    console.log(`Contrasena temporal: ${password}`);
    console.log('Guarda esta contrasena y cambiala luego.');
    console.log('=========================================');
}

function migrateUsers(db) {
    const users = db.get('usuarios').value();
    let changed = false;

    const migratedUsers = users.map((user) => {
        const nextUser = { ...user };
        const sanitizedUsername = sanitizeText(nextUser.usuario, { maxLength: 60 });
        const normalizedRole = sanitizeText(nextUser.rol || 'editor', { maxLength: 20 }).toLowerCase();

        if (sanitizedUsername !== nextUser.usuario) {
            nextUser.usuario = sanitizedUsername;
            changed = true;
        }

        if (normalizedRole !== nextUser.rol) {
            nextUser.rol = normalizedRole;
            changed = true;
        }

        if (!nextUser.passwordHash && typeof nextUser.password === 'string' && nextUser.password.trim()) {
            nextUser.passwordHash = hashPassword(nextUser.password.trim());
            delete nextUser.password;
            changed = true;
        }

        return nextUser;
    });

    if (changed) {
        db.set('usuarios', migratedUsers).write();
    }
}

function ensureUploadsDir(uploadsDir) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

function getExtensionForMime(mimeType) {
    const mimeMap = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif'
    };

    return mimeMap[mimeType] || '';
}

function storeImageDataUrl(dataUrl, uploadsDir) {
    const matches = /^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([a-zA-Z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!matches) {
        throw new Error('Formato de imagen no valido.');
    }

    const mimeType = matches[1];
    const base64Payload = matches[2];
    const extension = getExtensionForMime(mimeType);
    const buffer = Buffer.from(base64Payload, 'base64');

    if (!extension) {
        throw new Error('Tipo de imagen no permitido.');
    }

    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
        throw new Error('La imagen excede el tamano permitido.');
    }

    const fileName = `evento-${randomId()}.${extension}`;
    const absoluteFile = path.join(uploadsDir, fileName);
    fs.writeFileSync(absoluteFile, buffer);

    return `/uploads/eventos/${fileName}`;
}

function storeVideoDataUrl(dataUrl, uploadsDir) {
    const matches = /^data:(video\/(?:mp4|webm|ogg|x-msvideo|quicktime));base64,([a-zA-Z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!matches) {
        throw new Error('Formato de video no valido. Usa MP4, WebM u OGG.');
    }

    const mimeType = matches[1];
    const base64Payload = matches[2];
    let extension = 'mp4';
    if (mimeType.includes('webm')) extension = 'webm';
    else if (mimeType.includes('ogg')) extension = 'ogv';
    else if (mimeType.includes('quicktime') || mimeType.includes('x-msvideo')) extension = 'mov';

    const buffer = Buffer.from(base64Payload, 'base64');
    if (buffer.length === 0 || buffer.length > MAX_VIDEO_BYTES) {
        throw new Error('El video excede el tamano permitido (50MB).');
    }

    const fileName = `video-${randomId()}.${extension}`;
    const absoluteFile = path.join(uploadsDir, fileName);
    fs.writeFileSync(absoluteFile, buffer);

    return `/uploads/eventos/${fileName}`;
}

function isManagedUpload(imagePath) {
    return /^\/uploads\/eventos\/[a-zA-Z0-9._-]+$/.test(String(imagePath || ''));
}

function getManagedUploadAbsolutePath(imagePath, uploadsDir) {
    if (!isManagedUpload(imagePath)) {
        return '';
    }

    return path.join(uploadsDir, path.basename(imagePath));
}

function deleteManagedUpload(imagePath, uploadsDir) {
    const absolutePath = getManagedUploadAbsolutePath(imagePath, uploadsDir);
    if (absolutePath && fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
    }
}

function normalizeImageReference(imageValue) {
    const text = typeof imageValue === 'string' ? imageValue.trim() : '';
    if (!text) {
        return '';
    }

    if (isManagedUpload(text)) {
        return text;
    }

    return validateHttpUrl(text);
}

function migrateEventImages(db, uploadsDir) {
    const events = db.get('eventos').value();
    let changed = false;

    const migratedEvents = events.map((event) => {
        const nextEvent = { ...event };
        if (typeof nextEvent.imagen === 'string' && nextEvent.imagen.startsWith('data:image/')) {
            try {
                nextEvent.imagen = storeImageDataUrl(nextEvent.imagen, uploadsDir);
            } catch (error) {
                nextEvent.imagen = '';
            }
            changed = true;
            return nextEvent;
        }

        const normalizedImage = normalizeImageReference(nextEvent.imagen);
        if (normalizedImage !== (nextEvent.imagen || '')) {
            nextEvent.imagen = normalizedImage;
            changed = true;
        }

        if (typeof nextEvent.video === 'string' && nextEvent.video.startsWith('data:video/')) {
            try {
                nextEvent.video = storeVideoDataUrl(nextEvent.video, uploadsDir);
            } catch (error) {
                nextEvent.video = '';
            }
            changed = true;
        }

        const normalizedVideo = normalizeImageReference(nextEvent.video);
        if (normalizedVideo !== (nextEvent.video || '')) {
            nextEvent.video = normalizedVideo;
            changed = true;
        }

        const normalizedYoutubeUrl = normalizeYoutubeUrl(nextEvent.youtubeUrl);
        if (normalizedYoutubeUrl !== (nextEvent.youtubeUrl || '')) {
            nextEvent.youtubeUrl = normalizedYoutubeUrl;
            changed = true;
        }

        return nextEvent;
    });

    if (changed) {
        db.set('eventos', migratedEvents).write();
    }
}

function serializeSermon(sermon) {
    return {
        id: sanitizeIdentifier(sermon.id),
        titulo: sanitizeText(sermon.titulo, { maxLength: 120 }),
        predicador: sanitizeText(sermon.predicador, { maxLength: 120 }),
        fecha: sanitizeDate(sermon.fecha),
        youtubeUrl: normalizeYoutubeUrl(sermon.youtubeUrl),
        descripcion: sanitizeText(sermon.descripcion, { maxLength: 1200, multiline: true })
    };
}

function serializeEvent(event) {
    const category = EVENT_CATEGORIES.has(event.categoria) ? event.categoria : 'general';

    return {
        id: sanitizeIdentifier(event.id),
        titulo: sanitizeText(event.titulo, { maxLength: 140 }),
        categoria: category,
        lugar: sanitizeText(event.lugar, { maxLength: 160 }),
        fecha: sanitizeDate(event.fecha),
        hora: sanitizeTime(event.hora),
        imagen: normalizeImageReference(event.imagen),
        video: normalizeImageReference(event.video),
        youtubeUrl: normalizeYoutubeUrl(event.youtubeUrl),
        descripcion: sanitizeText(event.descripcion, { maxLength: 1400, multiline: true })
    };
}

function serializeMessage(message) {
    return {
        id: sanitizeIdentifier(message.id),
        nombre: sanitizeText(message.nombre, { maxLength: 120 }),
        contacto: sanitizeText(message.contacto, { maxLength: 120 }),
        mensaje: sanitizeText(message.mensaje, { maxLength: 1500, multiline: true }),
        fecha: sanitizeText(message.fecha, { maxLength: 40 }),
        leido: Boolean(message.leido)
    };
}

function validateRequiredText(value, label, options) {
    const text = sanitizeText(value, options);
    if (!text) {
        throw new Error(`El campo "${label}" es obligatorio.`);
    }
    return text;
}

function validateSermonPayload(payload) {
    const sermon = {
        titulo: validateRequiredText(payload.titulo, 'Titulo', { maxLength: 120 }),
        predicador: validateRequiredText(payload.predicador, 'Predicador', { maxLength: 120 }),
        fecha: sanitizeDate(payload.fecha),
        youtubeUrl: normalizeYoutubeUrl(payload.youtubeUrl),
        descripcion: validateRequiredText(payload.descripcion, 'Descripcion', { maxLength: 1200, multiline: true })
    };

    if (!sermon.fecha) {
        throw new Error('La fecha del sermon no es valida.');
    }

    if (!sermon.youtubeUrl) {
        throw new Error('Ingresa un enlace valido de YouTube.');
    }

    return sermon;
}

function resolveEventImage(imageValue, uploadsDir, currentImage) {
    const rawValue = typeof imageValue === 'string' ? imageValue.trim() : '';

    if (!rawValue) {
        return currentImage || '';
    }

    if (rawValue.startsWith('data:image/')) {
        const storedPath = storeImageDataUrl(rawValue, uploadsDir);
        if (currentImage && currentImage !== storedPath) {
            deleteManagedUpload(currentImage, uploadsDir);
        }
        return storedPath;
    }

    const normalizedReference = normalizeImageReference(rawValue);
    if (!normalizedReference) {
        throw new Error('La imagen del evento no es valida.');
    }

    if (currentImage && normalizedReference !== currentImage && !rawValue.startsWith('/uploads/eventos/')) {
        deleteManagedUpload(currentImage, uploadsDir);
    }

    return normalizedReference;
}

function resolveEventVideo(videoValue, uploadsDir, currentVideo) {
    const rawValue = typeof videoValue === 'string' ? videoValue.trim() : '';

    if (!rawValue) {
        return currentVideo || '';
    }

    if (rawValue.startsWith('data:video/')) {
        const storedPath = storeVideoDataUrl(rawValue, uploadsDir);
        if (currentVideo && currentVideo !== storedPath) {
            deleteManagedUpload(currentVideo, uploadsDir);
        }
        return storedPath;
    }

    const normalizedReference = normalizeImageReference(rawValue);
    if (currentVideo && normalizedReference !== currentVideo && !rawValue.startsWith('/uploads/eventos/')) {
        deleteManagedUpload(currentVideo, uploadsDir);
    }

    return normalizedReference;
}

function validateEventPayload(payload, uploadsDir, currentImage, currentVideo) {
    const category = sanitizeText(payload.categoria || 'general', { maxLength: 20 }).toLowerCase();
    const event = {
        titulo: validateRequiredText(payload.titulo, 'Titulo', { maxLength: 140 }),
        categoria: EVENT_CATEGORIES.has(category) ? category : 'general',
        lugar: validateRequiredText(payload.lugar, 'Lugar', { maxLength: 160 }),
        fecha: sanitizeDate(payload.fecha),
        hora: sanitizeTime(payload.hora),
        imagen: resolveEventImage(payload.imagen, uploadsDir, currentImage),
        video: resolveEventVideo(payload.video, uploadsDir, currentVideo),
        youtubeUrl: normalizeYoutubeUrl(payload.youtubeUrl),
        descripcion: validateRequiredText(payload.descripcion, 'Descripcion', { maxLength: 1400, multiline: true })
    };

    if (!event.fecha) {
        throw new Error('La fecha del evento no es valida.');
    }

    if (!event.hora) {
        throw new Error('La hora del evento no es valida.');
    }

    return event;
}

function validateMessagePayload(payload) {
    const message = {
        nombre: validateRequiredText(payload.nombre, 'Nombre', { maxLength: 120 }),
        contacto: validateRequiredText(payload.contacto, 'Contacto', { maxLength: 120 }),
        mensaje: validateRequiredText(payload.mensaje, 'Mensaje', { maxLength: 1500, multiline: true })
    };

    if (message.mensaje.length < 5) {
        throw new Error('El mensaje es demasiado corto.');
    }

    return message;
}

function validatePasswordChangePayload(payload) {
    const currentPassword = typeof payload.currentPassword === 'string' ? payload.currentPassword : '';
    const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : '';
    const confirmPassword = typeof payload.confirmPassword === 'string' ? payload.confirmPassword : '';

    if (!currentPassword) {
        throw new Error('Ingresa tu contrasena actual.');
    }

    if (newPassword.length < 8 || newPassword.length > 128) {
        throw new Error('La nueva contrasena debe tener entre 8 y 128 caracteres.');
    }

    if (!/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
        throw new Error('La nueva contrasena debe incluir al menos una letra y un numero.');
    }

    if (newPassword !== confirmPassword) {
        throw new Error('La confirmacion de la contrasena no coincide.');
    }

    if (currentPassword === newPassword) {
        throw new Error('La nueva contrasena debe ser diferente a la actual.');
    }

    return { currentPassword, newPassword };
}

function sendApiError(res, statusCode, message) {
    return res.status(statusCode).json({ success: false, mensaje: message });
}

function requireAuthentication(req, res, next) {
    if (req.session && req.session.usuarioLogueado) {
        return next();
    }

    if (!req.path.startsWith('/api/') && req.accepts('html')) {
        return res.redirect('/admin.html');
    }

    return sendApiError(res, 401, 'No autorizado. Inicia sesion.');
}

function requireRole(allowedRoles) {
    return function roleMiddleware(req, res, next) {
        if (!req.session || !req.session.usuarioLogueado) {
            return sendApiError(res, 401, 'No autorizado. Inicia sesion.');
        }

        if (!allowedRoles.includes(req.session.rol)) {
            return sendApiError(res, 403, 'No tienes permisos para esta accion.');
        }

        return next();
    };
}

function buildSessionPayload(req) {
    const role = req.session && req.session.rol ? req.session.rol : '';
    return {
        authenticated: Boolean(req.session && req.session.usuarioLogueado),
        usuario: req.session && req.session.usuario ? req.session.usuario : '',
        rol: role,
        roleLabel: getRoleLabel(role),
        permissions: getRolePermissions(role)
    };
}

function createApp(options = {}) {
    const dbFile = options.dbFile || DEFAULT_DB_FILE;
    const uploadsDir = options.uploadsDir || DEFAULT_UPLOADS_DIR;
    const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
    const seedAdminPassword = options.seedAdminPassword || process.env.IPUB_ADMIN_PASSWORD || '';
    const trustProxy = options.trustProxy === undefined ? DEFAULT_TRUST_PROXY : options.trustProxy;
    const rateLimits = resolveRateLimitConfig(options);
    const db = createDb(dbFile);
    const loginIpTracker = createAttemptTracker({
        ...rateLimits.loginPerIp,
        keyGenerator: (req) => getRequestIp(req)
    });
    const loginUserTracker = createAttemptTracker({
        ...rateLimits.loginPerUser,
        keyGenerator: (req) => getLoginAttemptKey(req)
    });
    const messageTracker = createAttemptTracker({
        ...rateLimits.messages,
        keyGenerator: (req) => getRequestIp(req)
    });

    ensureUploadsDir(uploadsDir);
    migrateUsers(db);
    ensureDefaultAdmin(db, seedAdminPassword);
    migrateEventImages(db, uploadsDir);

    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', trustProxy);

    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        next();
    });

    app.use(express.urlencoded({ limit: BODY_PAYLOAD_LIMIT, extended: true }));
    app.use(express.json({ limit: BODY_PAYLOAD_LIMIT }));
    app.use((error, req, res, next) => {
        if (error && error.type === 'entity.too.large') {
            return sendApiError(res, 413, 'La solicitud excede el tamano permitido.');
        }

        if (error instanceof SyntaxError && error.status === 400 && Object.prototype.hasOwnProperty.call(error, 'body')) {
            return sendApiError(res, 400, 'El cuerpo JSON no es valido.');
        }

        return next(error);
    });
    app.use(session({
        name: 'ipub.sid',
        secret: sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: 'auto',
            maxAge: 1000 * 60 * 60 * 8
        }
    }));

    app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

    app.get('/api/session', disableCaching, (req, res) => {
        res.json(buildSessionPayload(req));
    });

    app.post('/api/login', disableCaching, (req, res) => {
        const ipLimitState = loginIpTracker.getState(req);
        if (ipLimitState.limited) {
            res.setHeader('Retry-After', String(ipLimitState.retryAfterSeconds));
            return sendApiError(res, 429, rateLimits.loginPerIp.message);
        }

        const userLimitState = loginUserTracker.getState(req);
        if (userLimitState.limited) {
            res.setHeader('Retry-After', String(userLimitState.retryAfterSeconds));
            return sendApiError(res, 429, rateLimits.loginPerUser.message);
        }

        const username = sanitizeText(req.body.usuario, { maxLength: 60 });
        const password = typeof req.body.password === 'string' ? req.body.password : '';
        const user = db.get('usuarios').find({ usuario: username }).value();

        if (!user || !verifyPassword(password, user.passwordHash || user.password)) {
            loginIpTracker.consume(req);
            loginUserTracker.consume(req);
            return sendApiError(res, 401, 'Credenciales incorrectas.');
        }

        loginIpTracker.reset(req);
        loginUserTracker.reset(req);
        return req.session.regenerate((error) => {
            if (error) {
                return sendApiError(res, 500, 'No se pudo iniciar la sesion.');
            }

            req.session.usuarioLogueado = true;
            req.session.usuario = user.usuario;
            req.session.rol = user.rol;

            return res.json({
                success: true,
                mensaje: 'Bienvenido',
                ...buildSessionPayload(req)
            });
        });
    });

    app.post('/api/logout', disableCaching, (req, res) => {
        if (!req.session) {
            return res.json({ success: true });
        }

        return req.session.destroy(() => {
            res.clearCookie('ipub.sid');
            res.json({ success: true });
        });
    });

    app.post('/api/cuenta/password', disableCaching, requireAuthentication, (req, res) => {
        const currentUser = db.get('usuarios').find({ usuario: req.session.usuario }).value();

        if (!currentUser) {
            return sendApiError(res, 404, 'Usuario no encontrado.');
        }

        try {
            const { currentPassword, newPassword } = validatePasswordChangePayload(req.body);

            if (!verifyPassword(currentPassword, currentUser.passwordHash || currentUser.password)) {
                return sendApiError(res, 400, 'La contrasena actual no es correcta.');
            }

            const updatedUser = {
                ...currentUser,
                passwordHash: hashPassword(newPassword)
            };

            delete updatedUser.password;

            db.get('usuarios').find({ usuario: currentUser.usuario }).assign(updatedUser).write();
            return res.json({ success: true, mensaje: 'Contrasena actualizada correctamente.' });
        } catch (error) {
            return sendApiError(res, 400, error.message);
        }
    });

    app.get('/api/sermones', (req, res) => {
        const sermons = db.get('sermones').value().map(serializeSermon);
        res.json(sermons);
    });

    app.post('/api/sermones', requireRole(CONTENT_ROLES), (req, res) => {
        try {
            const sermon = validateSermonPayload(req.body);
            sermon.id = randomId();
            db.get('sermones').push(sermon).write();
            res.json({ success: true, sermon: serializeSermon(sermon) });
        } catch (error) {
            sendApiError(res, 400, error.message);
        }
    });

    app.put('/api/sermones/:id', requireRole(CONTENT_ROLES), (req, res) => {
        const sermonId = sanitizeIdentifier(req.params.id);
        const current = db.get('sermones').find({ id: sermonId }).value();

        if (!current) {
            return sendApiError(res, 404, 'Sermon no encontrado.');
        }

        try {
            const sermon = validateSermonPayload(req.body);
            db.get('sermones').find({ id: sermonId }).assign(sermon).write();
            return res.json({ success: true, sermon: serializeSermon({ ...current, ...sermon, id: sermonId }) });
        } catch (error) {
            return sendApiError(res, 400, error.message);
        }
    });

    app.delete('/api/sermones/:id', requireRole(CONTENT_ROLES), (req, res) => {
        const sermonId = sanitizeIdentifier(req.params.id);
        const current = db.get('sermones').find({ id: sermonId }).value();

        if (!current) {
            return sendApiError(res, 404, 'Sermon no encontrado.');
        }

        db.get('sermones').remove({ id: sermonId }).write();
        return res.json({ success: true });
    });

    app.get('/api/eventos', (req, res) => {
        const events = db.get('eventos').value().map(serializeEvent);
        res.json(events);
    });

    app.post('/api/eventos', requireRole(EVENT_MANAGER_ROLES), (req, res) => {
        try {
            const permissions = getRolePermissions(req.session.rol);
            const payload = permissions.lockedEventCategory
                ? { ...req.body, categoria: permissions.lockedEventCategory }
                : req.body;
            const event = validateEventPayload(payload, uploadsDir, '', '');
            event.id = randomId();
            db.get('eventos').push(event).write();
            res.json({ success: true, evento: serializeEvent(event) });
        } catch (error) {
            sendApiError(res, 400, error.message);
        }
    });

    app.put('/api/eventos/:id', requireRole(EVENT_MANAGER_ROLES), (req, res) => {
        const eventId = sanitizeIdentifier(req.params.id);
        const current = db.get('eventos').find({ id: eventId }).value();

        if (!current) {
            return sendApiError(res, 404, 'Evento no encontrado.');
        }

        try {
            const permissions = getRolePermissions(req.session.rol);
            if (permissions.lockedEventCategory && current.categoria !== permissions.lockedEventCategory) {
                return sendApiError(res, 403, 'No tienes permisos para modificar este evento.');
            }

            const payload = permissions.lockedEventCategory
                ? { ...req.body, categoria: permissions.lockedEventCategory }
                : req.body;
            const event = validateEventPayload(payload, uploadsDir, current.imagen || '', current.video || '');
            db.get('eventos').find({ id: eventId }).assign(event).write();
            return res.json({ success: true, evento: serializeEvent({ ...current, ...event, id: eventId }) });
        } catch (error) {
            return sendApiError(res, 400, error.message);
        }
    });

    app.delete('/api/eventos/:id', requireRole(EVENT_MANAGER_ROLES), (req, res) => {
        const eventId = sanitizeIdentifier(req.params.id);
        const current = db.get('eventos').find({ id: eventId }).value();

        if (!current) {
            return sendApiError(res, 404, 'Evento no encontrado.');
        }

        const permissions = getRolePermissions(req.session.rol);
        if (permissions.lockedEventCategory && current.categoria !== permissions.lockedEventCategory) {
            return sendApiError(res, 403, 'No tienes permisos para eliminar este evento.');
        }

        deleteManagedUpload(current.imagen, uploadsDir);
        deleteManagedUpload(current.video, uploadsDir);
        db.get('eventos').remove({ id: eventId }).write();
        return res.json({ success: true });
    });

    app.post('/api/mensajes', applyRateLimit(messageTracker, rateLimits.messages.message), (req, res) => {
        if (hasTriggeredContactHoneypot(req.body)) {
            return res.json({ success: true, mensaje: 'Mensaje enviado correctamente.' });
        }

        try {
            const message = validateMessagePayload(req.body);
            message.id = randomId();
            message.fecha = new Date().toLocaleString('es-BO', {
                timeZone: 'America/La_Paz',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            message.leido = false;
            db.get('mensajes').push(message).write();
            res.json({ success: true, mensaje: 'Mensaje enviado correctamente.' });
        } catch (error) {
            sendApiError(res, 400, error.message);
        }
    });

    app.get('/api/mensajes', requireRole(MESSAGE_ROLES), (req, res) => {
        const messages = db.get('mensajes').value().map(serializeMessage);
        res.json(messages);
    });

    app.put('/api/mensajes/:id', requireRole(MESSAGE_ROLES), (req, res) => {
        const messageId = sanitizeIdentifier(req.params.id);
        const current = db.get('mensajes').find({ id: messageId }).value();

        if (!current) {
            return sendApiError(res, 404, 'Mensaje no encontrado.');
        }

        db.get('mensajes').find({ id: messageId }).assign({ leido: true }).write();
        return res.json({ success: true });
    });

    app.delete('/api/mensajes/:id', requireRole(MESSAGE_ROLES), (req, res) => {
        const messageId = sanitizeIdentifier(req.params.id);
        const current = db.get('mensajes').find({ id: messageId }).value();

        if (!current) {
            return sendApiError(res, 404, 'Mensaje no encontrado.');
        }

        db.get('mensajes').remove({ id: messageId }).write();
        return res.json({ success: true });
    });

    app.get('/panel.html', disableCaching, requireAuthentication, (req, res) => {
        res.sendFile(PRIVATE_PANEL_FILE);
    });

    app.use((req, res) => {
        res.status(404).json({ success: false, mensaje: 'Ruta no encontrada.' });
    });

    return { app, db, uploadsDir, dbFile };
}

function startServer(options = {}) {
    const port = options.port || Number(process.env.PORT) || 8080;
    const host = options.host || '0.0.0.0';
    const { app, db } = createApp(options);

    // 3. INYECTAMOS EL BOT AQUÍ (Añadido)
    iniciarBot(db);

    return app.listen(port, host, () => {
        console.log('=========================================');
        console.log('Servidor IPUB Tupiza iniciado.');
        console.log(`Escuchando en el puerto: ${port}`);
        console.log('=========================================');
    });
}

if (require.main === module) {
    startServer();
}

module.exports = {
    CONTENT_ROLES,
    MESSAGE_ROLES,
    createApp,
    hashPassword,
    sanitizeText,
    startServer,
    verifyPassword
};