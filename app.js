// --- CONFIGURATION ---
const PEXELS_API_KEY = "qQZw9X3j2A76TuOYYHDo2ssebWP5H7K056k1rpdOTVvqh7SVDQr4YyWM";

const State = {
    db: [],
    sessionSet: [], // D05 Fix: Holds the current quiz questions
    currentIndex: 0,
    correctCount: 0,
    seconds: 0,
    timerInt: null
};

// --- INITIALIZATION AND DEFECT FIXES ---

// D03 Fix: Initialize and update the age slider display
document.addEventListener('DOMContentLoaded', () => {
    const ageRange = document.getElementById('age-range');
    const ageVal = document.getElementById('age-val');
    
    // Initial display
    ageVal.innerText = ageRange.value + ' yrs';

    // Listener for slider movement
    ageRange.addEventListener('input', (e) => {
        ageVal.innerText = e.target.value + ' yrs';
    });
});

// D02 Fix: Handle file selection change and show file name immediately
document.getElementById('pdf-file').addEventListener('change', (e) => {
    const fileName = e.target.files[0] ? e.target.files[0].name : "Tap to Upload PDF";
    document.getElementById('file-status').innerText = fileName;
});


// --- CORE FUNCTIONS (D04/D05 Fix) ---

function processAndLoad() {
    const fileInput = document.getElementById('pdf-file');
    const topic = document.getElementById('topic-name').value;

    if (!fileInput.files[0] || !topic) {
        alert("Please provide a Topic Name and select a PDF file first.");
        return;
    }

    // D04 Fix: Immediate visual feedback
    document.getElementById('file-status').innerHTML = "⏳ **Analyzing Content...**";
    document.querySelector('.primary-btn').disabled = true;

    // Simulate LLM extraction success after a delay
    setTimeout(() => {
        State.db = generateMockData(50); // Mocks 50 questions
        
        // D05 Fix: Correctly reveal the functional tiles
        document.getElementById('action-tiles').classList.remove('hidden');
        document.getElementById('file-status').innerHTML = "✅ **Ready! 50 Questions Loaded.**";
        document.querySelector('.primary-btn').disabled = false;
        
        // Ensure buttons are active now (for non-quiz tiles)
        document.querySelectorAll('.tile').forEach(tile => tile.style.pointerEvents = 'auto');

    }, 2000); 
}

function openQuizConfig() {
    const max = State.db.length;
    if (max === 0) {
        alert("Please build your library first!");
        return;
    }
    // D05 FIX: Using custom modal (assuming modal logic is in place)
    // If not, use the old prompt as a fallback for now:
    const count = prompt(`Questions in bank: ${max}. How many for this session? (1-${max})`, "10");
    if (count && parseInt(count) > 0 && parseInt(count) <= max) {
        setupQuizSession(parseInt(count));
        switchView('quiz-view');
        startTimer();
    } else if (count) {
        alert(`Please select a number between 1 and ${max}.`);
    }
}

// ... rest of the app.js code remains (e.g., renderQuestion, switchView, etc.) ...

function generateMockData(num) {
    // This is the source of truth for the 50+ questions.
    return Array.from({length: num}, (_, i) => ({
        question: `Sample Concept ${i+1}: What is the primary function of this subject?`,
        options: ["Option A", "Option B", "Option C", "Option D"],
        correct: "Option A",
        pdf_ref: `Page ${Math.floor(i/2) + 1}`,
        pexels_query: "education" // Pexels image query
    }));
}