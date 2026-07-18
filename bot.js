const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');

async function iniciarBot(db) {
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

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('\n=========================================');
            console.log('📱 ESCANEA ESTE CÓDIGO CON EL WHATSAPP DE LA IGLESIA');
            console.log('=========================================\n');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
            console.log('⚠️ Conexión cerrada. ¿Reconectando?:', shouldReconnect);
            if (shouldReconnect) iniciarBot(db);
        } else if (connection === 'open') {
            console.log('✅ ¡Bot IPUB sincronizado y en línea!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        
        let body = "";
        if (msg.message.conversation) {
            body = msg.message.conversation;
        } else if (msg.message.extendedTextMessage) {
            body = msg.message.extendedTextMessage.text;
        } else if (msg.message.ephemeralMessage) {
            const emph = msg.message.ephemeralMessage.message;
            body = emph.conversation || emph.extendedTextMessage?.text || "";
        }

        if (!body) return; 
        const input = body.toLowerCase().trim();
        db.read();

        if (input.includes('hola') || input.includes('menu') || input === '!hola') {
            const menuText = "🙏 *BIENVENIDO A IPUB TUPIZA* 🙏\n\nResponde con el *NÚMERO*:\n\n1️⃣ 🗓️ Ver Eventos\n2️⃣ 🧹 Roles de Limpieza\n3️⃣ 🛐 Petición de Oración\n4️⃣ 📍 Ubicación\n5️⃣ 🌐 Página Oficial\n\n👉 _Escribe solo el número_";
            await sock.sendMessage(from, { text: menuText });
            return;
        }

        if (input === '1' || input.includes('eventos')) {
            const eventos = db.get('eventos').value() || []; 
            let texto = "🗓️ *Próximos Eventos:*\n\n";
            eventos.forEach(e => {
                let enlace = (e.link && e.link.trim() !== "") ? e.link : "https://ipubtupiza.org";
                texto += `🔹 *${e.titulo}*\n📅 ${e.fecha} - ⏰ ${e.hora}\n🔗 ${enlace}\n\n`;
            });
            await sock.sendMessage(from, { text: texto });
        }
        else if (input === '2' || input.includes('roles')) {
            const roles = db.get('roles_limpieza').value() || [];
            let texto = "🧹 *Roles de Limpieza:*\n\n";
            roles.forEach(r => { texto += `*${r.dia}:* ${r.encargados}\n`; });
            await sock.sendMessage(from, { text: texto });
        }
        else if (input === '5') {
            await sock.sendMessage(from, { text: "🌐 *Página Oficial*\n🔗 https://ipubtupiza.org" });
        }

        if (input.startsWith('!orar ')) {
            const motivo = body.substring(6).trim();
            db.get('peticiones_oracion').push({ id: Date.now().toString(), motivo, fecha: new Date().toISOString(), numero: from.split('@')[0] }).write();
            await sock.sendMessage(from, { text: "🙏 Petición guardada. Dios te bendiga." });
        }
    });

    // -----------------------------------------------------
    // AUTOMATIZACIONES Y VERSÍCULOS DIARIOS (AHORA CON IMÁGENES ALEATORIAS)
    // -----------------------------------------------------
    const idGrupo = "120363028628647608@g.us"; 

    // LISTAS DE VERSÍCULOS
    const versiculosMañana = [
        "Salmo 118:24: 'Este es el día que hizo Jehová; Nos gozaremos y alegraremos en él.'",
        "Lamentaciones 3:22-23: 'Nuevas son sus misericordias cada mañana; grande es tu fidelidad.'",
        "Salmo 5:3: 'Oh Jehová, de mañana oirás mi voz; de mañana me presentaré ante ti y esperaré.'",
        "Sofonías 3:17: 'Jehová está en medio de ti, poderoso, él salvará; se gozará sobre ti con alegría.'",
        "Salmo 143:8: 'Hazme oír por la mañana tu misericordia, porque en ti he confiado.'"
    ];

    const versiculosNoche = [
        "Salmo 4:8: 'En paz me acostaré, y asimismo dormiré; Porque solo tú, Jehová, me haces vivir confiado.'",
        "Mateo 11:28: 'Venid a mí todos los que estáis trabajados y cargados, y yo os haré descansar.'",
        "Salmo 121:4: 'He aquí, no se adormecerá ni dormirá el que guarda a Israel.'",
        "Filipenses 4:13: 'Todo lo puedo en Cristo que me fortalece.'",
        "Juan 14:27: 'La paz os dejo, mi paz os doy; yo no os la doy como el mundo la da. No se turbe vuestro corazón.'"
    ];

    // LISTAS DE IMÁGENES
    const imagenesMañana = [
        "https://i.pinimg.com/736x/8f/a9/39/8fa939e1a90c50a187ed3f2b48b11116.jpg", // Amanecer montañas
        "https://i.pinimg.com/736x/f6/cc/21/f6cc21edebba0b147e62a26c48de8d12.jpg", // Taza de café y sol
        "https://i.pinimg.com/736x/21/2e/52/212e52495d460e5dbb0973a5a7698cb0.jpg", // Camino con luz
        "https://i.pinimg.com/736x/e4/41/5b/e4415b22b101de83cc339fcc050d2899.jpg"  // Paisaje luminoso
    ];

    const imagenesNoche = [
        "https://i.pinimg.com/736x/6c/67/bf/6c67bf30db1f516a7509f6e3c3325026.jpg", // Noche estrellada
        "https://i.pinimg.com/736x/1a/05/96/1a05963f2d22edfa5c2d3cf3cb877555.jpg", // Luna sobre el agua
        "https://i.pinimg.com/736x/91/92/47/919247eb81f8f309a6327b9c97b2d5a1.jpg", // Cielo nocturno paz
        "https://i.pinimg.com/736x/82/38/c7/8238c7f7bc8765dc57bf9e8a8e1e779d.jpg"  // Noche en la naturaleza
    ];

    // Versículo de la Mañana (7:00 AM)
    cron.schedule('0 7 * * *', async () => {
        const v = versiculosMañana[Math.floor(Math.random() * versiculosMañana.length)];
        const img = imagenesMañana[Math.floor(Math.random() * imagenesMañana.length)];
        
        await sock.sendMessage(idGrupo, { 
            image: { url: img }, 
            caption: `☀️ *¡BUENOS DÍAS IGLESIA!* ☀️\n\nEmpecemos este hermoso día con Su palabra:\n\n📖 ${v}\n\n¡Que tengas un día bendecido! 🙌\n🌐 https://ipubtupiza.org` 
        });
    });

    // Versículo de la Noche (9:00 PM)
    cron.schedule('0 21 * * *', async () => {
        const v = versiculosNoche[Math.floor(Math.random() * versiculosNoche.length)];
        const img = imagenesNoche[Math.floor(Math.random() * imagenesNoche.length)];
        
        await sock.sendMessage(idGrupo, { 
            image: { url: img }, 
            caption: `🌙 *DIOS TE BENDIGA ESTA NOCHE* 🌙\n\nAntes de descansar, recuerda:\n\n📖 ${v}\n\nConfía en Su poder para los días difíciles. ¡Descansa en Su paz! ✨` 
        });
    });

    // Recordatorio Limpieza (8:00 AM L-S)
    cron.schedule('0 8 * * 1-6', async () => {
        db.read();
        const roles = db.get('roles_limpieza').value() || [];
        const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const hoy = dias[new Date().getDay()]; 
        const rolHoy = roles.find(r => r.dia.toLowerCase() === hoy.toLowerCase());
        if (rolHoy) {
            await sock.sendMessage(idGrupo, { text: `📢 *RECORDATORIO*\n\nHoy le toca la limpieza a: *${rolHoy.encargados}*. ¡Gracias! 🙌` });
        }
    });

    // Domingo Imagen (8:30 AM)
    cron.schedule('30 8 * * 0', async () => {
        const imageUrl = "https://i.pinimg.com/736x/8f/c9/2e/8fc92e212d2fb449e7b2f0a149f1db89.jpg"; 
        await sock.sendMessage(idGrupo, { image: { url: imageUrl }, caption: "🌅 *¡FELIZ DOMINGO!* 🌅\n\nLos esperamos hoy en los servicios. 🙏⛪\n🔗 https://ipubtupiza.org" });
    });
}

module.exports = { iniciarBot };
