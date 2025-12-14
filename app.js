// --- CONFIGURATION ---
const PEXELS_API_KEY = "qQZw9X3j2A76TuOYYHDo2ssebWP5H7K056k1rpdOTVvqh7SVDQr4YyWM";
const State = {
    db: [],
    sessionSet: [], 
    currentIndex: 0,
    correctCount: 0,
    seconds: 0,
    timerInt: null
};

// --- INITIALIZATION AND UI BINDINGS ---

// Fix: Initialize and update the age slider display
document.addEventListener('DOMContentLoaded', () => {
    const ageRange = document.getElementById('age-range');
    const ageVal = document.getElementById('age-val');
    
    // Set initial display
    ageVal.innerText = ageRange.value + ' yrs';

    // Listener for slider movement
    ageRange.addEventListener('input', (e) => {
        ageVal.innerText = e.target.value + ' yrs';
    });

    // Listener for file selection change (Fix for no visual confirmation)
    document.getElementById('pdf-file').addEventListener('change', (e) => {
        const fileName = e.target.files[0] ? e.target.files[0].name : "Tap to Upload PDF";
        document.getElementById('file-status').innerText = fileName;
    });

    // Ensure Service Worker is registered
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js');
    }
});


// --- CORE FUNCTIONS (Processing and Navigation) ---

function processAndLoad() {
    const fileInput = document.getElementById('pdf-file');
    const topic = document.getElementById('topic-name').value;
    const processButton = document.querySelector('.primary-btn');

    if (!fileInput.files[0] || !topic) {
        alert("Please provide a Topic Name and select a PDF file first.");
        return;
    }

    // Visual feedback and disabling button during processing
    document.getElementById('file-status').innerHTML = "⏳ **Analyzing Content...**";
    processButton.disabled = true;

    // Simulate LLM extraction (2-second delay)
    setTimeout(() => {
        State.db = generateMockData(50); // Mocks 50 questions
        
        // Success state: reveal tiles and update status
        document.getElementById('action-tiles').classList.remove('hidden');
        document.getElementById('file-status').innerHTML = "✅ **Ready! 50 Questions Loaded.**";
        processButton.disabled = false;

    }, 2000); 
}

// FIX: Centralized View Switching (Ensures Quiz remnants are hidden)
function switchView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// FIX: Custom Modal for Quiz Configuration
function openQuizConfig() {
    const max = State.db.length;
    if (max === 0) {
        alert("Please click 'Build My Library' first!");
        return;
    }
    
    // Set up the custom modal content
    const modalBody = document.getElementById('modal-body');
    document.getElementById('modal-title').innerText = 'Start Quiz Session';
    
    modalBody.innerHTML = `
        <p>Questions in bank: ${max}</p>
        <div class="input-group">
            <label for="q-count">Select Questions (1-${max}):</label>
            <input type="number" id="q-count" value="10" min="1" max="${max}" class="glass-input">
        </div>
    `;
    
    document.getElementById('modal-action-btn').innerText = 'Start Quiz';
    document.getElementById('modal-action-btn').onclick = startQuiz;
    document.getElementById('modal-overlay').classList.remove('hidden');
}

function startQuiz() {
    const countInput = document.getElementById('q-count');
    const count = parseInt(countInput.value);
    const max = State.db.length;
    
    if (count < 1 || count > max || isNaN(count)) {
        alert(`Invalid count. Must be between 1 and ${max}.`);
        return;
    }
    
    document.getElementById('modal-overlay').classList.add('hidden');
    
    // Quiz Setup Logic: Shuffle and slice
    State.sessionSet = [...State.db].sort(() => 0.5 - Math.random()).slice(0, count);
    State.currentIndex = 0;
    
    switchView('quiz-view');
    // renderQuestion(); // Function needed for rendering the UI
    // startTimer();     // Function needed for timer logic
}

function startFlashcards() {
    if (State.db.length === 0) {
        alert("Please build your library first!");
        return;
    }
    // Simulation: In final app, this transitions to the Flashcards view
    alert("Flashcards View Initialized! (Simulated)"); 
}

function generateWorksheets() {
    if (State.db.length === 0) {
        alert("Please build your library first!");
        return;
    }
    // Simulation: In final app, this initiates the print dialog with custom CSS
    alert("Worksheets PDF Generated! (Simulated)"); 
}

// Mock Data Function (Source of Truth)
function generateMockData(num) {
    return Array.from({length: num}, (_, i) => ({
        question: `Sample Concept ${i+1}: What is the primary function of this subject?`,
        options: ["Option A", "Option B", "Option C", "Option D"],
        correct: "Option A",
        pdf_ref: `Page ${Math.floor(i/2) + 1}`,
        pexels_query: "education"
    }));
}

// --- PLACEHOLDER FUNCTIONS (Required for a fully running app) ---
// These are included to prevent "Function not found" errors
function renderQuestion() {
    document.getElementById('quiz-content').innerHTML = `<h2>Quiz Running... Question ${State.currentIndex + 1}</h2><p>Function needs full implementation.</p>`;
}
function startTimer() { console.log('Timer started.'); }
function exitToHub() { switchView('hub-view'); }
function clearSelection() { alert('Clear selection logic needs implementation.'); }
function skipQuestion() { alert('Skip logic needs implementation.'); }
function handleNext() { alert('Next question logic needs implementation.'); }