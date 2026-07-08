# ✨ AuraChat - Local Agentic AI

AuraChat is a 100% local, private, browser-based AI chat application powered by WebAssembly and LiteRT. It runs entirely on the client side, ensuring that your data and prompts never leave your device, while maintaining the ability to fetch real-time data from the web using an agentic proxy architecture.

## 🚀 Features

* **True Local Inference:** Runs the Gemma 4 E2B LiteRT model directly in your browser using WebAssembly.
* **Instant Loading (OPFS):** Caches the massive AI model inside the browser's Origin Private File System for instant initialization on subsequent visits.
* **Agentic Web Search:** Intelligently detects requests for real-time data (weather, news, stock prices) and queries the live web via a Val.town proxy, seamlessly integrating the results into the local context.
* **Persistent Chat History:** Utilizes IndexedDB to automatically save and manage your last 20 conversation sessions.
* **Progressive Web App (PWA):** Fully installable on Desktop and Mobile. Works offline and behaves like a native application.
* **Markdown & Syntax Highlighting:** Securely parses AI outputs into rich HTML using `marked.js` and `DOMPurify`, complete with dark-themed code blocks.

## 🛠️ Tech Stack

* **Frontend Engine:** HTML5, CSS3, JavaScript (ES Modules)
* **UI Framework:** Bootstrap 5, Bootstrap Icons
* **AI Runtime:** `@litert-lm/core` (WebAssembly)
* **Local Storage:** OPFS (Model Storage), IndexedDB (Chat History), Service Workers (PWA Cache)
* **Security:** DOMPurify
* **CI/CD:** GitHub Actions (Automated minification and deployment)
* **Web Proxy (Agent):** Val.town serverless backend

## 📖 Getting Started

Because AuraChat is a purely client-side application, you don't need to install any heavy node modules or backend servers to run it locally.

### 1. Serve Locally
Clone the repository and serve it using any simple local web server (like VS Code's Live Server extension, or Python's `http.server`).
```bash
git clone [https://github.com/monu-shaw/aurachat.git](https://github.com/monu-shaw/aurachat.git)
cd aurachat
python -m http.server 8000
