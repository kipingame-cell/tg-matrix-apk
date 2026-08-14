// TG MATRIX KIT — APK core: GramJS прямо в WebView, без сервера.
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { computeCheck } from 'telegram/Password';
import JSZip from 'jszip';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

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
    const map = { set_api_id: 'tgk_api_id', set_api_hash: 'tgk_api_hash', set_bot_token: 'tgk_bot_token', set_bot_chat: 'tgk_bot_chat', set_gemini: 'tgk_gemini', set_groq: 'tgk_groq', auth_api_id: 'tgk_api_id', auth_api_hash: 'tgk_api_hash' };
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
            // смена API-ключей = другой клиент: старая сессия невалидна
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
                const res = await client.invoke(new Api.channels.GetForumTopics({ channel: ent, offsetDate: 0, offsetId: 0, offsetTopic: 0, limit: 100 }));
                topicSel.innerHTML = '<option value="">ВСЕ ТОПИКИ</option>';
                (res.topics || []).forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id; opt.text = t.title;
                    topicSel.appendChild(opt);
                });
            } catch (e) {
                topicSel.innerHTML = '<option value="">ТОПИКИ НЕДОСТУПНЫ</option>';
            }
        } else {
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

// --- ЭКСПОРТ ---
let exportAbort = false;
let lastResult = null; // {zipName, base64, graphText, heatJson, count}

async function resolveSender(idStr, cache) {
    if (cache.has(idStr)) return cache.get(idStr);
    let name = 'ID' + idStr;
    try {
        const ent = await client.getEntity(idStr);
        name = [ent.firstName, ent.lastName].filter(Boolean).join(' ') || ent.title || ent.username || name;
    } catch (e) {}
    cache.set(idStr, name);
    return name;
}

// --- ДОСЬЕ: автовыбор модели + резервный канал ---
async function discoverGeminiModels(key) {
    try {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`);
        const jr = await resp.json();
        const rank = (n) => {
            let s = 0;
            if (n.includes('flash')) s += 100;
            if (n.includes('lite')) s += 20;
            if (n.includes('pro')) s += 50;
            const ver = n.match(/(\d+(?:\.\d+)?)/);
            if (ver) s += parseFloat(ver[1]) * 10;
            if (/image|tts|embed|aqa|vision|audio|robotics|computer-use/i.test(n)) s -= 10000;
            return s;
        };
        return (jr.models || [])
            .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
            .map(m => m.name.replace('models/', ''))
            .sort((a, b) => rank(b) - rank(a));
    } catch (e) { return []; }
}

async function tryGeminiModel(key, model, prompt) {
    try {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const jr = await resp.json();
        const txt = jr.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || null;
        if (txt && txt.length > 20) return txt;
        return { error: jr.error ? `${jr.error.code}: ${(jr.error.message || '').slice(0, 120)}` : 'EMPTY' };
    } catch (e) { return { error: fmtErr(e) }; }
}

async function genDossier(prompt) {
    const key = cfg.gemini;
    if (key) {
        // 1) Узнаём у Google, какие модели живы, и идём по списку от лучшей
        let models = await discoverGeminiModels(key);
        if (!models.length) {
            log('ДОСЬЕ: список моделей не получен, иду по запасному порядку...', '#fbc02d');
            models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
        } else {
            log(`ДОСЬЕ: доступно моделей: ${models.length}. Первая: ${models[0]}`);
        }
        for (const m of models.slice(0, 8)) {
            const r = await tryGeminiModel(key, m, prompt);
            if (typeof r === 'string') {
                if (m !== models[0]) log('ДОСЬЕ: переключился на ' + m, '#fbc02d');
                return r;
            }
            log(`ДОСЬЕ: ${m} отказал (${r.error}), пробую следующую...`, '#fbc02d');
            if (/leaked/i.test(r.error)) {
                log('ДОСЬЕ: GOOGLE ЗАБЛОКИРОВАЛ КЛЮЧ КАК УТЁКШИЙ. Сгенерируй новый: aistudio.google.com → Get API key, вставь в КЛЮЧИ И ИНТЕГРАЦИИ.', '#cc0000');
                break;
            }
            await sleep(800);
        }
        log('ДОСЬЕ: Gemini недоступен/лимит. Ухожу на бесплатный резерв...', '#fbc02d');
    }
    // 2) Резерв: Groq — бесплатный тир (ключ: console.groq.com), модели выбираем автоматически
    const gk = cfg.groq;
    if (gk) {
        // Автовыбор живой модели: спрашиваем у Groq список и берём chat-модели по убыванию контекста
        let gmodels = [];
        try {
            const mr = await fetch('https://api.groq.com/openai/v1/models', { headers: { 'Authorization': 'Bearer ' + gk } });
            const mj = await mr.json();
            gmodels = (mj.data || [])
                .filter(m => /llama|mixtral|gemma|qwen|deepseek|gpt/i.test(m.id) && !/guard|whisper|tts|prompt/i.test(m.id))
                .sort((a, b) => (b.context_window || 0) - (a.context_window || 0))
                .map(m => m.id);
        } catch (e) {}
        if (!gmodels.length) {
            log('ДОСЬЕ: список моделей Groq не получен, иду по запасному порядку...', '#fbc02d');
            gmodels = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
        } else {
            log(`ДОСЬЕ: Groq доступно моделей: ${gmodels.length}. Первая: ${gmodels[0]}`);
        }
        // Бесплатный тир режет большие запросы: ужимаем дамп, пока не пролезет
        const sizes = [24000, 12000, 6000, 3000];
        for (const m of gmodels.slice(0, 6)) {
            for (const sz of sizes) {
                try {
                    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + gk },
                        body: JSON.stringify({ model: m, messages: [{ role: 'user', content: prompt.slice(0, sz) }] })
                    });
                    const jr = await resp.json();
                    const txt = jr.choices?.[0]?.message?.content;
                    if (txt && txt.length > 20) {
                        log(`ДОСЬЕ: ответил резерв Groq (${m}${sz < 24000 ? ', дамп ужат до ' + sz : ''})`, '#fbc02d');
                        return txt;
                    }
                    const emsg = (jr.error?.message || 'EMPTY');
                    log(`ДОСЬЕ: Groq ${m} отказал (${emsg.slice(0, 80)})`, '#fbc02d');
                    if (!/too large|413|rate_limit|Request too/i.test(emsg)) break; // ошибка не про размер — следующая модель
                } catch (e) { log('ДОСЬЕ: Groq сбой: ' + fmtErr(e), '#fbc02d'); break; }
                await sleep(800);
            }
        }
    } else {
        log('ДОСЬЕ: резервный GROQ KEY не задан (бесплатно: console.groq.com)', '#fbc02d');
    }
    return 'ОШИБКА: все каналы нейросети недоступны. Проверь GEMINI KEY, добавь GROQ KEY (бесплатно: console.groq.com) или повтори позже.';
}

async function runExport() {
    const chatId = $('dialogs_dropdown').value;
    if (!chatId) return alert('ОБЪЕКТ НЕ ВЫБРАН');
    const ent = dialogMap.get(chatId);
    if (!ent) return alert('БАЗА УСТАРЕЛА. ЖМИ ⟳ И ВЫБЕРИ ЗАНОВО');

    exportAbort = false;
    $('cyber_monitor').classList.remove('hidden');
    $('export_btn').classList.add('hidden');
    $('stop_btn').classList.remove('hidden');
    ['download_btn', 'view_graph_btn', 'view_heatmap_btn'].forEach(i => $(i)?.classList.add('hidden'));
    $('mon_logs').innerHTML = '';

    const topicId = ($('topic_select') && $('topic_select').value && parseInt($('topic_select').value) > 0) ? parseInt($('topic_select').value) : null;

    const limit = parseInt($('limit').value) || 1000;
    const keywords = $('keywords').value.trim().toLowerCase();
    const kwList = keywords ? keywords.split(',').map(s => s.trim()).filter(Boolean) : [];
    const fromUser = $('fromUser').value;
    const df = $('dateFrom').value ? new Date($('dateFrom').value).getTime() : null;
    const dt = $('dateTo').value ? new Date($('dateTo').value).getTime() : null;
    const buildGraph = $('buildGraph').checked, buildHeatmap = $('buildHeatmap').checked;
    const buildDossier = $('buildDossier').checked;
    const buildMedia = $('buildMedia') && $('buildMedia').checked;
    const mediaFiles = [];   // {name, data: Buffer}
    const textOnly = $('exportMode').value === 'text';

    log('ЦЕЛЬ ЗАХВАЧЕНА. НАЧИНАЮ ПЕРЕХВАТ...');

    const senders = new Map();   // idStr -> name
    const records = [];          // {id, date, sender, senderId, text, replyTo, mentions, reactions}
    const msgSender = new Map(); // msgId -> senderId (для реплаев)
    let processed = 0;

    const updMon = () => {
        $('mon_speed').innerText = processed;
        $('mon_exported').innerText = records.length;
        $('mon_progress').style.width = Math.min(100, Math.round(records.length / limit * 100)) + '%';
        $('mon_processed').innerText = `${records.length} / ${limit}`;
    };

    try {
        const iterOpts = { limit };
        if (topicId) iterOpts.replyTo = topicId;
        for await (const m of client.iterMessages(ent, iterOpts)) {
            if (exportAbort) break;
            processed++;

            // Обход лимитов API: пауза-джиттер каждые 50 обработанных (как на сайте)
            if (processed % 50 === 0) {
                updMon();
                const jitter = Math.floor(Math.random() * 2000) + 1000;
                log(`[СИСТЕМА] Обход лимитов API. Пауза: ${jitter}ms...`);
                await sleep(jitter);
                if (exportAbort) break;
            }

            if (m.action) continue; // системный мусор
            const text = m.message || '';
            if (textOnly && !text) continue;
            const tsMs = m.date * 1000;
            if (df && tsMs < df) break;      // лента идёт от новых к старым
            if (dt && tsMs > dt) continue;
            const sid = m.senderId ? m.senderId.toString() : (m.fromId ? m.fromId.toString() : null);
            if (fromUser && sid !== fromUser) continue;
            if (kwList.length && !kwList.some(k => text.toLowerCase().includes(k))) continue;

            // Имя отправителя прямо из сообщения — без лишних запросов к API
            let senderName = 'СИСТЕМА';
            if (m.sender) {
                senderName = [m.sender.firstName, m.sender.lastName].filter(Boolean).join(' ') || m.sender.title || m.sender.username || 'Unknown';
                if (m.sender.username) window._usernameMap?.set(m.sender.username.toLowerCase(), sid);
            } else if (sid) {
                senderName = senders.get(sid) || ('ID' + sid);
            }
            if (sid && !senders.has(sid)) senders.set(sid, senderName);

            const mentions = [];
            (m.entities || []).forEach(en => {
                if (en.className === 'MessageEntityMention') {
                    mentions.push(text.substr(en.offset, en.length).replace('@', '').toLowerCase());
                }
            });
            const reactions = [];
            if (m.reactions && m.reactions.recentReactions) {
                m.reactions.recentReactions.forEach(r => {
                    const pid = r.peerId ? r.peerId.toString() : null;
                    if (pid) reactions.push(pid);
                });
            }

            // Превью медиа (как на сайте): миниатюры в zip/media/
            let mediaFile = null;
            if (buildMedia && m.media) {
                try {
                    await sleep(300 + Math.floor(Math.random() * 400));
                    const buff = await client.downloadMedia(m, { thumb: 1 });
                    if (buff) {
                        mediaFile = `media/preview_${m.id}.jpg`;
                        mediaFiles.push({ name: mediaFile, data: buff });
                    }
                } catch (e) { /* превью не критично */ }
            }

            const rec = {
                id: m.id, date: new Date(tsMs).toISOString(), sender: senderName, senderId: sid,
                text, replyTo: m.replyTo ? m.replyTo.replyToMsgId : null, mentions, reactions, media: mediaFile
            };
            records.push(rec);
            if (sid) msgSender.set(m.id, sid);
        }
        updMon();
    } catch (e) {
        const em = fmtErr(e);
        if (/FLOOD_WAIT_(\d+)/.test(em)) {
            const wait = Math.min(parseInt(em.match(/FLOOD_WAIT_(\d+)/)[1]), 120);
            log(`[СИСТЕМА] Telegram просит паузу ${wait}с. Жду...`, '#fbc02d');
            await sleep(wait * 1000);
            log('[СИСТЕМА] Пауза выдержана. Запусти перехват заново — продолжим с того же места.', '#fbc02d');
        } else {
            log('ОШИБКА ПЕРЕХВАТА: ' + em, '#cc0000');
        }
        finishExportUI();
        return;
    }

    if (exportAbort) { log('ПЕРЕХВАТ ОСТАНОВЛЕН ОПЕРАТОРОМ', '#cc0000'); finishExportUI(); return; }
    log(`ПЕРЕХВАЧЕНО ${records.length} СООБЩЕНИЙ. СБОРКА АРХИВА...`);
    $('mon_speed').innerText = processed;
    $('mon_exported').innerText = records.length;
    $('mon_progress').style.width = '100%';
    $('mon_processed').innerText = `${records.length} / ${limit}`;

    // --- ФАЙЛЫ ---
    const topicSuffix = (topicId && $('topic_select').selectedOptions[0]) ? '_' + $('topic_select').selectedOptions[0].text.replace(/[^\wа-яёА-ЯЁ-]+/gi, '_').slice(0, 25) : '';
    const chatName = ($('selected_chat_display').innerText.replace('ВЫБРАН: ', '').split(' → ')[0] || 'chat').replace(/[^\wа-яёА-ЯЁ-]+/gi, '_').slice(0, 40) + topicSuffix;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const zipName = `tgkit_${chatName}_${stamp}.zip`;

    const txtDump = records.map(r => `[${r.date}] ${r.sender}: ${r.text}`).join('\n');
    const json = JSON.stringify(records, null, 1);
    const heatJson = JSON.stringify(records.map(r => ({ user: r.sender, ts: r.date })));

    // Граф: ответы + упоминания + реакции
    let graphText = null;
    if (buildGraph) {
        const counts = new Map(); // name -> messages
        records.forEach(r => counts.set(r.sender, (counts.get(r.sender) || 0) + 1));
        const links = new Map(); // "a->b->type" -> {source,target,type,value}
        const addLink = (a, b, type) => {
            if (!a || !b || a === b) return;
            const k = `${a}->${b}->${type}`;
            const prev = links.get(k);
            links.set(k, { source: a, target: b, type, value: (prev?.value || 0) + 1 });
        };
        records.forEach(r => {
            if (r.replyTo && msgSender.has(r.replyTo)) {
                const targetSid = msgSender.get(r.replyTo);
                const targetName = senders.get(targetSid);
                addLink(r.sender, targetName, 'reply');
            }
            r.mentions.forEach(uname => {
                const pid = window._usernameMap?.get(uname);
                if (pid && senders.has(pid)) addLink(r.sender, senders.get(pid), 'mention');
            });
            r.reactions.forEach(pid => {
                if (senders.has(pid)) addLink(senders.get(pid), r.sender, 'reaction');
            });
        });
        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const nodeIds = new Map([...counts.keys()].map((n, i) => [n, 'n' + i]));
        const xn = [...counts.entries()].map(([n, c]) => `<node id="${nodeIds.get(n)}"><data key="name">${esc(n)}</data><data key="messages">${c}</data></node>`).join('');
        const typeNames = { reply: 'Ответы', mention: 'Упоминания', reaction: 'Реакции' };
        const xe = [...links.values()].map((l, i) => `<edge id="e${i}" source="${nodeIds.get(l.source)}" target="${nodeIds.get(l.target)}"><data key="weight">${l.value}</data><data key="type">${l.type}</data><data key="label">${typeNames[l.type]}</data></edge>`).join('');
        graphText = `<?xml version="1.0" encoding="UTF-8"?>\n<graphml xmlns="http://graphml.graphdrawing.org/xmlns">\n<key id="name" for="node" attr.name="name" attr.type="string"/>\n<key id="messages" for="node" attr.name="messages" attr.type="int"/>\n<key id="weight" for="edge" attr.name="weight" attr.type="int"/>\n<key id="type" for="edge" attr.name="type" attr.type="string"/>\n<key id="label" for="edge" attr.name="label" attr.type="string"/>\n<graph id="G" edgedefault="directed">${xn}${xe}</graph></graphml>`;
        log(`ГРАФ: ${counts.size} узлов, ${links.size} связей`);
    }

    // Досье (нейросеть: автовыбор живой модели Gemini, резерв — Groq бесплатно)
    let dossierText = null;
    if (buildDossier) {
        log('ДОСЬЕ: ЗАПРОС К НЕЙРОСЕТИ...');
        const sample = records.slice(0, 800).map(r => `${r.sender}: ${r.text}`).join('\n').slice(0, 60000);
        const prompt = 'Ты — аналитик. По дампу переписки составь краткое досье на самых активных участников: стиль общения, темы, роль в чате, взаимодействия. Ответ на русском, структурировано.\n\nДАМП:\n' + sample;
        dossierText = await genDossier(prompt);
        if (dossierText && !dossierText.startsWith('ОШИБКА')) log('ДОСЬЕ ГОТОВО');
        else log('ДОСЬЕ СБОЙ: ' + (dossierText || 'ПУСТО'), '#cc0000');
    }

    // HTML-дамп (как на сайте)
    const escH = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const htmlBody = records.map(r =>
        `<div class="msg"><div class="head"><span class="sender">${escH(r.sender)}</span><span>${r.date}</span></div>` +
        `<div class="text">${escH(r.text)}</div>` +
        (r.media ? `<br><img src="${r.media}" style="max-width:250px;border-radius:8px;margin-top:5px;border:1px solid #5a5a5f;">` : '') +
        `</div>`).join('');
    const htmlDump = `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>ПЕРЕХВАТ</title><style>body{background:#0a0a0a;color:#e0e0e0;font-family:monospace;padding:20px;}h1{color:#fbc02d;text-align:center;border-bottom:2px solid #b71c1c;text-transform:uppercase;letter-spacing:3px;font-size:1.3em;padding-bottom:10px;}.msg{border:1px solid #333;padding:12px;margin-bottom:12px;background:#151515;border-left:4px solid #b71c1c;}.head{display:flex;justify-content:space-between;font-size:12px;color:#777;margin-bottom:8px;border-bottom:1px dashed #333;padding-bottom:4px;}.sender{color:#fbc02d;font-weight:bold;text-transform:uppercase;}.text{font-size:14px;line-height:1.5;white-space:pre-wrap;color:#d0d0d0;}</style></head><body><h1>ПЕРЕХВАТ: ${escH(chatName)}</h1>${htmlBody}</body></html>`;

    // ZIP
    const zip = new JSZip();
    zip.file('messages.txt', txtDump);
    zip.file('messages.html', htmlDump);
    zip.file('messages.json', json);
    mediaFiles.forEach(f => zip.file(f.name, f.data));
    if (mediaFiles.length) log(`МЕДИА: ${mediaFiles.length} превью в архиве`);
    if (graphText) zip.file('graph.graphml', graphText);
    if (buildHeatmap) zip.file('heatmap.json', heatJson);
    if (dossierText) zip.file('dossier.txt', dossierText);
    const base64 = await zip.generateAsync({ type: 'base64' });

    lastResult = { zipName, base64, graphText, heatJson, count: records.length };
    localStorage.setItem('tgk_graphml', graphText || '');
    localStorage.setItem('tgk_heat', heatJson);
    localStorage.setItem('tgk_lastres', JSON.stringify({ zipName, hasGraph: !!graphText, hasHeat: buildHeatmap, count: records.length }));
    saveRegistry({
        zipName,
        chat: ($('selected_chat_display')?.innerText || '').replace('ВЫБРАН: ', '').replace('ОБЪЕКТ: ', ''),
        count: records.length,
        date: new Date().toISOString(),
        sizeKB: Math.round(base64.length * 3 / 4 / 1024),
        hasGraph: !!graphText, hasHeat: buildHeatmap, hasDossier: !!dossierText, hasMedia: mediaFiles.length > 0
    });

    log('АРХИВ СОБРАН: ' + zipName);
    finishExportUI();
    showResults();
    await saveZipToDevice();
    await pushZipToBot();
}

function finishExportUI() {
    $('export_btn').classList.remove('hidden');
    $('stop_btn').classList.add('hidden');
}

function showResults() {
    const r = lastResult || (() => { try { return JSON.parse(localStorage.getItem('tgk_lastres')); } catch (e) { return null; } })();
    if (!r) return;
    const dl = $('download_btn');
    dl.classList.remove('hidden');
    dl.innerText = '📥 АРХИВ: ' + (r.zipName || 'ZIP');
    dl.onclick = saveZipToDevice;
    const hasGraph = lastResult ? !!lastResult.graphText : r.hasGraph;
    const hasHeat = lastResult ? true : r.hasHeat;
    if (hasGraph) {
        const gb = $('view_graph_btn');
        gb.classList.remove('hidden');
        gb.onclick = () => { if (lastResult?.graphText) localStorage.setItem('tgk_graphml', lastResult.graphText); window.location.href = 'graph/index.html'; };
    }
    if (hasHeat) {
        const hb = $('view_heatmap_btn');
        hb.classList.remove('hidden');
        hb.onclick = () => { if (lastResult?.heatJson) localStorage.setItem('tgk_heat', lastResult.heatJson); window.location.href = 'heatmap/index.html'; };
    }
}

async function saveZipToDevice() {
    if (!lastResult) { const cached = localStorage.getItem('tgk_lastres'); return alert(cached ? 'АРХИВ УЖЕ БЫЛ ВЫДАН. ЗАПУСТИ НОВЫЙ ПЕРЕХВАТ ДЛЯ ФАЙЛА.' : 'НЕТ ДАННЫХ'); }
    try {
        if (Capacitor.isNativePlatform()) {
            await Filesystem.writeFile({
                path: `tgkit_exports/${lastResult.zipName}`,
                data: lastResult.base64,
                directory: Directory.Documents,
                recursive: true
            });
            log('ФАЙЛ СОХРАНЁН: Документы/tgkit_exports/' + lastResult.zipName, '#A6E22E');
            alert('СОХРАНЕНО:\nДокументы/tgkit_exports/' + lastResult.zipName);
        } else {
            const blob = await (await fetch('data:application/zip;base64,' + lastResult.base64)).blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = lastResult.zipName;
            a.click();
        }
    } catch (e) { log('СБОЙ СОХРАНЕНИЯ: ' + fmtErr(e), '#cc0000'); }
}

async function pushZipToBot() {
    if (!cfg.botToken || !cfg.botChat || !lastResult) return;
    log('ОТПРАВКА АРХИВА БОТОМ...');
    try {
        const blob = await (await fetch('data:application/zip;base64,' + lastResult.base64)).blob();
        const caption = `✅ ВЫГРУЗКА ЗАВЕРШЕНА\nЧат: ${$('selected_chat_display').innerText.replace('ВЫБРАН: ', '')}\nСообщений: ${lastResult.count}\nАрхив: ${lastResult.zipName}`;
        if (blob.size > 45 * 1024 * 1024) {
            await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: cfg.botChat, text: caption + '\n(архив >45МБ — забери из Документы/tgkit_exports)' })
            });
            log('БОТ: АРХИВ СЛИШКОМ БОЛЬШОЙ, ОТПРАВЛЕНО УВЕДОМЛЕНИЕ');
        } else {
            const fd = new FormData();
            fd.append('chat_id', cfg.botChat);
            fd.append('caption', caption);
            fd.append('document', blob, lastResult.zipName);
            const resp = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendDocument`, { method: 'POST', body: fd });
            const jr = await resp.json();
            if (jr.ok) log('БОТ: АРХИВ ОТПРАВЛЕН В TELEGRAM', '#A6E22E');
            else log('БОТ СБОЙ: ' + (jr.description || 'UNKNOWN'), '#cc0000');
        }
    } catch (e) { log('БОТ СБОЙ: ' + fmtErr(e), '#cc0000'); }
}

// --- ЖУРНАЛ ВЫГРУЗОВ ---
function getRegistry() { try { return JSON.parse(localStorage.getItem('tgk_registry') || '[]'); } catch (e) { return []; } }

function saveRegistry(entry) {
    const r = getRegistry();
    r.unshift(entry);
    if (r.length > 200) r.length = 200;
    try { localStorage.setItem('tgk_registry', JSON.stringify(r)); } catch (e) {}
    renderExports();
}

function fmtSize(kb) { return kb >= 1024 ? (kb / 1024).toFixed(1) + ' МБ' : kb + ' КБ'; }

function renderExports() {
    const list = $('exports_list'); if (!list) return;
    const r = getRegistry();
    const cnt = $('tab_exports_count'); if (cnt) cnt.innerText = r.length;
    if (!r.length) {
        list.innerHTML = '<div style="color:#5a5a5f;font-size:11px;text-align:center;padding:30px;">ЖУРНАЛ ПУСТ.<br>ПЕРВЫЙ ПЕРЕХВАТ ЗАПИШЕТСЯ СЮДА.</div>';
        return;
    }
    list.innerHTML = '';
    r.forEach(e => {
        const d = new Date(e.date);
        const card = document.createElement('div');
        card.className = 'export-card';
        const badge = (on, t) => `<span class="ec-badge${on ? '' : ' off'}">${t}</span>`;
        card.innerHTML =
            `<div class="ec-name">${e.zipName}</div>` +
            `<div class="ec-meta">` +
            `ДАТА: ${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU')}<br>` +
            `ОБЪЕКТ: ${e.chat || '—'}<br>` +
            `ПЕРЕХВАТ: ${e.count} сообщ. · РАЗМЕР: ${fmtSize(e.sizeKB || 0)}` +
            `</div>` +
            `<div class="ec-badges">${badge(e.hasGraph, 'ГРАФ')}${badge(e.hasHeat, 'РАДАР')}${badge(e.hasDossier, 'ДОСЬЕ')}${badge(e.hasMedia, 'МЕДИА')}</div>` +
            `<div class="ec-path">→ Документы/tgkit_exports/${e.zipName}</div>`;
        list.appendChild(card);
    });
}

function switchTab(name) {
    const term = name === 'terminal';
    document.querySelector('.container').style.display = term ? '' : 'none';
    $('exports_frame').classList.toggle('hidden', term);
    $('tab_terminal').classList.toggle('tab-active', term);
    $('tab_exports').classList.toggle('tab-active', !term);
    if (!term) renderExports();
}

// --- ВЫБОР ТОПИКА ---
function updateTopicDisplay() {
    const topicSel = $('topic_select'); if (!topicSel) return;
    const sel = JSON.parse(localStorage.getItem('tgk_sel') || 'null');
    if (!sel) return;
    const tid = topicSel.value && parseInt(topicSel.value) > 0 ? parseInt(topicSel.value) : null;
    const tname = tid ? topicSel.selectedOptions[0].text : null;
    sel.topicId = tid; sel.topicName = tname;
    localStorage.setItem('tgk_sel', JSON.stringify(sel));
    $('selected_chat_display').innerText = 'ВЫБРАН: ' + sel.name + (tname ? ' → ' + tname : '');
}

// --- ПАНЕЛЬ УПРАВЛЕНИЯ ---
async function initControl() {
    $('auth_frame').classList.add('hidden');
    $('control_frame').classList.remove('hidden');
    bindSettings();
    showResults();

    // База из кэша мгновенно, потом свежее сканирование
    try {
        const cached = JSON.parse(localStorage.getItem('tgk_chats') || '[]');
        if (cached.length) {
            allChats = cached; renderChats();
            const sel = JSON.parse(localStorage.getItem('tgk_sel') || 'null');
            if (sel) {
                $('dialogs_dropdown').value = sel.id;
                $('selected_chat_display').innerText = 'ВЫБРАН: ' + sel.name;
            }
        }
    } catch (e) {}
    await scanChats(true);
    // Восстановить выбор после свежего скана (нужны entity)
    try {
        const sel = JSON.parse(localStorage.getItem('tgk_sel') || 'null');
        if (sel && dialogMap.has(sel.id)) {
            await selectChat(sel.id, sel.name);
            if (sel.topicId && $('topic_select')) {
                $('topic_select').value = String(sel.topicId);
                if ($('topic_select').value !== String(sel.topicId)) $('topic_select').value = '';
                updateTopicDisplay();
            }
        }
    } catch (e) {}
}

// --- СВЯЗЫВАНИЕ UI ---
window.addEventListener('DOMContentLoaded', async () => {
    bindSettings();

    $('connect_btn').onclick = () => {
        if ($('password_block') && !$('password_block').classList.contains('hidden')) return doPassword();
        if ($('code_block') && !$('code_block').classList.contains('hidden') && $('code').value.trim()) return doSignInCode();
        return doSendCode();
    };
    $('btn_rescan').onclick = () => scanChats(false);
    if ($('topic_select')) $('topic_select').onchange = updateTopicDisplay;
    $('chat_search').addEventListener('input', renderChats);
    $('chat_sort').addEventListener('change', renderChats);
    $('export_btn').onclick = runExport;
    $('stop_btn').onclick = () => { exportAbort = true; };
    $('btn_logout_control').onclick = async () => {
        ['tgk_session', 'tgk_chats', 'tgk_sel', 'tgk_lastres'].forEach(k => localStorage.removeItem(k));
        try { if (client) await client.disconnect(); } catch (e) {}
        location.reload();
    };
    $('btn_toggle_settings').onclick = () => $('settings_panel').classList.toggle('hidden');

    // Вкладки снизу
    $('tab_terminal').onclick = () => switchTab('terminal');
    $('tab_exports').onclick = () => switchTab('exports');
    $('btn_clear_registry').onclick = () => {
        if (!confirm('Очистить журнал? Файлы в tgkit_exports останутся.')) return;
        localStorage.removeItem('tgk_registry');
        renderExports();
    };
    renderExports();

    // Автовход по сохранённой сессии
    if (localStorage.getItem('tgk_session')) {
        try {
            await ensureClient();
            const me = await client.getMe();
            if (me) { initControl(); return; }
        } catch (e) { /* сессия мертва — покажем окно входа */ }
        $('auth_frame').classList.remove('hidden');
    } else {
        $('auth_frame').classList.remove('hidden');
    }
});
