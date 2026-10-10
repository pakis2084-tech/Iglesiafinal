// -----------------------------------------------------
// TEXTOS DEL JUEGO: todo lo que el bot responde en juegos.js se arma aca,
// para que el estilo se cambie en un solo lugar.
//
// Reglas de estilo (formato de WhatsApp):
// - Encabezado: 「simbolo」 *Titulo*
// - Dato:       > *Etiqueta ›* valor
// - Talentos con ✦, comandos en `codigo`, notas en _cursiva_ (sin anidar formatos).
// - Como maximo un emoji tematico por linea y 8 lineas por mensaje.
// - Solo simbolos comunes: ✦ ✿ ✝ › 🕊️ 📖 🌱 🔥 🏆 🥇 🥈 🥉 (y ⏳ solo para el tiempo de las preguntas)
// - Solo alias, nunca ids, numeros ni @menciones.
// -----------------------------------------------------

const MAX_LINEAS_MENSAJE = 8;
const MEDALLAS = { 1: '🥇', 2: '🥈', 3: '🥉' };
const MAX_NOMBRES_CIERRE = 5;

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
        `> \`.perfil\` · \`.ranking\` › tus datos y top 5`,
        `> \`.trivia\` · \`.versiculo\` · \`.personaje\` › pregunta de 15 s`,
        comando('.r respuesta', 'responder la pregunta'),
        comando('.salir', 'borrar tus datos del juego'),
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

// ---------- Preguntas con tiempo limite ----------

const ENCABEZADO_PREGUNTA = {
    completar: ['📖', 'Completá el versículo'],
    personaje: ['✝', 'Personaje bíblico'],
    dato: ['✿', 'Pregunta bíblica']
};

// "Ana, Beto y Carla"; con mas de 5: "Ana, Beto, Carla, Dani, Eva y 2 más".
function listaNombres(nombres) {
    if (nombres.length <= MAX_NOMBRES_CIERRE) {
        return nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
    }
    return `${nombres.slice(0, MAX_NOMBRES_CIERRE).join(', ')} y ${nombres.length - MAX_NOMBRES_CIERRE} más`;
}

// No muestra la referencia: en "personaje" delataria la respuesta (ej. Isaías 9:6).
function pregunta({ tipo, texto, segundos, premio }) {
    const [simbolo, titulo] = ENCABEZADO_PREGUNTA[tipo] || ENCABEZADO_PREGUNTA.dato;
    const cuerpo = tipo === 'completar' ? texto.replace('____', '*____*') : texto;
    return componer([
        encabezado(simbolo, titulo),
        `> ${cuerpo}`,
        dato('Premio', talentos(premio)),
        `⏳ ${segundos} segundos — respondé con \`.r <tu respuesta>\``
    ]);
}

function preguntaEnCurso() {
    return error('Ya hay una pregunta en curso', 'Esperá el cierre para pedir otra.');
}

function recordatorioUnirme() {
    return componer([
        encabezado('✿', 'Para responder, primero unite al juego'),
        'Escribí `.unirme alias` y participá en la próxima.'
    ]);
}

function cierrePregunta({ correcta, referencia, acertaron, premio, llegaronAlTope, tope }) {
    const lineas = [
        encabezado('✝', 'Tiempo cumplido'),
        dato('Respuesta', correcta),
        dato('Referencia', `📖 ${referencia}`)
    ];

    if (acertaron.length === 0) {
        lineas.push(nota('Nadie acertó esta vez. ¡Ánimo para la próxima!'));
        return componer(lineas);
    }

    lineas.push(dato('Acertaron', listaNombres(acertaron)));
    lineas.push(dato('Premio', `${talentos(premio)} c/u`));
    if (llegaronAlTope.length > 0) {
        const verbo = llegaronAlTope.length === 1 ? 'ya llegó' : 'ya llegaron';
        lineas.push(nota(`${listaNombres(llegaronAlTope)} ${verbo} al tope de ${tope} preguntas premiadas de hoy.`));
    }
    return componer(lineas);
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
    pregunta,
    preguntaEnCurso,
    recordatorioUnirme,
    cierrePregunta,
    idGrupo
};
