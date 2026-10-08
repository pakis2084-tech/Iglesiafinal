// -----------------------------------------------------
// TEXTOS DEL JUEGO: todo lo que el bot responde en juegos.js se arma aca,
// para que el estilo se cambie en un solo lugar.
//
// Reglas de estilo (formato de WhatsApp):
// - Encabezado: 「simbolo」 *Titulo*
// - Dato:       > *Etiqueta ›* valor
// - Talentos con ✦, comandos en `codigo`, notas en _cursiva_ (sin anidar formatos).
// - Como maximo un emoji tematico por linea y 8 lineas por mensaje.
// - Solo simbolos comunes: ✦ ✿ ✝ › 🕊️ 📖 🌱 🔥 🏆 🥇 🥈 🥉
// - Solo alias, nunca ids, numeros ni @menciones.
// -----------------------------------------------------

const MAX_LINEAS_MENSAJE = 8;
const MEDALLAS = { 1: '🥇', 2: '🥈', 3: '🥉' };

function encabezado(simbolo, titulo) {
    return `「${simbolo}」 *${titulo}*`;
}

function dato(etiqueta, valor) {
    return `> *${etiqueta} ›* ${valor}`;
}

function comando(texto, descripcion) {
    return `> \`${texto}\` › ${descripcion}`;
}

function nota(texto) {
    return `_${texto}_`;
}

function talentos(cantidad) {
    return `✦ ${cantidad}`;
}

function dias(cantidad) {
    return `${cantidad} ${cantidad === 1 ? 'día' : 'días'}`;
}

// Une las lineas y aplica el tope de 8. Si algun mensaje lo superara por un
// cambio futuro, se recorta (y se avisa en el log) en vez de mandarlo largo.
function componer(lineas) {
    const filtradas = lineas.filter((linea) => linea !== null && linea !== undefined && linea !== false);
    if (filtradas.length > MAX_LINEAS_MENSAJE) {
        console.warn(`⚠️ Mensaje de juegos con ${filtradas.length} lineas, se recorta a ${MAX_LINEAS_MENSAJE}.`);
    }
    return filtradas.slice(0, MAX_LINEAS_MENSAJE).join('\n');
}

function error(titulo, detalle) {
    return componer([encabezado('✿', titulo), nota(detalle)]);
}

// ---------- Ayuda ----------

function ayuda() {
    return componer([
        encabezado('✿', 'Juegos del grupo'),
        comando('.unirme alias', 'participar con un apodo'),
        comando('.bendicion', 'tu Bendición del día'),
        comando('.perfil', 'talentos, racha y nivel'),
        comando('.ranking', 'top 5 de la semana'),
        comando('.salir', 'borrar tus datos del juego'),
        comando('.ayuda', 'esta lista'),
        nota('Los talentos son solo por diversión, no tienen valor real.')
    ]);
}

// ---------- Registro ----------

function bienvenida(alias, nivel) {
    return componer([
        encabezado('🌱', `¡Bienvenido/a, ${alias}!`),
        dato('Nivel', nivel),
        dato('Talentos', talentos(0)),
        'Escribí `.bendicion` para recibir tu primera Bendición del día.'
    ]);
}

function noRegistrado() {
    return componer([
        encabezado('✿', 'Todavía no estás en el juego'),
        'Escribí `.unirme alias` para participar.'
    ]);
}

function yaRegistrado(alias) {
    return error('Ya estás en el juego', `Participás como ${alias}.`);
}

function aliasFaltante() {
    return componer([
        encabezado('✿', 'Falta tu apodo'),
        'Escribilo después del comando, por ejemplo: `.unirme Gedeon`'
    ]);
}

const ERRORES_ALIAS = {
    largo: (min, max) => error('Alias no válido', `Debe tener entre ${min} y ${max} caracteres.`),
    caracteres: () => error('Alias no válido', 'Solo letras, números, espacios, punto, guion y guion bajo.'),
    telefono: () => error('Alias no válido', 'Por tu seguridad, no puede parecerse a un número de teléfono.')
};

function aliasInvalido(codigo, min, max) {
    const armar = ERRORES_ALIAS[codigo] || ERRORES_ALIAS.caracteres;
    return armar(min, max);
}

function aliasEnUso(alias) {
    return error(`El alias ${alias} ya está en uso`, 'Probá con otro.');
}

function despedida(alias) {
    return componer([
        encabezado('🕊️', `Hasta pronto, ${alias}`),
        nota('Borramos todos tus datos del juego.'),
        'Podés volver cuando quieras con `.unirme alias`.'
    ]);
}

// ---------- Bendicion ----------

function bendicion({ alias, versiculo, ganados, total, racha }) {
    return componer([
        encabezado('✝', `Bendición del día · ${alias}`),
        versiculo ? `> 📖 _${versiculo}_` : null,
        dato('Talentos', `+${ganados} · total ${talentos(total)}`),
        dato('Racha', `🔥 ${dias(racha)}`)
    ]);
}

function bendicionYaRecibida(racha) {
    return componer([
        encabezado('✝', 'Ya recibiste tu Bendición de hoy'),
        dato('Racha', `🔥 ${dias(racha)}`),
        nota('Volvé mañana para no cortarla.')
    ]);
}

// ---------- Perfil ----------

function perfil({ alias, talentosTotales, racha, mejorRacha, nivel, siguienteNivel, posicion }) {
    return componer([
        encabezado('🌱', `Perfil de ${alias}`),
        dato('Nivel', nivel),
        dato('Talentos', talentos(talentosTotales)),
        dato('Próximo nivel', siguienteNivel
            ? `${siguienteNivel.nombre} en ${talentos(siguienteNivel.desde - talentosTotales)}`
            : 'ya llegaste al máximo'),
        dato('Racha', `🔥 ${dias(racha)}`),
        dato('Mejor racha', dias(mejorRacha)),
        dato('Semana', posicion
            ? `🏆 #${posicion.posicion} de ${posicion.total} · ${talentos(posicion.talentos)}`
            : 'todavía sin talentos')
    ]);
}

// ---------- Ranking ----------

// filas: [{ alias, talentos, posicion }] ya ordenadas (top 5), una por linea.
// Medalla para las posiciones 1 a 3 (los empates comparten medalla).
function ranking({ numeroSemana, filas, total, miFila, registrado }) {
    if (filas.length === 0) {
        return componer([
            encabezado('🏆', `Ranking semanal · semana ${numeroSemana}`),
            nota('Todavía nadie sumó talentos esta semana.'),
            'Empezá con `.bendicion`.'
        ]);
    }

    const lineasTop = filas.map((fila) => {
        const medalla = MEDALLAS[fila.posicion];
        return medalla
            ? `${medalla} *${fila.alias}* ${talentos(fila.talentos)}`
            : `${fila.posicion}. ${fila.alias} ${talentos(fila.talentos)}`;
    });

    let pie;
    if (!registrado) {
        pie = 'Escribí `.unirme alias` para participar.';
    } else if (miFila) {
        pie = dato('Tu posición', `#${miFila.posicion} de ${total} · ${talentos(miFila.talentos)}`);
    } else {
        pie = dato('Tu posición', 'todavía sin talentos esta semana');
    }

    return componer([
        encabezado('🏆', `Ranking semanal · semana ${numeroSemana}`),
        ...lineasTop,
        pie
    ]);
}

// ---------- Utilidades ----------

// Solo el JID, sin formato, para poder copiarlo y pegarlo tal cual en el panel.
function idGrupo(jid) {
    return jid;
}

module.exports = {
    MAX_LINEAS_MENSAJE,
    encabezado,
    dato,
    talentos,
    ayuda,
    bienvenida,
    noRegistrado,
    yaRegistrado,
    aliasFaltante,
    aliasInvalido,
    aliasEnUso,
    despedida,
    bendicion,
    bendicionYaRecibida,
    perfil,
    ranking,
    idGrupo
};
