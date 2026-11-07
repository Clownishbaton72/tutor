/* BoardTutor – phase 1: layout, whiteboard, settings, local storage, backup.
   Phase 2 plugs an AI into window.BoardTutor.say() and window.BoardTutor.draw(). */

(function () {
  "use strict";

  // ---------- Settings (localStorage) ----------
  const SETTINGS_KEY = "boardtutor.settings.v1";
  const DEFAULTS = {
    subject: "Math", grade: "Grade 10-12", difficulty: "Medium",
    style: "visual", personality: "friendly",
  };
  const FIELDS = {
    subject: "set-subject", grade: "set-grade", difficulty: "set-difficulty",
    style: "set-style", personality: "set-personality",
  };

  function loadSettings() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
    catch (e) { return { ...DEFAULTS }; }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
  }
  const settings = loadSettings();
  Object.entries(FIELDS).forEach(([key, id]) => {
    const el = document.getElementById(id);
    el.value = settings[key];
    el.addEventListener("change", () => { settings[key] = el.value; saveSettings(settings); });
  });

  // ---------- IndexedDB (whiteboard sessions + progress) ----------
  const DB_NAME = "boardtutor", DB_VERSION = 1;
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
        if (!db.objectStoreNames.contains("progress")) db.createObjectStore("progress", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(store, id) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const r = db.transaction(store).objectStore(store).get(id);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function idbPut(store, value) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value);
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  }
  async function idbAll(store) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const r = db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }

  // ---------- Tutor panel ----------
  const log = document.getElementById("tutor-log");
  function say(text, who) {
    const d = document.createElement("div");
    d.className = "msg " + (who || "tutor");
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }
  say("Hi! I'm your board tutor. Try the demo lesson to see how I'll teach on the board.");

  document.getElementById("tutor-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("tutor-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    say(text, "me");
    // Phase 2: replace with AI call.
    say("The AI tutor isn't connected yet – that's the next step.");
  });

  // ---------- Whiteboard ----------
  let api = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Draw skeleton elements onto the board (what the AI will call in phase 2).
  function draw(skeletons) {
    if (!api) return;
    const els = ExcalidrawLib.convertToExcalidrawElements(skeletons);
    api.updateScene({ elements: [...api.getSceneElements(), ...els] });
    api.scrollToContent(els, { fitToViewport: false, animate: true });
  }

  async function demoLesson() {
    if (!api) return;
    const y0 = 40 + Math.max(0, ...api.getSceneElements().filter(e => !e.isDeleted).map(e => e.y + (e.height || 0)));
    say("Let's add 1/2 + 1/4 together. Watch the board.");
    draw([{ type: "text", x: 60, y: y0, text: "Adding fractions: 1/2 + 1/4", fontSize: 32 }]);
    await sleep(1200);

    say("Step 1: draw one whole, split in 4 equal parts.");
    draw([
      { type: "rectangle", x: 60, y: y0 + 70, width: 320, height: 80 },
      { type: "line", x: 140, y: y0 + 70, width: 0, height: 80 },
      { type: "line", x: 220, y: y0 + 70, width: 0, height: 80 },
      { type: "line", x: 300, y: y0 + 70, width: 0, height: 80 },
    ]);
    await sleep(1400);

    say("Step 2: 1/2 covers two of the four parts.");
    draw([
      { type: "rectangle", x: 60, y: y0 + 70, width: 160, height: 80,
        backgroundColor: "#a5d8ff", fillStyle: "solid", strokeColor: "#1971c2" },
      { type: "text", x: 60, y: y0 + 160, text: "1/2 = 2/4", fontSize: 24, strokeColor: "#1971c2" },
    ]);
    await sleep(1400);

    say("Step 3: 1/4 is one more part.");
    draw([
      { type: "rectangle", x: 220, y: y0 + 70, width: 80, height: 80,
        backgroundColor: "#b2f2bb", fillStyle: "solid", strokeColor: "#2f9e44" },
      { type: "text", x: 220, y: y0 + 160, text: "+ 1/4", fontSize: 24, strokeColor: "#2f9e44" },
    ]);
    await sleep(1400);

    draw([{ type: "text", x: 60, y: y0 + 210, text: "2/4 + 1/4 = 3/4", fontSize: 30, strokeColor: "#e03131" }]);
    await sleep(900);
    say("Your turn: what is 1/2 + 1/8? Draw it on the board and tell me your answer.");
  }

  // Expose hooks for phase 2.
  window.BoardTutor = { say, draw, getSettings: () => ({ ...settings }), idbGet, idbPut };

  // ---------- Mount Excalidraw ----------
  async function mount() {
    const saved = await idbGet("sessions", "current").catch(() => null);
    const e = React.createElement;
    let timer = null;

    function App() {
      return e(ExcalidrawLib.Excalidraw, {
        excalidrawAPI: (a) => { api = a; },
        initialData: saved
          ? { elements: saved.elements, files: saved.files, scrollToContent: true }
          : undefined,
        onChange: (elements, appState, files) => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            idbPut("sessions", { id: "current", elements, files, updated: Date.now() }).catch(() => {});
          }, 800);
        },
        UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false } },
      });
    }
    ReactDOM.createRoot(document.getElementById("board")).render(e(App));
    document.getElementById("board-loading").remove();
  }
  mount().catch((err) => {
    document.getElementById("board-loading").textContent = "Couldn't load the whiteboard: " + err.message;
  });

  // ---------- Buttons ----------
  document.getElementById("btn-demo").addEventListener("click", demoLesson);
  document.getElementById("btn-clear").addEventListener("click", () => {
    if (api && confirm("Clear the whole board?")) api.resetScene();
  });
  document.getElementById("btn-toggle-settings").addEventListener("click", () => {
    document.getElementById("settings").classList.toggle("open");
  });

  // ---------- Export / import ----------
  document.getElementById("btn-export").addEventListener("click", async () => {
    const backup = {
      app: "boardtutor", version: 1, exportedAt: new Date().toISOString(),
      settings,
      sessions: await idbAll("sessions"),
      progress: await idbAll("progress"),
    };
    const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "boardtutor-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const fileInput = document.getElementById("file-import");
  document.getElementById("btn-import").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== "boardtutor") throw new Error("Not a BoardTutor backup");
      if (!confirm("Importing replaces your current settings and board. Continue?")) return;
      saveSettings({ ...DEFAULTS, ...data.settings });
      for (const s of data.sessions || []) await idbPut("sessions", s);
      for (const p of data.progress || []) await idbPut("progress", p);
      location.reload();
    } catch (err) {
      alert("Import failed: " + err.message);
    }
  });
})();
