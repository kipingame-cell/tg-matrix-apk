// TG MATRIX KIT — APK core: GramJS прямо в WebView, без сервера.
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { computeCheck } from 'telegram/Password';
import JSZip from 'jszip';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { FileOpener } from '@capacitor-community/file-opener';

const $ = (id) => document.getElementById(id);
const log = (msg, color) => {
    const box = $('mon_logs'); if (!box) return;
    const div = document.createElement('div');
    div.textContent = `[${new Date().toLocaleTimeString()}] > ${msg}`;
    if (color) div.style.color = color;
    div.style.cssText += 'border-bottom:1px dashed #222;padding-bottom:3px;margin-bottom:3px;';
    box.appendChild(div); box.scrollTop = box.scrollHeight;
};

// --- НАСТРОЙКИ / КЛЮЧИ ---
const cfg = {
    get apiId() { return parseInt(localStorage.getItem('tgk_api_id') || '6'); },
    get apiHash() { return localStorage.getItem('tgk_api_hash') || 'eb06d4abfb49dc3eeb1aeb98ae0f581e'; },
    get botToken() { return localStorage.getItem('tgk_bot_token') || ''; },
    get botChat() { return localStorage.getItem('tgk_bot_chat') || ''; },
    get gemini() { return localStorage.getItem('tgk_gemini') || ''; },
    get groq() { return localStorage.getItem('tgk_groq') || ''; }
};
function bindSettings() {
    const map = { set_api_id: 'tgk_api_id', set_api_hash: 'tgk_api_hash', set_bot_token: 'tgk_bot_token', set_bot_chat: 'tgk_bot_chat', set_gemini: 'tgk_gemini', set_groqмагниты: 'tgk_groq', auth_api_id: 'tgk_api_id', auth_api_hash: 'tgk_api_hash' };
    Object.entries(map).forEach(([id, key]) => {
        const el = $(id); if (!el) return;
        el.value = localStorage.getItem(key) || '';
        // 'input', а не 'change': на мобильном change может не сработать до нажатия кнопки
        el.oninput = () => {
            localStorage.setItem(key, el.value.trim());
            // зеркалим в парное поле (экран входа <-> панель настроек)
            Object.entries(map).forEach(([oid, okey]) => {
                if (okey === key && oid !== id) { const o = $(oid); if (o) o.value = el.value; }
            });
            // смена API-ключей = другой клиент候: старая сессия невалидна
            if (key === 'tgk_api_id' || key === 'tgk_api_hash') {
                localStorage.removeItem('tgk_session');
                try { if (client) client.disconnect(); } catch (e) {}
                client = null;
            }
        };
    });
}

// --- TELEGRAM CLIENT ---
let client = null;
let phoneCodeHash = null;
let phoneGlobal = null;
let dialogMap = new Map(); // idStr -> entity
let allChats = [];

async function ensureClient() {
    if (client && client.connected) return client;
    const sess = new StringSession(localStorage.getItem('tgk_session') || '');
    client = new TelegramClient(sess, cfg.apiId, cfg.apiHash, {
        connectionRetries: 5,
        retryDelay: 1000,
        useWSS: true,
        // Маскировка под официальный клиент (Samsung S23 Ultra / Android 13 / 9.6.5)
        deviceModel: 'Samsung Galaxy S23 Ultra',
        systemVersion: 'Android 13.0',
        appVersion: '9.6.5',
        langCode: 'ru',
        systemLangCode: 'ru-RU'
    });
    await client.connect();
    return client;
}
function saveSession() {
    try { localStorage.setItem('tgk_session', client.session.save()); } catch (e) {}
}
const fmtErr = (e) => (e && (e.errorMessage || e.message)) || String(e);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- АВТОРИЗАЦИЯ ---
async function doSendCode() {
    const phone = $('phone').value.trim();
    if (!phone) return alert('ВВЕДИ НОМЕР');
    const btn = $('connect_btn');
    btn.disabled = true; btn.innerText = 'ПОДКЛЮЧЕНИЕ... (ДО 60 СЕК)';
    try {
        await ensureClient();
        const res = await client.invoke(new Api.auth.SendCode({
            phoneNumber: phone, apiId: cfg.apiId, apiHash: cfg.apiHash,
            settings: new Api.CodeSettings({})
        }));
        phoneCodeHash = res.phoneCodeHash; phoneGlobal = phone;
        $('code_block').classList.remove('hidden');
        btn.innerText = 'ОТПРАВИТЬ КОД';
        showResendButton();
        alert('КОД ОТПРАВЛЕН. КАНАЛ: ' + (res.type?.className || 'TELEGRAM'));
    } catch (e) {
        alert('СБОЙ: ' + fmtErr(e));
        btn.innerText = 'УСТАНОВИТЬ СВЯЗЬ';
    }
    btn.disabled = false;
}

async function doResendCode() {
    const rb = $('resend_code_btn');
    rb.disabled = true; rb.innerText = 'ПЕРЕОТПРАВКА...';
    try {
        const res = await client.invoke(new Api.auth.ResendCode({ phoneNumber: phoneGlobal, phoneCodeHash }));
        phoneCodeHash = res.phoneCodeHash;
        rb.innerText = 'ОТПРАВЛЕНО: ' + (res.type?.className || 'ПОВТОР');
    } catch (e) { rb.innerText = 'СБОЙ: ' + fmtErr(e); }
    rb.disabled = false;
    setTimeout(() => { rb.innerText = 'КОД НЕ ПРИШЁЛ? ВЫСЛАТЬ ПО SMS/ЗВОНКОМ'; }, 5000);
}

function showResendButton() {
    let rb = $('resend_code_btn');
    if (!rb) {
        rb = document.createElement('button');
        rb.id = 'resend_code_btn';
        rb.innerText = 'КОД НЕ ПРИШЁЛ? ВЫСЛАТЬ ПО SMS/ЗВОНКОМ';
        rb.style.cssText = 'margin-top:8px;width:100%;padding:8px;background:transparent;border:1px dashed #cc0000;color:#cc0000;font-size:10px;cursor:pointer;letter-spacing:1px;';
        rb.onclick = (e) => { e.preventDefault(); doResendCode(); };
        $('code_block').appendChild(rb);
    }
    rb.classList.remove('hidden');
}

async function doSignInCode() {
    const code = $('code').value.trim();
    if (!code) return alert('ВВЕДИ КОД');
    const btn = $('connect_btn');
    btn.disabled = true; btn.innerText = 'ПРОВЕРКА КОДА...';
    try {
        await client.invoke(new Api.auth.SignIn({ phoneNumber: phoneGlobal, phoneCodeHash, phoneCode: code }));
        saveSession();
        alert('СВЯЗЬ УСТАНОВЛЕНА!');
        initControl();
    } catch (e) {
        if (fmtErr(e).includes('SESSION_PASSWORD_NEEDED')) {
            $('code_block').classList.add('hidden');
            $('password_block').classList.remove('hidden');
            btn.innerText = 'ОТПРАВИТЬ ПАРОЛЬ';
        } else alert('ОШИБКА КОДА: ' + fmtErr(e));
    }
    btn.disabled = false; if (btn.innerText === 'ПРОВЕРКА КОДА...') btn.innerText = 'ОТПРАВИТЬ КОД';
}

async function doPassword() {
    const pwd = $('password').value;
    if (!pwd) return alert('ВВЕДИ ПАРОЛЬ 2FA');
    const btn = $('connect_btn');
    btn.disabled = true; btn.innerText = 'ПРОВЕРКА 2FA...';
    try {
        const pwState = await client.invoke(new Api.account.GetPassword());
        const check = await computeCheck(pwState, pwd);
        await client.invoke(new Api.auth.CheckPassword({ password: check }));
        saveSession();
        alert('СВЯЗЬ УСТАНОВЛЕНА!');
        initControl();
    } catch (e) { alert('ОШИБКА 2FA: ' + fmtErr(e)); }
    btn.disabled = false; btn.innerText = 'УСТАНОВИТЬ СВЯЗЬ';
}

// --- БАЗА ЧАТОВ ---
async function scanChats(silent = false) {
    const list = $('chat_list');
    if (!silent && list) list.innerHTML = '<div style="color:#aaa;font-size:10px;text-align:center;padding:15px;">СКАНИРОВАНИЕ СЕТИ...</div>';
    try {
        await ensureClient();
        const dialogs = await client.getDialogs({});
        dialogMap = new Map();
        allChats = [];
        dialogs.forEach(d => {
            const ent = d.entity;
            if (!ent || !ent.id) return;
            const id = ent.id.toString();
            const name = d.title || d.name || [ent.firstName, ent.lastName].filter(Boolean).join(' ') || ent.username || id;
            dialogMap.set(id, ent);
            allChats.push({ id, name });
        });
        localStorage.setItem('tgk_chats', JSON.stringify(allChats));
        renderChats();
    } catch (e) {
        if (!silent && list) list.innerHTML = '<div style="color:#c00;font-size:10px;text-align:center;padding:15px;">ОШИБКА БАЗЫ: ' + fmtErr(e) + '</div>';
    }
}

function renderChats() {
    const query = ($('chat_search')?.value || '').toLowerCase();
    const sort = $('chat_sort')?.value || 'az';
    const list = $('chat_list'); if (!list) return;
    let filtered = allChats.filter(c => c.name.toLowerCase().includes(query));
    filtered.sort((a, b) => sort === 'az' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
    if (!filtered.length) { list.innerHTML = '<div style="color:#5a5a5f;font-size:10px;text-align:center;padding:15px;">СОВПАДЕНИЙ НЕ НАЙДЕНО</div>'; return; }
    list.innerHTML = '';
    filtered.forEach(c => {
        const div = document.createElement('div');
        div.id = 'chat-item-' + c.id;
        div.style.cssText = 'cursor:pointer;padding:10px;border-bottom:1px solid #111;border-left:3px solid transparent;font-size:12px;color:#aaa;word-break:break-word;';
        div.textContent = c.name;
        div.onclick = () => selectChat(c.id, c.name);
        list.appendChild(div);
    });
}

async function selectChat(id, name) {
    $('dialogs_dropdown').value = id;
    $('selected_chat_display').innerText = 'ВЫБРАН: ' + name;
    localStorage.setItem('tgk_sel', JSON.stringify({ id, name }));
    document.querySelectorAll('[id^="chat-item-"]').forEach(el => { el.style.background = 'transparent'; el.style.borderLeft = '3px solid transparent'; });
    const active = $('chat-item-' + id);
    if (active) { active.style.background = '#1a1a24'; active.style.borderLeft = '3px solid #cc0000'; }

    // Топики форума
    const ent = dialogMap.get(id);
    const topicBlock = $('topic_block'), topicSel = $('topic_select');
    if (topicBlock && topicSel) {
        if (ent && ent.forum) {
            topicBlock.classList.remove('hidden');
            topicSel.innerHTML = '<option value="">ВСЕ ТОПИКИ</option><option value="-1" disabled>ЗАГРУЗКА ТОПИКОВ...</option>';
            try {
                const res = await client.invoke(new Api.channels.GetForumTopics({ channel: ent, offsetDate: 0, offsetId:, offsetTopic: 0, limit: 100 }));
                topicSel.innerHTML = '<option value="">ВСЕ ТОПИКИ</option>';
                (res.topics || []).forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id; opt.text = t.title;
                    topicSel.appendChild(opt);
                });
            } catch (e) {
                topicSel.innerHTML = '<option value="">ТОПИКИ НЕДОСТУПНЫ</option>';
            }
 of]}       } else {
            topicBlock.classList.add('hidden');
            topicSel.innerHTML = '<option value="">ВСЕ ТОПИКИ</option>';
        }
    }

    // Участники (для фильтра и резолва @username)
    const uDrop = $('fromUser');
    uDrop.innerHTML = '<option value="">СКАНИРОВАНИЕ...</option>';
    try {
        const parts = await client.getParticipants(ent, { limit: 400 });
        window._usernameMap = new Map();
        uDrop.innerHTML = `<option value="">ВСЕ УЧАСТНИКИ (${parts.length})</option>`;
        parts.forEach(p => {
            const pid = p.id?.toString();
            const nm = [p.firstName, p.lastName].filter(Boolean).join(' ') || p.username || pid;
            if (p.username) window._usernameMap.set(p.username.toLowerCase(), pid);
            const opt = document.createElement('option'); opt.value = pid; opt.text = nm; uDrop.appendChild(opt);
        });
    } catch (e) {
        window._usernameMap = new Map();
        uDrop.innerHTML = '<option value="">УЧАСТНИКИ НЕДОСТУПНЫ</option>';
    }
}
