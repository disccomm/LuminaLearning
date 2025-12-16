// --- CONFIGURATION ---
const CONFIG = {
    model: "Phi-3-mini-4k-instruct-q4f16_1-MLC", 
    pexelsKey: "qQZw9X3j2A76TuOYYHDo2ssebWP5H7K056k1rpdOTVvqh7SVDQr4YyWM",
    MAX_INFERENCE_RETRIES: 3,
    MAX_QUESTIONS_GENERATED: 10 
};

// --- GLOBAL STATE ---
const State = {
    engine: null, 
    isEngineLoaded: false,
    allQuestions: [],
    sessionQuestions: [],
    currentQIndex: 0,
    quizResults: [], 
    settings: {
        username: localStorage.getItem("lumina_user") || "Student",
        age: parseInt(localStorage.getItem("lumina_age")) || 12
    },
    lastFile: JSON.parse(localStorage.getItem("lumina_file")) || null,
    
    // V3.1: New state variables for customization
    studyMode: localStorage.getItem("lumina_mode") || 'quiz',
    quizLength: parseInt(localStorage.getItem("lumina_length")) || 5 
};

const savedQuestions = sessionStorage.getItem('lumina_questions');
if (savedQuestions) {
    try {
        State.allQuestions = JSON.parse(savedQuestions);
    } catch (e) {
        console.warn("Failed to parse saved questions. Clearing.");
        sessionStorage.removeItem('lumina_questions');
    }
}


const UI = {
    btn: document.getElementById('generate-btn'),
    loadingArea: document.getElementById('loading-area'), 
    status: document.getElementById('system-status'),
    loader: document.getElementById('ai-loader-bar'),
    
    fileInput: document.getElementById('file-upload'),
    topicInput: document.getElementById('topic-input'),
    dropZone: document.getElementById('drop-zone'),
    quizSummaryModal: document.getElementById('quiz-summary-modal'),
    toast: document.getElementById('toast-message'),
    clearBtn: document.getElementById('clear-source-btn'),
    
    qJumpSelect: document.getElementById('question-jump-select'),
    
    quizLengthSelect: document.getElementById('quiz-length-select'),
    studyModeRadios: document.querySelectorAll('input[name="study-mode"]'),
    flashcardContainer: document.getElementById('flashcard-container'),
    worksheetModal: document.getElementById('worksheet-modal'),
    worksheetContent: document.getElementById('worksheet-content'),
    worksheetAnswerKey: document.getElementById('worksheet-answer-key-content'),
    worksheetShowKeyBtn: document.getElementById('show-answer-key-btn')
};

// --- UTILITY FUNCTIONS ---
function aggressivelyCleanRawAIOutput(rawStr) {
    if (!rawStr) return "";
    let cleaned = rawStr.replace(/```json\s*/i, '').replace(/```\s*$/, '').trim();
    cleaned = cleaned.replace(/here is the json array:/i, '').trim();
    let start = cleaned.indexOf('[');
    let end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) {
        return cleaned; 
    }
    cleaned = cleaned.substring(start, end + 1);
    cleaned = cleaned.replace(/,\s*([\]}])/g, '$1'); 
    cleaned = cleaned.trim().replace(/^`+|`+$/g, '');
    return cleaned;
}

function safelyParseJSON(rawStr) {
    let jsonStr = aggressivelyCleanRawAIOutput(rawStr);
    if (!jsonStr || jsonStr.length < 5) {
        throw new Error("AI output lacks valid JSON structure after cleanup.");
    }
    try {
        const parsed = JSON.parse(jsonStr);
        if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'object' || !item.q || !Array.isArray(item.opts) || !item.why)) {
             throw new Error("Parsed JSON structure is invalid. Expected an array of question objects including 'q', 'opts', 'a', and 'why'.");
        }
        return parsed;
    } catch (e) {
        console.error("Critical JSON Parsing Failed:", e);
        throw new Error(`Syntax error in AI-generated JSON: ${e.message}`);
    }
}

function showToast(message, type = 'info') {
    let iconHTML = '';
    if (type === 'success') iconHTML = '<i class="fas fa-check-circle"></i>';
    else if (type === 'warning' || type === 'error') iconHTML = '<i class="fas fa-exclamation-triangle"></i>';
    else iconHTML = '<i class="fas fa-info-circle"></i>';

    UI.toast.innerHTML = iconHTML + message; 
    UI.toast.className = `toast ${type}`;
    UI.toast.classList.remove('hidden');
    
    setTimeout(() => {
        UI.toast.classList.add('hidden'); 
    }, 3000); 
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// --- CORE FUNCTIONS (PDF & AI) ---
async function extractTextFromPDF(file, onProgress) {
    const safeProgress = (msg) => typeof onProgress === 'function' ? onProgress(msg) : console.log(msg);
    try {
        if (!window.pdfjsLib) throw new Error("PDF Engine not ready.");
        safeProgress("Scanning PDF Structure...");
        const buffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        let fullText = "";
        const limit = Math.min(pdf.numPages, 5); 
        for (let i = 1; i <= limit; i++) {
            safeProgress(`Reading Page ${i} of ${limit}...`);
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const strings = content.items.map(item => item.str);
            fullText += strings.join(" ") + " ";
        }
        return fullText;
    } catch (e) {
        throw new Error("PDF Read Failed: " + e.message);
    }
}

async function getAIEngine(onProgress) {
    if (State.engine && State.isEngineLoaded) {
        onProgress("AI Engine ready (Instant Load).", 100);
        return State.engine;
    }
    if (!navigator.gpu) {
        throw new Error("WebGPU not supported. Use Chrome/Edge on Desktop/Android.");
    }
    onProgress("Booting GPU Engine: This is a one-time download for first use.", 10);
    const engine = new window.webllm.MLCEngine();
    engine.setInitProgressCallback((report) => {
        let percentage = report.progress * 100;
        let text = report.text;
        if (text.includes("Fetching")) text = "First time user - One time load...";
        if (text.includes("Loading")) text = "Loading into GPU VRAM...";
        onProgress(text, percentage);
    });
    await engine.reload(CONFIG.model);
    State.engine = engine;
    State.isEngineLoaded = true;
    return engine;
}

async function attemptGenerateQuestions(topic, text, onProgress, attempt = 1) {
    const engine = await getAIEngine(onProgress);
    UI.loader.style.width = `0%`;
    onProgress(`AI is thinking... (Attempt ${attempt}/${CONFIG.MAX_INFERENCE_RETRIES})`, 0);

    const age = State.settings.age;
    const contextLimit = 1500;
    const textContext = text.substring(0, contextLimit);
    
    const prompt = `
    Context: ${textContext}
    Topic: ${topic}
    Create ${CONFIG.MAX_QUESTIONS_GENERATED} high-quality, multiple-choice questions for a student at the ${age}-year-old difficulty level.
    **CRITICAL INSTRUCTION:** Return ONLY a JSON Array. DO NOT include any text, notes, or explanations before or after the array.
    The JSON structure MUST strictly adhere to this format:
    
    \`\`\`json
    [
      {
        "q": "Question Text", 
        "opts": ["Full Option Text A","Full Option Text B","Full Option Text C","Full Option Text D"], 
        "a": "Correct Full Option Text (Must exactly match one of the opts)", 
        "why": "Brief, detailed explanation for the answer (CRITICAL FOR FLASHCARDS)." 
      },
      // ... up to 10 questions
    ]
    \`\`\`
    
    Ensure the 'opts' array contains the full, descriptive text for each choice.
    `;

    const response = await engine.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4, 
    });

    const raw = response.choices[0].message.content;

    try {
        const questions = safelyParseJSON(raw);
        if (questions.length < 5) throw new Error(`AI generated only ${questions.length} questions. Need at least 5.`);
        return questions;
    } catch (e) {
        console.error(`AI Output Parse Failed (Attempt ${attempt}):`, e);
        if (attempt < CONFIG.MAX_INFERENCE_RETRIES) {
            onProgress(`Failed to parse AI response. Retrying (${attempt + 1}/${CONFIG.MAX_INFERENCE_RETRIES})...`, 0);
            await new Promise(resolve => setTimeout(resolve, 1500)); 
            return attemptGenerateQuestions(topic, text, onProgress, attempt + 1);
        }
        throw new Error("AI failed to generate valid quiz questions after multiple retries. Details: " + e.message);
    }
}


// --- CONTROLLER: MAIN LOGIC ---
async function handleBuild() {
    const file = UI.fileInput.files[0];
    const topic = UI.topicInput.value.trim(); 

    if (!file) return showToast("Please select a PDF file.", 'warning');
    if (!topic) return showToast("Please enter a topic.", 'warning');
    
    if (State.allQuestions.length > 0) {
        const confirmRebuild = confirm(`A quiz library for "${State.lastFile.name}" already exists. Are you sure you want to discard it and build a new one for "${topic}"?`);
        if (!confirmRebuild) {
            return;
        }
        State.allQuestions = [];
        sessionStorage.removeItem('lumina_questions');
    }

    UI.btn.disabled = true;
    UI.loadingArea.classList.remove('hidden');
    UI.loader.style.background = 'var(--primary)'; 

    const updateStatus = (msg, percent = null) => {
        UI.status.innerHTML = `<i class="fas fa-sync fa-spin"></i> ${msg}`;
        if (percent !== null) UI.loader.style.width = `${percent}%`;
    };

    try {
        await getAIEngine(updateStatus);
        UI.loader.style.width = `0%`;
        const text = await extractTextFromPDF(file, (msg) => updateStatus(msg, 10)); 
        State.allQuestions = await attemptGenerateQuestions(topic, text, updateStatus);
        
        if (State.allQuestions.length === 0) throw new Error("AI returned an empty question set.");
        sessionStorage.setItem('lumina_questions', JSON.stringify(State.allQuestions));

        showToast(`Library built with ${State.allQuestions.length} questions!`, 'success');
        
        routeToStudyMode(State.studyMode);

    } catch (err) {
        UI.status.innerHTML = `<span style="color:var(--error)">❌ Error: ${err.message}</span>`;
        UI.loader.style.background = 'var(--error)';
        console.error("BUILD ERROR:", err);
    } finally {
        UI.btn.disabled = false;
        UI.loader.style.width = '100%'; 
        UI.loadingArea.classList.add('hidden');
    }
}

function routeToStudyMode(mode) {
    if (State.allQuestions.length === 0) {
        showToast("Please build a library first.", 'warning');
        return;
    }

    const shuffledQuestions = shuffleArray([...State.allQuestions]);
    State.sessionQuestions = shuffledQuestions.slice(0, Math.min(State.quizLength, CONFIG.MAX_QUESTIONS_GENERATED));
    
    if (State.sessionQuestions.length < State.quizLength) {
        showToast(`Warning: Only ${State.sessionQuestions.length} questions generated. Using all available.`, 'warning');
    }

    State.currentQIndex = 0;
    State.quizResults = []; 
    
    document.getElementById('view-quiz').classList.add('hidden-view');
    document.getElementById('view-flashcards').classList.add('hidden-view');
    UI.quizSummaryModal.classList.add('hidden');
    UI.worksheetModal.classList.add('hidden');
    
    if (mode === 'quiz') {
        startQuiz();
    } else if (mode === 'flashcard') {
        startFlashcards();
    } else if (mode === 'worksheet') {
        startWorksheet();
    }
}


// --- QUIZ FUNCTIONS (USES State.sessionQuestions) ---
function startQuiz() {
    document.getElementById('view-hub').classList.add('hidden');
    document.getElementById('view-quiz').classList.remove('hidden-view');

    UI.qJumpSelect.innerHTML = '';
    for(let i = 0; i < State.sessionQuestions.length; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.innerText = `Question ${i + 1}`;
        UI.qJumpSelect.appendChild(option);
    }
    renderQuestion();
}

function renderQuestion() {
    const q = State.sessionQuestions[State.currentQIndex];
    document.getElementById('question-tracker').innerText = `${State.currentQIndex + 1}/${State.sessionQuestions.length}`;
    document.getElementById('quiz-progress-bar').style.width = `${((State.currentQIndex) / State.sessionQuestions.length) * 100}%`;
    document.getElementById('q-text').innerText = q.q;
    
    UI.qJumpSelect.value = State.currentQIndex;
    
    const container = document.getElementById('options-container');
    container.innerHTML = '';

    if (!q.opts || q.opts.length < 4 || q.opts.every(opt => opt.length < 2)) {
        container.innerHTML = `<p style="color: var(--error);">Error: Question options are corrupted. Exiting quiz is recommended.</p>`;
        document.getElementById('next-q-btn').innerText = "Exit Quiz";
        document.getElementById('next-q-btn').onclick = exitQuiz;
        document.getElementById('next-q-btn').classList.remove('hidden');
        return;
    }

    q.opts.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.innerText = opt;
        btn.onclick = () => checkAnswer(btn, opt, q);
        container.appendChild(btn);
    });

    document.getElementById('q-feedback').classList.add('hidden');
    document.getElementById('next-q-btn').classList.add('hidden');
    document.getElementById('next-q-btn').innerText = (State.currentQIndex < State.sessionQuestions.length - 1) ? "Continue" : "Finish & Review";
    document.getElementById('next-q-btn').onclick = nextQuestion;
}

function checkAnswer(btn, selected, qData) {
    const buttons = document.querySelectorAll('.option-btn');
    buttons.forEach(b => b.disabled = true);

    const isCorrect = selected === qData.a;

    State.quizResults.push({
        q: qData.q,
        correct: isCorrect,
        selected: selected,
        answer: qData.a
    });

    if (isCorrect) {
        btn.classList.add('correct');
        showFeedback(true, `Correct! ${qData.why}`);
    } else {
        btn.classList.add('wrong');
        buttons.forEach(b => { if(b.innerText === qData.a) b.classList.add('correct'); });
        showFeedback(false, `Oops! ${qData.why}`);
    }
    document.getElementById('next-q-btn').classList.remove('hidden');
}

function showFeedback(isSuccess, msg) {
    const fb = document.getElementById('q-feedback');
    fb.innerHTML = `<span class="icon">${isSuccess ? '🎉' : '❌'}</span> ${msg}`;
    fb.classList.remove('hidden');
}

window.nextQuestion = () => {
    if (State.currentQIndex < State.sessionQuestions.length - 1) {
        State.currentQIndex++;
        renderQuestion();
    } else {
        showQuizSummary(); 
    }
};

window.exitQuiz = () => {
    document.getElementById('view-quiz').classList.add('hidden-view');
    document.getElementById('view-hub').classList.remove('hidden');
    handleInitialLoad(); 
};

window.jumpToQuestion = (selectElement) => {
    const index = parseInt(selectElement.value);
    if (!isNaN(index) && index >= 0 && index < State.sessionQuestions.length) {
        State.currentQIndex = index;
        renderQuestion();
    }
};


// --- FLASHCARD FUNCTIONS (V3.1) ---
function startFlashcards() {
    document.getElementById('view-hub').classList.add('hidden');
    document.getElementById('view-flashcards').classList.remove('hidden-view');
    
    document.getElementById('flashcard-tracker').innerText = `1/${State.sessionQuestions.length}`;
    document.getElementById('flashcard-progress-bar').style.width = `0%`;
    
    renderFlashcard();
}

window.renderFlashcard = () => {
    const q = State.sessionQuestions[State.currentQIndex];
    
    document.getElementById('flashcard-tracker').innerText = `${State.currentQIndex + 1}/${State.sessionQuestions.length}`;
    document.getElementById('flashcard-progress-bar').style.width = `${(State.currentQIndex / State.sessionQuestions.length) * 100}%`;
    
    const card = UI.flashcardContainer;
    const front = document.getElementById('flashcard-front-content');
    const back = document.getElementById('flashcard-back-content');
    
    card.classList.remove('flipped');
    
    front.innerText = q.q;
    
    back.innerHTML = `
        <div class="answer-key-section">
            <h4 style="color:var(--success)">Correct Answer:</h4>
            <p>${q.a}</p>
        </div>
        <div class="explanation-section">
            <h4 style="color:var(--primary)">Explanation:</h4>
            <p>${q.why}</p>
        </div>
    `;

    document.getElementById('flashcard-next-btn').innerText = (State.currentQIndex < State.sessionQuestions.length - 1) ? "Next Card" : "Finish & Back to Hub";
};

window.flipCard = (cardElement) => {
    cardElement.classList.toggle('flipped');
};

window.nextCard = () => {
    if (State.currentQIndex < State.sessionQuestions.length - 1) {
        State.currentQIndex++;
        renderFlashcard();
    } else {
        exitFlashcards();
    }
};

window.exitFlashcards = () => {
    document.getElementById('view-flashcards').classList.add('hidden-view');
    document.getElementById('view-hub').classList.remove('hidden');
    handleInitialLoad(); 
};


// --- WORKSHEET FUNCTIONS (V3.1) ---
function startWorksheet() {
    document.getElementById('view-hub').classList.add('hidden');
    UI.worksheetModal.classList.remove('hidden');

    generateWorksheetContent();
}

function generateWorksheetContent() {
    let qContent = '<h3>Practice Worksheet</h3><hr>';
    let aContent = '<h3>Answer Key</h3><hr>';
    
    State.sessionQuestions.forEach((q, index) => {
        const qNum = index + 1;
        
        qContent += `
            <div class="worksheet-item">
                <p><strong>${qNum}. ${q.q}</strong></p>
                <div style="height: 20px; border-bottom: 1px dashed var(--text-sub); margin-bottom: 15px;"></div>
            </div>
        `;
        
        aContent += `
            <div class="worksheet-item">
                <p><strong>${qNum}. Answer: ${q.a}</strong></p>
                <p style="font-size:0.9em; color:var(--text-sub); margin-top:-10px;"><em>Reason: ${q.why}</em></p>
            </div>
        `;
    });
    
    UI.worksheetContent.innerHTML = qContent;
    UI.worksheetAnswerKey.innerHTML = aContent;
    document.getElementById('worksheet-answer-key').classList.add('hidden-print');
    UI.worksheetShowKeyBtn.innerText = "Show Answer Key";
}

window.toggleWorksheetAnswerKey = () => {
    const key = document.getElementById('worksheet-answer-key');
    const isHidden = key.classList.toggle('hidden-print');
    UI.worksheetShowKeyBtn.innerText = isHidden ? "Show Answer Key" : "Hide Answer Key";
};

window.printWorksheet = () => {
    window.print();
};

window.closeWorksheet = () => {
    UI.worksheetModal.classList.add('hidden');
    document.getElementById('view-hub').classList.remove('hidden');
    handleInitialLoad();
};


// --- UI MANAGEMENT & INIT ---
function showQuizSummary() {
    const total = State.sessionQuestions.length;
    const correct = State.quizResults.filter(r => r.correct).length;
    const scoreText = `${correct} / ${total}`;
    
    document.getElementById('summary-score').innerText = scoreText;
    
    const list = document.getElementById('summary-results-list');
    list.innerHTML = '';

    State.quizResults.forEach((r, index) => {
        const item = document.createElement('div');
        item.className = `summary-item ${r.correct ? 'correct' : 'wrong'}`;
        item.innerHTML = `
            <div class="summary-q-text">${index + 1}. ${r.q}</div>
            <div class="summary-icon"><i class="fas fa-${r.correct ? 'check' : 'times'}"></i></div>
            <div class="summary-answer">
                Your Answer: ${r.correct ? 'Correct' : r.selected || 'N/A'}<br>
                Correct Answer: ${r.answer}
            </div>
        `;
        list.appendChild(item);
    });

    UI.quizSummaryModal.classList.remove('hidden');
}

window.closeSummary = () => {
    UI.quizSummaryModal.classList.add('hidden');
    exitQuiz();
};

window.retakeQuiz = () => {
    UI.quizSummaryModal.classList.add('hidden');
    startQuiz(); 
};

function handleInitialLoad() {
    document.getElementById('view-hub').classList.remove('hidden');
    document.getElementById('view-quiz').classList.add('hidden-view');
    document.getElementById('view-flashcards').classList.add('hidden-view');
    UI.quizSummaryModal.classList.add('hidden'); 
    UI.worksheetModal.classList.add('hidden');

    UI.quizLengthSelect.value = State.quizLength;
    document.querySelector(`input[name="study-mode"][value="${State.studyMode}"]`).checked = true;

    if (State.allQuestions.length > 0) {
        const mode = State.studyMode;
        const buttonText = (mode === 'worksheet') 
            ? "Generate Worksheet" 
            : `Start ${mode.charAt(0).toUpperCase() + mode.slice(1)} (${State.quizLength} Qs)`;
            
        UI.btn.innerText = buttonText;
        showToast(`Library built with ${CONFIG.MAX_QUESTIONS_GENERATED} questions is ready.`, 'info');
        UI.btn.onclick = () => routeToStudyMode(State.studyMode);
        UI.topicInput.disabled = false;
        UI.dropZone.style.pointerEvents = 'auto';

    } else {
        UI.btn.innerText = "Build Library";
        UI.btn.onclick = handleBuild;
        UI.topicInput.disabled = false;
        UI.dropZone.style.pointerEvents = 'auto';
    }
    
    if (State.lastFile) {
        document.getElementById('file-name').innerText = State.lastFile.name;
        UI.dropZone.classList.add('has-file');
    } else {
        document.getElementById('file-name').innerText = 'Select PDF Source';
        UI.dropZone.classList.remove('has-file');
    }
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if(file) {
        State.lastFile = { name: file.name }; 
        localStorage.setItem("lumina_file", JSON.stringify(State.lastFile));
        document.getElementById('file-name').innerText = file.name;
        UI.dropZone.classList.add('has-file');
        UI.btn.innerText = "Build Library";
        UI.btn.onclick = handleBuild;
    }
}

function clearSource() { 
    State.lastFile = null;
    State.allQuestions = [];
    State.sessionQuestions = [];
    localStorage.removeItem("lumina_file");
    sessionStorage.removeItem('lumina_questions'); 
    UI.fileInput.value = '';
    UI.topicInput.value = '';
    handleInitialLoad();
    UI.topicInput.focus();
    showToast("Input and internal quiz data cleared.", 'info'); 
}

function handleLengthChange(e) {
    State.quizLength = parseInt(e.target.value);
    localStorage.setItem("lumina_length", State.quizLength);
    handleInitialLoad();
}

function handleModeChange(e) {
    State.studyMode = e.target.value;
    localStorage.setItem("lumina_mode", State.studyMode);
    handleInitialLoad();
}

document.addEventListener('DOMContentLoaded', () => {
    UI.dropZone.onclick = () => UI.fileInput.click();
    UI.fileInput.onchange = handleFileSelect;
    UI.clearBtn.onclick = clearSource; 

    UI.quizLengthSelect.onchange = handleLengthChange;
    UI.studyModeRadios.forEach(radio => radio.onchange = handleModeChange);

    handleInitialLoad(); 
    
    // Settings setup (unchanged)
    const slider = document.getElementById('age-slider');
    slider.value = State.settings.age;
    const role = State.settings.age < 10 ? 'Explorer' : (State.settings.age < 16 ? 'Creator' : 'Innovator');
    document.getElementById('level-badge').innerText = `${State.settings.age} yrs • ${role}`;

    slider.oninput = () => {
        const val = slider.value;
        const role = val < 10 ? 'Explorer' : (val < 16 ? 'Creator' : 'Innovator');
        document.getElementById('level-badge').innerText = `${val} yrs • ${role}`;
        State.settings.age = val;
        localStorage.setItem("lumina_age", val);
    };

    document.getElementById('username-input').value = State.settings.username;
    document.getElementById('nav-username').innerText = State.settings.username; 
});

window.toggleSettings = () => {
    const m = document.getElementById('settings-modal');
    m.classList.toggle('hidden');
    if(!m.classList.contains('hidden')) {
        document.getElementById('age-slider').value = State.settings.age;
    } else {
        State.settings.username = document.getElementById('username-input').value;
        document.getElementById('nav-username').innerText = State.settings.username;
        localStorage.setItem("lumina_user", State.settings.username);
    }
};

window.resetApp = () => { 
    if (confirm("Are you sure? This will delete all saved settings and cached data (including the AI model weights). You will have to re-download the AI model.")) {
        localStorage.clear(); 
        sessionStorage.clear(); 
        location.reload(true); 
    }
};