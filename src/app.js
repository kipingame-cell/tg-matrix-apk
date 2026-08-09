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
    get gemini() { return localStorage.getItem('tgk_gemini') || ''; }
};
function bindSettings() {
    const map = { set_bot_token: 'tgk_bot_token', set_bot_chat: 'tgk_bot_chat', set_gemini: 'tgk_gemini' };
    Object.entries(map).forEach(([id, key]) => {
        const el = $(id); if (!el) return;
        el.value = localStorage.getItem(key) || '';
        el.onchange = () => localStorage.setItem(key, el.value.trim());
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

    // Участники (для фильтра и резолва @username)
    const uDrop = $('fromUser');
    uDrop.innerHTML = '<option value="">СКАНИРОВАНИЕ...</option>';
    try {
        const ent = dialogMap.get(id);
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

    const limit = parseInt($('limit').value) || 1000;
    const keywords = $('keywords').value.trim().toLowerCase();
    const kwList = keywords ? keywords.split(',').map(s => s.trim()).filter(Boolean) : [];
    const fromUser = $('fromUser').value;
    const df = $('dateFrom').value ? new Date($('dateFrom').value).getTime() : null;
    const dt = $('dateTo').value ? new Date($('dateTo').value).getTime() : null;
    const buildGraph = $('buildGraph').checked, buildHeatmap = $('buildHeatmap').checked;
    const buildDossier = $('buildDossier').checked;
    const textOnly = $('exportMode').value === 'text';

    log('ЦЕЛЬ ЗАХВАЧЕНА. НАЧИНАЮ ПЕРЕХВАТ...');

    const senders = new Map();   // idStr -> name
    const records = [];          // {id, date, sender, senderId, text, replyTo, mentions, reactions}
    const msgSender = new Map(); // msgId -> senderId (для реплаев)
    let offsetId = 0, processed = 0;

    try {
        while (records.length < limit && !exportAbort) {
            const batch = Math.min(100, limit - records.length);
            const msgs = await client.getMessages(ent, { limit: batch, offsetId });
            if (!msgs || !msgs.length) break;

            for (const m of msgs) {
                processed++;
                offsetId = m.id;
                if (m.action) continue; // системный мусор
                const text = m.message || '';
                if (textOnly && !text) continue;
                const tsMs = m.date * 1000;
                if (df && tsMs < df) continue;
                if (dt && tsMs > dt) continue;
                const sid = m.senderId ? m.senderId.toString() : (m.fromId ? m.fromId.toString() : null);
                if (fromUser && sid !== fromUser) continue;
                if (kwList.length && !kwList.some(k => text.toLowerCase().includes(k))) continue;

                const senderName = sid ? await resolveSender(sid, senders) : 'СИСТЕМА';
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
                const rec = {
                    id: m.id, date: new Date(tsMs).toISOString(), sender: senderName, senderId: sid,
                    text, replyTo: m.replyTo ? m.replyTo.replyToMsgId : null, mentions, reactions
                };
                records.push(rec);
                if (sid) msgSender.set(m.id, sid);

                if (records.length % 50 === 0) {
                    $('mon_speed').innerText = processed;
                    $('mon_exported').innerText = records.length;
                    $('mon_progress').style.width = Math.min(100, Math.round(records.length / limit * 100)) + '%';
                    $('mon_processed').innerText = `${records.length} / ${limit}`;
                }
            }
            if (msgs.length < batch) break;
        }
    } catch (e) {
        log('ОШИБКА ПЕРЕХВАТА: ' + fmtErr(e), '#cc0000');
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
    const chatName = ($('selected_chat_display').innerText.replace('ВЫБРАН: ', '') || 'chat').replace(/[^\wа-яёА-ЯЁ-]+/gi, '_').slice(0, 40);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const zipName = `tgkit_${chatName}_${stamp}.zip`;

    const txt = records.map(r => `[${r.date}] ${r.sender}: ${r.text}`).join('\n');
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

    // Досье (Gemini)
    let dossierText = null;
    if (buildDossier && cfg.gemini) {
        log('ДОСЬЕ: ЗАПРОС К НЕЙРОСЕТИ...');
        try {
            const sample = records.slice(0, 800).map(r => `${r.sender}: ${r.text}`).join('\n').slice(0, 60000);
            const prompt = 'Ты — аналитик. По дампу переписки составь краткое досье на самых активных участников: стиль общения, темы, роль в чате, взаимодействия. Ответ на русском, структурировано.\n\nДАМП:\n' + sample;
            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(cfg.gemini)}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            const jr = await resp.json();
            dossierText = jr.candidates?.[0]?.content?.parts?.[0]?.text || ('ОШИБКА: ' + JSON.stringify(jr).slice(0, 300));
            log('ДОСЬЕ ГОТОВО');
        } catch (e) { log('ДОСЬЕ СБОЙ: ' + fmtErr(e), '#cc0000'); }
    }

    // ZIP
    const zip = new JSZip();
    zip.file('messages.txt', txt);
    zip.file('messages.json', json);
    if (graphText) zip.file('graph.graphml', graphText);
    if (buildHeatmap) zip.file('heatmap.json', heatJson);
    if (dossierText) zip.file('dossier.txt', dossierText);
    const base64 = await zip.generateAsync({ type: 'base64' });

    lastResult = { zipName, base64, graphText, heatJson, count: records.length };
    localStorage.setItem('tgk_graphml', graphText || '');
    localStorage.setItem('tgk_heat', heatJson);
    localStorage.setItem('tgk_lastres', JSON.stringify({ zipName, hasGraph: !!graphText, hasHeat: buildHeatmap, count: records.length }));

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
        if (sel && dialogMap.has(sel.id)) selectChat(sel.id, sel.name);
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
