// --- CONFIGURATION & STATE (V29.0 - Pexels Re-integrated, All Pop-up Issues Fixed) ---

const SELECTED_MODEL = "Phi-3-mini-4k-instruct-q4f16_1-MLC"; 

// PEXELS CONFIG (USER MUST REPLACE THIS KEY)
// WARNING: This key is exposed in the front-end code.
const PEXELS_API_KEY_DEFAULT = "qQZw9X3j2A76TuOYYHDo2ssebWP5H7K056k1rpdOTVvqh7SVDQr4YyWM"; 

// App Settings - Loaded from Local Storage
let isDarkMode = localStorage.getItem('isDarkMode') === 'true';
let fontSize = localStorage.getItem('fontSize') || 16;
let userName = localStorage.getItem('userName') || "Student"; 

const KNOWLEDGE_ZONES = {
    Explorer: { 
        min: 5, max: 10, 
        prompt: "You are a teacher for children (ages 5-10). Use simple language. Focus on basic facts." 
    },
    Creator: { 
        min: 11, max: 15, 
        prompt: "You are a tutor for teenagers. Focus on applying concepts." 
    },
    Innovator: { 
        min: 16, max: 25, 
        prompt: "You are a professor. Focus on critical analysis and complex synthesis." 
    }
};

const State = {
    db: [], // Universal Source of Truth (Generated Questions)
    sessionSet: [], 
    currentIndex: 0,
    seconds: 0,
    timerInt: null,
    quizState: [], 
    engine: null, // Holds WebLLM engine
    extractedText: "" 
};

// --- CORE UTILITIES ---
function getKnowledgeZone(age) {
    const ageInt = parseInt(age);
    if (ageInt >= 16) return 'Innovator';
    if (ageInt >= 11) return 'Creator';
    return 'Explorer';
}

function applyTheme() {
    // 1. Apply Dark Mode Class
    document.body.classList.toggle('dark-mode', isDarkMode);

    // 2. Apply Font Size Variable
    document.documentElement.style.setProperty('--base-font-size', `${fontSize}px`);

    // 3. Update Inputs (for Settings Modal)
    const rangeInput = document.getElementById('font-size-range');
    if (rangeInput) rangeInput.value = fontSize;
    
    const darkCheck = document.getElementById('dark-mode-check');
    if (darkCheck) darkCheck.checked = isDarkMode;
}

/**
 * FIX: This is the function that had the statusCallback error.
 * The inner function call now correctly takes the statusCallback as the second argument.
 */
async function extractTextFromPDF(file, statusCallback) {
    try {
        if (!window.pdfjsLib) throw new Error("PDF.js library not loaded in index.html");
        
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = "";
        const maxPages = Math.min(pdf.numPages, 5); 

        for (let i = 1; i <= maxPages; i++) {
            // Correct call to the statusCallback function
            statusCallback(`📄 Reading Page ${i}/${maxPages}...`); 
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(" ");
            fullText += `[Page ${i}] ${pageText}\n`;
        }
        return fullText;
    } catch (e) {
        console.error("PDF Read Error:", e);
        throw new Error("Could not read PDF. Make sure it is a text PDF (not scanned).");
    }
}

// --- PEXELS IMAGE UTILITY (NEW) ---
async function getPexelsImage(query) {
    if (PEXELS_API_KEY === "YOUR_PEXELS_API_KEY_HERE") {
        console.warn("Pexels API key not set. Skipping image fetch.");
        return null;
    }

    // Search Pexels for an image related to the topic
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
    
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': PEXELS_API_KEY }
        });

        if (!response.ok) {
            console.error(`Pexels API Error: ${response.status} ${response.statusText}`);
            return null;
        }

        const data = await response.json();

        if (data.photos.length > 0) {
            // Return the URL of a medium-sized image
            return data.photos[0].src.medium; 
        }
        return null;
    } catch (error) {
        console.error("Pexels API fetch failed:", error);
        return null;
    }
}


// --- AI ENGINE (WebLLM - Zero Fee) ---
async function initializeEngine(statusCallback) {
    if (State.engine) return State.engine;

    if (!window.webllm) {
        throw new Error("WebLLM library not loaded. Check index.html script tags.");
    }

    statusCallback("📥 Downloading AI Model (This happens once)...");
    
    const engine = new window.webllm.MLCEngine();
    engine.setInitProgressCallback((report) => {
        statusCallback(`📥 Loading AI: ${Math.ceil(report.progress * 100)}%`);
    });
    
    await engine.reload(SELECTED_MODEL);
    State.engine = engine;
    return engine;
}

async function AIExtractionService(topic, aiStatus) {
    const engine = await initializeEngine(aiStatus);
    
    // Start fetching the image while the AI model is setting up
    const imagePromise = getPexelsImage(topic);
    
    const age = localStorage.getItem('ageRange') || 10;
    const zone = getKnowledgeZone(age);
    const context = State.extractedText.substring(0, 4000); 

    const systemPrompt = `
        ${KNOWLEDGE_ZONES[zone].prompt}
        Task: Create 5 multiple-choice questions based on the Context.
        Format: ONLY valid JSON array. No text before/after.
        Example: [{"question":"?","options":["A","B","C","D"],"correct":"A", "explanation": "..."}]
    `;

    const userPrompt = `Topic: ${topic}\nContext: ${context}\n\nGenerate 5 questions now.`;

    aiStatus.innerText = "🧠 AI is thinking... (10-30s on first run)";
    
    try {
        const response = await engine.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.5,
            max_tokens: 1500,
        });

        const raw = response.choices[0].message.content;
        const start = raw.indexOf('[');
        const end = raw.lastIndexOf(']');
        
        if (start === -1 || end === -1) throw new Error("AI did not return a valid JSON list.");
        
        const jsonStr = raw.substring(start, end + 1);
        const questions = JSON.parse(jsonStr);
        
        // Wait for image fetch
        const imageUrl = await imagePromise;

        // Map and inject image URL into the FIRST question
        const finalQuestions = questions.map((q, i) => {
            const question = {
                id: `gen-${i}`,
                question: q.question,
                options: q.options,
                correct: q.correct,
                explanation: q.explanation || "Correct answer derived from document.",
                question_topic: topic
            };
            // Inject image into the first question only, for demonstration
            if (i === 0 && imageUrl) {
                question.imageUrl = imageUrl;
            }
            return question;
        });
        
        return finalQuestions;

    } catch (e) {
        console.error("AI Generation Failed:", e);
        return [{ question: "AI Failed to Generate. Re-run after confirming context.", options: ["A", "B", "C", "D"], correct: "A", explanation: "Fallback error." }];
    }
}


// --- MAIN WORKFLOW ---
async function processAndLoad() {
    const topic = document.getElementById('topic-name').value;
    const fileInput = document.getElementById('pdf-file');
    const aiStatus = document.getElementById('ai-status');
    const btn = document.getElementById('build-library-btn');

    if (!topic || !fileInput.files[0]) {
        openConfirmationModal("Missing Input", "Please enter a Topic Name and select a PDF file.", () => closeModal());
        return;
    }

    btn.disabled = true;
    
    try {
        // Step 1: Read PDF (Fixed call to extractTextFromPDF)
        State.extractedText = await extractTextFromPDF(fileInput.files[0], (msg) => aiStatus.innerText = msg);
        
        // Step 2: Generate Questions (This now includes Pexels image fetching)
        State.db = await AIExtractionService(topic, aiStatus);
        
        // Step 3: Success State
        aiStatus.innerText = `✅ Success! ${State.db.length} Questions Ready.`;
        
        // Enable Quiz/Flashcard/Worksheet Tiles 
        document.getElementById('action-tiles').querySelectorAll('.action-tile').forEach(t => t.classList.add('active'));
        
    } catch (error) {
        aiStatus.innerText = `❌ Error: ${error.message}`;
        State.db = []; 
    } finally {
        btn.disabled = false;
    }
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    applyTheme();

    // Set User Name in Header
    const welcomeEl = document.querySelector('header h4'); 
    if (welcomeEl) {
        welcomeEl.innerHTML = `Welcome back, <br><span style="font-size:1.2em; color:var(--primary-color);">${userName}</span>`;
    }

    // Fix: Level Slider Binding
    const ageRange = document.getElementById('age-range');
    const ageVal = document.getElementById('age-val');
    
    if (ageRange && ageVal) { 
        const currentAge = localStorage.getItem('ageRange') || 12;
        ageRange.value = currentAge;
        ageVal.innerText = `${currentAge} yrs (${getKnowledgeZone(currentAge)})`;
        
        ageRange.addEventListener('input', (e) => {
            const val = e.target.value;
            ageVal.innerText = `${val} yrs (${getKnowledgeZone(val)})`;
            localStorage.setItem('ageRange', val);
        });
    }

    // Bind PDF Name Display and clear on reload (FIX: File name not clearing)
    const pdfFile = document.getElementById('pdf-file');
    const fileStatus = document.getElementById('file-status');
    if (pdfFile && fileStatus) {
        // Clear file status on initial load
        fileStatus.innerText = "Tap to Upload PDF"; 

        pdfFile.addEventListener('change', (e) => {
            const name = e.target.files[0] ? e.target.files[0].name : "Tap to Upload PDF";
            fileStatus.innerText = name;
            document.getElementById('ai-status').innerText = "Ready to Analyze.";
        });
    }

    // Bind the main button explicitly
    const buildButton = document.getElementById('build-library-btn');
    if (buildButton) {
        buildButton.onclick = processAndLoad;
    }
});


// --- MODAL UTILITIES (FIX: Replaces all alert/confirm pop-ups) ---

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
}

/**
 * Universal modal function for confirmations and custom alerts.
 * @param {string} title 
 * @param {string} message 
 * @param {Function} onConfirm - Function to run when user clicks the primary button.
 * @param {boolean} isConfirmation - If true, show two buttons (Confirm/Cancel). If false, show one (OK).
 */
function openConfirmationModal(title, message, onConfirm, isConfirmation = false) {
    const modal = document.getElementById('modal-overlay');
    const body = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');
    
    modalTitle.innerText = title;
    
    let buttonsHtml = '';
    
    // NOTE: Function name is passed as a string, so we must use a function that is available globally (like signOut)
    // or use a wrapper function in the case of switchView
    const confirmAction = onConfirm.name ? `${onConfirm.name}()` : `(${onConfirm.toString().replace('()', '')})()`;
    
    if (isConfirmation) {
        buttonsHtml = `
            <button class="danger-btn" style="margin-right: 10px; width: 48%;" onclick="${confirmAction}">
                Yes, Continue
            </button>
            <button class="close-btn" style="width: 48%;" onclick="closeModal()">
                Cancel
            </button>
        `;
    } else {
        buttonsHtml = `
            <button class="primary-btn" onclick="${confirmAction}">
                OK
            </button>
        `;
    }

    body.innerHTML = `
        <p>${message}</p>
        <div style="display: flex; justify-content: space-between; margin-top: 20px;">
            ${buttonsHtml}
        </div>
    `;

    modal.classList.remove('hidden');
}


// --- SETTINGS LOGIC ---
function openSettingsModal() {
    const modal = document.getElementById('modal-overlay');
    const body = document.getElementById('modal-body');
    const title = document.getElementById('modal-title');
    
    title.innerText = "App Settings";
    
    // Settings body content
    body.innerHTML = `
        <div class="input-group">
            <label>Dark Mode</label>
            <input type="checkbox" id="dark-mode-check" 
                onchange="isDarkMode = this.checked; localStorage.setItem('isDarkMode', this.checked); applyTheme();" 
                ${isDarkMode ? 'checked' : ''}>
        </div>
        
        <div class="input-group" style="display:block;">
            <label>Font Size</label>
            <input id="font-size-range" type="range" min="12" max="24" value="${fontSize}" 
                oninput="fontSize = this.value; localStorage.setItem('fontSize', this.value); applyTheme();">
            <div style="text-align:right; font-size:0.8rem; color:var(--primary-color);">Drag to resize</div>
        </div>

        <button class="close-btn" onclick="closeModal()">
            Done
        </button>

        <button class="danger-btn" onclick="openSignOutConfirmation()">
            Sign Out & Reset Data
        </button>
    `;
    modal.classList.remove('hidden');
    applyTheme(); 
}

function openSignOutConfirmation() {
    closeModal(); // Close settings first
    // Open confirmation modal (isConfirmation = true)
    openConfirmationModal(
        "Reset App", 
        "Are you sure you want to sign out? This will permanently delete all saved settings and generated questions.", 
        signOut, // Function to call on confirmation
        true 
    );
}

function signOut() {
    localStorage.clear();
    location.reload();
}


// --- QUIZ & UI NAVIGATION ---
function startQuiz() {
    if (State.db.length === 0) {
        openConfirmationModal("No Library Loaded", "Please load your library by clicking 'Build My Library' first!", () => closeModal());
        return;
    }
    
    State.sessionSet = [...State.db]; 
    State.quizState = State.sessionSet.map(() => ({ answer: null, isCorrect: null }));
    State.currentIndex = 0;
    
    switchView('quiz-view');
    renderQuestion();
}

function renderQuestion() {
    const q = State.sessionSet[State.currentIndex];
    const sq = State.quizState[State.currentIndex];
    
    // PEXELS INTEGRATION: Display image if URL exists
    const imageHtml = q.imageUrl ? 
        `<img src="${q.imageUrl}" alt="Visual aid for ${q.question_topic}" 
             style="width: 100%; height: 200px; object-fit: cover; border-radius: 12px; margin-bottom: 15px;">
        <p style="font-size:0.75rem; text-align:right; margin-top:-10px; color:var(--text-color); opacity:0.7;">Image via Pexels</p>`
        : '';
    
    document.getElementById('quiz-content').innerHTML = `
        <div class="glass-panel">
            <h3>Question ${State.currentIndex + 1} of ${State.sessionSet.length}</h3>
            ${imageHtml}
            <p style="font-size:1.1rem; margin-bottom:20px;">${q.question}</p>
            <div class="options-list">
                ${q.options.map(opt => `
                    <button class="opt-btn ${sq.answer === opt ? (sq.isCorrect ? 'right' : 'wrong') : ''}" 
                            onclick="selectAnswer('${opt.replace(/'/g, "\\'")}')" 
                            ${sq.isCorrect !== null ? 'disabled' : ''}>
                        ${opt}
                    </button>
                `).join('')}
            </div>
             ${sq.isCorrect !== null ? `<p style="margin-top:10px; color:var(--text-color);"><em>${q.explanation}</em></p>` : ''}
        </div>
    `;
    
    document.getElementById('next-btn').disabled = (sq.isCorrect === null);
}

function selectAnswer(choice) {
    const sq = State.quizState[State.currentIndex];
    const q = State.sessionSet[State.currentIndex];
    
    if (sq.answer) return;

    sq.answer = choice;
    sq.isCorrect = (choice === q.correct);
    renderQuestion();
}

function handleNext() {
    if (State.currentIndex < State.sessionSet.length - 1) {
        State.currentIndex++;
        renderQuestion();
    } else {
        openConfirmationModal("Quiz Complete", "You have finished all questions! Returning to the main hub.", () => switchView('hub-view'));
    }
}

function switchView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function openExitConfirmation() {
    // Open confirmation modal for quiz exit
    openConfirmationModal(
        "Exit Quiz", 
        "Are you sure you want to exit? Your current quiz progress will be lost.", 
        () => { closeModal(); switchView('hub-view'); }, // Function to run if confirmed
        true // Is a confirmation
    );
}