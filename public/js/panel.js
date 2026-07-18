const state = {
    session: null,
    sermons: [],
    events: [],
    editingSermonId: '',
    editingEventId: '',
    inactivityTimer: null
};

const tabTitles = {
    sermones: 'Gestion de Sermones',
    eventos: 'Agenda de Eventos',
    mensajes: 'Bandeja de Entrada'
};

const categoryLabels = {
    general: 'General',
    jovenes: 'Jovenes',
    damas: 'Damas',
    escuela: 'Escuela'
};

const categoryBadgeClasses = {
    general: 'bg-secondary',
    jovenes: 'bg-primary',
    damas: 'bg-danger',
    escuela: 'bg-success'
};
const roleLabels = {
    admin: 'Admin',
    pastor: 'Pastor',
    editor: 'Editor',
    damas_admin: 'Admin Damas'
};

const placeholderImage = '/images/placeholders/evento-fallback.svg';
const defaultPasswordFeedback = 'La nueva contrasena debe tener al menos 8 caracteres, una letra y un numero.';

document.addEventListener('DOMContentLoaded', () => {
    initPanel().catch(handleFatalError);
});

async function initPanel() {
    try {
        state.session = await fetchJson('/api/session');
    } catch (error) {
        if (error && error.status === 404) {
            throw new Error('El panel se actualizo pero el servidor sigue con la version anterior. Reinicia el servidor y vuelve a entrar.');
        }
        throw error;
    }

    if (!state.session.authenticated) {
        redirectToLogin();
        return;
    }

    applySessionUi();
    bindNavigation();
    bindForms();
    bindInactivityTimer();

    await Promise.all([
        state.session.permissions.canManageSermons ? loadSermons() : Promise.resolve(),
        state.session.permissions.canManageEvents ? loadEvents() : Promise.resolve(),
        state.session.permissions.canManageMessages ? loadMessages() : Promise.resolve()
    ]);

    const requestedTab = window.location.hash === '#mensajes'
        ? 'mensajes'
        : window.location.hash === '#eventos'
            ? 'eventos'
            : 'sermones';
    changeTab(requestedTab);
}

function applySessionUi() {
    const roleBadge = document.getElementById('rol-badge');
    const roleLabel = state.session.roleLabel || roleLabels[state.session.rol] || String(state.session.rol || 'usuario').toUpperCase();
    roleBadge.textContent = `Rol: ${roleLabel}`;
    document.getElementById('usuario-actual').textContent = state.session.usuario || 'usuario';

    toggleSectionAccess('sermones', Boolean(state.session.permissions.canManageSermons));
    toggleSectionAccess('eventos', Boolean(state.session.permissions.canManageEvents));
    if (!state.session.permissions.canManageMessages) {
        toggleSectionAccess('mensajes', false);
    } else {
        toggleSectionAccess('mensajes', true);
    }

    const categoryField = document.getElementById('ev-categoria');
    const categoryHelp = document.getElementById('ev-categoria-help');
    if (categoryField && state.session.permissions.lockedEventCategory) {
        categoryField.value = state.session.permissions.lockedEventCategory;
        categoryField.disabled = true;
        if (categoryHelp) {
            categoryHelp.textContent = `Esta cuenta solo puede publicar eventos de ${categoryLabels[state.session.permissions.lockedEventCategory] || 'su ministerio'}.`;
        }
    } else if (categoryField) {
        categoryField.disabled = false;
        if (categoryHelp) {
            categoryHelp.textContent = '';
        }
    }
}

function toggleSectionAccess(tab, enabled) {
    const menu = document.getElementById(`btn-menu-${tab}`);
    const section = document.getElementById(`seccion-${tab}`);
    if (menu) menu.style.display = enabled ? '' : 'none';
    if (section) section.style.display = enabled ? '' : 'none';
}

function getAvailableTabs() {
    const tabs = [];
    if (state.session.permissions.canManageSermons) tabs.push('sermones');
    if (state.session.permissions.canManageEvents) tabs.push('eventos');
    if (state.session.permissions.canManageMessages) tabs.push('mensajes');
    return tabs;
}

function bindNavigation() {
    document.querySelectorAll('[data-tab]').forEach((button) => {
        button.addEventListener('click', () => {
            changeTab(button.dataset.tab);
        });
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
        logout().catch(handleRequestError);
    });
}

function changeTab(tab) {
    const availableTabs = getAvailableTabs();
    const requestedTab = tab === 'mensajes' && !state.session.permissions.canManageMessages ? '' : tab;
    const targetTab = availableTabs.includes(requestedTab) ? requestedTab : (availableTabs[0] || 'sermones');

    document.querySelectorAll('.seccion-panel').forEach((section) => {
        section.classList.remove('seccion-activa');
    });

    document.querySelectorAll('.sidebar a').forEach((button) => {
        button.classList.remove('active');
    });

    const section = document.getElementById(`seccion-${targetTab}`);
    const menu = document.getElementById(`btn-menu-${targetTab}`);

    if (section) {
        section.classList.add('seccion-activa');
    }

    if (menu) {
        menu.classList.add('active');
    }

    document.getElementById('titulo-seccion').textContent = tabTitles[targetTab] || tabTitles.sermones;
    window.location.hash = targetTab === 'sermones' ? '' : targetTab;
}

function bindForms() {
    document.getElementById('formSermon').addEventListener('submit', handleSermonSubmit);
    document.getElementById('formEvento').addEventListener('submit', handleEventSubmit);
    document.getElementById('formPassword').addEventListener('submit', handlePasswordSubmit);
    document.getElementById('toggle-password-form').addEventListener('click', togglePasswordForm);
}

async function handleSermonSubmit(event) {
    event.preventDefault();

    const submitButton = document.getElementById('btn-guardar-sermon');
    submitButton.disabled = true;
    submitButton.textContent = 'Procesando...';

    const payload = {
        titulo: document.getElementById('titulo').value,
        predicador: document.getElementById('predicador').value,
        fecha: document.getElementById('fecha').value,
        youtubeUrl: document.getElementById('youtubeUrl').value,
        descripcion: document.getElementById('descripcion').value
    };

    try {
        const url = state.editingSermonId ? `/api/sermones/${state.editingSermonId}` : '/api/sermones';
        const method = state.editingSermonId ? 'PUT' : 'POST';
        await fetchJson(url, {
            method,
            body: JSON.stringify(payload)
        });

        resetSermonForm();
        await loadSermons();
    } catch (error) {
        handleRequestError(error);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = state.editingSermonId ? 'Actualizar Sermon' : 'Guardar Sermon';
    }
}

async function handleEventSubmit(event) {
    event.preventDefault();

    const submitButton = document.getElementById('btn-guardar-evento');
    const fileInput = document.getElementById('ev-imagen');
    const videoInput = document.getElementById('ev-video');
    submitButton.disabled = true;
    submitButton.textContent = 'Subiendo...';

    try {
        let imagePayload = '';
        if (fileInput.files.length > 0) {
            imagePayload = await readImageAsDataUrl(fileInput.files[0]);
        } else if (state.editingEventId) {
            const currentEvent = state.events.find((item) => item.id === state.editingEventId);
            imagePayload = currentEvent ? currentEvent.imagen || '' : '';
        }

        let videoPayload = '';
        if (videoInput && videoInput.files.length > 0) {
            videoPayload = await readVideoAsDataUrl(videoInput.files[0]);
        } else if (state.editingEventId) {
            const currentEvent = state.events.find((item) => item.id === state.editingEventId);
            videoPayload = currentEvent ? currentEvent.video || '' : '';
        }

        const payload = {
            titulo: document.getElementById('ev-titulo').value,
            categoria: document.getElementById('ev-categoria').value,
            lugar: document.getElementById('ev-lugar').value,
            fecha: document.getElementById('ev-fecha').value,
            hora: document.getElementById('ev-hora').value,
            imagen: imagePayload,
            video: videoPayload,
            youtubeUrl: document.getElementById('ev-youtubeUrl') ? document.getElementById('ev-youtubeUrl').value : '',
            descripcion: document.getElementById('ev-descripcion').value
        };

        const url = state.editingEventId ? `/api/eventos/${state.editingEventId}` : '/api/eventos';
        const method = state.editingEventId ? 'PUT' : 'POST';
        await fetchJson(url, {
            method,
            body: JSON.stringify(payload)
        });

        resetEventForm();
        await loadEvents();
    } catch (error) {
        handleRequestError(error);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = state.editingEventId ? 'Actualizar Evento' : 'Guardar Evento';
    }
}

async function handlePasswordSubmit(event) {
    event.preventDefault();

    const submitButton = document.getElementById('btn-guardar-password');
    submitButton.disabled = true;
    submitButton.textContent = 'Actualizando...';
    setPasswordFeedback('Procesando cambio de contrasena...', 'text-muted');

    try {
        await fetchJson('/api/cuenta/password', {
            method: 'POST',
            body: JSON.stringify({
                currentPassword: document.getElementById('password-actual').value,
                newPassword: document.getElementById('password-nueva').value,
                confirmPassword: document.getElementById('password-confirmacion').value
            })
        });

        resetPasswordForm(true);
        setPasswordFeedback('Contrasena actualizada correctamente.', 'text-success');
    } catch (error) {
        setPasswordFeedback(error.message || 'No se pudo actualizar la contrasena.', 'text-danger');
        handleRequestError(error, { silent: true });
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Actualizar contrasena';
    }
}

function togglePasswordForm() {
    const form = document.getElementById('formPassword');
    form.classList.toggle('d-none');

    if (form.classList.contains('d-none')) {
        resetPasswordForm(false);
    } else {
        document.getElementById('password-actual').focus();
    }
}

function resetSermonForm() {
    state.editingSermonId = '';
    document.getElementById('formSermon').reset();
    document.getElementById('sermonId').value = '';
    const submitButton = document.getElementById('btn-guardar-sermon');
    submitButton.textContent = 'Guardar Sermon';
    submitButton.classList.remove('btn-state-edit');
}

function resetEventForm() {
    state.editingEventId = '';
    document.getElementById('formEvento').reset();
    document.getElementById('eventoId').value = '';
    if (document.getElementById('ev-video')) document.getElementById('ev-video').value = '';
    if (document.getElementById('ev-youtubeUrl')) document.getElementById('ev-youtubeUrl').value = '';
    if (document.getElementById('ev-categoria') && state.session && state.session.permissions.lockedEventCategory) {
        document.getElementById('ev-categoria').value = state.session.permissions.lockedEventCategory;
    }
    const submitButton = document.getElementById('btn-guardar-evento');
    submitButton.textContent = 'Guardar Evento';
    submitButton.classList.remove('btn-state-edit');
}

function resetPasswordForm(keepOpen) {
    const form = document.getElementById('formPassword');
    form.reset();
    setPasswordFeedback(defaultPasswordFeedback, 'text-muted');

    if (!keepOpen) {
        form.classList.add('d-none');
    }
}

function setPasswordFeedback(message, className) {
    const feedback = document.getElementById('password-feedback');
    feedback.className = `small ${className}`;
    feedback.textContent = message;
}

async function loadSermons() {
    const sermons = await fetchJson('/api/sermones');
    state.sermons = Array.isArray(sermons) ? sermons : [];
    renderSermons();
}

function renderSermons() {
    const tbody = document.getElementById('lista-sermones-admin');
    tbody.replaceChildren();

    if (state.sermons.length === 0) {
        appendPlaceholderRow(tbody, 4, 'No hay sermones.');
        return;
    }

    state.sermons.slice().reverse().forEach((sermon) => {
        const row = document.createElement('tr');

        row.appendChild(createCell(sermon.fecha, 'ps-4 text-muted small'));
        row.appendChild(createCell(sermon.titulo, 'fw-bold'));
        row.appendChild(createCell(sermon.predicador, 'text-secondary small'));

        const actionsCell = document.createElement('td');
        actionsCell.className = 'text-end pe-4';

        const editButton = createIconButton('btn btn-sm btn-outline-primary me-1', 'Editar', 'fas fa-edit');
        editButton.addEventListener('click', () => prepareSermonEdit(sermon.id));

        const deleteButton = createIconButton('btn btn-sm btn-outline-danger', 'Eliminar', 'fas fa-trash-alt');
        deleteButton.addEventListener('click', () => {
            deleteSermon(sermon.id).catch(handleRequestError);
        });

        actionsCell.append(editButton, deleteButton);
        row.appendChild(actionsCell);
        tbody.appendChild(row);
    });
}

function prepareSermonEdit(sermonId) {
    const sermon = state.sermons.find((item) => item.id === sermonId);
    if (!sermon) {
        return;
    }

    state.editingSermonId = sermon.id;
    document.getElementById('sermonId').value = sermon.id;
    document.getElementById('titulo').value = sermon.titulo || '';
    document.getElementById('predicador').value = sermon.predicador || '';
    document.getElementById('fecha').value = sermon.fecha || '';
    document.getElementById('youtubeUrl').value = sermon.youtubeUrl || '';
    document.getElementById('descripcion').value = sermon.descripcion || '';

    const submitButton = document.getElementById('btn-guardar-sermon');
    submitButton.textContent = 'Actualizar Sermon';
    submitButton.classList.add('btn-state-edit');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteSermon(sermonId) {
    if (!window.confirm('Eliminar sermon?')) {
        return;
    }

    await fetchJson(`/api/sermones/${sermonId}`, { method: 'DELETE' });

    if (state.editingSermonId === sermonId) {
        resetSermonForm();
    }

    await loadSermons();
}

async function loadEvents() {
    const events = await fetchJson('/api/eventos');
    state.events = Array.isArray(events) ? events : [];
    if (state.session && state.session.permissions.lockedEventCategory) {
        state.events = state.events.filter((event) => event.categoria === state.session.permissions.lockedEventCategory);
    }
    state.events.sort((first, second) => new Date(first.fecha) - new Date(second.fecha));
    renderEvents();
}

function renderEvents() {
    const tbody = document.getElementById('lista-eventos-admin');
    tbody.replaceChildren();

    if (state.events.length === 0) {
        appendPlaceholderRow(tbody, 4, 'No hay eventos.');
        return;
    }

    state.events.forEach((event) => {
        const row = document.createElement('tr');

        const imageCell = document.createElement('td');
        imageCell.className = 'ps-4';
        const image = document.createElement('img');
        image.src = event.imagen || placeholderImage;
        image.alt = event.titulo || 'Evento';
        image.className = 'rounded';
        image.style.width = '60px';
        image.style.height = '40px';
        image.style.objectFit = 'cover';
        imageCell.appendChild(image);

        const dateCell = document.createElement('td');
        dateCell.className = 'text-muted small';
        dateCell.append(
            createIconText('far fa-calendar-alt me-1', event.fecha),
            document.createElement('br'),
            createIconText('far fa-clock me-1', event.hora)
        );

        const infoCell = document.createElement('td');
        const title = document.createElement('div');
        title.className = 'fw-bold';
        title.textContent = event.titulo || '';

        const badge = document.createElement('span');
        badge.className = `badge ms-2 ${categoryBadgeClasses[event.categoria] || 'bg-secondary'}`;
        badge.textContent = categoryLabels[event.categoria] || categoryLabels.general;
        title.appendChild(badge);

        const place = document.createElement('div');
        place.className = 'text-secondary small';
        place.appendChild(createIconText('fas fa-map-marker-alt me-1 text-danger', event.lugar));

        const mediaInfo = document.createElement('div');
        mediaInfo.className = 'd-flex flex-wrap gap-2 mt-2';
        if (event.youtubeUrl) {
            mediaInfo.appendChild(createMediaBadge('YouTube', 'text-bg-danger'));
        }
        if (event.video) {
            mediaInfo.appendChild(createMediaBadge('Video adjunto', 'text-bg-dark'));
        }

        infoCell.append(title, place);
        if (mediaInfo.childNodes.length > 0) {
            infoCell.appendChild(mediaInfo);
        }

        const actionsCell = document.createElement('td');
        actionsCell.className = 'text-end pe-4';

        const editButton = createIconButton('btn btn-sm btn-outline-primary me-1', 'Editar', 'fas fa-edit');
        editButton.addEventListener('click', () => prepareEventEdit(event.id));

        const deleteButton = createIconButton('btn btn-sm btn-outline-danger', 'Eliminar', 'fas fa-trash-alt');
        deleteButton.addEventListener('click', () => {
            deleteEvent(event.id).catch(handleRequestError);
        });

        actionsCell.append(editButton, deleteButton);
        row.append(imageCell, dateCell, infoCell, actionsCell);
        tbody.appendChild(row);
    });
}

function prepareEventEdit(eventId) {
    const event = state.events.find((item) => item.id === eventId);
    if (!event) {
        return;
    }

    state.editingEventId = event.id;
    document.getElementById('eventoId').value = event.id;
    document.getElementById('ev-titulo').value = event.titulo || '';
    document.getElementById('ev-categoria').value = event.categoria || 'general';
    document.getElementById('ev-lugar').value = event.lugar || '';
    document.getElementById('ev-fecha').value = event.fecha || '';
    document.getElementById('ev-hora').value = event.hora || '';
    document.getElementById('ev-imagen').value = '';
    if (document.getElementById('ev-video')) document.getElementById('ev-video').value = '';
    if (document.getElementById('ev-youtubeUrl')) document.getElementById('ev-youtubeUrl').value = event.youtubeUrl || '';
    document.getElementById('ev-descripcion').value = event.descripcion || '';

    const submitButton = document.getElementById('btn-guardar-evento');
    submitButton.textContent = 'Actualizar Evento';
    submitButton.classList.add('btn-state-edit');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteEvent(eventId) {
    if (!window.confirm('Eliminar evento?')) {
        return;
    }

    await fetchJson(`/api/eventos/${eventId}`, { method: 'DELETE' });

    if (state.editingEventId === eventId) {
        resetEventForm();
    }

    await loadEvents();
}

async function loadMessages() {
    const messages = await fetchJson('/api/mensajes');
    renderMessages(Array.isArray(messages) ? messages : []);
}

function renderMessages(messages) {
    const tbody = document.getElementById('lista-mensajes-admin');
    const badge = document.getElementById('badge-mensajes');
    let unreadCount = 0;

    tbody.replaceChildren();

    if (!messages.length) {
        appendPlaceholderRow(tbody, 4, 'Bandeja vacia. No hay mensajes nuevos.');
        badge.style.display = 'none';
        return;
    }

    messages.slice().reverse().forEach((message) => {
        if (!message.leido) {
            unreadCount += 1;
        }

        const row = document.createElement('tr');
        if (!message.leido) {
            row.classList.add('mensaje-no-leido');
        }

        row.appendChild(createCell(message.fecha || 'Sin fecha', 'ps-4 text-muted small'));

        const senderCell = document.createElement('td');
        const sender = document.createElement('div');
        sender.className = 'fw-bold';
        sender.textContent = message.nombre || 'Anonimo';

        if (!message.leido) {
            const newBadge = document.createElement('span');
            newBadge.className = 'badge bg-danger ms-2 small';
            newBadge.textContent = 'Nuevo';
            sender.appendChild(newBadge);
        }

        const contactLine = document.createElement('div');
        contactLine.className = 'text-primary small';
        const isEmail = String(message.contacto || '').includes('@');
        contactLine.appendChild(createIconText(isEmail ? 'fas fa-envelope' : 'fab fa-whatsapp', message.contacto || 'Sin contacto'));
        senderCell.append(sender, contactLine);

        const messageCell = document.createElement('td');
        messageCell.className = 'text-secondary small';
        messageCell.style.maxWidth = '300px';
        messageCell.textContent = message.mensaje || '';

        const actionsCell = document.createElement('td');
        actionsCell.className = 'text-end pe-4';

        if (!message.leido) {
            const readButton = createIconButton('btn btn-sm btn-outline-success me-1', 'Marcar como leido', 'fas fa-check');
            readButton.addEventListener('click', () => {
                markMessageAsRead(message.id).catch(handleRequestError);
            });
            actionsCell.appendChild(readButton);
        }

        const replyLink = document.createElement('a');
        replyLink.className = 'btn btn-sm btn-outline-primary me-1';
        replyLink.target = '_blank';
        replyLink.rel = 'noopener noreferrer';
        replyLink.title = 'Responder';
        replyLink.href = buildReplyLink(message);
        replyLink.innerHTML = `<i class="${String(message.contacto || '').includes('@') ? 'fas fa-envelope' : 'fab fa-whatsapp'}"></i>`;

        const deleteButton = createIconButton('btn btn-sm btn-outline-danger', 'Eliminar', 'fas fa-trash-alt');
        deleteButton.addEventListener('click', () => {
            deleteMessage(message.id).catch(handleRequestError);
        });

        actionsCell.append(replyLink, deleteButton);
        row.append(senderCell, messageCell, actionsCell);
        tbody.appendChild(row);
    });

    if (unreadCount > 0) {
        badge.textContent = String(unreadCount);
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

async function markMessageAsRead(messageId) {
    await fetchJson(`/api/mensajes/${messageId}`, { method: 'PUT' });
    await loadMessages();
}

async function deleteMessage(messageId) {
    if (!window.confirm('Eliminar este mensaje permanentemente?')) {
        return;
    }

    await fetchJson(`/api/mensajes/${messageId}`, { method: 'DELETE' });
    await loadMessages();
}

function buildReplyLink(message) {
    const contact = String(message.contacto || '').trim();
    if (contact.includes('@')) {
        return `mailto:${contact}?subject=Respuesta%20de%20IPUB%20Tupiza`;
    }

    const phone = contact.replace(/\D/g, '');
    if (!phone) {
        return '#';
    }

    const name = encodeURIComponent(message.nombre || '');
    return `https://wa.me/${phone}?text=Hola%20${name},%20somos%20de%20la%20IPUB%20Tupiza.%20Recibimos%20tu%20mensaje.`;
}

async function logout() {
    try {
        await fetchJson('/api/logout', { method: 'POST' });
    } finally {
        redirectToLogin();
    }
}

function bindInactivityTimer() {
    const reset = () => {
        clearTimeout(state.inactivityTimer);
        state.inactivityTimer = setTimeout(() => {
            logout().catch(handleRequestError);
        }, 15 * 60 * 1000);
    };

    ['mousemove', 'mousedown', 'keydown', 'touchstart'].forEach((eventName) => {
        document.addEventListener(eventName, reset, { passive: true });
    });

    reset();
}

async function readImageAsDataUrl(file) {
    if (!file) {
        return '';
    }

    if (file.size > 5 * 1024 * 1024) {
        throw new Error('La imagen supera el tamano maximo de 5 MB.');
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
        reader.readAsDataURL(file);
    });
}

async function readVideoAsDataUrl(file) {
    if (!file) {
        return '';
    }

    if (file.size > 50 * 1024 * 1024) {
        throw new Error('El video supera el tamano maximo de 50 MB.');
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('No se pudo leer el video.'));
        reader.readAsDataURL(file);
    });
}

async function fetchJson(url, options = {}) {
    const requestOptions = { ...options };
    requestOptions.headers = { ...(options.headers || {}) };

    if (requestOptions.body && !requestOptions.headers['Content-Type']) {
        requestOptions.headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, requestOptions);
    const isJson = (response.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await response.json() : null;

    if (!response.ok) {
        const error = new Error((data && data.mensaje) || 'Ocurrio un error.');
        error.status = response.status;
        throw error;
    }

    return data;
}

function appendPlaceholderRow(tbody, columns, message) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = columns;
    cell.className = 'text-center py-4 text-muted';
    cell.textContent = message;
    row.appendChild(cell);
    tbody.appendChild(row);
}

function createCell(text, className = '') {
    const cell = document.createElement('td');
    cell.className = className;
    cell.textContent = text || '';
    return cell;
}

function createIconButton(className, title, iconClass) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = title;
    button.innerHTML = `<i class="${iconClass}"></i>`;
    return button;
}

function createIconText(iconClass, text) {
    const fragment = document.createDocumentFragment();
    const icon = document.createElement('i');
    icon.className = iconClass;
    fragment.appendChild(icon);
    fragment.appendChild(document.createTextNode(` ${text || ''}`));
    return fragment;
}

function createMediaBadge(text, className) {
    const badge = document.createElement('span');
    badge.className = `badge ${className}`;
    badge.textContent = text;
    return badge;
}

function handleRequestError(error, options = {}) {
    if (error && error.status === 401) {
        redirectToLogin();
        return;
    }

    if (!options.silent) {
        window.alert(error && error.message ? error.message : 'Ocurrio un error.');
    }
}

function handleFatalError(error) {
    console.error('No se pudo iniciar el panel:', error);
    showFatalPanelMessage(error && error.message ? error.message : 'No se pudo iniciar el panel.');
    handleRequestError(error, { silent: true });
}

function redirectToLogin() {
    window.location.replace('/admin.html');
}

function showFatalPanelMessage(message) {
    const title = document.getElementById('titulo-seccion');
    const roleBadge = document.getElementById('rol-badge');
    const username = document.getElementById('usuario-actual');
    const contentArea = document.querySelector('.content-area');

    if (title) {
        title.textContent = 'Panel no disponible';
    }

    if (roleBadge) {
        roleBadge.textContent = 'Error';
        roleBadge.className = 'badge bg-danger';
    }

    if (username) {
        username.textContent = 'No se pudo cargar';
    }

    if (contentArea && !document.getElementById('panel-error-alert')) {
        const alert = document.createElement('div');
        alert.id = 'panel-error-alert';
        alert.className = 'alert alert-danger';
        alert.textContent = message;
        contentArea.prepend(alert);
    }
}
