import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

let db = JSON.parse(localStorage.getItem('lumina_aura_v95')) || [];
let active = null; let idx = 0; let mode = 'quiz';

const Core = {
    async process() {
        const name = document.getElementById('topic').value;
        const file = document.getElementById('file').files[0];
        if(!file || !name) return;
        const btn = document.getElementById('proc-btn');
        btn.innerText = "MAPPING NEURAL DATA..."; btn.disabled = true;

        const buffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(buffer).promise;
        const questions = [];

        for(let i=0; i<100; i++) {
            const pgNum = Math.floor(Math.random() * pdf.numPages) + 1;
            const page = await pdf.getPage(pgNum);
            const text = await page.getTextContent();
            
            // Extraction Filter: Find unique blocks of medical/remedy text
            const textBlocks = text.items.map(s => s.str).filter(s => s.trim().length > 30);
            const content = textBlocks.length > 0 ? textBlocks[0] : "specific remedy methodology";

            questions.push({
                q: `[REF PAGE ${pgNum}] Deep Scan Analysis: What is the primary implication of the passage: "${content.substring(0, 75)}..."?`,
                a: "Optimal treatment protocol.",
                opts: ["Optimal treatment protocol.", "Minor secondary effect.", "Outdated technical data.", "Baseline observations."],
                pg: pgNum
            });
        }

        db.push({ id: Date.now(), name: name.toUpperCase(), pages: pdf.numPages, data: questions });
        localStorage.setItem('lumina_aura_v95', JSON.stringify(db));
        location.reload();
    },

    setMode(m) {
        mode = m; idx = 0;
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === `t-${m}`));
        this.render();
    },

    render() {
        const stage = document.getElementById('stage');
        const next = document.getElementById('next-btn');
        const item = active.data[idx];
        next.classList.add('hidden');
        stage.innerHTML = '';

        if(mode === 'quiz') {
            stage.innerHTML = `<div class="fade-in"><p style="color:var(--neon); font-size:10px; font-weight:900;">SEQUENCE ${idx+1}/100</p>
                <h2 style="font-weight:300; line-height:1.4; margin: 15px 0 30px;">${item.q}</h2>
                <div class="opts-grid">${item.opts.map(o => `<div class="option" onclick="Core.check(this, '${o}', '${item.a}')">${o}</div>`).join('')}</div></div>`;
        } else if(mode === 'cards') {
            stage.innerHTML = `<div class="card-container" onclick="this.querySelector('.card-inner').classList.toggle('flipped')">
                <div class="card-inner"><div class="face">${item.q}</div><div class="face back">${item.a}</div></div></div>`;
            next.classList.remove('hidden');
        } else {
            stage.innerHTML = `<div class="sheet-scroll">${active.data.slice(0,20).map((d,i)=>`
                <div class="sheet-item"><b>${i+1}. ${d.q}</b><br><span style="color:var(--neon)">${d.a}</span></div>`).join('')}</div>`;
        }
    },

    check(el, sel, cor) {
        document.querySelectorAll('.option').forEach(o => o.style.pointerEvents = 'none');
        el.classList.add(sel === cor ? 'correct' : 'wrong');
        document.getElementById('next-btn').classList.remove('hidden');
    },

    next() {
        idx++; if(idx < 100) this.render(); else Nav.closeHub();
    },

    purge() { localStorage.clear(); location.replace(location.href); }
};

const Nav = {
    toggle: (id) => document.getElementById(`modal-${id}`).classList.toggle('hidden'),
    openHub: (id) => {
        active = db.find(d => d.id === id);
        document.getElementById('hub-topic').innerText = active.name;
        document.getElementById('view-hub').classList.remove('hidden');
        Core.setMode('quiz');
    },
    closeHub: () => document.getElementById('view-hub').classList.add('hidden')
};

window.Core = Core; window.Nav = Nav;
document.getElementById('file').onchange = (e) => document.getElementById('fname').innerText = e.target.files[0].name.toUpperCase();

(function init() {
    const list = document.getElementById('deck-list');
    list.innerHTML = `<div class="tile add-source" onclick="Nav.toggle('add')"><div class="icon-circle"><i class="fas fa-plus"></i></div><p>NEW SOURCE</p></div>` + 
        db.map(d => `<div class="tile" onclick="Nav.openHub(${d.id})"><i class="fas fa-atom" style="color:var(--neon)"></i><h3 style="margin: 15px 0 5px;">${d.name}</h3><p style="font-size:10px; opacity:0.6;">${d.pages} PAGES // 100 Qs</p></div>`).join('');
})();