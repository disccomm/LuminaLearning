// --- CONFIGURATION ---
const SELECTED_MODEL = "Phi-3-mini-4k-instruct-q4f16_1-MLC";
const PEXELS_API_KEY = "qQZw9X3j2A76TuOYYHDo2ssebWP5H7K056k1rpdOTVvqh7SVDQr4YyWM"; 

// State Management
const State = {
    db: [],
    sessionSet: [],
    currentIndex: 0,
    extractedText: "",
    engine: null,
    settings: {
        userName: localStorage.getItem('userName') || "Explorer",
        age: localStorage.getItem('ageRange') || 12
    }
};

const KNOWLEDGE_ZONES = {
    Explorer: { max: 10, prompt: "You are a teacher for kids (5-10). Simple words." },
    Creator: { max: 15, prompt: "You are a tutor for teens. Focus on concepts." },
    Innovator: { max: 25, prompt: "You are a professor. High level analysis." }
};

// --- CORE FUNCTIONS ---

function getZone(age) {
    if (age <= 10) return 'Explorer';
    if (age <= 15) return 'Creator';
    return 'Innovator';
}

function updateUI() {
    document.getElementById('display-name').innerText = State.settings.userName;
    const zone = getZone(State.settings.age);
    document.getElementById('age-val').innerText = `${State.settings.age} yrs (${zone})`;
    document.getElementById('age-range').value = State.settings.age;
}

// 1. PDF EXTRACTION (FIXED: Callback handling)
async function extractTextFromPDF(file, statusCallback) {
    try {
        if (!window.pdfjsLib) throw new Error("PDF Lib missing");
        
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = "";
        const maxPages = Math.min(pdf.numPages, 5); // Limit for speed

        for (let i = 1; i <= maxPages; i++) {
            // SAFE CALL: Check if callback exists and is a function
            if (typeof statusCallback === 'function') {
                statusCallback(`📄 Scanning Page ${i}/${maxPages}...`);
            }
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map(item => item.str).join(" ") + " ";
        }
        return fullText;
    } catch (e) {
        console.error(e);
        throw new Error("Cannot read PDF. Is it text-based?");
    }
}

// 2. AI ENGINE & GENERATION
async function initializeEngine(statusCallback) {
    if (State.engine) return State.engine;
    if (!window.webllm) throw new Error("WebLLM missing");

    statusCallback("🧠 Waking up AI (One-time load)...");
    const engine = new window.webllm.MLCEngine();
    engine.setInitProgressCallback((report) => {
        statusCallback(`📥 Loading AI Model: ${Math.ceil(report.progress * 100)}%`);
    });
    await engine.reload(SELECTED_MODEL);
    State.engine = engine;
    return engine;
}

async function generateQuestions(topic, context, aiStatusCallback) {
    const engine = await initializeEngine(aiStatusCallback);
    
    // Pexels Fetch (Silent)
    let imageUrl = null;
    if (PEXELS_API_KEY !== "YOUR_PEXELS_API_KEY_HERE") {
        try {
            const pexRes = await fetch(`https://api.pexels.com/v1/search?query=${topic}&per_page=1`, {
                headers: { Authorization: PEXELS_API_KEY }
            });
            const pexData = await pexRes.json();
            if (pexData.photos && pexData.photos.length > 0) imageUrl = pexData.photos[0].src.medium;
        } catch (e) { console.log("Image fetch failed"); }
    }

    const zone = getZone(State.settings.age);
    const systemPrompt = `
        ${KNOWLEDGE_ZONES[zone].prompt}
        Context: ${context.substring(0, 3000)}
        Task: Generate 5 multiple choice questions in strictly valid JSON format.
        Format: [{"question":"...","options":["A","B","C","D"],"correct":"A","explanation":"..."}]
    `;

    aiStatusCallback("✨ Dreaming up questions...");
    
    const response = await engine.chat.completions.create({
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Topic: ${topic}. Go.` }],
        temperature: 0.6,
    });

    const raw = response.choices[0].message.content;
    const jsonMatch = raw.match(/\[.*\]/s);
    if (!jsonMatch) throw new Error("AI output invalid.");
    
    const questions = JSON.parse(jsonMatch[0]);
    
    // Attach image to first question
    if (imageUrl && questions.length > 0) questions[0].imageUrl = imageUrl;
    
    return questions;
}

// --- CONTROLLERS ---

async function handleBuildLibrary() {
    const topic = document.getElementById('topic-name').value;
    const fileInput = document.getElementById('pdf-file');
    const statusEl = document.getElementById('ai-status');
    const btn = document.getElementById('build-library-btn');
    
    if (!topic || !fileInput.files[0]) {
        alert("Please enter a topic and select a PDF.");
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

    try {
        // STEP 1: READ PDF
        // CRITICAL FIX: Passing an ARROW FUNCTION, not a string assignment
        const text = await extractTextFromPDF(fileInput.files[0], (msg) => {
            statusEl.innerHTML = `<i class="fas fa-sync fa-spin"></i> ${msg}`;
        });

        // STEP 2: GENERATE
        State.db = await generateQuestions(topic, text, (msg) => {
            statusEl.innerHTML = `<i class="fas fa-magic fa-spin"></i> ${msg}`;
        });

        // SUCCESS
        statusEl.innerHTML = `<i class="fas fa-check-circle"></i> Library Ready (${State.db.length} Qs)`;
        document.querySelectorAll('.mode-card').forEach(c => c.classList.add('active'));

    } catch (e) {
        statusEl.innerHTML = `<span style="color:var(--error)"><i class="fas fa-exclamation-triangle"></i> ${e.message}</span>`;
        console.error(e);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-magic"></i> Build My Library';
    }
}

function startQuiz() {
    if (!State.db.length) return;
    State.sessionSet = [...State.db];
    State.currentIndex = 0;
    
    switchView('quiz-view');
    renderQuestion();
}

function renderQuestion() {
    const q = State.sessionSet[State.currentIndex];
    const total = State.sessionSet.length;
    
    document.getElementById('q-counter').innerText = `${State.currentIndex + 1}/${total}`;
    document.getElementById('quiz-progress').style.width = `${((State.currentIndex) / total) * 100}%`;
    
    let html = `
        <div class="glass-card">
            ${q.imageUrl ? `<img src="${q.imageUrl}" />` : ''}
            <h3 style="font-size: 1.2rem; margin-bottom: 20px;">${q.question}</h3>
            <div class="options-grid">
                ${q.options.map(opt => `
                    <button class="opt-btn" onclick="checkAnswer(this, '${opt.replace(/'/g, "\\'")}', '${q.correct.replace(/'/g, "\\'")}')">
                        ${opt}
                    </button>
                `).join('')}
            </div>
            <div id="explanation" class="hidden" style="margin-top:15px; padding:10px; background:rgba(255,255,255,0.1); border-radius:8px;">
                <small>💡 ${q.explanation}</small>
            </div>
        </div>
    `;
    
    document.getElementById('quiz-content').innerHTML = html;
    document.getElementById('next-btn').disabled = true;
}

window.checkAnswer = function(btn, selected, correct) {
    const parent = btn.parentElement;
    const allBtns = parent.querySelectorAll('.opt-btn');
    
    allBtns.forEach(b => b.disabled = true); // Lock all
    
    if (selected === correct) {
        btn.classList.add('correct');
        // Play sound effect could go here
    } else {
        btn.classList.add('wrong');
        // Highlight correct one
        allBtns.forEach(b => {
            if (b.innerText.includes(correct)) b.classList.add('correct');
        });
    }
    
    document.getElementById('explanation').classList.remove('hidden');
    document.getElementById('next-btn').disabled = false;
}

function handleNext() {
    if (State.currentIndex < State.sessionSet.length - 1) {
        State.currentIndex++;
        renderQuestion();
    } else {
        openModal("🎉 Quiz Complete!", `<p>You finished the set!</p><button class="cta-btn primary" onclick="closeModal(); switchView('hub-view')">Back to Hub</button>`);
    }
}

// --- EVENT LISTENERS & INIT ---

document.addEventListener('DOMContentLoaded', () => {
    updateUI();
    
    // Fix: File Input Persistence
    const fileInput = document.getElementById('pdf-file');
    const label = document.getElementById('file-status');
    const zone = document.getElementById('upload-zone');
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            label.innerText = e.target.files[0].name; // Set name
            zone.style.borderColor = '#00b09b';
            zone.style.background = 'rgba(0, 176, 155, 0.1)';
        }
    });

    // Slider Logic
    document.getElementById('age-range').addEventListener('input', (e) => {
        State.settings.age = e.target.value;
        localStorage.setItem('ageRange', e.target.value);
        updateUI();
    });

    document.getElementById('build-library-btn').onclick = handleBuildLibrary;
});

// Navigation
function switchView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// Modal Logic
window.openSettingsModal = function() {
    openModal("Settings", `
        <div class="input-group">
            <label>User Name</label>
            <input type="text" value="${State.settings.userName}" onchange="State.settings.userName=this.value; localStorage.setItem('userName', this.value); updateUI()">
        </div>
        <button class="cta-btn secondary" onclick="localStorage.clear(); location.reload();" style="border-color:var(--error); color:var(--error)">Reset App Data</button>
    `);
}

window.openExitConfirmation = function() {
    openModal("Exit Quiz?", `
        <p>Progress will be lost.</p>
        <div style="display:flex; gap:10px; margin-top:20px;">
            <button class="cta-btn secondary" onclick="closeModal()">Cancel</button>
            <button class="cta-btn primary" onclick="closeModal(); switchView('hub-view')">Exit</button>
        </div>
    `);
}

function openModal(title, content) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-body').innerHTML = content;
    document.getElementById('modal-overlay').classList.remove('hidden');
}

window.closeModal = function() {
    document.getElementById('modal-overlay').classList.add('hidden');
}