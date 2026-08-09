// ТЕЛЕМЕТРИЯ v2 (APK): общая линия чата + сравнение периодов
// Данные: ?file=... или localStorage ('tgk_heat')
let rawData = [];
let chart = null;
let mode = 'normal'; // 'normal' | 'compare'
const colors = ['#00ffff', '#cc0000', '#A6E22E', '#FD971F', '#AE81FF', '#E6DB74', '#f06595', '#20c997'];
const TOTAL_KEY = '__TOTAL__';

async function init() {
    try {
        const file = new URLSearchParams(window.location.search).get('file');
        if (file) {
            const res = await fetch(file);
            rawData = await res.json();
        } else {
            rawData = JSON.parse(localStorage.getItem('tgk_heat') || 'null');
        }

        if (!Array.isArray(rawData)) return alert("ДАННЫЕ ТЕЛЕМЕТРИИ НЕ НАЙДЕНЫ. СДЕЛАЙ ВЫГРУЗКУ В ТЕРМИНАЛЕ.");

        const users = [...new Set(rawData.map(d => d.user))].sort();
        const cont = document.getElementById('users_container');
        cont.innerHTML = '';

        // Общая линия чата — всегда первой
        const totalLabel = document.createElement('label');
        totalLabel.style.display = 'block';
        totalLabel.innerHTML = `<input type="checkbox" value="${TOTAL_KEY}" checked> <span style="color:#ffffff;font-weight:bold;">ВЕСЬ ЧАТ</span>`;
        totalLabel.querySelector('input').onchange = render;
        cont.appendChild(totalLabel);

        users.forEach((u, i) => {
            const l = document.createElement('label');
            l.style.display = 'block';
            l.innerHTML = `<input type="checkbox" value="${u}"> <span style="color:${colors[i % colors.length]}">${u}</span>`;
            l.querySelector('input').onchange = render;
            cont.appendChild(l);
        });

        // Автозаполнение периодов: B = последняя неделя, A = неделя до неё
        if (rawData.length) {
            const tsArr = rawData.map(d => new Date(d.ts).getTime()).filter(t => !isNaN(t));
            if (tsArr.length) {
                const maxT = Math.max(...tsArr), week = 7 * 864e5;
                setDT('b_from', maxT - week); setDT('b_to', maxT);
                setDT('a_from', maxT - 2 * week); setDT('a_to', maxT - week);
            }
        }
        render();
    } catch (e) {
        document.body.innerHTML += `<div style="color:red; padding:20px;">КРИТИЧЕСКИЙ СБОЙ: ${e.message}</div>`;
    }
}

function setDT(id, ms) {
    const d = new Date(ms);
    const pad = n => String(n).padStart(2, '0');
    document.getElementById(id).value =
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function bucketKey(dt, mode) {
    if (mode === 'hour') return dt.toISOString().slice(0, 13) + ':00';
    if (mode === 'day') return dt.toISOString().slice(0, 10);
    if (mode === 'week') {
        const d = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
        const day = (d.getUTCDay() + 6) % 7; // понедельник = 0
        d.setUTCDate(d.getUTCDate() - day);
        return d.toISOString().slice(0, 10);
    }
    if (mode === 'month') return dt.toISOString().slice(0, 7);
    if (mode === 'year') return dt.getFullYear().toString();
    return dt.toISOString().slice(0, 16).replace('T', ' ');
}

function selectedUsers() {
    const checked = Array.from(document.querySelectorAll('#users_container input:checked')).map(c => c.value);
    return { total: checked.includes(TOTAL_KEY), users: checked.filter(v => v !== TOTAL_KEY) };
}

function aggregate(filterFn, mode) {
    const stats = {};
    const labels = new Set();
    rawData.filter(filterFn).forEach(d => {
        const k = bucketKey(new Date(d.ts), mode);
        stats[k] = (stats[k] || 0) + 1;
        labels.add(k);
    });
    return { stats, labels };
}

function renderNormal() {
    const modeRes = document.getElementById('time_res').value;
    const sel = selectedUsers();
    const labels = new Set();
    const datasets = [];

    if (sel.total) {
        const agg = aggregate(() => true, modeRes);
        agg.labels.forEach(l => labels.add(l));
        datasets.push({ label: 'ВЕСЬ ЧАТ', stats: agg.stats, color: '#ffffff', width: 3 });
    }
    sel.users.forEach((u, idx) => {
        const agg = aggregate(d => d.user === u, modeRes);
        agg.labels.forEach(l => labels.add(l));
        datasets.push({ label: u, stats: agg.stats, color: colors[idx % colors.length], width: 1.5 });
    });

    const sortedLabels = Array.from(labels).sort();
    const finalDS = datasets.map(ds => ({
        label: ds.label,
        data: sortedLabels.map(l => ds.stats[l] || 0),
        borderColor: ds.color,
        borderWidth: ds.width,
        backgroundColor: ds.color + '22',
        fill: ds.label === 'ВЕСЬ ЧАТ', tension: 0.3, pointRadius: 0
    }));

    draw(sortedLabels, finalDS, false);
}

function periodBounds(prefix) {
    const from = document.getElementById(prefix + '_from').value;
    const to = document.getElementById(prefix + '_to').value;
    if (!from || !to) return null;
    const f = new Date(from).getTime(), t = new Date(to).getTime();
    if (isNaN(f) || isNaN(t) || t <= f) return null;
    return { from: f, to: t };
}

function renderCompare() {
    const sel = selectedUsers();
    // В сравнении: если включён «ВЕСЬ ЧАТ» или никто не выбран — считаем весь чат, иначе только выбранных
    const useAll = sel.total || sel.users.length === 0;
    const userSet = new Set(sel.users);
    const filterFn = useAll ? () => true : d => userSet.has(d.user);

    const A = periodBounds('a'), B = periodBounds('b');
    if (!A || !B) { alert('ЗАДАЙТЕ ОБА ПЕРИОДА (ДАТА ОТ < ДАТА ДО)'); return; }

    const BUCKETS = 50;
    const bucketize = (bounds) => {
        const arr = new Array(BUCKETS).fill(0);
        const span = bounds.to - bounds.from;
        rawData.filter(filterFn).forEach(d => {
            const t = new Date(d.ts).getTime();
            if (t < bounds.from || t > bounds.to) return;
            const idx = Math.min(BUCKETS - 1, Math.floor((t - bounds.from) / span * BUCKETS));
            arr[idx]++;
        });
        return arr;
    };

    const dataA = bucketize(A), dataB = bucketize(B);
    const labels = Array.from({ length: BUCKETS }, (_, i) => Math.round(i / (BUCKETS - 1) * 100) + '%');

    const scope = useAll ? 'весь чат' : `выбранные (${userSet.size})`;
    const sumA = dataA.reduce((a, b) => a + b, 0), sumB = dataB.reduce((a, b) => a + b, 0);
    const delta = sumA > 0 ? Math.round((sumB - sumA) / sumA * 100) : 0;
    document.getElementById('compare_stat').textContent =
        `A: ${sumA} сообщ.  |  B: ${sumB} сообщ.  |  изменение: ${delta > 0 ? '+' : ''}${delta}%  (${scope})`;

    draw(labels, [
        { label: `ПЕРИОД A (${sumA})`, data: dataA, borderColor: '#ff5555', borderWidth: 2, backgroundColor: '#ff555522', fill: true, tension: 0.3, pointRadius: 0 },
        { label: `ПЕРИОД B (${sumB})`, data: dataB, borderColor: '#A6E22E', borderWidth: 2, backgroundColor: '#A6E22E22', fill: true, tension: 0.3, pointRadius: 0 }
    ], true);
}

function draw(labels, datasets, isCompare) {
    const canvas = document.getElementById('mainChart');
    if (chart) chart.destroy();
    chart = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { grid: { color: '#333' }, ticks: { color: '#aaa', maxTicksLimit: isCompare ? 11 : 20 } },
                y: { grid: { color: '#333' }, ticks: { color: '#aaa' } }
            },
            plugins: {
                legend: { display: isCompare, labels: { color: '#f4e8d3', font: { family: 'JetBrains Mono' } } }
            }
        }
    });
}

function render() {
    if (mode === 'compare') renderCompare();
    else renderNormal();
}

function setMode(m) {
    mode = m;
    document.getElementById('compare_panel').classList.toggle('visible', m === 'compare');
    document.getElementById('btn_mode_normal').classList.toggle('active-mode', m === 'normal');
    document.getElementById('btn_mode_compare').classList.toggle('active-mode', m === 'compare');
    document.getElementById('time_res').disabled = (m === 'compare');
    if (m === 'normal') document.getElementById('compare_stat').textContent = '';
    render();
}

document.getElementById('btn_mode_normal').onclick = () => setMode('normal');
document.getElementById('btn_mode_compare').onclick = () => setMode('compare');
document.getElementById('btn_compare_go').onclick = renderCompare;
document.getElementById('time_res').onchange = render;
['a_from', 'a_to', 'b_from', 'b_to'].forEach(id => {
    document.getElementById(id).onchange = () => { if (mode === 'compare') renderCompare(); };
});
document.getElementById('btn_all').onclick = () => { document.querySelectorAll('#users_container input').forEach(i => i.checked = true); render(); };
document.getElementById('btn_none').onclick = () => { document.querySelectorAll('#users_container input').forEach(i => i.checked = false); render(); };

init();
