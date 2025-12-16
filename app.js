// --- CONFIGURATION ---
const CONFIG = {
    model: "Phi-3-mini-4k-instruct-q4f16_1-MLC", 
    pexelsKey: "qQZw9X3j2A76TuOYYHDo2ssebWP5H7K056k1rpdOTVvqh7SVDQr4YyWM" // <-- ADD YOUR KEY HERE
};

const State = {
    engine: null, 
    isEngineLoaded: false,
    questions: [],
    currentQIndex: 0,
    settings: {
        username: localStorage.getItem("lumina_user") || "Student",
        age: parseInt(localStorage.getItem("lumina_age")) || 12
    }
};

const UI = {
    btn: document.getElementById('generate-btn'),
    status: document.getElementById('system-status'),
    loader: document.getElementById('ai-loader-bar'),
    loadContainer: document.getElementById('ai-progress-container'),
    fileInput: document.getElementById('file-upload'),
    topicInput: document.getElementById('topic-input'),
    dropZone: document.getElementById('drop-zone')
};


// --- UTILITY: JSON REPAIR FUNCTION (NEW & CRITICAL FIX) ---
function safelyParseJSON(rawStr) {
    if (!rawStr) throw new Error("Empty AI response received.");

    // 1. Find the bounds of the JSON array
    let start = rawStr.indexOf('[');
    let end = rawStr.lastIndexOf(']') + 1;

    if (start === -1 || end === 0 || end <= start) {
        throw new Error("AI output lacks valid array markers ([...]).");
    }
    
    let jsonStr = rawStr.substring(start, end);

    // 2. Aggressive Repair for Common LLM Errors
    try {
        // Fix 1: Remove trailing commas before a closing bracket or curly brace.
        // This is the most common cause of the JSON parsing error seen.
        jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1'); 

        // Fix 2: Remove leading/trailing quotes or backticks if they surround the whole array.
        jsonStr = jsonStr.trim().replace(/^`+|`+$/g, '');

        return JSON.parse(jsonStr);

    } catch (e) {
        console.error("Critical JSON Repair Failed:", e);
        throw new Error(`Syntax error in AI-generated JSON: ${e.message}`);
    }
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

// --- CORE 2: AI ENGINE (SINGLETON & OPTIMIZED CLARITY) ---
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

        if (text.includes("Fetching")) text = "One-Time Download (First Use)...";
        if (text.includes("Loading")) text = "Loading into GPU VRAM...";
        
        onProgress(text, percentage);
    });

    await engine.reload(CONFIG.model);
    
    State.engine = engine;
    State.isEngineLoaded = true;
    return engine;
}

async function generateQuestions(topic, text, onProgress) {
    const engine = await getAIEngine(onProgress);
    
    UI.loader.style.width = `0%`;
    onProgress("AI is thinking... (Running on your GPU)", 0); // Status update for thinking

    const age = State.settings.age;
    const contextLimit = 1500;
    const textContext = text.substring(0, contextLimit);
    
    const prompt = `
    Context: ${textContext}
    Topic: ${topic}
    Create 5 multiple-choice questions for a ${age}-year-old student.
    Return ONLY a JSON Array. DO NOT include any text, notes, or explanations before or after the array.
    Format: [{"q": "Question", "opts": ["A","B","C","D"], "a": "Correct Option String", "why": "Explanation"}]
    `;

    const response = await engine.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3, 
    });

    const raw = response.choices[0].message.content;

    try {
        // Use the new safe parser to handle malformed JSON from the LLM
        return safelyParseJSON(raw);
    } catch (e) {
        console.error("Failed to process AI output:", e);
        throw new Error("Failed to parse AI response. Retrying...");
    }
}

// --- CORE 3: PEXELS IMAGE FETCH ---
async function fetchImageForTopic(topic) {
    if (!CONFIG.pexelsKey || CONFIG.pexelsKey === "YOUR_PEXELS_KEY_HERE") {
        console.warn("Pexels API key not configured. Skipping image fetch.");
        return null;
    }

    try {
        const query = encodeURIComponent(topic);
        const url = `https://api.pexels.com/v1/search?query=${query}&per_page=1`;
        
        const response = await fetch(url, {
            headers: {
                Authorization: CONFIG.pexelsKey
            }
        });

        if (!response.ok) {
            throw new Error(`Pexels API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        if (data.photos && data.photos.length > 0) {
            return data.photos[0].src.medium; 
        }
        return null;
    } catch (e) {
        console.error("Image Fetch Error:", e);
        return null;
    }
}


// --- CONTROLLER: MAIN LOGIC ---
async function handleBuild() {
    const file = UI.fileInput.files[0];
    const topic = UI.topicInput.value.trim(); 

    if (!file) return alert("Please select a PDF file.");
    if (!topic) return alert("Please enter a topic.");

    UI.btn.disabled = true;
    UI.status.classList.remove('hidden');
    UI.loadContainer.classList.remove('hidden');

    const updateStatus = (msg, percent = null) => {
        UI.status.innerHTML = `<i class="fas fa-sync fa-spin"></i> ${msg}`;
        if (percent !== null) UI.loader.style.width = `${percent}%`;
    };

    try {
        // 1. Load AI Engine (Handles download/cache check and initial load)
        await getAIEngine(updateStatus);

        // 2. PDF 
        UI.loader.style.width = `0%`;
        const text = await extractTextFromPDF(file, (msg) => updateStatus(msg, 10)); 

        // 3. AI Inference
        State.questions = await generateQuestions(topic, text, updateStatus);

        // 4. PEXELS IMAGE FETCH
        updateStatus("Finalizing... Fetching visual context.");
        const imageUrl = await fetchImageForTopic(topic);
        
        if (State.questions.length > 0) {
            State.questions[0].imageUrl = imageUrl; 
        }
        
        // 5. Start Quiz
        startQuiz();

    } catch (err) {
        UI.status.innerHTML = `<span style="color:var(--error)">❌ Error: ${err.message}</span>`;
        UI.loader.style.background = 'var(--error)';
        console.error("Build Failed:", err);
    } finally {
        UI.btn.disabled = false;
    }
}

// --- QUIZ & UI FUNCTIONS ---
function startQuiz() {
    document.getElementById('view-hub').classList.add('hidden');
    document.getElementById('view-quiz').classList.remove('hidden-view');
    State.currentQIndex = 0;
    renderQuestion();
}

function renderQuestion() {
    const q = State.questions[State.currentQIndex];
    document.getElementById('question-tracker').innerText = `${State.currentQIndex + 1}/${State.questions.length}`;
    document.getElementById('quiz-progress-bar').style.width = `${((State.currentQIndex) / State.questions.length) * 100}%`;
    document.getElementById('q-text').innerText = q.q;
    
    const imgContainer = document.getElementById('q-image-container');
    imgContainer.innerHTML = ''; 

    if (q.imageUrl) {
        imgContainer.classList.remove('hidden');
        imgContainer.innerHTML = `<img src="${q.imageUrl}" alt="${q.q}" />`;
    } else {
        imgContainer.classList.add('hidden');
    }
    
    const container = document.getElementById('options-container');
    container.innerHTML = '';

    q.opts.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.innerText = opt;
        btn.onclick = () => checkAnswer(btn, opt, q);
        container.appendChild(btn);
    });

    document.getElementById('q-feedback').classList.add('hidden');
    document.getElementById('next-q-btn').classList.add('hidden');
}

function checkAnswer(btn, selected, qData) {
    const buttons = document.querySelectorAll('.option-btn');
    buttons.forEach(b => b.disabled = true);

    if (selected === qData.a) {
        btn.classList.add('correct');
        showFeedback(true, "Correct! " + qData.why);
    } else {
        btn.classList.add('wrong');
        buttons.forEach(b => { if(b.innerText === qData.a) b.classList.add('correct'); });
        showFeedback(false, "Oops! " + qData.why);
    }
    document.getElementById('next-q-btn').classList.remove('hidden');
}

function showFeedback(isSuccess, msg) {
    const fb = document.getElementById('q-feedback');
    fb.innerHTML = (isSuccess ? '🎉 ' : '❌ ') + msg;
    fb.style.color = isSuccess ? '#00D885' : '#FF4455';
    fb.classList.remove('hidden');
}

window.nextQuestion = () => {
    if (State.currentQIndex < State.questions.length - 1) {
        State.currentQIndex++;
        renderQuestion();
    } else {
        alert("Quiz Complete!");
        exitQuiz();
    }
};

window.exitQuiz = () => {
    document.getElementById('view-quiz').classList.add('hidden-view');
    document.getElementById('view-hub').classList.remove('hidden');
    UI.status.classList.add('hidden');
    UI.loadContainer.classList.add('hidden');
    UI.loader.style.width = '0%';
    // Clear uploaded file display on exit
    document.getElementById('file-name').innerText = 'Select PDF Source'; 
    UI.dropZone.style.borderColor = 'rgba(255,255,255,0.2)';
    UI.dropZone.style.background = 'transparent';
};

// --- INIT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
    UI.dropZone.onclick = () => UI.fileInput.click();
    UI.fileInput.onchange = (e) => {
        if(e.target.files[0]) {
            document.getElementById('file-name').innerText = e.target.files[0].name;
            UI.dropZone.style.borderColor = '#6C5DD3';
            UI.dropZone.style.background = 'rgba(108, 93, 211, 0.1)';
        }
    };

    const slider = document.getElementById('age-slider');
    slider.oninput = () => {
        const val = slider.value;
        const role = val < 10 ? 'Explorer' : (val < 16 ? 'Creator' : 'Innovator');
        document.getElementById('level-badge').innerText = `${val} yrs • ${role}`;
        State.settings.age = val;
    };

    document.getElementById('username-input').value = State.settings.username;
    document.getElementById('nav-username').innerText = State.settings.username; 
    
    UI.btn.onclick = handleBuild;
});

window.toggleSettings = () => {
    const m = document.getElementById('settings-modal');
    m.classList.toggle('hidden');
    if(!m.classList.contains('hidden')) {
        // When opening, ensure username slider value is loaded
        const slider = document.getElementById('age-slider');
        slider.value = State.settings.age;
    } else {
        // When closing, save settings
        State.settings.username = document.getElementById('username-input').value;
        document.getElementById('nav-username').innerText = State.settings.username;
        localStorage.setItem("lumina_user", State.settings.username);
        // Age is saved in slider.oninput
    }
};

window.resetApp = () => { 
    if (confirm("Are you sure? This will delete all saved settings and cached data (including the AI model weights). You will have to re-download the AI model.")) {
        localStorage.clear(); 
        // Force hard reload to clear any residual JS/WebLLM state
        location.reload(true); 
    }
};