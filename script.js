import { Engine } from 'https://cdn.jsdelivr.net/npm/@litert-lm/core/+esm';

let engine;
let chat;
let currentSessionId = null;
let db = null;

// DOM Elements
const chatBox = document.getElementById('chatBox');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const statusBadge = document.getElementById('statusBadge');
const initMessage = document.getElementById('initMessage');
const modelFileInput = document.getElementById('modelFileInput');
const sessionList = document.getElementById('sessionList');


// 1. High-Intent Triggers: Words that almost always imply real-time web dependency
const HIGH_INTENT_PATTERNS = [
  /\b(weather|forecast|temperature|rain|snow|crypto|news|headlines|sensex|nifty|stock price)\b/i,
  /\bsearch (the web|online|google|bing|duckduckgo)\b/i,
  /\b(gold|silver|bitcoin|solana|ethereum|dollar|rupee) price\b/i,
  /\b(live score|match score|who won today)\b/i
];

// 2. Context Triggers: Broad terms that require a temporal anchor to be valid
const CONTEXT_PATTERNS = [
  /\b(price|score|stock|rate|event|conferencing|news|update|meeting|happening|status|traffic)\b/i
];

// 3. Temporal Anchors: Time phrases that restrict broad context terms
const TEMPORAL_PATTERNS = [
  /\b(today|tonight|tomorrow|right now|currently|this week|latest|current|live|real[- ]?time)\b/i
];

export function needsWebSearch(text) {
  const sanitizedText = text.trim();
  if (!sanitizedText) return false;

  // Rule 1: Immediate trigger on absolute high-intent signatures
  if (HIGH_INTENT_PATTERNS.some((pattern) => pattern.test(sanitizedText))) {
    return true;
  }

  // Rule 2: Combo trigger. Only search if a Context keyword matches AND a Temporal keyword matches
  // Example: "Apple stock" -> False | "Apple stock today" -> True
  const hasContext = CONTEXT_PATTERNS.some((pattern) => pattern.test(sanitizedText));
  const hasTemporal = TEMPORAL_PATTERNS.some((pattern) => pattern.test(sanitizedText));

  if (hasContext && hasTemporal) {
    return true;
  }

  return false;
}

// Configure Marked.js to use Highlight.js for code blocks
marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
    },
    breaks: true // Convert standard line breaks to <br>
});

// ==========================================
// 1. INDEXEDDB MANAGER (CORE HISTORY LOGIC)
// ==========================================
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("AuraChatDB", 1);
        
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains("sessions")) {
                database.createObjectStore("sessions", { keyPath: "id" });
            }
            if (!database.objectStoreNames.contains("messages")) {
                const msgStore = database.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
                msgStore.createIndex("sessionId", "sessionId", { unique: false });
            }
        };

        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

// Save or Update Session Meta
function saveSessionMeta(id, title) {
    return new Promise((resolve) => {
        const transaction = db.transaction(["sessions"], "readwrite");
        const store = transaction.objectStoreNames ? transaction.objectStore("sessions") : transaction.objectStore("sessions");
        
        const sessionData = { id, title, updatedAt: Date.now() };
        store.put(sessionData);
        
        transaction.oncomplete = async () => {
            await enforceSessionLimit();
            await renderSidebarSessions();
            resolve();
        };
    });
}

// Enforce limit of exactly 20 sessions max
function enforceSessionLimit() {
    return new Promise((resolve) => {
        const transaction = db.transaction(["sessions", "messages"], "readwrite");
        const sessionStore = transaction.objectStore("sessions");
        const messageStore = transaction.objectStore("messages");
        
        sessionStore.getAll().onsuccess = (e) => {
            const allSessions = e.target.result;
            
            // Sort by oldest first
            allSessions.sort((a, b) => a.updatedAt - b.updatedAt);
            
            if (allSessions.length > 20) {
                const excessCount = allSessions.length - 20;
                const sessionsToDelete = allSessions.slice(0, excessCount);
                
                sessionsToDelete.forEach(session => {
                    sessionStore.delete(session.id);
                    
                    // Cascade deletion to wipe all matching messages
                    const index = messageStore.index("sessionId");
                    index.openCursor(IDBKeyRange.only(session.id)).onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            cursor.delete();
                            cursor.continue();
                        }
                    };
                });
                console.log(`Purged ${excessCount} old chat session(s) to optimize space.`);
            }
            resolve();
        };
    });
}

// Save an individual message
function saveMessage(sessionId, role, text) {
    const transaction = db.transaction(["messages", "sessions"], "readwrite");
    const msgStore = transaction.objectStore("messages");
    const sessionStore = transaction.objectStore("sessions");
    
    msgStore.add({ sessionId, role, text, timestamp: Date.now() });
    
    // Touch session timestamp to keep it fresh at the top of the history list
    sessionStore.get(sessionId).onsuccess = (e) => {
        const session = e.target.result;
        if (session) {
            session.updatedAt = Date.now();
            sessionStore.put(session);
        }
    };
}

// Load historical messages into active view window
function loadSessionMessages(sessionId) {
    chatBox.innerHTML = '';
    initMessage.style.display = 'none';
    
    const transaction = db.transaction(["messages"], "readonly");
    const index = transaction.objectStore("messages").index("sessionId");
    
    index.getAll(IDBKeyRange.only(sessionId)).onsuccess = (e) => {
        const messages = e.target.result;
        // Sort explicitly by timestamp
        messages.sort((a, b) => a.timestamp - b.timestamp);
        messages.forEach((msg) => {
          const msgDiv = appendMessageMarkup("", msg.role);
          if (msg.role === "ai") {
            msgDiv.innerHTML = DOMPurify.sanitize(marked.parse(msg.text));
          } else {
            msgDiv.textContent = msg.text; // Keep user messages as plain text
          }
        });
    };
}

// Render sessions array inside offcanvas layout 
function renderSidebarSessions() {
    return new Promise((resolve) => {
        const transaction = db.transaction(["sessions"], "readonly");
        transaction.objectStore("sessions").getAll().onsuccess = (e) => {
            const sessions = e.target.result;
            // Sort descending: newest chats show up first
            sessions.sort((a, b) => b.updatedAt - a.updatedAt);
            
            sessionList.innerHTML = '';
            sessions.forEach(session => {
                const btn = document.createElement('button');
                btn.className = `list-group-item list-group-item-action session-item ${session.id === currentSessionId ? 'active' : ''}`;
                btn.textContent = session.title || "Untitled Conversation";
                btn.onclick = () => switchSession(session.id);
                sessionList.appendChild(btn);
            });
            resolve();
        };
    });
}

// Switch between conversation pipelines
async function switchSession(id) {
    currentSessionId = id;
    loadSessionMessages(id);
    await renderSidebarSessions();
    
    // Reset conversation structure inside inference window
    if (engine) {
        chat = await engine.createConversation();
    }
    
    // Close the Bootstrap offcanvas sidebar automatically
    const sidebarEl = document.getElementById('historySidebar');
    const instance = bootstrap.Offcanvas.getInstance(sidebarEl);
    if (instance) instance.hide();
}

// ==========================================
// 2. UI HELPERS & ENGINE MANAGEMENT
// ==========================================
function appendMessageMarkup(text, sender) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message msg-${sender}`;
    msgDiv.textContent = text;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
    return msgDiv;
}

function updateStatus(text, bgClass) {
    statusBadge.textContent = text;
    statusBadge.className = `badge ${bgClass} text-white`;
}

async function initializeEngine(file) {
    updateStatus('Loading Engine...', 'bg-info');
    const localModelUrl = URL.createObjectURL(file);
    
    try {
        engine = await Engine.create({ model: localModelUrl });
        chat = await engine.createConversation();
        updateStatus('Model Ready', 'bg-success');
    } catch (error) {
        updateStatus('Error Loading', 'bg-danger');
        appendMessageMarkup(`Initialization error: ${error.message}`, "system");
    }
}

// ==========================================
// 3. APPLICATION RUNTIME & LIFESTYLE EVENT BINDINGS
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    await renderSidebarSessions();

    try {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle("gemma-4-E2B.litertlm");
        const file = await fileHandle.getFile();
        initializeEngine(file);
    } catch (e) {
        console.log("No cached model file found inside OPFS sandbox container.");
    }
});

modelFileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    updateStatus('Saving to Cache...', 'bg-info');
    appendMessageMarkup(`Saving ${file.name} to local browser storage...`, "system");
    
    try {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle("gemma-4-E2B.litertlm", { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(file);
        await writable.close();
        
        await initializeEngine(file);
    } catch (error) {
        appendMessageMarkup(`Storage error: ${error.message}`, "system");
        updateStatus('Storage Error', 'bg-danger');
    }
});

async function handleSend() {
    if (!engine) {
        alert("Please load the local WebAssembly runtime engine core first!");
        return;
    }

    const text = userInput.value.trim();
    if (!text) return;

    // ==========================================
    // BUG FIX: Initialize Session ID if missing
    // ==========================================
    if (!currentSessionId) {
        currentSessionId = "session_" + Date.now();
        // Take the first 25 characters of the prompt as the conversation title
        const sessionTitle = text.length > 25 ? text.substring(0, 25) + "..." : text;
        await saveSessionMeta(currentSessionId, sessionTitle);
        initMessage.style.display = 'none';
    }

    // 1. Inject the System Prompt instructions implicitly
    const isSearchRequired = needsWebSearch(text);

    let systemInstruction = "";
    if (isSearchRequired) {
      // Force agentic token parsing framework instructions
      systemInstruction = `You are AuraChat. The user is asking for real-time information. You must reply ONLY with [SEARCH: "your query"].\n\nUser: ${text}`;
    } else {
      // Normal conversation system instruction (Skip the search proxy check entirely)
      systemInstruction = `You are AuraChat, a helpful local AI assistant.\n\nUser: ${text}`;
    }
    // Update UI View & Save user prompt state
    appendMessageMarkup(text, "user");
    saveMessage(currentSessionId, "user", text);
    userInput.value = '';

    const aiBubble = appendMessageMarkup("", "ai");

    try {
        let completeAiResponse = "";
        for await (const chunk of chat.sendMessageStreaming(systemInstruction)) {
            completeAiResponse += chunk.content[0].text;
            
            // If we start seeing a search command, stop rendering it to the UI!
            if (completeAiResponse.includes("[SEARCH:")) {
                aiBubble.innerHTML = `<em>🔍 Searching the web...</em>`;
            } else {
                aiBubble.innerHTML = DOMPurify.sanitize(marked.parse(completeAiResponse));
            }
            chatBox.scrollTop = chatBox.scrollHeight;
        }

        // ==========================================
        // AGENTIC TOOL CALLING LOOP
        // ==========================================
        const searchRegex = /\[SEARCH:\s*"(.*?)"\]/;
        const match = completeAiResponse.match(searchRegex);

        if (match) {
            const query = match[1];
            aiBubble.innerHTML = `<em>🔍 Fetching live data for: "${query}"...</em>`;

            try {
              // 1. Fetch from a SearXNG instance (assuming it's running locally on port 8080)
              // Note: If using a public instance, replace the localhost URL.
              const response = await fetch(
                `https://searxng.val.run/?q=${encodeURIComponent(
                  query
                )}&format=json`
              );

              if (!response.ok)
                throw new Error(`HTTP error! status: ${response.status}`);
              const data = await response.json();

              // 2. Extract the best snippets from the top 3 web results
              let contextData = "";
              if (data.results && data.results.length > 0) {
                // Grab the top 3 results to give the AI good context
                const topResults = data.results.slice(0, 3);
                contextData = topResults
                  .map(
                    (r, i) =>
                      `[Result ${i + 1}] ${r.title}: ${r.content || r.snippet}`
                  )
                  .join("\n");
              } else {
                contextData = "No web search results found.";
              }

              // 3. Re-prompt the AI silently with the new web data
              const followUpPrompt = `Web search results for "${query}":\n${contextData}\n\nPlease answer the user's original question using this information.`;

              let finalAnswer = "";
              aiBubble.innerHTML = ""; // Clear the searching indicator

              for await (const chunk of chat.sendMessageStreaming(
                followUpPrompt
              )) {
                finalAnswer += chunk.content[0].text;
                aiBubble.innerHTML = DOMPurify.sanitize(
                  marked.parse(finalAnswer)
                );
                chatBox.scrollTop = chatBox.scrollHeight;
              }

              saveMessage(currentSessionId, "ai", finalAnswer);
            } catch (fetchError) {
              aiBubble.innerHTML = `⚠️ Could not fetch data from SearXNG: ${fetchError.message}`;
            }
        } else {
            // Normal conversation save (No search triggered)
            saveMessage(currentSessionId, "ai", completeAiResponse);
        }

    } catch (error) {
        aiBubble.innerHTML += `<br><span class="text-danger">[Generation Error: ${error.message}]</span>`;
    }
}

// Global scope access hooks for inline window layout interactions
window.startNewChat = () => {
    currentSessionId = null;
    chatBox.innerHTML = '';
    initMessage.style.display = 'block';
    renderSidebarSessions();
};

sendBtn.addEventListener('click', handleSend);
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
    }
});