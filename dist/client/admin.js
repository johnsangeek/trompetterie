"use strict";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const PX_PER_SEC = 90;
const PX_PER_SEMI = 16;
const MIDI_MIN = 48; // C3
const MIDI_MAX = 96; // C7
const RULER_HEIGHT = 34;
const WAVEFORM_HEIGHT = 56;
const TOP_OFFSET = RULER_HEIGHT + WAVEFORM_HEIGHT;
const MIN_NOTE_DURATION = 0.05;
const DEFAULT_NOTE_DURATION = 0.35;

const NOTE_NAMES = ["Do", "Do#", "Ré", "Ré#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];
function midiName(midi) {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}
function isBlackKey(midi) {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}
function clampMidi(m) { return Math.max(MIDI_MIN, Math.min(MIDI_MAX, m)); }

function midiToTop(midi) { return (MIDI_MAX - midi) * PX_PER_SEMI; }
function topToMidi(top) { return clampMidi(Math.round(MIDI_MAX - top / PX_PER_SEMI)); }
function timeToX(t) { return t * PX_PER_SEC; }
function xToTime(x) { return Math.max(0, x / PX_PER_SEC); }

function formatTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Gate — this page is an internal authoring tool, not linked from the app.
// Auto-opens on localhost; anywhere else it needs one explicit click through,
// as a "you clearly meant to be here" speed bump rather than real auth.
// ---------------------------------------------------------------------------

const gateEl = document.getElementById("gate");
const appEl = document.getElementById("app");
const isLocalHost = ["localhost", "127.0.0.1"].includes(location.hostname);
if (isLocalHost) {
  gateEl.hidden = true;
  appEl.hidden = false;
}
document.getElementById("gateEnterBtn").addEventListener("click", () => {
  gateEl.hidden = true;
  appEl.hidden = false;
});

// ---------------------------------------------------------------------------
// Element refs
// ---------------------------------------------------------------------------

const el = {
  trackNameInput: document.getElementById("trackNameInput"),
  trackIdInput: document.getElementById("trackIdInput"),
  pickAudioBtn: document.getElementById("pickAudioBtn"),
  audioFileInput: document.getElementById("audioFileInput"),
  pickMidiBtn: document.getElementById("pickMidiBtn"),
  midiFileInput: document.getElementById("midiFileInput"),
  importJsonBtn: document.getElementById("importJsonBtn"),
  jsonFileInput: document.getElementById("jsonFileInput"),
  playPauseBtn: document.getElementById("playPauseBtn"),
  currentTimeLabel: document.getElementById("currentTimeLabel"),
  durationLabel: document.getElementById("durationLabel"),
  bpmInput: document.getElementById("bpmInput"),
  cleanShortBtn: document.getElementById("cleanShortBtn"),
  exportBtn: document.getElementById("exportBtn"),
  statusLine: document.getElementById("statusLine"),
  rollScroll: document.getElementById("rollScroll"),
  rollInner: document.getElementById("rollInner"),
  rollRuler: document.getElementById("rollRuler"),
  rollWaveform: document.getElementById("rollWaveform"),
  rollGrid: document.getElementById("rollGrid"),
  rollNotes: document.getElementById("rollNotes"),
  playhead: document.getElementById("playhead"),
};

function setStatus(text) { el.statusLine.textContent = text || ""; }

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  audioCtx: null,
  audioBuffer: null,
  sourceNode: null,
  isPlaying: false,
  startContextTime: 0,
  startOffset: 0,
  duration: 40, // sensible default before any audio is loaded
  bpm: 120,
  rafHandle: null,
  // Once notes came from a MIDI import or a JSON re-import, a later lone
  // audio drop is treated as "sync a reference track" (waveform + playback
  // only) rather than "start a fresh auto-transcription" - it would
  // otherwise silently wipe out a hand-corrected note set.
  protectNotes: false,
  // Preserve the catalogue accompaniment when a multi-track JSON is opened,
  // while the piano roll edits only the pedagogical trumpet line.
  catalogStems: [],
};

let notes = []; // {time, midi, duration}
let selectedNote = null;
const noteEls = new Map(); // note object -> DOM element

// ---------------------------------------------------------------------------
// Pitch/BPM detection — ported from the main app's app.js so this page has
// no dependency on index.html's DOM structure.
// ---------------------------------------------------------------------------

function detectBPM(channelData, sampleRate) {
  const hop = Math.round(sampleRate * 0.0464);
  const frameCount = Math.floor(channelData.length / hop);
  if (frameCount < 8) return 120;

  const energy = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    const start = i * hop;
    for (let j = 0; j < hop; j++) {
      const v = channelData[start + j] || 0;
      sum += v * v;
    }
    energy[i] = Math.sqrt(sum / hop);
  }

  const onset = new Float32Array(frameCount);
  for (let i = 1; i < frameCount; i++) {
    const diff = energy[i] - energy[i - 1];
    onset[i] = diff > 0 ? diff : 0;
  }

  const hopTime = hop / sampleRate;
  const minLag = Math.max(1, Math.round(60 / 220 / hopTime));
  const maxLag = Math.min(frameCount - 1, Math.round(60 / 40 / hopTime));

  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = 0; i + lag < frameCount; i++) score += onset[i] * onset[i + lag];
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }

  let bpm = 60 / (bestLag * hopTime);
  while (bpm < 70) bpm *= 2;
  while (bpm > 200) bpm /= 2;
  return Math.round(bpm * 10) / 10;
}

function decimate(channelData, sourceRate, targetRate) {
  const ratio = Math.floor(sourceRate / targetRate);
  if (ratio <= 1) return { data: channelData, sampleRate: sourceRate };
  const outLength = Math.floor(channelData.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    let sum = 0;
    const start = i * ratio;
    for (let j = 0; j < ratio; j++) sum += channelData[start + j];
    out[i] = sum / ratio;
  }
  return { data: out, sampleRate: sourceRate / ratio };
}

function autoCorrelate(buffer, sampleRate) {
  const SIZE = buffer.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;

  let r1 = 0;
  let r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) { if (Math.abs(buffer[i]) < thres) { r1 = i; break; } }
  for (let i = 1; i < SIZE / 2; i++) { if (Math.abs(buffer[SIZE - i]) < thres) { r2 = SIZE - i; break; } }
  const trimmed = buffer.slice(r1, r2);
  const newSize = trimmed.length;
  if (newSize < 8) return -1;

  const c = new Float32Array(newSize);
  for (let i = 0; i < newSize; i++) {
    let sum = 0;
    for (let j = 0; j < newSize - i; j++) sum += trimmed[j] * trimmed[j + i];
    c[i] = sum;
  }

  let d = 0;
  while (d < newSize - 1 && c[d] > c[d + 1]) d++;

  let maxval = -1;
  let maxpos = -1;
  for (let i = d; i < newSize; i++) { if (c[i] > maxval) { maxval = c[i]; maxpos = i; } }
  if (maxpos <= 0 || maxpos >= newSize - 1) return -1;

  const x1 = c[maxpos - 1];
  const x2 = c[maxpos];
  const x3 = c[maxpos + 1];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  let T0 = maxpos;
  if (a !== 0) T0 = maxpos - b / (2 * a);
  if (T0 <= 0) return -1;
  return sampleRate / T0;
}

function extractPitchFrames(channelData, sampleRate, onProgress) {
  const windowSize = 1024;
  const hop = 512;
  const totalFrames = Math.max(0, Math.floor((channelData.length - windowSize) / hop));
  const frames = [];

  return new Promise((resolve) => {
    let i = 0;
    function processChunk() {
      const chunkEnd = Math.min(i + 300, totalFrames);
      for (; i < chunkEnd; i++) {
        const start = i * hop;
        const frame = channelData.subarray(start, start + windowSize);
        const freq = autoCorrelate(frame, sampleRate);
        const time = start / sampleRate;
        if (freq > 140 && freq < 1400) {
          const midi = Math.round(69 + 12 * Math.log2(freq / 440));
          frames.push({ time, midi });
        } else {
          frames.push({ time, midi: null });
        }
      }
      onProgress(totalFrames ? i / totalFrames : 1);
      if (i < totalFrames) setTimeout(processChunk, 0);
      else resolve(frames);
    }
    processChunk();
  });
}

function segmentPitchFrames(frames) {
  const hopTime = frames.length >= 2 ? frames[1].time - frames[0].time : 512 / 11025;
  const segments = [];
  let cur = null;
  for (const f of frames) {
    if (cur && f.midi === cur.midi) {
      cur.endTime = f.time + hopTime;
    } else {
      if (cur) segments.push(cur);
      cur = { startTime: f.time, endTime: f.time + hopTime, midi: f.midi };
    }
  }
  if (cur) segments.push(cur);

  const minDur = 0.06;
  return segments.filter((s) => s.midi !== null && s.endTime - s.startTime >= minDur);
}

// ---------------------------------------------------------------------------
// Audio loading
// ---------------------------------------------------------------------------

async function loadAudioFile(file, { autoDetectNotes = true } = {}) {
  stopPlayback();
  setStatus("Chargement…");
  if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await state.audioCtx.decodeAudioData(arrayBuffer);
  state.audioBuffer = audioBuffer;
  state.duration = Math.max(audioBuffer.duration, state.duration || 0);
  el.durationLabel.textContent = formatTime(state.duration);
  el.playPauseBtn.disabled = false;
  el.exportBtn.disabled = false;
  if (!el.trackNameInput.value) el.trackNameInput.value = file.name.replace(/\.[^.]+$/, "");
  if (!el.trackIdInput.value) el.trackIdInput.value = slugify(el.trackNameInput.value);

  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;

  if (!autoDetectNotes) {
    // A companion MIDI file already supplied the notes and (usually) the
    // tempo - just show the waveform and let it play alongside.
    layoutRoll();
    renderNotes();
    setStatus(`Audio "${file.name}" chargé — aligné sur les notes du MIDI.`);
    return;
  }

  setStatus("Analyse du tempo…");
  const bpm = detectBPM(channelData, sampleRate);
  state.bpm = bpm;
  el.bpmInput.value = bpm.toFixed(1);

  setStatus("Analyse des notes…");
  const pitchInput = decimate(channelData, sampleRate, 11025);
  const frames = await extractPitchFrames(pitchInput.data, pitchInput.sampleRate, (frac) => {
    setStatus(`Analyse des notes… ${Math.round(frac * 100)}%`);
  });
  const segments = segmentPitchFrames(frames);
  notes = segments.map((s) => ({ time: s.startTime, midi: s.midi, duration: s.endTime - s.startTime }));
  state.protectNotes = false;
  state.catalogStems = [];

  layoutRoll();
  renderNotes();
  setStatus(`${notes.length} notes détectées automatiquement — corrige à la main ce qui manque.`);
}

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ---------------------------------------------------------------------------
// MIDI import — minimal standard-MIDI-file reader: header + all tracks,
// pairing note-on/note-off per (channel, pitch) to get real durations, with
// a tick->seconds conversion that follows tempo-change meta events.
// ---------------------------------------------------------------------------

function parseMidiFile(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  let pos = 0;
  const readStr = (at, n) => String.fromCharCode(...bytes.subarray(at, at + n));
  const u8 = () => view.getUint8(pos++);
  const u16 = () => { const v = view.getUint16(pos); pos += 2; return v; };
  const u32 = () => { const v = view.getUint32(pos); pos += 4; return v; };
  const readVarLen = () => {
    let value = 0, byte;
    do {
      if (pos >= view.byteLength) throw new Error("Fichier MIDI incomplet");
      byte = u8();
      value = (value << 7) | (byte & 127);
    } while (byte & 128);
    return value;
  };

  if (readStr(0, 4) !== "MThd") throw new Error("Ce fichier n'est pas un MIDI standard");
  pos = 4;
  const headerLength = u32();
  if (headerLength < 6) throw new Error("En-tête MIDI invalide");
  u16(); // format, unused
  const trackCount = u16();
  let division = u16();
  if (division & 0x8000) division = 480; // SMPTE timecode division not supported - fall back
  pos = 8 + headerLength;

  const tempoEvents = [{ tick: 0, usPerQuarter: 500000 }]; // default 120bpm until told otherwise
  const rawNoteEvents = []; // {tick, type:'on'|'off', note, channel}

  for (let t = 0; t < trackCount && pos + 8 <= view.byteLength; t++) {
    if (readStr(pos, 4) !== "MTrk") break;
    pos += 4;
    const length = u32();
    const end = Math.min(view.byteLength, pos + length);
    let tick = 0;
    let running = 0;
    while (pos < end) {
      tick += readVarLen();
      let status = u8();
      let first = null;
      if (status < 0x80) {
        if (!running) throw new Error("Évènement MIDI invalide");
        first = status;
        status = running;
      } else if (status < 0xf0) {
        running = status;
      }
      if (status === 0xff) {
        const type = u8();
        const size = readVarLen();
        if (type === 0x51 && size === 3) {
          const usPerQuarter = (u8() << 16) | (u8() << 8) | u8();
          tempoEvents.push({ tick, usPerQuarter });
        } else {
          pos += size;
        }
        continue;
      }
      if (status === 0xf0 || status === 0xf7) { pos += readVarLen(); continue; }

      const high = status & 0xf0;
      const channel = status & 0x0f;
      const isShort = high === 0xc0 || high === 0xd0; // program change / channel pressure: 1 data byte
      const d1 = first !== null ? first : u8();
      const d2 = isShort ? 0 : u8();

      if (channel === 9) continue; // drum channel, not a melody
      if (high === 0x90 && d2 > 0) rawNoteEvents.push({ tick, type: "on", note: d1, channel });
      else if (high === 0x90 || high === 0x80) rawNoteEvents.push({ tick, type: "off", note: d1, channel });
    }
    pos = end;
  }

  tempoEvents.sort((a, b) => a.tick - b.tick);
  // Collapse same-tick entries to the last one - the default 120bpm placeholder
  // at tick 0 must not win over a real tempo meta event also declared at tick 0.
  const effectiveTempoEvents = [];
  for (const te of tempoEvents) {
    if (effectiveTempoEvents.length && effectiveTempoEvents[effectiveTempoEvents.length - 1].tick === te.tick) {
      effectiveTempoEvents[effectiveTempoEvents.length - 1] = te;
    } else {
      effectiveTempoEvents.push(te);
    }
  }
  const marks = [];
  let cumSeconds = 0;
  for (let i = 0; i < effectiveTempoEvents.length; i++) {
    marks.push({ tick: effectiveTempoEvents[i].tick, seconds: cumSeconds, usPerQuarter: effectiveTempoEvents[i].usPerQuarter });
    const nextTick = effectiveTempoEvents[i + 1] ? effectiveTempoEvents[i + 1].tick : null;
    if (nextTick !== null) cumSeconds += ((nextTick - effectiveTempoEvents[i].tick) * effectiveTempoEvents[i].usPerQuarter) / (division * 1e6);
  }
  function tickToSeconds(tick) {
    let mark = marks[0];
    for (const m of marks) { if (m.tick <= tick) mark = m; else break; }
    return mark.seconds + ((tick - mark.tick) * mark.usPerQuarter) / (division * 1e6);
  }

  rawNoteEvents.sort((a, b) => a.tick - b.tick);
  const active = new Map(); // "channel-note" -> startTick
  const parsedNotes = [];
  for (const ev of rawNoteEvents) {
    const key = `${ev.channel}-${ev.note}`;
    if (ev.type === "on") {
      if (active.has(key)) closeNote(key, ev.tick); // retrigger without an off - close the previous one here
      active.set(key, ev.tick);
    } else if (active.has(key)) {
      closeNote(key, ev.tick);
    }
  }
  function closeNote(key, endTick) {
    const startTick = active.get(key);
    active.delete(key);
    const note = Number(key.split("-")[1]);
    const startTime = tickToSeconds(startTick);
    const duration = Math.max(MIN_NOTE_DURATION, tickToSeconds(endTick) - startTime);
    parsedNotes.push({ time: startTime, midi: note, duration });
  }

  if (!parsedNotes.length) throw new Error("Aucune note exploitable dans ce fichier MIDI");
  parsedNotes.sort((a, b) => a.time - b.time);

  // BPM from the first tempo event, if the file declared one explicitly.
  const bpm = effectiveTempoEvents[0].usPerQuarter !== 500000 || effectiveTempoEvents.length > 1
    ? Math.round((60000000 / effectiveTempoEvents[0].usPerQuarter) * 10) / 10
    : null;

  return { notes: parsedNotes, bpm };
}

async function loadMidiFile(file) {
  setStatus("Lecture du MIDI…");
  try {
    const parsed = parseMidiFile(await file.arrayBuffer());
    notes = parsed.notes;
    state.protectNotes = true;
    state.catalogStems = [];
    if (parsed.bpm) { state.bpm = parsed.bpm; el.bpmInput.value = parsed.bpm.toFixed(1); }
    const midiEnd = notes.reduce((max, n) => Math.max(max, n.time + n.duration), 0);
    state.duration = Math.max(state.duration || 0, midiEnd + 1);
    el.durationLabel.textContent = formatTime(state.duration);
    el.exportBtn.disabled = false;
    if (!el.trackNameInput.value) el.trackNameInput.value = file.name.replace(/\.[^.]+$/, "");
    if (!el.trackIdInput.value) el.trackIdInput.value = slugify(el.trackNameInput.value);
    layoutRoll();
    renderNotes();
    setStatus(`${notes.length} notes importées depuis ${file.name}.`);
  } catch (err) {
    setStatus(`Erreur MIDI : ${err.message || err}`);
  }
}

function isMidiFile(file) {
  return /\.(mid|midi)$/i.test(file.name) || file.type === "audio/midi" || file.type === "audio/mid";
}
function isAudioFile(file) {
  return file.type.startsWith("audio/") && !isMidiFile(file);
}

async function handleIncomingFiles(fileList) {
  const files = Array.from(fileList || []);
  const midiFile = files.find(isMidiFile);
  const audioFile = files.find(isAudioFile);
  if (midiFile) await loadMidiFile(midiFile);
  if (audioFile) await loadAudioFile(audioFile, { autoDetectNotes: !midiFile && !state.protectNotes });
  if (!midiFile && !audioFile) setStatus("Fichier non reconnu (attendu : audio ou .mid/.midi).");
}

el.pickAudioBtn.addEventListener("click", () => el.audioFileInput.click());
el.audioFileInput.addEventListener("change", () => {
  handleIncomingFiles(el.audioFileInput.files);
  el.audioFileInput.value = "";
});

el.pickMidiBtn.addEventListener("click", () => el.midiFileInput.click());
el.midiFileInput.addEventListener("change", () => {
  const file = el.midiFileInput.files && el.midiFileInput.files[0];
  el.midiFileInput.value = "";
  if (file) loadMidiFile(file);
});

// Drop an audio file and/or a MIDI file anywhere on the page - both at once
// loads the MIDI as notes and the audio as the reference waveform/playback.
["dragenter", "dragover"].forEach((evt) => {
  window.addEventListener(evt, (e) => {
    e.preventDefault();
    document.querySelector(".toolbar").classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((evt) => {
  window.addEventListener(evt, (e) => {
    e.preventDefault();
    document.querySelector(".toolbar").classList.remove("dragover");
  });
});
window.addEventListener("drop", (e) => {
  handleIncomingFiles(e.dataTransfer.files);
});

// ---------------------------------------------------------------------------
// JSON import/export — same shape as tracks/*.json in the main app.
// ---------------------------------------------------------------------------

el.importJsonBtn.addEventListener("click", () => el.jsonFileInput.click());
el.jsonFileInput.addEventListener("change", async () => {
  const file = el.jsonFileInput.files && el.jsonFileInput.files[0];
  el.jsonFileInput.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const importedLead = Array.isArray(data.stems) ? data.stems.find((stem) => stem.isLead) : null;
    const importedNotes = importedLead?.notes?.length ? importedLead.notes : (data.notes || []);
    notes = importedNotes.map((n) => ({
      time: n.time,
      midi: n.midi,
      duration: n.duration || 0.3,
    }));
    state.protectNotes = true;
    state.catalogStems = Array.isArray(data.stems) ? structuredClone(data.stems) : [];
    if (data.name) el.trackNameInput.value = data.name;
    if (data.id) el.trackIdInput.value = data.id;
    if (data.bpm) { state.bpm = data.bpm; el.bpmInput.value = data.bpm; }
    if (data.duration) { state.duration = data.duration; el.durationLabel.textContent = formatTime(state.duration); }
    layoutRoll();
    renderNotes();
    setStatus(`${notes.length} notes importées depuis ${file.name}. Charge l'audio correspondant pour éditer avec le son.`);
  } catch (err) {
    setStatus(`Erreur d'import : ${err.message || err}`);
  }
});

el.exportBtn.addEventListener("click", () => {
  const id = el.trackIdInput.value.trim() || slugify(el.trackNameInput.value) || "morceau";
  const guideNotes = notes
    .slice()
    .sort((a, b) => a.time - b.time)
    .map((n) => ({ time: Math.round(n.time * 1000) / 1000, midi: n.midi, duration: Math.round(n.duration * 1000) / 1000 }));
  const payload = {
    id,
    name: el.trackNameInput.value.trim() || id,
    bpm: Math.round(state.bpm * 10) / 10,
    duration: Math.round(state.duration * 100) / 100,
    notes: guideNotes.map(({ time, midi }) => ({ time, midi })),
  };
  if (state.catalogStems.length) {
    payload.stems = state.catalogStems.map((stem) => stem.isLead
      ? { ...stem, notes: guideNotes }
      : stem);
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus(`Exporté : ${id}.json (${payload.notes.length} notes).`);
});

el.cleanShortBtn.addEventListener("click", () => {
  const before = notes.length;
  notes = notes.filter((n) => n.duration >= 0.06);
  renderNotes();
  setStatus(`${before - notes.length} note(s) courte(s) retirée(s).`);
});

el.bpmInput.addEventListener("input", () => {
  const v = Number(el.bpmInput.value);
  if (v > 0) { state.bpm = v; layoutRoll(); }
});

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

function currentPlaybackTime() {
  if (!state.isPlaying) return state.startOffset;
  return state.startOffset + (state.audioCtx.currentTime - state.startContextTime);
}

function startPlaybackFrom(offset) {
  if (!state.audioBuffer) return;
  if (state.sourceNode) { try { state.sourceNode.stop(); } catch (_e) {} }
  const source = state.audioCtx.createBufferSource();
  source.buffer = state.audioBuffer;
  source.connect(state.audioCtx.destination);
  source.start(0, Math.max(0, offset));
  source.onended = () => {
    if (state.sourceNode === source) {
      state.isPlaying = false;
      el.playPauseBtn.textContent = "Lecture";
      cancelAnimationFrame(state.rafHandle);
    }
  };
  state.sourceNode = source;
  state.startContextTime = state.audioCtx.currentTime;
  state.startOffset = offset;
  state.isPlaying = true;
  el.playPauseBtn.textContent = "Pause";
  tickPlayhead();
}

function pausePlayback() {
  if (!state.isPlaying) return;
  state.startOffset = currentPlaybackTime();
  if (state.sourceNode) { try { state.sourceNode.stop(); } catch (_e) {} }
  state.sourceNode = null;
  state.isPlaying = false;
  el.playPauseBtn.textContent = "Lecture";
  cancelAnimationFrame(state.rafHandle);
}

function stopPlayback() {
  if (state.sourceNode) { try { state.sourceNode.stop(); } catch (_e) {} }
  state.sourceNode = null;
  state.isPlaying = false;
  state.startOffset = 0;
  el.playPauseBtn.textContent = "Lecture";
  cancelAnimationFrame(state.rafHandle);
}

function seekTo(t) {
  const wasPlaying = state.isPlaying;
  if (wasPlaying) { if (state.sourceNode) { try { state.sourceNode.stop(); } catch (_e) {} } state.sourceNode = null; }
  state.startOffset = Math.max(0, Math.min(state.duration, t));
  if (wasPlaying) startPlaybackFrom(state.startOffset);
  else updatePlayheadUI(state.startOffset);
}

function tickPlayhead() {
  if (!state.isPlaying) return;
  const t = currentPlaybackTime();
  if (t >= state.duration) { stopPlayback(); updatePlayheadUI(state.duration); return; }
  updatePlayheadUI(t);
  state.rafHandle = requestAnimationFrame(tickPlayhead);
}

function updatePlayheadUI(t) {
  el.playhead.style.left = `${timeToX(t)}px`;
  el.currentTimeLabel.textContent = formatTime(t);
  if (state.isPlaying) keepPlayheadInView(t);
}

// Auto-scrolls the piano-roll horizontally during playback so the playhead
// never runs off the visible edge - the view follows the transport instead
// of needing a manual scroll to keep up.
function keepPlayheadInView(t) {
  const x = timeToX(t);
  const viewportWidth = el.rollScroll.clientWidth;
  const scrollLeft = el.rollScroll.scrollLeft;
  const margin = 80;
  if (x < scrollLeft + margin) {
    el.rollScroll.scrollLeft = Math.max(0, x - margin);
  } else if (x > scrollLeft + viewportWidth - margin) {
    el.rollScroll.scrollLeft = x - margin;
  }
}

el.playPauseBtn.addEventListener("click", async () => {
  if (!state.audioBuffer) return;
  if (state.audioCtx.state === "suspended") await state.audioCtx.resume();
  if (state.isPlaying) pausePlayback();
  else startPlaybackFrom(state.startOffset >= state.duration ? 0 : state.startOffset);
});

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && document.activeElement === document.body) {
    e.preventDefault();
    el.playPauseBtn.click();
  }
  if ((e.key === "Delete" || e.key === "Backspace") && selectedNote && document.activeElement.tagName !== "INPUT") {
    e.preventDefault();
    deleteNote(selectedNote);
  }
});

// ---------------------------------------------------------------------------
// Piano-roll layout & grid
// ---------------------------------------------------------------------------

function layoutRoll() {
  const rowCount = MIDI_MAX - MIDI_MIN + 1;
  const height = rowCount * PX_PER_SEMI;
  const width = Math.max(timeToX(state.duration) + 400, el.rollScroll.clientWidth);
  el.rollInner.style.height = `${height + TOP_OFFSET}px`;
  el.rollInner.style.width = `${width}px`;
  el.playhead.style.height = `${height + TOP_OFFSET}px`;
  buildGrid(width, height);
  buildRuler(width);
  drawWaveform(width);
}

function buildGrid(width, height) {
  el.rollGrid.innerHTML = "";
  el.rollGrid.style.width = `${width}px`;
  el.rollGrid.style.height = `${height}px`;
  for (let midi = MIDI_MAX; midi >= MIDI_MIN; midi--) {
    const row = document.createElement("div");
    row.className = "roll-grid-row" + (isBlackKey(midi) ? " black-key" : "");
    row.style.top = `${midiToTop(midi)}px`;
    row.style.height = `${PX_PER_SEMI}px`;
    const label = document.createElement("span");
    label.className = "row-label" + (midi % 12 === 0 ? " row-label-c" : "");
    label.textContent = midiName(midi);
    row.appendChild(label);
    el.rollGrid.appendChild(row);
  }
}

function buildRuler(width) {
  el.rollRuler.innerHTML = "";
  el.rollRuler.style.width = `${width}px`;
  const totalSeconds = Math.ceil(width / PX_PER_SEC);
  for (let s = 0; s <= totalSeconds; s++) {
    const tick = document.createElement("div");
    tick.className = "roll-ruler-tick";
    tick.style.left = `${timeToX(s)}px`;
    if (s % 5 === 0) {
      const label = document.createElement("span");
      label.textContent = formatTime(s);
      tick.appendChild(label);
    }
    el.rollRuler.appendChild(tick);
  }

  // Measure lines (assuming 4/4), from the BPM field - lets you line up a
  // MIDI re-edit against real bars instead of only raw seconds.
  const measureDuration = (60 / Math.max(1, state.bpm)) * 4;
  const measureCount = Math.ceil((width / PX_PER_SEC) / measureDuration);
  for (let m = 0; m <= measureCount; m++) {
    const t = m * measureDuration;
    const tick = document.createElement("div");
    tick.className = "roll-ruler-measure";
    tick.style.left = `${timeToX(t)}px`;
    const label = document.createElement("span");
    label.textContent = `M${m + 1}`;
    tick.appendChild(label);
    el.rollRuler.appendChild(tick);
  }
}

function seekFromPointerEvent(e, target) {
  const rect = target.getBoundingClientRect();
  const x = e.clientX - rect.left + el.rollScroll.scrollLeft;
  seekTo(xToTime(x));
}

el.rollRuler.addEventListener("click", (e) => seekFromPointerEvent(e, el.rollRuler));
el.rollWaveform.addEventListener("click", (e) => seekFromPointerEvent(e, el.rollWaveform));

// ---------------------------------------------------------------------------
// Waveform — min/max peaks per pixel column, drawn once per load/resize.
// ---------------------------------------------------------------------------

function drawWaveform(width) {
  const canvas = el.rollWaveform;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${WAVEFORM_HEIGHT}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(WAVEFORM_HEIGHT * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, WAVEFORM_HEIGHT);

  if (!state.audioBuffer) {
    ctx.fillStyle = "rgba(109, 117, 111, 0.5)";
    ctx.font = "11px sans-serif";
    ctx.fillText("Charge un audio pour voir la forme d'onde ici.", 8, WAVEFORM_HEIGHT / 2 + 4);
    return;
  }

  const data = state.audioBuffer.getChannelData(0);
  const samplesPerPx = data.length / width;
  const mid = WAVEFORM_HEIGHT / 2;
  ctx.fillStyle = "rgba(216, 149, 45, 0.55)";
  for (let x = 0; x < width; x++) {
    const start = Math.floor(x * samplesPerPx);
    const end = Math.min(data.length, Math.floor((x + 1) * samplesPerPx) || start + 1);
    let min = 1, max = -1;
    for (let i = start; i < end; i++) {
      const v = data[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min > max) { min = 0; max = 0; }
    const y1 = mid + min * mid * 0.92;
    const y2 = mid + max * mid * 0.92;
    ctx.fillRect(x, Math.min(y1, y2), 1, Math.max(1, Math.abs(y2 - y1)));
  }
}

window.addEventListener("resize", () => layoutRoll());

// ---------------------------------------------------------------------------
// Notes — render + drag/resize/select/delete interaction
// ---------------------------------------------------------------------------

function renderNotes() {
  el.rollNotes.innerHTML = "";
  noteEls.clear();
  notes.forEach((note) => {
    const div = document.createElement("div");
    div.className = "roll-note";
    positionNoteEl(div, note);
    div.title = `${midiName(note.midi)} · ${note.time.toFixed(2)}s`;

    const resizeHandle = document.createElement("div");
    resizeHandle.className = "roll-note-resize";
    div.appendChild(resizeHandle);

    div.addEventListener("pointerdown", (e) => startNoteDrag(e, note, div, false));
    resizeHandle.addEventListener("pointerdown", (e) => startNoteDrag(e, note, div, true));
    div.addEventListener("dblclick", (e) => { e.stopPropagation(); deleteNote(note); });

    el.rollNotes.appendChild(div);
    noteEls.set(note, div);
  });
  if (selectedNote && noteEls.has(selectedNote)) {
    noteEls.get(selectedNote).classList.add("selected");
  } else {
    selectedNote = null;
  }
}

function positionNoteEl(div, note) {
  div.style.left = `${timeToX(note.time)}px`;
  div.style.width = `${Math.max(6, note.duration * PX_PER_SEC)}px`;
  div.style.top = `${midiToTop(note.midi) + 1}px`;
  div.style.height = `${PX_PER_SEMI - 2}px`;
}

function selectNote(note) {
  if (selectedNote && noteEls.has(selectedNote)) noteEls.get(selectedNote).classList.remove("selected");
  selectedNote = note;
  if (note && noteEls.has(note)) noteEls.get(note).classList.add("selected");
}

function deleteNote(note) {
  const idx = notes.indexOf(note);
  if (idx === -1) return;
  notes.splice(idx, 1);
  if (selectedNote === note) selectedNote = null;
  renderNotes();
}

function startNoteDrag(e, note, div, isResize) {
  e.preventDefault();
  e.stopPropagation();
  selectNote(note);
  div.setPointerCapture(e.pointerId);
  div.style.cursor = isResize ? "ew-resize" : "grabbing";

  const startX = e.clientX;
  const startY = e.clientY;
  const origTime = note.time;
  const origMidi = note.midi;
  const origDuration = note.duration;
  let moved = false;

  function onMove(ev) {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;

    if (isResize) {
      note.duration = Math.max(MIN_NOTE_DURATION, origDuration + dx / PX_PER_SEC);
    } else {
      note.time = Math.max(0, origTime + dx / PX_PER_SEC);
      const semitoneShift = Math.round(-dy / PX_PER_SEMI);
      note.midi = clampMidi(origMidi + semitoneShift);
    }
    positionNoteEl(div, note);
    div.title = `${midiName(note.midi)} · ${note.time.toFixed(2)}s`;
  }

  function onUp(ev) {
    div.releasePointerCapture(ev.pointerId);
    div.removeEventListener("pointermove", onMove);
    div.removeEventListener("pointerup", onUp);
    div.style.cursor = isResize ? "ew-resize" : "grab";
    if (state.duration < note.time + note.duration + 2) {
      state.duration = note.time + note.duration + 2;
      el.durationLabel.textContent = formatTime(state.duration);
      layoutRoll();
      renderNotes();
    }
  }

  div.addEventListener("pointermove", onMove);
  div.addEventListener("pointerup", onUp);
}

el.rollNotes.addEventListener("pointerdown", (e) => {
  if (e.target !== el.rollNotes) return; // clicked a note, handled above
  const rect = el.rollNotes.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const note = { time: xToTime(x), midi: topToMidi(y), duration: DEFAULT_NOTE_DURATION };
  notes.push(note);
  renderNotes();
  selectNote(note);
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

layoutRoll();
renderNotes();
