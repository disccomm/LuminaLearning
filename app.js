// --- CONFIGURATION ---
const CONFIG = {
    model: "Phi-3-mini-4k-instruct-q4f16_1-MLC", 
    pexelsKey: "qQZw9X3j2A76TuOYYHDo2ssebWP5H7K056k1rpdOTVvqh7SVDQr4YyWM" // <-- ADD YOUR KEY HERE
    MAX_INFERENCE_RETRIES: 3 
};

const State = {
    engine: null, 
    isEngineLoaded: false,
    questions: [],
    currentQIndex: 0,
    quizResults: [], 
    settings: {
        username: localStorage.getItem("lumina_user") || "Student",
        age: parseInt(localStorage.getItem("lumina_age")) || 12
    },
    lastFile: JSON.parse(localStorage.getItem("lumina_file")) || null,
};

const UI = {
    btn: document.getElementById('generate-btn'),
    // Consolidated status and loading elements
    loadingArea: document.getElementById('loading-area'), 
    status: document.getElementById('system-status'),
    loader: document.getElementById('ai-loader-bar'),
    
    fileInput: document.getElementById('file-upload'),
    topicInput: document.getElementById('topic-input'),
    dropZone: document.getElementById('drop-zone'),
    quizSummaryModal: document.getElementById('quiz-summary-modal'),
    toast: document.getElementById('toast-message'),
    clearBtn: document.getElementById('clear-source-btn'),
    
    // New Quiz Navigation
    qJumpSelect: document.getElementById('question-jump-select')
};

// --- UTILITY 1: AGGRESSIVE AI OUTPUT CLEANUP (REINFORCED) ---
function aggressivelyCleanRawAIOutput(rawStr) {
    if (!rawStr) return "";

    // 1. Remove common pre/post-amble text, including code fences
    let cleaned = rawStr.replace(/```json\s*/i, '').replace(/```\s*$/, '').trim();
    cleaned = cleaned.replace(/here is the json array:/i, '').trim();
    
    // Aggressive: Remove leading comments or extra text before the array starts
    let start = cleaned.indexOf('[');
    let end = cleaned.lastIndexOf(']');

    if (start === -1 || end === -1 || end <= start) {
        return cleaned; 
    }
    
    // Extract the content inside the array, including the brackets
    cleaned = cleaned.substring(start, end + 1);

    // 2. Fix 1: Remove trailing commas before a closing bracket or curly brace.
    cleaned = cleaned.replace(/,\s*([\]}])/g, '$1'); 
    
    // 3. Fix 2: Remove leading/trailing quotes or backticks.
    cleaned = cleaned.trim().replace(/^`+|`+$/g, '');

    return cleaned;
}

// --- UTILITY 2: JSON REPAIR FUNCTION ---
function safelyParseJSON(rawStr) {
    let jsonStr = aggressivelyCleanRawAIOutput(rawStr);

    if (!jsonStr || jsonStr.length < 5) {
        throw new Error("AI output lacks valid JSON structure after cleanup.");
    }
    
    try {
        const parsed = JSON.parse(jsonStr);
        // CRITICAL VALIDATION: Ensure the structure is an array of objects
        if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'object' || !item.q || !Array.isArray(item.opts))) {
             throw new Error("Parsed JSON structure is invalid. Expected an array of question objects.");
        }
        return parsed;
    } catch (e) {
        console.error("Critical JSON Parsing Failed:", e);
        throw new Error(`Syntax error in AI-generated JSON: ${e.message}`);
    }
}

// --- UTILITY 3: TOAST NOTIFICATION ---
function showToast(message, type = 'info') {
    UI.toast.innerText = message;
    UI.toast.className = `toast ${type}`;
    UI.toast.classList.remove('hidden');
    setTimeout(() => {
        UI.toast.classList.add('hidden');
    }, 3000);
}


// --- CORE 1: PDF EXTRACTION ---
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

// --- CORE 2: AI ENGINE ---
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

// Function with improved retry logic and prompt
async function attemptGenerateQuestions(topic, text, onProgress, attempt = 1) {
    const engine = await getAIEngine(onProgress);
    
    UI.loader.style.width = `0%`;
    onProgress(`AI is thinking... (Attempt ${attempt}/${CONFIG.MAX_INFERENCE_RETRIES})`, 0);

    const age = State.settings.age;
    const contextLimit = 1500;
    const textContext = text.substring(0, contextLimit);
    
    // Prompt: Strictly enforce JSON with full option text
    const prompt = `
    Context: ${textContext}
    Topic: ${topic}
    Create 5 high-quality, multiple-choice questions for a student at the ${age}-year-old difficulty level.
    
    **CRITICAL INSTRUCTION:** Return ONLY a JSON Array. DO NOT include any text, notes, or explanations before or after the array.
    
    The JSON structure MUST strictly adhere to this format:
    
    \`\`\`json
    [
      {
        "q": "Question Text", 
        "opts": ["Full Option Text A","Full Option Text B","Full Option Text C","Full Option Text D"], 
        "a": "Correct Full Option Text (Must exactly match one of the opts)", 
        "why": "Brief Explanation"
      },
      // ... up to 5 questions
    ]
    \`\`\`
    
    Ensure the 'opts' array contains the full, descriptive text for each choice, not just single letters.
    `;

    const response = await engine.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4, 
    });

    const raw = response.choices[0].message.content;

    try {
        return safelyParseJSON(raw);
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


// --- CONTROLLER: MAIN LOGIC (STRICT SEQUENCING) ---
async function handleBuild() {
    const file = UI.fileInput.files[0];
    const topic = UI.topicInput.value.trim(); 

    if (!file) return showToast("Please select a PDF file.", 'warning');
    if (!topic) return showToast("Please enter a topic.", 'warning');

    UI.btn.disabled = true;
    
    // CRITICAL FIX: Ensure UI is fully ready and visible BEFORE any async call that reports status
    UI.loadingArea.classList.remove('hidden');
    UI.loader.style.background = 'var(--primary)'; 

    const updateStatus = (msg, percent = null) => {
        UI.status.innerHTML = `<i class="fas fa-sync fa-spin"></i> ${msg}`;
        if (percent !== null) UI.loader.style.width = `${percent}%`;
    };

    try {
        // 1. Load AI Engine
        await getAIEngine(updateStatus);

        // 2. PDF
        UI.loader.style.width = `0%`;
        const text = await extractTextFromPDF(file, (msg) => updateStatus(msg, 10)); 

        // 3. AI Inference with Retries
        State.questions = await attemptGenerateQuestions(topic, text, updateStatus);
        
        if (State.questions.length === 0) throw new Error("AI returned an empty question set.");

        // 4. Start Quiz
        showToast(`Library built with ${State.questions.length} questions!`, 'success');
        startQuiz();

    } catch (err) {
        UI.status.innerHTML = `<span style="color:var(--error)">❌ Error: ${err.message}</span>`;
        UI.loader.style.background = 'var(--error)';
        console.error("BUILD ERROR:", err);
    } finally {
        UI.btn.disabled = false;
        UI.loader.style.width = '100%'; 
    }
}


// --- QUIZ & UI FUNCTIONS ---
function startQuiz() {
    document.getElementById('view-hub').classList.add('hidden');
    document.getElementById('view-quiz').classList.remove('hidden-view');
    State.currentQIndex = 0;
    State.quizResults = []; 
    // New: Populate Jump Selector
    UI.qJumpSelect.innerHTML = '';
    for(let i = 0; i < State.questions.length; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.innerText = `Question ${i + 1}`;
        UI.qJumpSelect.appendChild(option);
    }
    renderQuestion();
}

window.jumpToQuestion = (selectElement) => {
    const index = parseInt(selectElement.value);
    if (!isNaN(index) && index >= 0 && index < State.questions.length) {
        State.currentQIndex = index;
        renderQuestion();
    }
};

function renderQuestion() {
    const q = State.questions[State.currentQIndex];
    document.getElementById('question-tracker').innerText = `${State.currentQIndex + 1}/${State.questions.length}`;
    document.getElementById('quiz-progress-bar').style.width = `${((State.currentQIndex) / State.questions.length) * 100}%`;
    document.getElementById('q-text').innerText = q.q;
    
    // Update question jump select box
    UI.qJumpSelect.value = State.currentQIndex;
    
    // (Image container logic remains the same)
    const container = document.getElementById('options-container');
    container.innerHTML = '';

    // FINAL VALIDATION CHECK: Reject questions with bad options (e.g. single letters)
    if (!q.opts || q.opts.length < 4 || q.opts.every(opt => opt.length < 2)) {
        container.innerHTML = `<p style="color: var(--error);">Error: Question options are corrupted. AI returned invalid data. Exiting quiz is recommended.</p>`;
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
    document.getElementById('next-q-btn').innerText = (State.currentQIndex < State.questions.length - 1) ? "Continue" : "Finish & Review";
    document.getElementById('next-q-btn').onclick = nextQuestion;
}

// ... (checkAnswer, showFeedback remain the same) ...
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
    if (State.currentQIndex < State.questions.length - 1) {
        State.currentQIndex++;
        renderQuestion();
    } else {
        showQuizSummary(); 
    }
};

window.exitQuiz = () => {
    document.getElementById('view-quiz').classList.add('hidden-view');
    document.getElementById('view-hub').classList.remove('hidden');
    // Hide consolidated loading UI components
    UI.loadingArea.classList.add('hidden');
    UI.loader.style.width = '0%';
};


// --- QUIZ SUMMARY MODAL ---
function showQuizSummary() {
    const total = State.questions.length;
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


// --- INIT LISTENERS & APP STATE ---
function handleFileSelect(e) {
    const file = e.target.files[0];
    if(file) {
        State.lastFile = { name: file.name }; 
        localStorage.setItem("lumina_file", JSON.stringify(State.lastFile));
        document.getElementById('file-name').innerText = file.name;
        UI.dropZone.classList.add('has-file');
    }
}

function clearSource() { 
    State.lastFile = null;
    localStorage.removeItem("lumina_file");
    UI.fileInput.value = '';
    UI.topicInput.value = '';
    document.getElementById('file-name').innerText = 'Select PDF Source';
    UI.dropZone.classList.remove('has-file');
    UI.topicInput.focus();
    showToast("Input cleared.", 'info'); 
}

document.addEventListener('DOMContentLoaded', () => {
    UI.dropZone.onclick = () => UI.fileInput.click();
    UI.fileInput.onchange = handleFileSelect;
    UI.btn.onclick = handleBuild;
    UI.clearBtn.onclick = clearSource; 

    // ... (rest of DOMContentLoaded for settings/slider remains the same) ...

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
    
    if (State.lastFile) {
        document.getElementById('file-name').innerText = State.lastFile.name;
        UI.dropZone.classList.add('has-file');
        showToast(`Ready to analyze ${State.lastFile.name}.`, 'info');
    }
});

// Settings Modal Handlers
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
        location.reload(true); 
    }
};