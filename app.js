// --- CONFIGURATION & STATE (V18.0 Stable) ---
const PEXELS_API_KEY_DEFAULT = "qQZw9X3j2A76TuOYYHDo2ssebWP5H7K056k1rpdOTVvqh7SVDQr4YyWM"; 
let PEXELS_API_KEY = localStorage.getItem('pexelsKey') || PEXELS_API_KEY_DEFAULT; 

// V18.0: Add Theme State
let isDarkMode = localStorage.getItem('isDarkMode') === 'true';
let fontSize = localStorage.getItem('fontSize') || 16;
let topicName = localStorage.getItem('topicName') || '';

const State = {
    db: [], 
    sessionSet: [], 
    currentIndex: 0,
    seconds: 0,
    timerInt: null,
    quizState: [], 
    isPaused: false,
    quizStartTime: 0,
    isRetrySession: false 
};

// --- INITIALIZATION AND UI BINDINGS (V18.0: Refactor for Stability) ---

function playAudio(type) {
    console.log(`Audio Feedback: ${type}`);
}

function applyTheme() {
    document.body.classList.toggle('dark-mode', isDarkMode);
    document.documentElement.style.setProperty('--base-font-size', `${fontSize}px`);
}

document.addEventListener('DOMContentLoaded', () => {
    // V18.0: Apply theme immediately
    applyTheme();
    
    // V18.0: Initialize Topic Name
    const topicInput = document.getElementById('topic-name');
    topicInput.value = topicName;
    topicInput.addEventListener('input', (e) => {
        topicName = e.target.value;
        localStorage.setItem('topicName', topicName);
    });

    // V18.0: Initialize Age Slider
    const ageRange = document.getElementById('age-range');
    const ageVal = document.getElementById('age-val');
    const storedAge = localStorage.getItem('ageRange') || 10;
    
    ageRange.value = storedAge;
    ageVal.innerText = storedAge + ' yrs';
    
    ageRange.addEventListener('input', (e) => {
        const val = e.target.value;
        ageVal.innerText = val + ' yrs';
        localStorage.setItem('ageRange', val); // Persist age
    });

    // V18.0: File Status Listener
    document.getElementById('pdf-file').addEventListener('change', (e) => {
        const fileName = e.target.files[0] ? e.target.files[0].name : "Tap to Upload PDF";
        document.getElementById('file-status').innerText = fileName;
    });

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js');
    }
});

// --- HELPER: Custom Modal (No Change) ---

function openConfirmationModal(title, bodyText, actionText, actionFn) {
    const modalBody = document.getElementById('modal-body');
    const modalActionBtn = document.getElementById('modal-action-btn');

    document.getElementById('modal-title').innerText = title;
    
    modalActionBtn.classList.remove('hidden');
    modalActionBtn.innerText = actionText;
    modalActionBtn.onclick = () => {
        document.getElementById('modal-overlay').classList.add('hidden');
        if (actionFn) actionFn(); 
    };
    
    modalBody.innerHTML = `<p>${bodyText}</p>`;
    document.getElementById('modal-overlay').classList.remove('hidden');
}

// --- CORE FUNCTIONS (V18.0: Updated Logic) ---

async function processAndLoad() {
    const fileInput = document.getElementById('pdf-file');
    const processButton = document.querySelector('.primary-btn');
    const aiStatus = document.getElementById('ai-status');

    if (!topicName || topicName.trim() === "") {
        openConfirmationModal("Topic Required", "Please provide a Topic Name first.", "OK");
        return;
    }
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        openConfirmationModal("File Required", "Please select a PDF file before building the library.", "OK");
        return;
    }
    
    processButton.disabled = true;
    
    try {
        aiStatus.innerText = "1. ⬆️ Uploading PDF to AI Server...";
        
        // Use the globally updated topicName
        const quizData = await AIExtractionService(topicName, aiStatus);
        
        State.db = quizData; 
        
        document.getElementById('action-tiles').classList.remove('hidden');
        document.getElementById('file-status').innerText = fileInput.files[0].name;
        aiStatus.innerText = `✅ Success! ${quizData.length} Questions Loaded for ${topicName}.`;
        
    } catch (error) {
        aiStatus.innerText = `❌ Error: ${error.message}`;
        openConfirmationModal("AI Processing Failed", "Check your network or ensure the file is valid.", "Close");
        console.error("AI Mock Service Error:", error);
    } finally {
        processButton.disabled = false;
    }
}

function switchView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function openQuizConfig() {
    // ... (logic remains the same) ...
}

function startQuiz() {
    // ... (logic remains the same) ...
}

function startFlashcards() {
    if (State.db.length === 0) {
        openConfirmationModal("Library Empty", "Please build your library first!", "OK");
        return;
    }
    openConfirmationModal("Flashcards View", "Flashcards Session Initialized! (Simulated)", "Start Cards"); 
}

function generateWorksheets() {
    if (State.db.length === 0) {
        openConfirmationModal("Library Empty", "Please build your library first!", "OK");
        return;
    }
    openConfirmationModal("Worksheet Generated", "Worksheets PDF Generated! (Simulated). Check your downloads.", "Done"); 
}

// V18.0: Enhanced Settings Modal
function openSettingsModal() {
    const modalBody = document.getElementById('modal-body');
    const modalActionBtn = document.getElementById('modal-action-btn');

    document.getElementById('modal-title').innerText = 'App Settings';
    
    modalActionBtn.classList.remove('hidden'); 
    modalActionBtn.innerText = 'Save Settings';
    modalActionBtn.onclick = saveSettings; 
    
    modalBody.innerHTML = `
        <div class="setting-group">
            <h3>Appearance</h3>
            <div class="zone-selector">
                <label>Dark Mode</label>
                <input type="checkbox" id="dark-mode-toggle" ${isDarkMode ? 'checked' : ''}>
            </div>
            <div class="zone-selector">
                <label>Font Size</label>
                <input type="range" id="font-size-range" min="14" max="20" value="${fontSize}">
                <span id="font-size-val">${fontSize}px</span>
            </div>
            <div class="input-group">
                <label for="pexels-key">Pexels API Key:</label>
                <input type="text" id="pexels-key" class="glass-input" placeholder="Paste Key here..." value="${PEXELS_API_KEY === PEXELS_API_KEY_DEFAULT ? '' : PEXELS_API_KEY}">
            </div>
        </div>
        
        <button class="signout-btn" onclick="signOut()">Sign Out & Reset</button>
    `;

    document.getElementById('font-size-range').addEventListener('input', (e) => {
        document.getElementById('font-size-val').innerText = e.target.value + 'px';
    });
    
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function saveSettings() {
    const keyInput = document.getElementById('pexels-key');
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const fontSizeRange = document.getElementById('font-size-range');

    // 1. PEXELS KEY
    const key = keyInput.value.trim();
    if (key.length > 10) {
        PEXELS_API_KEY = key;
        localStorage.setItem('pexelsKey', key);
    } else if (key === "") {
        PEXELS_API_KEY = PEXELS_API_KEY_DEFAULT;
        localStorage.removeItem('pexelsKey');
    }

    // 2. DARK MODE
    isDarkMode = darkModeToggle.checked;
    localStorage.setItem('isDarkMode', isDarkMode);
    
    // 3. FONT SIZE
    fontSize = parseInt(fontSizeRange.value);
    localStorage.setItem('fontSize', fontSize);

    // Apply and close
    applyTheme();
    document.getElementById('modal-overlay').classList.add('hidden');
}

// V18.0: New Sign Out Function
function signOut() {
    openConfirmationModal(
        "Sign Out", 
        "Are you sure you want to sign out? This will clear all local data and settings.", 
        "Confirm Sign Out", 
        () => {
            localStorage.clear();
            window.location.reload(); // Hard reset the application
        }
    );
}

// ... (Image Loading, Quiz Interaction Logic, Timer and Mock Data remain the same) ...

function retryWrongAnswers() {
    const wrongAnswers = State.quizState.filter(q => q.isCorrect === false);
    
    if (wrongAnswers.length === 0) {
        openConfirmationModal("No Mistakes!", "Great job! You have no incorrect answers to retry.", "OK");
        return;
    }
    
    const retrySet = wrongAnswers.map(q => State.sessionSet[q.id]);
    
    State.isRetrySession = true;
    State.sessionSet = retrySet;
    
    setupQuizSession(retrySet.length); 

    // V18.0: Replaced alert() with Custom Modal
    openConfirmationModal("Retrying...", `Retrying ${retrySet.length} incorrect answers...`, "Start", () => {
        switchView('quiz-view');
        renderQuestion();
        startTimer();
    });
}