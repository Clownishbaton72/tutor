/* BoardTutor – phase 1: layout, whiteboard, settings, local storage, backup.
   Phase 2 plugs an AI into window.BoardTutor.say() and window.BoardTutor.draw(). */

(function () {
  "use strict";

  // ---------- Settings (localStorage) ----------
  const SETTINGS_KEY = "boardtutor.settings.v1";
  const DEFAULTS = {
    subject: "Math", grade: "Grade 10-12", difficulty: "Medium",
    style: "visual", personality: "friendly",
    model: "gemini-3.8-flash", voice: true, rate: "1",
  };
  const FIELDS = {
    subject: "set-subject", grade: "set-grade", difficulty: "set-difficulty",
    style: "set-style", personality: "set-personality", model: "set-model",
  };

  function loadSettings() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
    catch (e) { return { ...DEFAULTS }; }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
  }
  const settings = loadSettings();
  if (settings.model === "gemini-2.5-flash") { settings.model = DEFAULTS.model; saveSettings(settings); } // migrate old default
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
  // ---------- Voice (speech out + speech in) ----------
  const synth = window.speechSynthesis;
  let interacted = false; // browsers only allow speech after a user gesture
  ["pointerdown", "keydown"].forEach((ev) =>
    window.addEventListener(ev, () => { interacted = true; }, { once: true }));

  const voiceEl = document.getElementById("set-voice");
  voiceEl.checked = !!settings.voice;
  voiceEl.addEventListener("change", () => {
    settings.voice = voiceEl.checked; saveSettings(settings);
    if (!voiceEl.checked && synth) synth.cancel();
  });
  const rateEl = document.getElementById("set-rate");
  rateEl.value = settings.rate;
  rateEl.addEventListener("input", () => { settings.rate = rateEl.value; saveSettings(settings); });

  function pickVoice() {
    if (!synth) return null;
    const lang = (navigator.language || "en-US").toLowerCase().slice(0, 2);
    const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
    return voices.find((v) => /natural|google|premium|enhanced/i.test(v.name)) || voices[0] || null;
  }
  function speak(text) {
    if (!settings.voice || !synth || !interacted) return;
    const clean = String(text).replace(/[*_`#]/g, "");
    if (!clean.trim()) return;
    const u = new SpeechSynthesisUtterance(clean);
    let rate = Number(settings.rate) || 1;
    if (settings.personality === "patient") rate *= 0.92;
    if (settings.personality === "energetic") { rate *= 1.08; u.pitch = 1.15; }
    u.rate = rate;
    const v = pickVoice(); if (v) u.voice = v;
    synth.speak(u);
  }

  // ---------- Tutor panel ----------
  const log = document.getElementById("tutor-log");
  function say(text, who, opts) {
    const d = document.createElement("div");
    d.className = "msg " + (who || "tutor");
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    if ((who || "tutor") === "tutor" && !(opts && opts.silent)) speak(text);
  }
  let typingEl = null;
  function setTyping(on) {
    if (on) {
      typingEl = document.createElement("div");
      typingEl.className = "msg tutor"; typingEl.textContent = "…";
      log.appendChild(typingEl); log.scrollTop = log.scrollHeight;
    } else if (typingEl) { typingEl.remove(); typingEl = null; }
  }
  say("Hi! Pick a subject, tell me what you want to learn, and I'll teach it on the board. Or try the demo lesson.", "tutor", { silent: true });

  document.getElementById("tutor-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("tutor-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    ask(text);
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

  // ---------- AI tutor (Gemini) ----------
  const KEY_STORE = "boardtutor.key.v1";
  const keyInput = document.getElementById("set-key");
  // Paste your restricted Gemini key between the quotes below (see setup steps).
  const BUILT_IN_KEY = "AIzaSyA3REzsAtHAD3C7fRkknlZyYpeXkkim75o";
  function getStoredKey() { try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; } }
  function getKey() { return getStoredKey() || BUILT_IN_KEY; }
  keyInput.value = getStoredKey();
  keyInput.addEventListener("change", () => {
    try { localStorage.setItem(KEY_STORE, keyInput.value.trim()); } catch (e) {}
  });

  let history = []; // [{ role: "user" | "model", text }]
  let busy = false;

  function persistHistory() {
    history = history.slice(-30);
    idbPut("progress", { id: "history", items: history, updated: Date.now() }).catch(() => {});
  }
  idbGet("progress", "history").then((h) => {
    if (!h || !h.items) return;
    history = h.items;
    history.forEach((m) => {
      if (m.role === "user") say(m.text, "me", { silent: true });
      else {
        try {
          const o = JSON.parse(m.text);
          if (o.say) say(o.say, "tutor", { silent: true });
          if (o.question) say(o.question, "tutor", { silent: true });
        } catch (e) {}
      }
    });
  }).catch(() => {});

  function systemPrompt() {
    const s = settings;
    const personas = {
      friendly: "a warm, encouraging coach",
      patient: "calm, patient and reassuring",
      socratic: "Socratic: guide mostly with questions instead of telling",
      energetic: "upbeat and energetic",
    };
    const styles = {
      visual: "Lean heavily on diagrams, colour and drawings, with very few words.",
      step: "Break everything into small numbered steps, one idea per turn.",
      concise: "Be brief: short explanations and few steps.",
    };
    return `You are a tutor teaching at a whiteboard. Subject: ${s.subject}. Student level: ${s.grade}. Difficulty: ${s.difficulty}. Personality: ${personas[s.personality]}. Teaching style: ${styles[s.style]}

TEACHING RULES
- Teach, do not just hand over answers. Cover one small idea per turn, then check understanding.
- Always use the board: draw diagrams, worked steps, labelled examples.
- When the student answers a question, say whether it is right, explain why, and if wrong give a hint before the full solution.
- If the student sends a picture of the board, look at what they drew or wrote and respond to it.
- Keep spoken text short (1-3 sentences), plain text, no markdown, no LaTeX. Write maths like 3/4, x^2, sqrt(9).
- Reply in the language the student uses.

OUTPUT: reply with JSON only, in exactly this shape:
{"say": "what you say out loud", "clear": false, "board": [ ...items... ], "question": "a short check question, or null"}

"clear": true wipes the board first (use when starting a new topic).
Board coordinates: each turn you draw in a fresh area 900 wide x 500 tall, origin (0,0) top-left, y goes down. It is placed below earlier work automatically. Keep items inside that area and avoid overlaps.
Item types:
{"type":"text","x":0,"y":0,"text":"short text, use \\n for lines","size":24,"color":"#1971c2"}
{"type":"rectangle"|"ellipse"|"diamond","x":0,"y":0,"w":160,"h":80,"color":"#1e1e1e","fill":"#a5d8ff"}   (fill optional)
{"type":"arrow"|"line","x":0,"y":0,"w":120,"h":0,"color":"#1e1e1e"}   (w,h are the end point offset from x,y and may be negative)
Draw items in the order you want them to appear. Put a text label near each shape (shape text is separate).`;
  }

  async function boardImage() {
    try {
      const els = api.getSceneElements().filter((e) => !e.isDeleted);
      if (!els.length) return null;
      const blob = await ExcalidrawLib.exportToBlob({
        elements: els,
        appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
        files: api.getFiles(),
        mimeType: "image/png",
        getDimensions: (w, h) => {
          const sc = Math.min(1, 1024 / Math.max(w, h));
          return { width: w * sc, height: h * sc, scale: sc };
        },
      });
      return await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(",")[1]);
        fr.readAsDataURL(blob);
      });
    } catch (e) { return null; }
  }

  async function callGemini() {
    const key = getKey();
    if (!key) throw new Error("NOKEY");
    const contents = history.slice(-20).map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
    const img = await boardImage();
    if (img) contents[contents.length - 1].parts.push({ inline_data: { mime_type: "image/png", data: img } });

    const model = encodeURIComponent(settings.model || "gemini-3.8-flash");
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt() }] },
        contents,
        generationConfig: { responseMimeType: "application/json", temperature: 0.7 },
      }),
    });
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json()).error.message; } catch (e) {}
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    const data = await res.json();
    const text = ((data.candidates || [])[0]?.content?.parts || []).map((p) => p.text || "").join("");
    if (!text) throw new Error("Empty reply from the model");
    try {
      return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch (e) {
      return { say: text, board: [], question: null };
    }
  }

  function toSkeleton(it, ox, oy) {
    const x = ox + (+it.x || 0), y = oy + (+it.y || 0), color = it.color || "#1e1e1e";
    switch (it.type) {
      case "text":
        return { type: "text", x, y, text: String(it.text || ""), fontSize: +it.size || 22, strokeColor: color };
      case "rectangle": case "ellipse": case "diamond":
        return {
          type: it.type, x, y, width: +it.w || 100, height: +it.h || 60, strokeColor: color,
          ...(it.fill ? { backgroundColor: it.fill, fillStyle: "solid" } : {}),
        };
      case "arrow": case "line":
        if (!(+it.w) && !(+it.h)) return null;
        return { type: it.type, x, y, width: +it.w || 0, height: +it.h || 0, strokeColor: color };
    }
    return null;
  }

  async function drawBlock(items, clear) {
    if (!api) return;
    if (clear) api.resetScene();
    const live = api.getSceneElements().filter((e) => !e.isDeleted);
    const oy = live.length ? Math.max(...live.map((e) => e.y + (e.height || 0))) + 60 : 40;
    const added = [];
    for (const it of items || []) {
      const sk = toSkeleton(it, 40, oy);
      if (!sk) continue;
      const els = ExcalidrawLib.convertToExcalidrawElements([sk]);
      added.push(...els);
      api.updateScene({ elements: [...api.getSceneElements(), ...els] });
      await sleep(350);
    }
    if (added.length) api.scrollToContent(added, { fitToViewport: true, viewportZoomFactor: 0.8, animate: true });
  }

  async function present(out) {
    if (out.say) say(out.say);
    await drawBlock(out.board, !!out.clear);
    if (out.question) say(out.question);
  }

  function friendlyError(e) {
    const m = String((e && e.message) || e);
    if (m === "NOKEY") return "Paste your free Gemini API key in the sidebar first (aistudio.google.com/apikey).";
    if (/429|quota|rate/i.test(m)) return "Rate limit reached. Wait a minute and try again.";
    return "Gemini error: " + m;
  }

  async function ask(text) {
    if (busy) return;
    busy = true;
    if (synth) synth.cancel();
    say(text, "me");
    history.push({ role: "user", text });
    setTyping(true);
    try {
      const out = await callGemini();
      history.push({ role: "model", text: JSON.stringify(out) });
      setTyping(false);
      await present(out);
    } catch (err) {
      history.pop();
      setTyping(false);
      say(friendlyError(err), "tutor", { silent: true });
    } finally {
      persistHistory();
      busy = false;
    }
  }

  // ---------- Microphone ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = document.getElementById("btn-mic");
  if (!SR) {
    mic.style.display = "none";
  } else {
    let rec = null, listening = false;
    mic.addEventListener("click", () => {
      if (listening) { rec.stop(); return; }
      if (synth) synth.cancel();
      rec = new SR();
      rec.lang = navigator.language || "en-US";
      rec.interimResults = true;
      rec.onstart = () => { listening = true; mic.classList.add("rec"); };
      rec.onend = () => { listening = false; mic.classList.remove("rec"); };
      rec.onerror = (ev) => {
        if (ev.error === "not-allowed") say("Microphone access was blocked in your browser.", "tutor", { silent: true });
      };
      rec.onresult = (ev) => {
        const input = document.getElementById("tutor-input");
        let t = "", fin = false;
        for (const r of ev.results) { t += r[0].transcript; if (r.isFinal) fin = true; }
        input.value = t;
        if (fin) { input.value = ""; if (t.trim()) ask(t.trim()); }
      };
      rec.start();
    });
  }

  document.getElementById("btn-new").addEventListener("click", () => {
    if (!confirm("Start a new lesson? This clears the board and the conversation.")) return;
    if (synth) synth.cancel();
    history = []; persistHistory();
    log.innerHTML = "";
    if (api) api.resetScene();
    say("New lesson! What would you like to learn?", "tutor", { silent: true });
  });

  // Hooks for other code.
  window.BoardTutor = { say, draw, ask, getSettings: () => ({ ...settings }), idbGet, idbPut };

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
