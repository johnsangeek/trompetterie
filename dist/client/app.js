"use strict";

// True once installed/launched as a standalone PWA (Android/desktop via the
// manifest's display:standalone, or iOS's older navigator.standalone flag).
// In that context the app is a dedicated scale-study tool: no audio upload.
const isStandalonePWA =
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  audioContext: null,
  audioBuffer: null,
  sourceNode: null,
  isPlaying: false,
  startContextTime: 0,
  startOffset: 0,
  bpm: 120,
  duration: 0,
  loopA: null,
  loopB: null,
  loopEnabled: false,
  noteEvents: [],      // flat, time-sorted: {type:'note'|'rest', startTime, endTime, midi}
  measures: [],         // array of arrays of noteEvents (grouped per 4/4 bar)
  renderedMeasureWindowStart: -1,
  lastRenderKey: null,
  rafHandle: null,

  mode: "improvisation", // 'transcription' | 'improvisation' | 'manual' — library of scales works with no file loaded

  detectedKey: null,   // {root, mode} concert pitch class, from Krumhansl-Schmuckler
  scaleRoot: 0,         // concert pitch class, user-adjustable
  scaleType: "blues",

  songScaleRoot: 0,    // detected from whatever transcription/manual notes are loaded
  songScaleType: "major",

  octaveShift: 0,      // 0 or -12 - lowers every displayed/played note for players who can't reach the written register yet

  chordMode: "free", // 'free' | 'chord'
  chordQuality: "maj7",
  chordSide: "inside", // 'inside' | 'outside'

  pianoRoll: {
    // Default progression (concert pitch): Dm9 - Bb9 - Am9 - Eb13
    chords: [
      [62, 65, 69, 72, 76], // D4 F4 A4 C5 E5
      [58, 68, 72, 74],     // Bb3 Ab4 C5 D5
      [57, 67, 71, 72, 76], // A3 G4 B4 C5 E5
      [63, 67, 72, 73, 77], // Eb4 G4 C5 Db5 F5
    ],
    selectedChordIndex: null,
    suggestions: [],
    responseIndices: [],
  },

  manualNotes: [],      // [{time, midi}] concert pitch, user-placed, time-sorted
  manualMeasures: [],
  manualCaptureMode: false,
  deleteNoteMode: false, // when true, clicking a staff note removes it instead of previewing it
  scaleOptionsOpen: false, // gamme/tonalité picker, revealed by clicking the treble clef
  moreToolsOpen: false,    // transport/BPM/looper, chord tool, saved scores - tucked away by default
  selectedManualNoteIndex: null,
  twelveKeyBaseNotes: null,
  twelveKeyBaseRoot: null,
  soundEngine: "sample",

  scoreLoopActive: false,
  scoreLoopTimer: null,
  scheduledOscillators: [],
  scoreLoopStartTime: 0,
  scoreLoopDuration: 0,
  scoreLoopEvents: [],
  scoreLoopLastKey: null,
  scoreLoopRafHandle: null,

  metronomeActive: false,
  metronomeTimer: null,
  metronomeOscillators: [],

  scoreMuted: false,
  scoreMasterGain: null,
};

const SAVED_SCORES_STORAGE_KEY = "trumpetTrainerSavedScores";
const FAVORITE_SCALES_STORAGE_KEY = "trumpetTrainerFavoriteScales";
const CHORD_PROGRESSION_STORAGE_KEY = "trumpetTrainerChordProgression";

const TRUMPET_SAMPLES = [
  [53, "F3.mp3"], [57, "A3.mp3"], [60, "C4.mp3"], [63, "Ds4.mp3"],
  [65, "F4.mp3"], [67, "G4.mp3"], [70, "As4.mp3"], [74, "D5.mp3"],
  [77, "F5.mp3"], [81, "A5.mp3"], [84, "C6.mp3"],
];
const trumpetSampleBuffers = new Map();

const TICKS_PER_BEAT = 4;      // 16th-note resolution
const TICKS_PER_MEASURE = 16;  // 4/4 time signature

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const el = {
  boardingSpace: document.getElementById("boardingSpace"),
  mainApp: document.getElementById("mainApp"),
  boardTrumpetBtn: document.getElementById("boardTrumpetBtn"),
  backToBoardingLink: document.getElementById("backToBoardingLink"),
  clefToggleBtn: document.getElementById("clefToggleBtn"),
  moreToolsToggleBtn: document.getElementById("moreToolsToggleBtn"),
  hiddenModeToggle: document.getElementById("hiddenModeToggle"),
  scorePlaybackRow: document.getElementById("scorePlaybackRow"),
  transportPanel: document.getElementById("transportPanel"),
  pianoToolPanel: document.getElementById("pianoToolPanel"),
  savedScoresPanel: document.getElementById("savedScoresPanel"),
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("fileInput"),
  status: document.getElementById("status"),
  progressWrap: document.getElementById("progressWrap"),
  progressBar: document.getElementById("progressBar"),
  workspace: document.getElementById("workspace"),
  bpmDisplay: document.getElementById("bpmDisplay"),
  bpmInput: document.getElementById("bpmInput"),
  durationValue: document.getElementById("durationValue"),
  playBtn: document.getElementById("playBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  stopBtn: document.getElementById("stopBtn"),
  currentTimeLabel: document.getElementById("currentTimeLabel"),
  totalTimeLabel: document.getElementById("totalTimeLabel"),
  seekBar: document.getElementById("seekBar"),
  setLoopABtn: document.getElementById("setLoopABtn"),
  setLoopBBtn: document.getElementById("setLoopBBtn"),
  loopALabel: document.getElementById("loopALabel"),
  loopBLabel: document.getElementById("loopBLabel"),
  loopEnabledCheckbox: document.getElementById("loopEnabledCheckbox"),
  snapGridSelect: document.getElementById("snapGridSelect"),
  clearLoopBtn: document.getElementById("clearLoopBtn"),
  currentNoteLabel: document.getElementById("currentNoteLabel"),
  staff: document.getElementById("staff"),
  valve1: document.getElementById("valve1"),
  valve2: document.getElementById("valve2"),
  valve3: document.getElementById("valve3"),
  openInstrumentViewBtn: document.getElementById("openInstrumentViewBtn"),
  closeInstrumentViewBtn: document.getElementById("closeInstrumentViewBtn"),
  instrumentStage: document.getElementById("instrumentStage"),

  modeBtns: Array.from(document.querySelectorAll(".mode-btn")),
  improvisationControls: document.getElementById("improvisationControls"),
  manualControls: document.getElementById("manualControls"),
  detectedKeyLabel: document.getElementById("detectedKeyLabel"),
  scaleRootSelect: document.getElementById("scaleRootSelect"),
  scaleTypeSelect: document.getElementById("scaleTypeSelect"),
  degreeChips: document.getElementById("degreeChips"),
  pitchPalette: document.getElementById("pitchPalette"),
  songKeyPanel: document.getElementById("songKeyPanel"),
  songKeyLabel: document.getElementById("songKeyLabel"),
  startSongQuizBtn: document.getElementById("startSongQuizBtn"),
  songNotesHeader: document.getElementById("songNotesHeader"),
  startSongNotesQuizBtn: document.getElementById("startSongNotesQuizBtn"),
  pistonNoteLabel: document.getElementById("pistonNoteLabel"),
  octaveDownBtn: document.getElementById("octaveDownBtn"),
  octaveUpBtn: document.getElementById("octaveUpBtn"),
  octaveShiftLabel: document.getElementById("octaveShiftLabel"),
  undoManualNoteBtn: document.getElementById("undoManualNoteBtn"),
  clearManualNotesBtn: document.getElementById("clearManualNotesBtn"),
  deleteNoteModeBtn: document.getElementById("deleteNoteModeBtn"),
  toggleTwelveKeysBtn: document.getElementById("toggleTwelveKeysBtn"),
  twelveKeysPanel: document.getElementById("twelveKeysPanel"),
  twelveKeysGrid: document.getElementById("twelveKeysGrid"),
  playScoreBtn: document.getElementById("playScoreBtn"),
  stopScoreBtn: document.getElementById("stopScoreBtn"),
  openKaraokeBtn: document.getElementById("openKaraokeBtn"),
  exportScorePdfBtn: document.getElementById("exportScorePdfBtn"),
  soundEngineSelect: document.getElementById("soundEngineSelect"),
  metronomeBtn: document.getElementById("metronomeBtn"),
  muteScoreCheckbox: document.getElementById("muteScoreCheckbox"),
  saveScoreBtn: document.getElementById("saveScoreBtn"),
  savedScoresList: document.getElementById("savedScoresList"),
  noFileHint: document.getElementById("noFileHint"),
  toggleFavoriteScaleBtn: document.getElementById("toggleFavoriteScaleBtn"),
  favoriteScalesList: document.getElementById("favoriteScalesList"),

  chordModeBtns: Array.from(document.querySelectorAll("[data-chordmode]")),
  scaleTypeLabel: document.getElementById("scaleTypeLabel"),
  chordQualityLabel: document.getElementById("chordQualityLabel"),
  chordQualitySelect: document.getElementById("chordQualitySelect"),
  insideOutsideRow: document.getElementById("insideOutsideRow"),
  insideScaleBtn: document.getElementById("insideScaleBtn"),
  outsideScaleBtn: document.getElementById("outsideScaleBtn"),
  chordScaleExplain: document.getElementById("chordScaleExplain"),

  pianoRollGrid: document.getElementById("pianoRollGrid"),
  addChordSlotBtn: document.getElementById("addChordSlotBtn"),
  clearPianoRollBtn: document.getElementById("clearPianoRollBtn"),
  jazzifyBtn: document.getElementById("jazzifyBtn"),
  sendChordToTrumpetBtn: document.getElementById("sendChordToTrumpetBtn"),
  pianoRollFeedback: document.getElementById("pianoRollFeedback"),
  jazzVariationPicker: document.getElementById("jazzVariationPicker"),

  transcriptionTools: document.getElementById("transcriptionTools"),
  cleanTranscriptionBtn: document.getElementById("cleanTranscriptionBtn"),
  editTranscriptionBtn: document.getElementById("editTranscriptionBtn"),
  transcriptionFeedback: document.getElementById("transcriptionFeedback"),

  toggleScannerBtn: document.getElementById("toggleScannerBtn"),
  captureScannedNoteBtn: document.getElementById("captureScannedNoteBtn"),
  scannerNoteLabel: document.getElementById("scannerNoteLabel"),
  scannerCentsLabel: document.getElementById("scannerCentsLabel"),
  tunerNeedle: document.getElementById("tunerNeedle"),
  scannerFeedback: document.getElementById("scannerFeedback"),

  startQuizBtn: document.getElementById("startQuizBtn"),
  quizArea: document.getElementById("quizArea"),
  quizScore: document.getElementById("quizScore"),
  quizProgress: document.getElementById("quizProgress"),
  stopQuizBtn: document.getElementById("stopQuizBtn"),
  quizTimerCircle: document.getElementById("quizTimerCircle"),
  quizTimerLabel: document.getElementById("quizTimerLabel"),
  quizStatus: document.getElementById("quizStatus"),
  quizFeedback: document.getElementById("quizFeedback"),
  quizManualButtons: document.getElementById("quizManualButtons"),
  quizCorrectBtn: document.getElementById("quizCorrectBtn"),
  quizWrongBtn: document.getElementById("quizWrongBtn"),
  quizMicHint: document.getElementById("quizMicHint"),
};

// Les outils avancés restent disponibles sans encombrer le pupitre principal.
// On déplace leurs panneaux dans un tiroir unique ouvert par la roue dentée.
const toolsDrawer = document.createElement("aside");
toolsDrawer.className = "tools-drawer";
toolsDrawer.hidden = true;
toolsDrawer.setAttribute("aria-label", "Outils de la trompette");
const toolsDrawerHead = document.createElement("div");
toolsDrawerHead.className = "tools-drawer-head";
toolsDrawerHead.innerHTML = '<strong>Outils</strong><button type="button" class="tools-drawer-close" aria-label="Fermer les outils">×</button>';
toolsDrawer.appendChild(toolsDrawerHead);
[
  el.dropzone,
  el.status,
  el.progressWrap,
  el.transportPanel,
  el.pianoToolPanel,
  el.savedScoresPanel,
  document.querySelector(".octave-shift-stepper"),
  document.querySelector(".note-scanner"),
].filter(Boolean).forEach((node) => toolsDrawer.appendChild(node));
el.mainApp.appendChild(toolsDrawer);
[el.degreeChips, el.songNotesHeader, el.songKeyPanel].filter(Boolean).forEach((node) => el.improvisationControls.appendChild(node));

// The 3D trumpet is now an always-visible inline panel (not an on-demand
// fullscreen modal), so it's activated once at startup and never closed.
// openInstrumentStage/closeInstrumentStage are kept only because
// trumpet-3d.js's render loop still gates on the "trumpet:view-open/close"
// events and on el.instrumentStage.hidden - this shell must remain usable
// even if WebGL or the 3D model fails.
function openInstrumentStage() {
  el.instrumentStage.hidden = false;
  el.instrumentStage.setAttribute("aria-hidden", "false");
  document.body.classList.add("instrument-view-open");
  window.dispatchEvent(new CustomEvent("trumpet:view-open"));
}

function closeInstrumentStage() {
  el.instrumentStage.hidden = true;
  el.instrumentStage.setAttribute("aria-hidden", "true");
  document.body.classList.remove("instrument-view-open");
  window.dispatchEvent(new CustomEvent("trumpet:view-close"));
}

el.openInstrumentViewBtn.addEventListener("click", openInstrumentStage);
el.closeInstrumentViewBtn.addEventListener("click", closeInstrumentStage);
openInstrumentStage();

// ---------------------------------------------------------------------------
// Standalone PWA layout — a dedicated scale-study app, front and center,
// with no audio upload flow at all.
// ---------------------------------------------------------------------------

function applyStandaloneLayout() {
  if (!isStandalonePWA) return;
  document.body.classList.add("standalone-app");

  el.dropzone.hidden = true;
  el.progressWrap.hidden = true;
  el.noFileHint.hidden = true;

  el.playBtn.hidden = true;
  el.pauseBtn.hidden = true;
  el.stopBtn.hidden = true;
  el.seekBar.hidden = true;
  document.querySelector(".time-display").hidden = true;
  document.querySelector(".loop-controls").hidden = true;
  el.durationValue.closest(".stat").hidden = true;

  document.querySelector(".mode-toggle").hidden = true;
  document.querySelector(".saved-scores-panel").hidden = true;

  document.querySelector(".score-playback-hint").textContent =
    "Choisis une gamme, règle le BPM, et boucle-la pour t'entraîner.";
  document.querySelector("header .subtitle").textContent =
    "Ta bibliothèque de gammes — partout, hors ligne.";
}

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

function setStatus(text, isError) {
  el.status.hidden = !text;
  el.status.textContent = text || "";
  el.status.classList.toggle("error", !!isError);
}

function setProgress(fraction) {
  el.progressWrap.hidden = fraction === null;
  if (fraction !== null) {
    el.progressBar.style.width = `${Math.round(fraction * 100)}%`;
  }
}

["dragenter", "dragover"].forEach((evt) => {
  el.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    el.dropzone.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((evt) => {
  el.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    el.dropzone.classList.remove("dragover");
  });
});
el.dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadFile(file);
});
el.dropzone.addEventListener("click", () => el.fileInput.click());
el.fileInput.addEventListener("change", () => {
  const file = el.fileInput.files && el.fileInput.files[0];
  if (file) loadFile(file);
});

async function loadFile(file) {
  if (noteScanner.active) stopNoteScanner();
  stopPlayback();
  stopScorePlayback();
  stopMetronome();
  if (quizState.active) stopQuiz(false);
  state.octaveShift = 0;
  el.octaveShiftLabel.textContent = "Octave normale";
  el.octaveDownBtn.disabled = false;
  el.octaveUpBtn.disabled = false;
  setStatus("Chargement du fichier...");
  setProgress(0);

  try {
    if (!state.audioContext) {
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer);
    state.audioBuffer = audioBuffer;
    state.duration = audioBuffer.duration;

    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;

    setStatus("Analyse du tempo...");
    const bpm = detectBPM(channelData, sampleRate);
    state.bpm = bpm;
    el.bpmDisplay.textContent = bpm.toFixed(1);
    el.bpmInput.value = bpm.toFixed(1);

    setStatus("Analyse des notes...");
    const pitchInput = decimate(channelData, sampleRate, 11025);
    const rawFrames = await extractPitchFrames(pitchInput.data, pitchInput.sampleRate, (frac) => setProgress(frac));

    setStatus("Construction de la partition...");
    const segments = segmentPitchFrames(rawFrames);
    state.noteEvents = buildNoteEvents(segments, state.duration, state.bpm);
    state.measures = groupIntoMeasures(state.noteEvents);

    state.detectedKey = detectKey(state.noteEvents);
    state.scaleRoot = state.detectedKey.root;
    state.scaleType = state.detectedKey.mode === "minor" ? "blues" : "majorPentatonic";
    el.detectedKeyLabel.textContent = formatTrumpetKey(state.detectedKey.root, state.detectedKey.mode);
    el.scaleRootSelect.value = String(state.scaleRoot);
    el.scaleTypeSelect.value = state.scaleType;
    state.chordMode = "free";
    el.chordModeBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.chordmode === "free"));
    el.scaleTypeLabel.hidden = false;
    el.chordQualityLabel.hidden = true;
    el.insideOutsideRow.hidden = true;

    state.manualNotes = [];
    state.manualCaptureMode = false;
    rebuildManualMeasures();

    setProgress(null);
    setStatus("");

    el.durationValue.textContent = formatTime(state.duration);
    el.totalTimeLabel.textContent = formatTime(state.duration);
    el.seekBar.value = 0;
    state.loopA = null;
    state.loopB = null;
    state.loopEnabled = false;
    el.loopEnabledCheckbox.checked = false;
    updateLoopLabels();

    setFileControlsEnabled(true);
    setMode("transcription");
  } catch (err) {
    console.error(err);
    setProgress(null);
    setStatus(`Erreur : ${err.message || err}`, true);
  }
}

// ---------------------------------------------------------------------------
// BPM detection — energy-envelope autocorrelation
// ---------------------------------------------------------------------------

function detectBPM(channelData, sampleRate) {
  const hop = Math.round(sampleRate * 0.0464); // ~46ms frames
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
    for (let i = 0; i + lag < frameCount; i++) {
      score += onset[i] * onset[i + lag];
    }
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  let bpm = 60 / (bestLag * hopTime);
  while (bpm < 70) bpm *= 2;
  while (bpm > 200) bpm /= 2;
  return Math.round(bpm * 10) / 10;
}

// ---------------------------------------------------------------------------
// Pitch detection — autocorrelation (ACF2+), chunked so the UI stays responsive
// ---------------------------------------------------------------------------

// Autocorrelation is O(windowSize^2) per frame; downsampling first (with a
// cheap box-filter for anti-aliasing) keeps whole-track analysis tractable
// without losing accuracy in the trumpet's range (~150Hz-1200Hz).
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
  for (let i = 0; i < SIZE; i++) {
    const val = buffer[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;

  let r1 = 0;
  let r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buffer[i]) < thres) { r1 = i; break; }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buffer[SIZE - i]) < thres) { r2 = SIZE - i; break; }
  }
  const trimmed = buffer.slice(r1, r2);
  const newSize = trimmed.length;
  if (newSize < 8) return -1;

  const c = new Float32Array(newSize);
  for (let i = 0; i < newSize; i++) {
    let sum = 0;
    for (let j = 0; j < newSize - i; j++) {
      sum += trimmed[j] * trimmed[j + i];
    }
    c[i] = sum;
  }

  let d = 0;
  while (d < newSize - 1 && c[d] > c[d + 1]) d++;

  let maxval = -1;
  let maxpos = -1;
  for (let i = d; i < newSize; i++) {
    if (c[i] > maxval) {
      maxval = c[i];
      maxpos = i;
    }
  }
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

// ---------------------------------------------------------------------------
// Trumpet note scanner — strictly monophonic: one detected pitch, its tuning
// and the matching Bb-trumpet fingering. It never attempts chord detection.
// ---------------------------------------------------------------------------

const noteScanner = {
  active: false,
  stream: null,
  analyser: null,
  buffer: null,
  pollHandle: null,
  lastMidi: null,
  stableFrames: 0,
  stableMidi: null,
};

async function startNoteScanner() {
  if (quizState.active) stopQuiz(false);
  if (!navigator.mediaDevices?.getUserMedia) {
    el.scannerFeedback.textContent = "Le micro n'est pas disponible dans ce navigateur.";
    return;
  }

  try {
    if (!state.audioContext) state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (state.audioContext.state === "suspended") await state.audioContext.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const source = state.audioContext.createMediaStreamSource(stream);
    const analyser = state.audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    noteScanner.active = true;
    noteScanner.stream = stream;
    noteScanner.analyser = analyser;
    noteScanner.buffer = new Float32Array(analyser.fftSize);
    noteScanner.lastMidi = null;
    noteScanner.stableFrames = 0;
    noteScanner.stableMidi = null;
    el.toggleScannerBtn.textContent = "Arrêter";
    el.toggleScannerBtn.classList.add("active");
    el.scannerFeedback.textContent = "Joue une note tenue…";
    noteScanner.pollHandle = setInterval(scanTrumpetNote, 90);
  } catch (error) {
    el.scannerFeedback.textContent = "Autorise le micro pour utiliser le scanner de notes.";
  }
}

function stopNoteScanner() {
  if (noteScanner.pollHandle) clearInterval(noteScanner.pollHandle);
  noteScanner.stream?.getTracks().forEach((track) => track.stop());
  noteScanner.active = false;
  noteScanner.stream = null;
  noteScanner.analyser = null;
  noteScanner.buffer = null;
  noteScanner.pollHandle = null;
  el.toggleScannerBtn.textContent = "Démarrer le scanner";
  el.toggleScannerBtn.classList.remove("active");
  el.scannerFeedback.textContent = "Scanner arrêté.";
}

function scanTrumpetNote() {
  if (!noteScanner.active || !noteScanner.analyser) return;
  noteScanner.analyser.getFloatTimeDomainData(noteScanner.buffer);
  const frequency = autoCorrelate(noteScanner.buffer, state.audioContext.sampleRate);
  if (frequency < 140 || frequency > 1400) return;

  const preciseMidi = 69 + 12 * Math.log2(frequency / 440);
  const midi = Math.round(preciseMidi);
  const cents = Math.round((preciseMidi - midi) * 100);
  if (midi === noteScanner.lastMidi) noteScanner.stableFrames++;
  else {
    noteScanner.lastMidi = midi;
    noteScanner.stableFrames = 1;
  }
  if (noteScanner.stableFrames < 3) return;

  noteScanner.stableMidi = midi;
  el.scannerNoteLabel.textContent = midiToTrumpetWrittenName(midi);
  el.scannerCentsLabel.textContent = Math.abs(cents) <= 5 ? "Juste" : `${cents > 0 ? "+" : ""}${cents} cents`;
  el.tunerNeedle.style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
  el.captureScannedNoteBtn.disabled = false;
  updatePistons(midi);
  setTrumpetCurrentNote(midi);
  el.scannerFeedback.textContent = `Entendu : ${midiToConcertDisplayName(midi)} · à lire : ${midiToTrumpetWrittenName(midi)}.`;
}

function captureScannedNote() {
  if (noteScanner.stableMidi === null) return;
  const beatDuration = 60 / state.bpm;
  const last = state.manualNotes[state.manualNotes.length - 1];
  const time = last ? last.time + beatDuration : 0;
  state.manualCaptureMode = true;
  state.duration = Math.max(state.duration, time + beatDuration);
  state.manualNotes.push({ time, midi: noteScanner.stableMidi });
  rebuildManualMeasures();
  const manualButton = el.modeBtns.find((btn) => btn.dataset.mode === "manual");
  if (manualButton) manualButton.disabled = false;
  setMode("manual");
  el.scannerFeedback.textContent = `${midiToTrumpetWrittenName(noteScanner.stableMidi)} ajoutée à la fin de la partition.`;
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
        // Trumpet's practical range is roughly concert E3 (~165Hz, written
        // F#3) to C6 (~1047Hz); bounding the detector there - rather than
        // the much wider range used before - avoids octave errors where a
        // low bass/piano note's harmonics get mistaken for a low fundamental.
        if (freq > 140 && freq < 1400) {
          const midi = Math.round(69 + 12 * Math.log2(freq / 440));
          frames.push({ time, midi });
        } else {
          frames.push({ time, midi: null });
        }
      }
      onProgress(totalFrames ? i / totalFrames : 1);
      if (i < totalFrames) {
        setTimeout(processChunk, 0);
      } else {
        resolve(frames);
      }
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
// Quantization — segments -> 16th-note grid -> VexFlow-ready note events
// ---------------------------------------------------------------------------

function timeToTicks(time, bpm) {
  const beats = (time * bpm) / 60;
  return Math.round(beats * TICKS_PER_BEAT);
}

function ticksToTime(ticks, bpm) {
  const beats = ticks / TICKS_PER_BEAT;
  return (beats * 60) / bpm;
}

function buildNoteEvents(segments, duration, bpm) {
  const totalTicks = Math.max(1, timeToTicks(duration, bpm));
  const events = [];
  let cursor = 0;

  for (const seg of segments) {
    let startTicks = timeToTicks(seg.startTime, bpm);
    let endTicks = timeToTicks(seg.endTime, bpm);
    if (endTicks <= startTicks) endTicks = startTicks + 1;
    if (startTicks < cursor) startTicks = cursor;
    if (endTicks <= startTicks) continue;

    if (startTicks > cursor) {
      events.push({ type: "rest", startTicks: cursor, endTicks: startTicks, midi: null });
    }
    events.push({ type: "note", startTicks, endTicks, midi: seg.midi });
    cursor = endTicks;
  }

  if (cursor < totalTicks) {
    events.push({ type: "rest", startTicks: cursor, endTicks: totalTicks, midi: null });
  }

  for (const e of events) {
    e.startTime = ticksToTime(e.startTicks, bpm);
    e.endTime = ticksToTime(e.endTicks, bpm);
  }

  return events;
}

function cleanTranscription() {
  const notes = state.noteEvents.filter((event) => event.type === "note").map((event) => ({ ...event }));
  if (notes.length < 2) {
    el.transcriptionFeedback.textContent = "Pas assez de notes pour lancer le nettoyage.";
    return;
  }

  const filtered = [];
  let removed = 0;
  notes.forEach((note, index) => {
    const previous = notes[index - 1];
    const next = notes[index + 1];
    const length = note.endTicks - note.startTicks;
    const betweenSamePitch = previous && next && previous.midi === next.midi && length <= 2;
    const isolatedJump = previous && next && length <= 1
      && Math.abs(note.midi - previous.midi) >= 7
      && Math.abs(note.midi - next.midi) >= 7;
    if (betweenSamePitch || isolatedJump) removed++;
    else filtered.push(note);
  });

  const merged = [];
  filtered.forEach((note) => {
    const previous = merged[merged.length - 1];
    if (previous && previous.midi === note.midi && note.startTicks - previous.endTicks <= 2) {
      previous.endTicks = Math.max(previous.endTicks, note.endTicks);
    } else {
      merged.push({ ...note });
    }
  });

  const segments = merged.map((note) => ({
    startTime: ticksToTime(note.startTicks, state.bpm),
    endTime: ticksToTime(note.endTicks, state.bpm),
    midi: note.midi,
  }));
  state.noteEvents = buildNoteEvents(segments, state.duration, state.bpm);
  state.measures = groupIntoMeasures(state.noteEvents);
  state.lastRenderKey = null;
  state.renderedMeasureWindowStart = -1;
  drawFullScore(state.measures, null);
  el.transcriptionFeedback.textContent = removed
    ? `${removed} note${removed > 1 ? "s" : ""} parasite${removed > 1 ? "s" : ""} retirée${removed > 1 ? "s" : ""}.`
    : "La partition est déjà propre selon le filtre automatique.";
}

function editDetectedTranscription() {
  state.manualNotes = state.noteEvents
    .filter((event) => event.type === "note")
    .map((event) => ({ time: event.startTime, midi: event.midi }));
  state.manualCaptureMode = true;
  rebuildManualMeasures();
  setMode("manual");
  setStatus("Partition copiée dans l'éditeur : supprime une note ou remplace-la avec la palette.");
  setTimeout(() => setStatus(""), 4500);
}

const DURATION_TOKENS = [
  [16, "w"], [12, "hd"], [8, "h"], [6, "qd"], [4, "q"], [3, "8d"], [2, "8"], [1, "16"],
];

function splitTicksIntoTokens(ticks) {
  const tokens = [];
  let remaining = ticks;
  while (remaining > 0) {
    let matched = null;
    for (const [len, dur] of DURATION_TOKENS) {
      if (len <= remaining) { matched = [len, dur]; break; }
    }
    if (!matched) matched = [1, "16"];
    tokens.push(matched);
    remaining -= matched[0];
  }
  return tokens;
}

function groupIntoMeasures(events) {
  const measures = [];
  let currentMeasure = [];
  let measureFill = 0;

  function pushMeasure() {
    measures.push(currentMeasure);
    currentMeasure = [];
    measureFill = 0;
  }

  for (const event of events) {
    let remaining = event.endTicks - event.startTicks;
    let cursorTicks = event.startTicks;

    while (remaining > 0) {
      const spaceLeft = TICKS_PER_MEASURE - measureFill;
      const chunk = Math.min(remaining, spaceLeft);
      const tokens = splitTicksIntoTokens(chunk);

      for (const [len, dur] of tokens) {
        currentMeasure.push({
          type: event.type,
          duration: dur,
          midi: event.midi,
          startTime: ticksToTime(cursorTicks, state.bpm),
          endTime: ticksToTime(cursorTicks + len, state.bpm),
        });
        cursorTicks += len;
        measureFill += len;
      }

      remaining -= chunk;
      if (measureFill >= TICKS_PER_MEASURE) pushMeasure();
    }
  }

  if (currentMeasure.length) pushMeasure();
  return measures;
}

// ---------------------------------------------------------------------------
// Key detection (Krumhansl-Schmuckler) & improvisation scales
// ---------------------------------------------------------------------------

// Same profiles used by the Python backend's key-finder (backend/analysis/key.py),
// kept here so both tools agree on what a given recording's key is.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearsonCorrelation(a, b) {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

function rollRight(arr, shift) {
  const n = arr.length;
  const out = new Array(n);
  for (let j = 0; j < n; j++) {
    out[j] = arr[((j - shift) % n + n) % n];
  }
  return out;
}

function buildPitchClassHistogram(noteEvents) {
  const hist = new Array(12).fill(0);
  for (const e of noteEvents) {
    if (e.type !== "note" || e.midi === null || e.midi === undefined) continue;
    hist[((e.midi % 12) + 12) % 12] += e.endTime - e.startTime;
  }
  return hist;
}

function detectKey(noteEvents) {
  const hist = buildPitchClassHistogram(noteEvents);
  if (!hist.some((v) => v > 0)) return { root: 0, mode: "major" };

  let best = { root: 0, mode: "major", score: -Infinity };
  for (let root = 0; root < 12; root++) {
    for (const [mode, profile] of [["major", MAJOR_PROFILE], ["minor", MINOR_PROFILE]]) {
      const rotated = rollRight(profile, root);
      const score = pearsonCorrelation(hist, rotated);
      if (score > best.score) best = { root, mode, score };
    }
  }
  return { root: best.root, mode: best.mode };
}

// Same Krumhansl-Schmuckler detection as detectKey, but for a flat list of
// concert-pitch notes with no durations (manual/catalog transcriptions) -
// every note counts equally instead of being weighted by how long it rings.
function detectKeyFromNotes(notes) {
  const events = notes.map((n) => ({ type: "note", midi: n.midi, startTime: 0, endTime: 1 }));
  return detectKey(events);
}

const SCALE_DEFINITIONS = {
  // Principales
  major: { label: "Majeur", group: "Principales", intervals: [0, 2, 4, 5, 7, 9, 11] },
  naturalMinor: { label: "Mineur naturel", group: "Principales", intervals: [0, 2, 3, 5, 7, 8, 10] },
  majorPentatonic: { label: "Pentatonique majeure", group: "Principales", intervals: [0, 2, 4, 7, 9] },
  minorPentatonic: { label: "Pentatonique mineure", group: "Principales", intervals: [0, 3, 5, 7, 10] },
  blues: { label: "Blues", group: "Principales", intervals: [0, 3, 5, 6, 7, 10] },

  // Modes (Ionien = Majeur, Éolien = Mineur naturel, déjà listés ci-dessus)
  dorian: { label: "Dorien", group: "Modes", intervals: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { label: "Phrygien", group: "Modes", intervals: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { label: "Lydien", group: "Modes", intervals: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { label: "Mixolydien", group: "Modes", intervals: [0, 2, 4, 5, 7, 9, 10] },
  locrian: { label: "Locrien", group: "Modes", intervals: [0, 1, 3, 5, 6, 8, 10] },

  // Mineures avancées
  harmonicMinor: { label: "Mineur harmonique", group: "Mineures avancées", intervals: [0, 2, 3, 5, 7, 8, 11] },
  melodicMinor: { label: "Mineur mélodique (jazz)", group: "Mineures avancées", intervals: [0, 2, 3, 5, 7, 9, 11] },

  // Jazz / symétriques
  bebopDominant: { label: "Bebop dominante", group: "Jazz / symétriques", intervals: [0, 2, 4, 5, 7, 9, 10, 11] },
  wholeTone: { label: "Ton par ton", group: "Jazz / symétriques", intervals: [0, 2, 4, 6, 8, 10] },
  diminishedWholeHalf: { label: "Diminuée (ton-demi-ton)", group: "Jazz / symétriques", intervals: [0, 2, 3, 5, 6, 8, 9, 11] },
  diminishedHalfWhole: { label: "Diminuée (demi-ton-ton)", group: "Jazz / symétriques", intervals: [0, 1, 3, 4, 6, 7, 9, 10] },
  chromatic: { label: "Chromatique", group: "Jazz / symétriques", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

// For a given chord quality: the "inside" scale (safe, matches the chord
// cleanly) and an "outside" one (a jazzier substitute that adds tension/
// color before resolving back) - both built on the same root for simplicity.
const CHORD_TO_SCALES = {
  maj7: { label: "Maj7", inside: "major", outside: "lydian" },
  maj6: { label: "6", inside: "major", outside: "lydian" },
  dom7: { label: "7", inside: "mixolydian", outside: "diminishedHalfWhole" },
  min7: { label: "m7", inside: "dorian", outside: "melodicMinor" },
  min7b5: { label: "m7b5", inside: "locrian", outside: "harmonicMinor" },
  dim7: { label: "dim7", inside: "diminishedWholeHalf", outside: "diminishedHalfWhole" },
  min: { label: "m", inside: "dorian", outside: "naturalMinor" },
  minMaj7: { label: "mMaj7", inside: "melodicMinor", outside: "harmonicMinor" },
  maj: { label: "Maj", inside: "major", outside: "lydian" },
  sus4: { label: "sus4", inside: "mixolydian", outside: "lydian" },
};

// ---------------------------------------------------------------------------
// Piano roll — a small chord-progression editor. Notes stored as concert
// MIDI. Extension tones (9ths, 13ths...) are tolerated by chord detection
// below rather than rejected, since real voicings almost always carry them.
// ---------------------------------------------------------------------------

const PR_ROW_HEIGHT = 15;
const PR_HEADER_HEIGHT = 28;
const PR_KEYS_WIDTH = 42;
const PR_COL_WIDTH = 130;
const PR_MIDI_LOW = 55; // G3
const PR_MIDI_HIGH = 79; // G5

const CHORD_QUALITY_TEMPLATES = {
  maj7: [0, 4, 7, 11],
  maj6: [0, 4, 7, 9],
  dom7: [0, 4, 7, 10],
  min7: [0, 3, 7, 10],
  min7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  min: [0, 3, 7],
  minMaj7: [0, 3, 7, 11],
  maj: [0, 4, 7],
  sus4: [0, 5, 7],
};

// Chord recognition from bare pitch-classes is fundamentally ambiguous (e.g.
// A-C-E-G reads equally well as Am7 or Cmaj7 - same notes, different root).
// Real voicings almost always put the root in the bass, so we anchor the
// root there rather than searching all 12 candidates - it also sidesteps
// ties between qualities that "explain" the same notes equally well.
function detectChordFromMidiNotes(midiNotes) {
  if (!midiNotes.length) return null;
  const pitchClasses = new Set(midiNotes.map((m) => ((m % 12) + 12) % 12));
  const bassMidi = Math.min(...midiNotes);
  const root = ((bassMidi % 12) + 12) % 12;

  let best = null;
  for (const [quality, template] of Object.entries(CHORD_QUALITY_TEMPLATES)) {
    const templateSet = new Set(template.map((iv) => (root + iv) % 12));
    let matched = 0;
    templateSet.forEach((pc) => {
      if (pitchClasses.has(pc)) matched++;
    });
    const missing = templateSet.size - matched;
    const extra = [...pitchClasses].filter((pc) => !templateSet.has(pc)).length;
    const score = matched * 2 - missing * 2.2 - extra * 0.3;
    if (!best || score > best.score) best = { root, quality, score };
  }
  return best;
}

function isBlackKey(midi) {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

function renderPianoRoll() {
  const container = el.pianoRollGrid;
  container.innerHTML = "";

  const rowCount = PR_MIDI_HIGH - PR_MIDI_LOW + 1;
  const chordCount = state.pianoRoll.chords.length;

  const pr = document.createElement("div");
  pr.className = "pr-container";
  pr.style.width = `${PR_KEYS_WIDTH + chordCount * PR_COL_WIDTH}px`;
  pr.style.height = `${PR_HEADER_HEIGHT + rowCount * PR_ROW_HEIGHT}px`;

  // Piano key labels (one per pitch row), high pitch at top.
  for (let midi = PR_MIDI_HIGH; midi >= PR_MIDI_LOW; midi--) {
    const rowIdx = PR_MIDI_HIGH - midi;
    const label = document.createElement("div");
    label.className = `pr-key-label ${isBlackKey(midi) ? "pr-key-black" : "pr-key-white"}`;
    label.style.left = "0px";
    label.style.top = `${PR_HEADER_HEIGHT + rowIdx * PR_ROW_HEIGHT}px`;
    label.style.width = `${PR_KEYS_WIDTH}px`;
    label.style.height = `${PR_ROW_HEIGHT}px`;
    label.textContent = midiToVexKey(midi).replace("/", "").toUpperCase();
    pr.appendChild(label);
  }

  // Chord header buttons (select + play a chord).
  state.pianoRoll.chords.forEach((_, chordIdx) => {
    const header = document.createElement("div");
    header.className = "pr-chord-header";
    if (state.pianoRoll.selectedChordIndex === chordIdx) header.classList.add("pr-chord-selected");
    if (state.pianoRoll.responseIndices.includes(chordIdx)) header.classList.add("pr-chord-response");
    header.style.left = `${PR_KEYS_WIDTH + chordIdx * PR_COL_WIDTH}px`;
    header.style.top = "0px";
    header.style.width = `${PR_COL_WIDTH}px`;
    header.style.height = `${PR_HEADER_HEIGHT}px`;
    const chord = detectChordFromMidiNotes(state.pianoRoll.chords[chordIdx]);
    header.textContent = chord
      ? `${state.pianoRoll.responseIndices.includes(chordIdx) ? "↳ " : ""}${FRENCH_NOTE_NAMES[chord.root]}${CHORD_TO_SCALES[chord.quality].label}`
      : `Accord ${chordIdx + 1}`;
    header.addEventListener("click", () => selectChord(chordIdx));
    pr.appendChild(header);
  });

  // Grid cells (click empty cell = add note).
  for (let midi = PR_MIDI_HIGH; midi >= PR_MIDI_LOW; midi--) {
    const rowIdx = PR_MIDI_HIGH - midi;
    for (let chordIdx = 0; chordIdx < chordCount; chordIdx++) {
      const cell = document.createElement("div");
      cell.className = `pr-cell ${isBlackKey(midi) ? "pr-cell-black-row" : "pr-cell-white-row"}`;
      if (state.pianoRoll.selectedChordIndex === chordIdx) cell.classList.add("pr-cell-selected");
      cell.style.left = `${PR_KEYS_WIDTH + chordIdx * PR_COL_WIDTH}px`;
      cell.style.top = `${PR_HEADER_HEIGHT + rowIdx * PR_ROW_HEIGHT}px`;
      cell.style.width = `${PR_COL_WIDTH}px`;
      cell.style.height = `${PR_ROW_HEIGHT}px`;
      cell.addEventListener("click", () => toggleNoteInChord(chordIdx, midi));
      pr.appendChild(cell);
    }
  }

  // Notes (drawn on top, span the full column width like the reference screenshot).
  state.pianoRoll.chords.forEach((notes, chordIdx) => {
    notes.forEach((midi) => {
      if (midi < PR_MIDI_LOW || midi > PR_MIDI_HIGH) return;
      const rowIdx = PR_MIDI_HIGH - midi;
      const note = document.createElement("div");
      note.className = "pr-note";
      note.style.left = `${PR_KEYS_WIDTH + chordIdx * PR_COL_WIDTH + 2}px`;
      note.style.top = `${PR_HEADER_HEIGHT + rowIdx * PR_ROW_HEIGHT + 1}px`;
      note.style.width = `${PR_COL_WIDTH - 4}px`;
      note.style.height = `${PR_ROW_HEIGHT - 2}px`;
      note.title = midiToFrenchName(midi);
      note.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleNoteInChord(chordIdx, midi);
      });
      pr.appendChild(note);
    });
  });

  container.appendChild(pr);
}

function saveSharedChordProgression() {
  try { localStorage.setItem(CHORD_PROGRESSION_STORAGE_KEY, JSON.stringify(state.pianoRoll.chords)); } catch (_error) { /* local-only bonus */ }
}

function loadSharedChordProgression() {
  try {
    const saved = JSON.parse(localStorage.getItem(CHORD_PROGRESSION_STORAGE_KEY) || "null");
    if (Array.isArray(saved) && saved.length && saved.every((chord) => Array.isArray(chord))) {
      state.pianoRoll.chords = saved;
    }
  } catch (_error) { /* keep defaults */ }
}

function toggleNoteInChord(chordIdx, midi) {
  hideJazzSuggestions();
  const notes = state.pianoRoll.chords[chordIdx];
  const idx = notes.indexOf(midi);
  if (idx >= 0) {
    notes.splice(idx, 1);
  } else {
    notes.push(midi);
  }
  state.pianoRoll.selectedChordIndex = chordIdx;
  const hasNotes = notes.length > 0;
  el.jazzifyBtn.disabled = !hasNotes;
  el.sendChordToTrumpetBtn.disabled = !hasNotes;
  el.pianoRollFeedback.textContent = hasNotes
    ? "Accord sélectionné — tu peux créer une variante ou l'envoyer vers la trompette."
    : "Ajoute des notes à cet accord pour continuer.";
  saveSharedChordProgression();
  renderPianoRoll();
}

function selectChord(chordIdx) {
  hideJazzSuggestions();
  state.pianoRoll.selectedChordIndex = chordIdx;
  const notes = state.pianoRoll.chords[chordIdx];
  const hasNotes = notes.length > 0;
  el.jazzifyBtn.disabled = !hasNotes;
  el.sendChordToTrumpetBtn.disabled = !hasNotes;
  renderPianoRoll();

  notes.forEach((midi) => playTone(midi, 1.1));
  el.pianoRollFeedback.textContent = hasNotes
    ? "Accord sélectionné et joué."
    : "Cet emplacement est vide : clique dans la grille pour ajouter des notes.";
}

function addChordSlot() {
  hideJazzSuggestions();
  state.pianoRoll.chords.push([]);
  state.pianoRoll.selectedChordIndex = state.pianoRoll.chords.length - 1;
  el.jazzifyBtn.disabled = true;
  el.sendChordToTrumpetBtn.disabled = true;
  el.pianoRollFeedback.textContent = "Nouvel accord sélectionné — ajoute ses notes dans la grille.";
  saveSharedChordProgression();
  renderPianoRoll();
}

function clearPianoRoll() {
  if (!confirm("Effacer toute la progression d'accords ?")) return;
  state.pianoRoll.chords = [[]];
  state.pianoRoll.selectedChordIndex = null;
  state.pianoRoll.responseIndices = [];
  saveSharedChordProgression();
  hideJazzSuggestions();
  el.jazzifyBtn.disabled = true;
  el.sendChordToTrumpetBtn.disabled = true;
  el.pianoRollFeedback.textContent = "Progression effacée.";
  renderPianoRoll();
}

function buildJazzVariation(notes, detected) {
  const extensions = {
    maj7: [0, 4, 7, 11, 14],
    maj6: [0, 4, 7, 9, 14],
    dom7: [0, 4, 7, 10, 14, 21],
    min7: [0, 3, 7, 10, 14],
    min7b5: [0, 3, 6, 10, 13],
    dim7: [0, 3, 6, 9, 14],
    min: [0, 3, 7, 10, 14],
    minMaj7: [0, 3, 7, 11, 14],
    maj: [0, 4, 7, 11, 14],
    sus4: [0, 5, 7, 10, 14],
  };

  const bass = Math.min(...notes);
  let rootMidi = bass;
  while (((rootMidi % 12) + 12) % 12 !== detected.root) rootMidi--;
  while (rootMidi < PR_MIDI_LOW) rootMidi += 12;
  while (rootMidi > PR_MIDI_LOW + 11) rootMidi -= 12;

  const variation = extensions[detected.quality].map((interval) => {
    let midi = rootMidi + interval;
    while (midi > PR_MIDI_HIGH) midi -= 12;
    while (midi < PR_MIDI_LOW) midi += 12;
    return midi;
  });

  return [...new Set(variation)].sort((a, b) => a - b);
}

function buildChordVoicing(root, quality) {
  const intervals = {
    maj7: [0, 4, 7, 11, 14],
    dom7: [0, 4, 7, 10, 14],
    min7: [0, 3, 7, 10, 14],
  }[quality];

  let rootMidi = PR_MIDI_LOW;
  while (((rootMidi % 12) + 12) % 12 !== root) rootMidi++;
  const notes = intervals.map((interval) => {
    let midi = rootMidi + interval;
    while (midi > PR_MIDI_HIGH) midi -= 12;
    return midi;
  });
  return [...new Set(notes)].sort((a, b) => a - b);
}

function chordName(root, quality) {
  return `${FRENCH_NOTE_NAMES[root]}${CHORD_TO_SCALES[quality].label}`;
}

function hideJazzSuggestions() {
  state.pianoRoll.suggestions = [];
  el.jazzVariationPicker.hidden = true;
  el.jazzVariationPicker.innerHTML = "";
}

function playChordNotes(notes) {
  notes.forEach((midi) => playTone(midi, 1.2));
}

function appendJazzResponse(variation) {
  const newIndex = state.pianoRoll.chords.length;
  state.pianoRoll.chords.push([...variation.notes]);
  state.pianoRoll.responseIndices.push(newIndex);
  state.pianoRoll.selectedChordIndex = newIndex;
  saveSharedChordProgression();
  renderPianoRoll();
  playChordNotes(variation.notes);
  el.pianoRollFeedback.textContent = `${variation.label} ajouté comme réponse à la fin de la progression.`;

  requestAnimationFrame(() => {
    el.pianoRollGrid.scrollTo({ left: el.pianoRollGrid.scrollWidth, behavior: "smooth" });
  });
}

function renderJazzSuggestions(suggestions, sourceName) {
  el.jazzVariationPicker.innerHTML = "";

  const heading = document.createElement("div");
  heading.className = "variation-picker-heading";
  heading.textContent = `Réponses possibles à ${sourceName}`;
  el.jazzVariationPicker.appendChild(heading);

  const list = document.createElement("div");
  list.className = "variation-list";
  suggestions.forEach((variation) => {
    const card = document.createElement("div");
    card.className = "variation-card";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "variation-preview";
    const title = document.createElement("strong");
    title.textContent = variation.label;
    const description = document.createElement("span");
    description.textContent = variation.description;
    copy.append(title, description);
    copy.addEventListener("click", () => {
      playChordNotes(variation.notes);
      el.pianoRollFeedback.textContent = `Écoute : ${variation.label}.`;
    });

    const add = document.createElement("button");
    add.type = "button";
    add.className = "btn variant-add-btn";
    add.textContent = "Ajouter à la fin";
    add.addEventListener("click", () => appendJazzResponse(variation));

    card.append(copy, add);
    list.appendChild(card);
  });

  el.jazzVariationPicker.appendChild(list);
  el.jazzVariationPicker.hidden = false;
}

function jazzifyChord() {
  const idx = state.pianoRoll.selectedChordIndex;
  if (idx === null) {
    el.pianoRollFeedback.textContent = "Sélectionne d'abord un accord du piano.";
    return;
  }
  const notes = state.pianoRoll.chords[idx];
  const detected = detectChordFromMidiNotes(notes);
  if (!detected || notes.length < 3) {
    el.pianoRollFeedback.textContent = "Ajoute au moins trois notes pour créer une variante cohérente.";
    return;
  }

  const sourceName = chordName(detected.root, detected.quality);
  const isMinor = ["min", "min7", "min7b5", "minMaj7"].includes(detected.quality);
  const fourthRoot = (detected.root + 5) % 12;
  const dominantRoot = (detected.root + 7) % 12;
  const suggestions = [
    {
      label: `${sourceName} enrichi`,
      description: "Même accord, avec 9e ou 13e pour plus de couleur.",
      notes: buildJazzVariation(notes, detected),
    },
    {
      label: chordName(fourthRoot, isMinor ? "min7" : "maj7"),
      description: "Réponse douce sur le quatrième degré.",
      notes: buildChordVoicing(fourthRoot, isMinor ? "min7" : "maj7"),
    },
    {
      label: chordName(dominantRoot, "dom7"),
      description: "Réponse tendue qui appelle un retour vers l'accord de départ.",
      notes: buildChordVoicing(dominantRoot, "dom7"),
    },
  ];

  state.pianoRoll.suggestions = suggestions;
  renderJazzSuggestions(suggestions, sourceName);
  playChordNotes(suggestions[0].notes);
  el.pianoRollFeedback.textContent = "Trois réponses trouvées : écoute-les puis ajoute celle que tu préfères.";
}

function sendChordToTrumpet() {
  const idx = state.pianoRoll.selectedChordIndex;
  if (idx === null) {
    el.pianoRollFeedback.textContent = "Sélectionne d'abord un accord du piano.";
    return;
  }
  const notes = state.pianoRoll.chords[idx];
  const detected = detectChordFromMidiNotes(notes);
  if (!detected || notes.length < 3) {
    el.pianoRollFeedback.textContent = "Ajoute au moins trois notes avant de demander une gamme trompette.";
    return;
  }

  state.scaleRoot = detected.root;
  state.scaleType = CHORD_TO_SCALES[detected.quality].outside;
  state.chordMode = "free";
  el.scaleRootSelect.value = String(detected.root);
  el.scaleTypeSelect.value = state.scaleType;
  el.chordModeBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.chordmode === "free"));
  el.scaleTypeLabel.hidden = false;
  el.chordQualityLabel.hidden = true;
  el.insideOutsideRow.hidden = true;
  setMode("improvisation");
  const scaleName = SCALE_DEFINITIONS[state.scaleType].label;
  el.pianoRollFeedback.textContent = `Trompette : ${trumpetPitchClassLabel(detected.root)} · gamme ${scaleName}, avec les doigtés.`;
  el.staff.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---------------------------------------------------------------------------
// Quiz ("auto-école") — plays a note from the current scale, gives a few
// seconds to reproduce it on the real trumpet. Auto-graded via the mic when
// available (reusing the same autoCorrelate pitch detector as the rest of
// the app); otherwise the user self-reports with a click.
// ---------------------------------------------------------------------------

const QUIZ_RESPONSE_MS = 5000;
const QUIZ_RING_CIRCUMFERENCE = 2 * Math.PI * 44;

const quizState = {
  active: false,
  pool: [],
  index: 0,
  correct: 0,
  missed: [],
  currentTarget: null,
  awaitingAnswer: false,
  micStream: null,
  micAnalyser: null,
  micBuffer: null,
  micUsable: false,
  timerStart: 0,
  timerHandle: null,
  micPollHandle: null,
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function startQuiz(poolOverride) {
  if (noteScanner.active) stopNoteScanner();
  let uniqueConcert;
  if (poolOverride) {
    uniqueConcert = [...new Set(poolOverride)];
  } else {
    const writtenMidis = buildScaleReference(state.scaleRoot, state.scaleType);
    uniqueConcert = [...new Set(writtenMidis.slice(0, -1).map((m) => m - 2))];
  }
  if (uniqueConcert.length < 2) return;

  quizState.active = true;
  quizState.pool = shuffle(uniqueConcert);
  quizState.index = 0;
  quizState.correct = 0;
  quizState.missed = [];

  el.startQuizBtn.hidden = true;
  el.quizArea.hidden = false;
  el.quizFeedback.textContent = "";
  el.quizFeedback.className = "quiz-feedback";

  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.audioContext.state === "suspended") state.audioContext.resume();

  quizState.micUsable = false;
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      quizState.micStream = stream;
      const source = state.audioContext.createMediaStreamSource(stream);
      const analyser = state.audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      quizState.micAnalyser = analyser;
      quizState.micBuffer = new Float32Array(analyser.fftSize);
      quizState.micUsable = true;
      el.quizMicHint.textContent = "🎤 Micro actif — détection automatique.";
    } catch (e) {
      quizState.micUsable = false;
      el.quizMicHint.textContent = "🎤 Micro indisponible — confirme toi-même avec les boutons.";
    }
  } else {
    el.quizMicHint.textContent = "🎤 Micro non supporté ici — confirme toi-même avec les boutons.";
  }

  el.quizManualButtons.hidden = false;

  nextQuizRound();
}

function stopQuiz(showSummary) {
  quizState.active = false;
  quizState.awaitingAnswer = false;
  if (quizState.timerHandle) {
    cancelAnimationFrame(quizState.timerHandle);
    quizState.timerHandle = null;
  }
  if (quizState.micPollHandle) {
    clearInterval(quizState.micPollHandle);
    quizState.micPollHandle = null;
  }
  if (quizState.micStream) {
    quizState.micStream.getTracks().forEach((t) => t.stop());
    quizState.micStream = null;
  }
  quizState.micAnalyser = null;

  el.startQuizBtn.hidden = false;
  el.quizManualButtons.hidden = true;
  if (!showSummary) {
    el.quizArea.hidden = true;
  }
}

function nextQuizRound() {
  if (!quizState.active) return;
  if (quizState.index >= quizState.pool.length) {
    finishQuiz();
    return;
  }

  quizState.currentTarget = quizState.pool[quizState.index];
  // Easy mode: show the fingering and note name up front instead of making
  // the player guess by ear first - the exercise is "can you play this
  // fingering", not "can you name this pitch blind".
  updatePistons(quizState.currentTarget);
  setTrumpetCurrentNote(quizState.currentTarget);
  el.quizProgress.textContent = `Note ${quizState.index + 1}/${quizState.pool.length}`;
  el.quizScore.textContent = `${quizState.correct}/${quizState.index}`;
  el.quizStatus.textContent = "Écoute…";
  el.quizFeedback.textContent = "";
  el.quizFeedback.className = "quiz-feedback";
  el.quizTimerLabel.textContent = "🎺";
  el.quizTimerCircle.style.stroke = "#ffb020";
  setQuizRing(1);

  playTone(quizState.currentTarget, 0.6);

  setTimeout(() => {
    if (!quizState.active) return;
    beginResponseWindow();
  }, 900);
}

function setQuizRing(fraction) {
  const offset = QUIZ_RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, fraction)));
  el.quizTimerCircle.style.strokeDashoffset = String(offset);
}

function beginResponseWindow() {
  quizState.awaitingAnswer = true;
  quizState.timerStart = performance.now();
  el.quizStatus.textContent = "À toi de jouer !";

  const tick = () => {
    if (!quizState.awaitingAnswer) return;
    const elapsed = performance.now() - quizState.timerStart;
    const remaining = Math.max(0, QUIZ_RESPONSE_MS - elapsed);
    setQuizRing(remaining / QUIZ_RESPONSE_MS);
    el.quizTimerLabel.textContent = String(Math.ceil(remaining / 1000));

    if (remaining <= 0) {
      resolveQuizRound(false);
      return;
    }
    quizState.timerHandle = requestAnimationFrame(tick);
  };
  quizState.timerHandle = requestAnimationFrame(tick);

  if (quizState.micUsable) {
    quizState.micPollHandle = setInterval(checkMicForTarget, 120);
  }
}

function checkMicForTarget() {
  if (!quizState.awaitingAnswer || !quizState.micAnalyser) return;
  quizState.micAnalyser.getFloatTimeDomainData(quizState.micBuffer);
  const freq = autoCorrelate(quizState.micBuffer, state.audioContext.sampleRate);
  if (freq <= 0) return;
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  if (midi === quizState.currentTarget) {
    resolveQuizRound(true);
  }
}

function resolveQuizRound(success) {
  if (!quizState.awaitingAnswer) return;
  quizState.awaitingAnswer = false;
  if (quizState.timerHandle) {
    cancelAnimationFrame(quizState.timerHandle);
    quizState.timerHandle = null;
  }
  if (quizState.micPollHandle) {
    clearInterval(quizState.micPollHandle);
    quizState.micPollHandle = null;
  }

  const target = quizState.currentTarget;
  updatePistons(target);
  setTrumpetCurrentNote(target);

  if (success) {
    quizState.correct++;
    el.quizFeedback.textContent = `✓ ${midiToTrumpetWrittenName(target)} !`;
    el.quizFeedback.className = "quiz-feedback correct";
    el.quizTimerCircle.style.stroke = "#4fd1c5";
  } else {
    quizState.missed.push(target);
    el.quizFeedback.textContent = `✗ C'était ${midiToTrumpetWrittenName(target)}`;
    el.quizFeedback.className = "quiz-feedback wrong";
    el.quizTimerCircle.style.stroke = "#ef5350";
  }
  el.quizStatus.textContent = "";
  setQuizRing(0);

  quizState.index++;
  el.quizScore.textContent = `${quizState.correct}/${quizState.index}`;

  setTimeout(() => {
    if (quizState.active) nextQuizRound();
  }, 1300);
}

function finishQuiz() {
  const total = quizState.pool.length;
  el.quizProgress.textContent = "Terminé";
  el.quizStatus.textContent = "";
  el.quizTimerLabel.textContent = "🏁";
  setQuizRing(0);

  if (quizState.missed.length) {
    const missedNames = [...new Set(quizState.missed.map((m) => midiToTrumpetWrittenName(m)))].join(", ");
    el.quizFeedback.textContent = `${quizState.correct}/${total} — à retravailler : ${missedNames}`;
    el.quizFeedback.className = "quiz-feedback wrong";
  } else {
    el.quizFeedback.textContent = `${quizState.correct}/${total} — parfait !`;
    el.quizFeedback.className = "quiz-feedback correct";
  }

  stopQuiz(true);
}

// Builds one ascending octave (root to octave, written pitch) of the chosen
// scale, starting near written C4 so it sits comfortably on the staff.
function buildScaleReference(concertRootPitchClass, scaleType) {
  const writtenPitchClass = ((concertRootPitchClass + 2) % 12 + 12) % 12;
  let base = 60;
  while (base % 12 !== writtenPitchClass) base++;
  base += state.octaveShift;

  const intervals = SCALE_DEFINITIONS[scaleType].intervals;
  const writtenMidis = intervals.map((iv) => base + iv);
  writtenMidis.push(base + 12);
  return writtenMidis;
}

function fingeringLabel(writtenMidi) {
  const idx = ((writtenMidi - 60) % 12 + 12) % 12;
  const valves = FINGERING_PATTERN[idx];
  return valves.length ? valves.join("") : "0";
}

function fingeringValves(writtenMidi) {
  const idx = ((writtenMidi - 60) % 12 + 12) % 12;
  return FINGERING_PATTERN[idx];
}

// One signature color per valve, reused consistently everywhere a fingering
// is shown (staff, chips, the physical piston caps) so the numbers read at
// a glance without needing to parse the digits.
const VALVE_COLORS = { 1: "#ef5350", 2: "#4fd1c5", 3: "#ffb020" };
const OPEN_FINGERING_COLOR = "#9aa1b2";

// HTML (colored <span> per digit) for use inside chip labels.
function coloredFingeringHTML(writtenMidi) {
  const valves = fingeringValves(writtenMidi);
  const values = valves.length ? valves : [0];
  return values.map((value) => {
    const color = value ? VALVE_COLORS[value] : OPEN_FINGERING_COLOR;
    return `<span class="fingering-color-dot" style="--fingering-color:${color}">${value}</span>`;
  }).join("");
}

// Draws the fingering digits directly onto an SVG as individual colored
// <text> elements (rather than one plain string) since VexFlow's Annotation
// can't color individual characters within a single text run.
function drawColoredFingering(svgRoot, x, y, writtenMidi, fontSize) {
  if (!svgRoot) return;
  const NS = "http://www.w3.org/2000/svg";
  const valves = fingeringValves(writtenMidi);
  const chars = valves.length ? valves.map(String) : ["0"];
  const colors = valves.length ? valves.map((v) => VALVE_COLORS[v]) : [OPEN_FINGERING_COLOR];
  const diameter = fontSize * 1.18;
  const gap = fontSize * 0.22;
  const totalWidth = chars.length * diameter + (chars.length - 1) * gap;
  const centerY = y - fontSize * 0.34;
  let cx = x - totalWidth / 2 + diameter / 2;

  chars.forEach((ch, i) => {
    const circle = document.createElementNS(NS, "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(centerY));
    circle.setAttribute("r", String(diameter / 2));
    circle.setAttribute("fill", colors[i]);
    circle.setAttribute("stroke", "rgba(255,255,255,.9)");
    circle.setAttribute("stroke-width", "1.3");
    svgRoot.appendChild(circle);

    const text = document.createElementNS(NS, "text");
    text.setAttribute("x", String(cx));
    text.setAttribute("y", String(centerY + fontSize * 0.31));
    text.setAttribute("font-family", "Arial, sans-serif");
    text.setAttribute("font-weight", "bold");
    text.setAttribute("font-size", String(fontSize * 0.72));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", ch === "0" ? "#ffffff" : "#17201d");
    text.textContent = ch;
    svgRoot.appendChild(text);
    cx += diameter + gap;
  });
}

// ---------------------------------------------------------------------------
// Notation rendering (VexFlow) — renders a small scrolling window of measures
// ---------------------------------------------------------------------------

function midiToVexKey(midi) {
  const names = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
  const octave = Math.floor(midi / 12) - 1;
  return `${names[((midi % 12) + 12) % 12]}/${octave}`;
}

const FRENCH_NOTE_NAMES = ["Do", "Do#", "Ré", "Mib", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "Sib", "Si"];
const INTERNATIONAL_NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

function midiToFrenchName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return `${FRENCH_NOTE_NAMES[((midi % 12) + 12) % 12]}${octave}`;
}

function midiToInternationalName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return `${INTERNATIONAL_NOTE_NAMES[((midi % 12) + 12) % 12]}${octave}`;
}

function midiToTrumpetWrittenName(concertMidi) {
  const writtenMidi = concertMidi + 2;
  return `${midiToFrenchName(writtenMidi)} / ${midiToInternationalName(writtenMidi)}`;
}

function midiToConcertDisplayName(concertMidi) {
  return `${midiToFrenchName(concertMidi)} / ${midiToInternationalName(concertMidi)} concert`;
}

function trumpetPitchClassLabel(concertPitchClass) {
  const writtenPitchClass = (concertPitchClass + 2) % 12;
  return `${FRENCH_NOTE_NAMES[writtenPitchClass]} / ${INTERNATIONAL_NOTE_NAMES[writtenPitchClass]} trompette · ${FRENCH_NOTE_NAMES[concertPitchClass]} / ${INTERNATIONAL_NOTE_NAMES[concertPitchClass]} concert`;
}

function formatTrumpetKey(concertPitchClass, mode) {
  const quality = mode === "minor" ? "mineur" : "majeur";
  return `${trumpetPitchClassLabel(concertPitchClass)} · ${quality}`;
}

function setTrumpetCurrentNote(concertMidi) {
  setCurrentNoteLabel(midiToTrumpetWrittenName(concertMidi));
}

// Mirrors the current note name next to the pistons too, so the fingering
// panel is readable on its own without scrolling back up to the staff header.
function setCurrentNoteLabel(text) {
  el.currentNoteLabel.textContent = text;
  el.pistonNoteLabel.textContent = text;
  window.dispatchEvent(new CustomEvent("trumpet:note", { detail: { label: text } }));
}

function findActiveEvent(measuresArr, currentTime, centerMeasureIdx) {
  if (centerMeasureIdx < 0) return null;
  const lo = Math.max(0, centerMeasureIdx - 1);
  const hi = Math.min(measuresArr.length - 1, centerMeasureIdx + 1);
  for (let mi = lo; mi <= hi; mi++) {
    for (const e of measuresArr[mi]) {
      if (e.type === "note" && currentTime >= e.startTime && currentTime < e.endTime) return e;
    }
  }
  return null;
}

function drawMeasureWindow(measuresArr, start, activeStartTime) {
  el.staff.classList.remove("staff-scrollable");

  const windowSize = 4;
  const measuresToRender = measuresArr.slice(start, start + windowSize);
  if (!measuresToRender.length) {
    el.staff.innerHTML = "";
    return;
  }

  el.staff.innerHTML = "";

  const VF = Vex.Flow;
  const measureWidth = 220;
  const totalWidth = measureWidth * measuresToRender.length + 40;
  const renderHeight = 160;

  const renderer = new VF.Renderer(el.staff, VF.Renderer.Backends.SVG);
  renderer.resize(totalWidth, renderHeight);
  const context = renderer.getContext();
  const svgRoot = el.staff.querySelector("svg");

  let x = 10;
  measuresToRender.forEach((measure, idx) => {
    const stave = new VF.Stave(x, 20, measureWidth);
    if (idx === 0) {
      stave.addClef("treble");
      if (start === 0) stave.addTimeSignature("4/4");
    }
    stave.setContext(context).draw();

    const vfNotes = measure.map((event) => {
      let note;
      if (event.type === "rest") {
        note = new VF.StaveNote({ keys: ["b/4"], duration: `${event.duration}r` });
      } else {
        // event.midi is concert pitch; the staff is written pitch, a major
        // second above concert for Bb trumpet - so the note POSITION here
        // must be transposed (+2) even though everything else (the sound via
        // playTone, the label via midiToFrenchName, fingering via
        // updatePistons) stays on the untransposed concert value. This is
        // what makes what's drawn on the staff match a real trumpet part:
        // the position you see is the position/fingering you'd read off
        // sheet music, not the pitch class you actually hear.
        const key = midiToVexKey(event.midi + 2);
        note = new VF.StaveNote({ keys: [key], duration: event.duration });
        if (key.includes("#")) note.addModifier(new VF.Accidental("#"));
        const isActive = event.startTime === activeStartTime;
        const isSelected = isManualEventSelected(event);
        note.setStyle({
          fillStyle: isActive ? "#e0781f" : isSelected ? "#0f9f91" : "#1a1a1a",
          strokeStyle: isActive ? "#e0781f" : isSelected ? "#0f9f91" : "#1a1a1a",
        });
      }
      return note;
    });

    if (vfNotes.length) {
      const voice = new VF.Voice({ num_beats: 4, beat_value: 4 }).setStrict(false);
      voice.addTickables(vfNotes);
      new VF.Formatter().joinVoices([voice]).format([voice], measureWidth - 20);
      voice.draw(context, stave);

      measure.forEach((event, i) => {
        if (event.type === "note") {
          // Fingering text first, click overlay last (on top in SVG paint
          // order) - so the invisible overlay still intercepts clicks that
          // land directly on the small fingering digits, not just the
          // notehead.
          drawColoredFingering(svgRoot, vfNotes[i].getAbsoluteX(), 120, event.midi + 2, 16);
          attachNoteClickOverlay(svgRoot, vfNotes[i].getAbsoluteX(), renderHeight, event.midi, 1, 0, () => handleStaffNoteClick(event));
        }
      });
    }

    x += measureWidth;
  });
}

// Renders every measure at once, wrapped across as many rows as needed to
// fit the container width, so the whole piece can be browsed (scrolled) up
// front instead of only revealing itself 4 measures at a time as playback
// advances. Used whenever nothing is actively playing - once playback
// starts, drawMeasureWindow's single-row auto-follow view takes back over
// so redraws stay cheap (a handful of measures instead of the whole piece)
// during the note-by-note updates.
function drawFullScore(measuresArr, activeStartTime) {
  el.staff.classList.add("staff-scrollable");

  if (!measuresArr.length) {
    el.staff.innerHTML = "";
    return;
  }

  el.staff.innerHTML = "";

  const VF = Vex.Flow;
  const measureWidth = 220;
  const rowHeight = 160;
  const containerWidth = Math.max(280, el.staff.clientWidth || 600);
  const measuresPerRow = Math.max(1, Math.floor((containerWidth - 40) / measureWidth));

  const rows = [];
  for (let i = 0; i < measuresArr.length; i += measuresPerRow) {
    rows.push(measuresArr.slice(i, i + measuresPerRow));
  }

  const totalWidth = measuresPerRow * measureWidth + 40;
  const totalHeight = rows.length * rowHeight;

  const renderer = new VF.Renderer(el.staff, VF.Renderer.Backends.SVG);
  renderer.resize(totalWidth, totalHeight);
  const context = renderer.getContext();
  const svgRoot = el.staff.querySelector("svg");

  let activeRowY = null;

  rows.forEach((rowMeasures, rowIdx) => {
    let x = 10;
    const y = 20 + rowIdx * rowHeight;
    rowMeasures.forEach((measure, idx) => {
      const stave = new VF.Stave(x, y, measureWidth);
      if (idx === 0) {
        stave.addClef("treble");
        if (rowIdx === 0) stave.addTimeSignature("4/4");
      }
      stave.setContext(context).draw();

      const vfNotes = measure.map((event) => {
        let note;
        if (event.type === "rest") {
          note = new VF.StaveNote({ keys: ["b/4"], duration: `${event.duration}r` });
        } else {
          // Written pitch (+2) for the staff position - see the comment in
          // drawMeasureWindow for why: matches a real trumpet part, so the
          // note's position on the staff lines up with its fingering.
          const key = midiToVexKey(event.midi + 2);
          note = new VF.StaveNote({ keys: [key], duration: event.duration });
          if (key.includes("#")) note.addModifier(new VF.Accidental("#"));
          const isActive = event.startTime === activeStartTime;
          const isSelected = isManualEventSelected(event);
          if (isActive) activeRowY = y;
          note.setStyle({
            fillStyle: isActive ? "#e0781f" : isSelected ? "#0f9f91" : "#1a1a1a",
            strokeStyle: isActive ? "#e0781f" : isSelected ? "#0f9f91" : "#1a1a1a",
          });
        }
        return note;
      });

      if (vfNotes.length) {
        const voice = new VF.Voice({ num_beats: 4, beat_value: 4 }).setStrict(false);
        voice.addTickables(vfNotes);
        new VF.Formatter().joinVoices([voice]).format([voice], measureWidth - 20);
        voice.draw(context, stave);

        measure.forEach((event, i) => {
          if (event.type === "note") {
            drawColoredFingering(svgRoot, vfNotes[i].getAbsoluteX(), y + 100, event.midi + 2, 16);
            attachNoteClickOverlay(svgRoot, vfNotes[i].getAbsoluteX(), rowHeight, event.midi, 1, y - 20, () => handleStaffNoteClick(event));
          }
        });
      }

      x += measureWidth;
    });
  });

  if (activeRowY !== null && el.staff.classList.contains("staff-scrollable")) {
    el.staff.scrollTo({ top: Math.max(0, activeRowY - 20), behavior: "smooth" });
  }
}

function refreshPlayhead(currentTime) {
  const measuresArr = state.mode === "manual" ? state.manualMeasures : state.measures;

  const centerMeasureIdx = measuresArr.findIndex(
    (m) => m.length && currentTime >= m[0].startTime && currentTime < m[m.length - 1].endTime
  );
  const activeEvent = findActiveEvent(measuresArr, currentTime, centerMeasureIdx);

  if (!state.isPlaying && !state.scoreLoopActive) {
    const renderKey = `${state.mode}|full|${activeEvent ? activeEvent.startTime : "none"}`;
    if (renderKey === state.lastRenderKey) return;
    state.lastRenderKey = renderKey;
    drawFullScore(measuresArr, activeEvent ? activeEvent.startTime : null);
    updatePistons(activeEvent ? activeEvent.midi : null);
    if (activeEvent) setTrumpetCurrentNote(activeEvent.midi);
    else setCurrentNoteLabel("--");
    return;
  }

  const windowStart = centerMeasureIdx >= 0 ? Math.max(0, centerMeasureIdx - 1) : Math.max(0, state.renderedMeasureWindowStart);

  const renderKey = `${state.mode}|${windowStart}|${activeEvent ? activeEvent.startTime : "none"}`;
  if (renderKey === state.lastRenderKey) return;
  state.lastRenderKey = renderKey;
  state.renderedMeasureWindowStart = windowStart;

  drawMeasureWindow(measuresArr, windowStart, activeEvent ? activeEvent.startTime : null);
  updatePistons(activeEvent ? activeEvent.midi : null);
  if (activeEvent) setTrumpetCurrentNote(activeEvent.midi);
  else setCurrentNoteLabel("--");
}

// ---------------------------------------------------------------------------
// Improvisation mode — static scale reference (not synced to playback)
// ---------------------------------------------------------------------------

// Wraps onto multiple staff lines instead of one long horizontally-scrolling
// row, sized to the container's actual width - so every note (including the
// last, octave-closing one) is visible at a glance without scrolling.
function renderScaleStaff(writtenMidis, activeWrittenMidi) {
  el.staff.innerHTML = "";
  const VF = Vex.Flow;
  const scale = isStandalonePWA ? 1.3 : 1;
  const perNoteWidth = 92;
  const rowMargin = 50;
  const rowHeight = 122; // extra room for the enlarged fingering digits below each note

  const containerWidth = Math.max(280, el.staff.clientWidth || 600);
  const availableLogical = containerWidth / scale;
  const notesPerRow = Math.max(
    3,
    Math.min(writtenMidis.length, Math.floor((availableLogical - rowMargin) / perNoteWidth))
  );

  const rows = [];
  for (let i = 0; i < writtenMidis.length; i += notesPerRow) {
    rows.push(writtenMidis.slice(i, i + notesPerRow));
  }

  const widestRow = Math.max(...rows.map((r) => r.length));
  const totalWidthLogical = Math.min(availableLogical, widestRow * perNoteWidth + rowMargin);
  const totalHeightLogical = rows.length * rowHeight + 30;

  const renderer = new VF.Renderer(el.staff, VF.Renderer.Backends.SVG);
  renderer.resize(totalWidthLogical * scale, totalHeightLogical * scale);
  const context = renderer.getContext();
  context.scale(scale, scale);
  const svgRoot = el.staff.querySelector("svg");

  const nameAnnotationSize = isStandalonePWA ? 13 : 11;
  const fingeringSize = isStandalonePWA ? 22 : 18;

  rows.forEach((rowMidis, rowIdx) => {
    const y = 20 + rowIdx * rowHeight;
    const staveWidth = Math.max(200, rowMidis.length * perNoteWidth + 20);
    const stave = new VF.Stave(10, y, staveWidth);
    if (rowIdx === 0) stave.addClef("treble");
    stave.setContext(context).draw();

    const vfNotes = rowMidis.map((midi) => {
      const key = midiToVexKey(midi);
      const note = new VF.StaveNote({ keys: [key], duration: "q" });
      if (key.includes("#")) note.addModifier(new VF.Accidental("#"));

      const nameAnnotation = new VF.Annotation(`${midiToFrenchName(midi)} / ${midiToInternationalName(midi)}`);
      nameAnnotation.setFont("Arial", nameAnnotationSize, "bold");
      if (VF.Annotation.VerticalJustify) {
        nameAnnotation.setVerticalJustification(VF.Annotation.VerticalJustify.TOP);
      }
      note.addModifier(nameAnnotation);

      const isActive = midi === activeWrittenMidi;
      note.setStyle({
        fillStyle: isActive ? "#e0781f" : "#1a1a1a",
        strokeStyle: isActive ? "#e0781f" : "#1a1a1a",
      });
      return note;
    });

    const voice = new VF.Voice({ num_beats: vfNotes.length, beat_value: 4 }).setStrict(false);
    voice.addTickables(vfNotes);
    new VF.Formatter().joinVoices([voice]).format([voice], staveWidth - 20);
    voice.draw(context, stave);

    rowMidis.forEach((midi, i) => {
      const noteX = vfNotes[i].getAbsoluteX();
      drawColoredFingering(svgRoot, noteX * scale, (y + 108) * scale, midi, fingeringSize * scale);
      attachNoteClickOverlay(svgRoot, noteX * scale, rowHeight * scale, midi - 2, scale, y * scale - 15 * scale, () => selectScaleNote(midi));
    });
  });
}

function renderDegreeChips(writtenMidis) {
  const container = el.degreeChips;
  container.innerHTML = "";

  // Every note gets a chip, including the closing octave (e.g. Do5) - it's
  // the same pitch class as the root but a distinct, playable note.
  writtenMidis.forEach((writtenMidi) => {
    const concertMidi = writtenMidi - 2;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "degree-chip";
    chip.dataset.concertMidi = String(concertMidi);
    chip.innerHTML = `<span>${midiToFrenchName(writtenMidi)}</span><span class="chip-international">${midiToInternationalName(writtenMidi)}</span><span class="chip-concert">${midiToConcertDisplayName(concertMidi)}</span><span class="chip-fingering">${coloredFingeringHTML(writtenMidi)}</span>`;
    chip.addEventListener("click", () => selectScaleNote(writtenMidi));
    container.appendChild(chip);
  });
}

function renderScaleReference() {
  const writtenMidis = buildScaleReference(state.scaleRoot, state.scaleType);
  renderScaleStaff(writtenMidis);
  renderDegreeChips(writtenMidis);
  updateFavoriteButtonState();
}

// ---------------------------------------------------------------------------
// Chord-based scale lookup — pick a chord, get an "inside" scale that
// matches it and an "outside" jazz substitute for a different color.
// ---------------------------------------------------------------------------

function populateChordQualitySelect() {
  el.chordQualitySelect.innerHTML = "";
  Object.entries(CHORD_TO_SCALES).forEach(([key, def]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = def.label;
    el.chordQualitySelect.appendChild(opt);
  });
}

function applyChordSelection() {
  const chordDef = CHORD_TO_SCALES[state.chordQuality];
  state.scaleType = chordDef[state.chordSide];

  const rootName = trumpetPitchClassLabel(state.scaleRoot);
  const scaleLabel = SCALE_DEFINITIONS[state.scaleType].label;
  const sideLabel = state.chordSide === "inside" ? "dedans" : "dehors";
  el.chordScaleExplain.textContent = `${rootName} · accord ${chordDef.label} → ${scaleLabel} (${sideLabel})`;

  renderScaleReference();
  if (state.scoreLoopActive) startScorePlayback();
}

function setChordMode(mode) {
  state.chordMode = mode;
  el.chordModeBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.chordmode === mode));
  el.scaleTypeLabel.hidden = mode === "chord";
  el.chordQualityLabel.hidden = mode !== "chord";
  el.insideOutsideRow.hidden = mode !== "chord";

  if (mode === "chord") {
    applyChordSelection();
  } else {
    state.scaleType = el.scaleTypeSelect.value;
    renderScaleReference();
    if (state.scoreLoopActive) startScorePlayback();
  }
}

// Shared by both the degree chips and clicking directly on a staff note:
// plays the note, highlights it in orange on the staff, syncs the matching
// chip's active state, and scrolls the staff into view.
function selectScaleNote(writtenMidi) {
  const concertMidi = writtenMidi - 2;
  playTone(concertMidi);
  updatePistons(concertMidi);
  setTrumpetCurrentNote(concertMidi);

  const writtenMidis = buildScaleReference(state.scaleRoot, state.scaleType);
  renderScaleStaff(writtenMidis, writtenMidi);

  Array.from(el.degreeChips.children).forEach((chip) => {
    chip.classList.toggle("active", Number(chip.dataset.concertMidi) === concertMidi);
  });

  el.staff.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---------------------------------------------------------------------------
// Favorite scales — a quick-access bookmark list, independent of any loaded
// audio file, so "Blues in Bb" etc. can be found again in one tap.
// ---------------------------------------------------------------------------

function getFavoriteScales() {
  try {
    const raw = localStorage.getItem(FAVORITE_SCALES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function setFavoriteScalesList(list) {
  try {
    localStorage.setItem(FAVORITE_SCALES_STORAGE_KEY, JSON.stringify(list));
  } catch (e) { /* storage full or unavailable - fail silently */ }
}

function isFavoriteScale(root, scaleType) {
  return getFavoriteScales().some((f) => f.root === root && f.scaleType === scaleType);
}

function toggleFavoriteScale() {
  const root = state.scaleRoot;
  const scaleType = state.scaleType;
  const favorites = getFavoriteScales();
  const idx = favorites.findIndex((f) => f.root === root && f.scaleType === scaleType);

  if (idx >= 0) {
    favorites.splice(idx, 1);
  } else {
    favorites.push({ root, scaleType });
  }

  setFavoriteScalesList(favorites);
  updateFavoriteButtonState();
  renderFavoriteScalesList();
}

function updateFavoriteButtonState() {
  const active = isFavoriteScale(state.scaleRoot, state.scaleType);
  el.toggleFavoriteScaleBtn.classList.toggle("active", active);
  el.toggleFavoriteScaleBtn.textContent = active ? "★ Favori" : "☆ Favori";
}

function favoriteScaleLabel(entry) {
  const scaleLabel = SCALE_DEFINITIONS[entry.scaleType] ? SCALE_DEFINITIONS[entry.scaleType].label : entry.scaleType;
  return `${scaleLabel} · ${trumpetPitchClassLabel(entry.root)}`;
}

function renderFavoriteScalesList() {
  const favorites = getFavoriteScales();
  el.favoriteScalesList.innerHTML = "";

  if (!favorites.length) {
    const empty = document.createElement("span");
    empty.className = "favorite-scales-empty";
    empty.textContent = "Aucune pour l'instant — clique ☆ Favori pour en ajouter.";
    el.favoriteScalesList.appendChild(empty);
    return;
  }

  favorites.forEach((entry) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "favorite-chip";
    chip.innerHTML = `${favoriteScaleLabel(entry)} <span class="remove-favorite" title="Retirer">✕</span>`;

    chip.addEventListener("click", (e) => {
      if (e.target.classList.contains("remove-favorite")) {
        setFavoriteScalesList(getFavoriteScales().filter((f) => !(f.root === entry.root && f.scaleType === entry.scaleType)));
        renderFavoriteScalesList();
        updateFavoriteButtonState();
        return;
      }
      state.scaleRoot = entry.root;
      state.scaleType = entry.scaleType;
      el.scaleRootSelect.value = String(entry.root);
      el.scaleTypeSelect.value = entry.scaleType;
      renderScaleReference();
    });

    el.favoriteScalesList.appendChild(chip);
  });
}

// ---------------------------------------------------------------------------
// Manual mode — blank staff, user places notes at the current playback time
// ---------------------------------------------------------------------------

// Preview a note AND jump the score to where it's actually used - for the
// read-only "notes du morceau" palette, where there's nothing to place/edit,
// just a piece to learn. Highlights the first occurrence and scrolls the
// (internally-scrollable) full-score view to it.
function locateNoteInScore(concertMidi) {
  updatePistons(concertMidi);
  setTrumpetCurrentNote(concertMidi);
  playTone(concertMidi);

  const measuresArr = state.mode === "manual" ? state.manualMeasures : state.measures;
  for (const measure of measuresArr) {
    const found = measure.find((e) => e.type === "note" && e.midi === concertMidi);
    if (found) {
      state.lastRenderKey = null;
      drawFullScore(measuresArr, found.startTime);
      return;
    }
  }
}

function buildPitchPalette() {
  const container = el.pitchPalette;
  container.innerHTML = "";

  // Editing a real transcription (audioBuffer loaded): keep the full
  // chromatic range so any pitch can be placed/corrected. A read-only
  // catalog track (no audioBuffer - clicks only preview, they never edit
  // state.manualNotes) instead gets narrowed to just the notes actually in
  // the piece, sorted low to high - shorter and relevant to what's playing,
  // instead of an unrelated full 3-octave chromatic run - and framed as a
  // "notes du morceau" reference with its own quiz entry point, since there's
  // nothing to place/edit here.
  const readOnly = !state.audioBuffer && state.manualNotes.length > 0 && !state.manualCaptureMode;
  let concertMidis;
  if (readOnly) {
    concertMidis = [...new Set(state.manualNotes.map((n) => n.midi))].sort((a, b) => a - b);
  } else {
    concertMidis = [];
    for (let m = 50; m <= 86; m++) concertMidis.push(m);
  }

  el.songNotesHeader.hidden = !readOnly;

  concertMidis.forEach((concertMidi) => {
    const writtenMidi = concertMidi + 2;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "degree-chip";
    chip.innerHTML = `<span>${midiToFrenchName(writtenMidi)}</span><span class="chip-international">${midiToInternationalName(writtenMidi)}</span><span class="chip-concert">${midiToConcertDisplayName(concertMidi)}</span><span class="chip-fingering">${coloredFingeringHTML(writtenMidi)}</span>`;
    chip.addEventListener("click", () => {
      if (readOnly) {
        locateNoteInScore(concertMidi);
      } else {
        placeManualNote(concertMidi);
      }
    });
    container.appendChild(chip);
  });
}

function buildManualMeasuresFor(notes, bpm, totalDuration) {
  const noteDuration = 60 / bpm / 2; // eighth note, fixed
  const segments = notes.map((n) => ({
    startTime: n.time,
    endTime: Math.min(n.time + noteDuration, totalDuration),
    midi: n.midi,
  }));
  const events = buildNoteEvents(segments, totalDuration, bpm);
  return groupIntoMeasures(events);
}

function rebuildManualMeasures() {
  state.manualMeasures = buildManualMeasuresFor(state.manualNotes, state.bpm, state.duration);
}

function placeManualNote(concertMidi) {
  // Always preview - sound + piston - regardless of whether a real audio
  // file is loaded, so palette chips work the same way the scale library's
  // chips do. Only actually edit the transcription (place/overwrite a note
  // at the current playback time) when there's a real, scrubbable audio
  // file behind it; a track loaded from the Training catalog has no such
  // timeline to anchor placement to, and shouldn't get silently mutated by
  // someone just clicking around to check fingerings.
  updatePistons(concertMidi);
  setTrumpetCurrentNote(concertMidi);
  playTone(concertMidi);

  if (!state.audioBuffer && !state.manualCaptureMode) return;

  if (!state.audioBuffer && state.manualCaptureMode) {
    const beatDuration = 60 / state.bpm;
    const last = state.manualNotes[state.manualNotes.length - 1];
    const time = last ? last.time + beatDuration : 0;
    state.duration = Math.max(state.duration, time + beatDuration);
    state.manualNotes.push({ time, midi: concertMidi });
    rebuildManualMeasures();
    drawFullScore(state.manualMeasures, null);
    return;
  }

  const fraction = Number(el.snapGridSelect.value);
  const time = Math.max(0, Math.min(snapTime(currentPlaybackPosition(), state.bpm, fraction), state.duration));

  const existing = state.manualNotes.find((n) => Math.abs(n.time - time) < 1e-6);
  if (existing) {
    existing.midi = concertMidi;
  } else {
    state.manualNotes.push({ time, midi: concertMidi });
    state.manualNotes.sort((a, b) => a.time - b.time);
  }

  rebuildManualMeasures();

  if (state.mode === "manual") {
    state.lastRenderKey = null;
    updatePlayheadUI(currentPlaybackPosition());
    updateSongKeyPanel();
  }
}

// ---------------------------------------------------------------------------
// File-dependent controls — everything that needs an actual loaded recording
// (playback, looper, transcription, manual notes synced to it). The scale
// library works without any of this.
// ---------------------------------------------------------------------------

function setFileControlsEnabled(enabled) {
  el.playBtn.disabled = !enabled;
  el.stopBtn.disabled = !enabled;
  el.seekBar.disabled = !enabled;
  el.setLoopABtn.disabled = !enabled;
  el.setLoopBBtn.disabled = !enabled;
  el.clearLoopBtn.disabled = !enabled;
  el.loopEnabledCheckbox.disabled = !enabled;
  el.modeBtns.forEach((btn) => {
    if (btn.dataset.mode === "transcription" || btn.dataset.mode === "manual") {
      btn.disabled = !enabled;
    }
  });
  el.noFileHint.hidden = enabled;
}

// ---------------------------------------------------------------------------
// Song key panel — detects the key of whatever's loaded (transcription or
// manual/catalog track) so the player can jump straight into an interro on
// the theoretical scale that matches it, without hunting for it themselves.
// ---------------------------------------------------------------------------

function updateSongKeyPanel() {
  const notes = state.mode === "manual" ? state.manualNotes : state.noteEvents.filter((e) => e.type === "note");
  if (notes.length < 3) {
    el.songKeyPanel.hidden = true;
    return;
  }

  const key = detectKeyFromNotes(notes);
  state.songScaleRoot = key.root;
  state.songScaleType = key.mode === "minor" ? "naturalMinor" : "major";

  const modeLabel = key.mode === "minor" ? "mineur" : "majeur";
  el.songKeyLabel.textContent = `${trumpetPitchClassLabel(key.root)} · ${modeLabel}`;
  el.songKeyPanel.hidden = false;
}

// ---------------------------------------------------------------------------
// Octave shift — for players who can't yet reach a piece's written register,
// or who want to check what a note would look/sound like an octave up (e.g.
// to place a high ending note the transcription is missing). Transposes the
// loaded transcription itself (in full octaves, so pitch class - and
// therefore fingering - is unaffected) rather than threading an offset
// through every render/playback call site: staff, palette, song-key
// detection and the score-loop synth all just read state.manualNotes /
// state.noteEvents as-is, so shifting the data once is enough. Resets on
// every fresh load (loadFile / loadTrackFromQueryParam) rather than
// persisting across pieces, to avoid double-shifting bugs.
// ---------------------------------------------------------------------------

const OCTAVE_SHIFT_MIN = -24; // 2 octaves down
const OCTAVE_SHIFT_MAX = 24;  // 2 octaves up

function setOctaveShift(target) {
  target = Math.max(OCTAVE_SHIFT_MIN, Math.min(OCTAVE_SHIFT_MAX, target));
  const delta = target - state.octaveShift;
  state.octaveShift = target;

  const steps = target / 12;
  el.octaveShiftLabel.textContent = steps === 0 ? "Octave normale" : `${steps > 0 ? "+" : ""}${steps} octave${Math.abs(steps) > 1 ? "s" : ""}`;
  el.octaveDownBtn.disabled = target <= OCTAVE_SHIFT_MIN;
  el.octaveUpBtn.disabled = target >= OCTAVE_SHIFT_MAX;

  if (delta === 0) return;

  state.manualNotes.forEach((n) => { n.midi += delta; });
  state.noteEvents.forEach((e) => { if (e.type === "note") e.midi += delta; });
  if (state.measures.length) state.measures = groupIntoMeasures(state.noteEvents);
  rebuildManualMeasures();

  state.lastRenderKey = null;
  if (state.mode === "manual") {
    drawFullScore(state.manualMeasures, null);
    buildPitchPalette();
    updateSongKeyPanel();
  } else if (state.mode === "transcription") {
    drawFullScore(state.measures, null);
  } else {
    renderScaleReference();
  }
}

// ---------------------------------------------------------------------------
// Mode switching
// ---------------------------------------------------------------------------

function setMode(mode) {
  stopScorePlayback();
  if (quizState.active) stopQuiz(false);
  state.mode = mode;
  state.deleteNoteMode = false;
  el.deleteNoteModeBtn.classList.remove("btn-danger-active");
  el.deleteNoteModeBtn.textContent = "🗑️ Supprimer une note";
  el.modeBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
  el.improvisationControls.hidden = mode !== "improvisation" || !state.scaleOptionsOpen;
  el.manualControls.hidden = mode !== "manual";
  el.transcriptionTools.hidden = mode !== "transcription";
  el.degreeChips.hidden = mode !== "improvisation";
  el.pitchPalette.hidden = mode !== "manual";

  state.lastRenderKey = null;
  state.renderedMeasureWindowStart = -1;

  if (mode === "improvisation") {
    renderScaleReference();
    setCurrentNoteLabel("--");
    el.songKeyPanel.hidden = true;
  } else if (mode === "manual") {
    drawFullScore(state.manualMeasures, null);
    updateSongKeyPanel();
    buildPitchPalette();
  } else {
    drawFullScore(state.measures, null);
    updateSongKeyPanel();
  }
}

// ---------------------------------------------------------------------------
// Piston simulator — standard Bb trumpet fingering chart (written pitch)
// ---------------------------------------------------------------------------

// Index = (writtenMidi - 60) mod 12, relative to C. Values = pressed valves.
const FINGERING_PATTERN = {
  0: [],        // C  - open
  1: [1, 2, 3], // C#
  2: [1, 3],    // D
  3: [2, 3],    // D#/Eb
  4: [1, 2],    // E
  5: [1],       // F
  6: [2],       // F#
  7: [],        // G  - open
  8: [2, 3],    // G#/Ab
  9: [1, 2],    // A
  10: [1],      // A#/Bb
  11: [2],      // B
};

function updatePistons(concertMidi) {
  const valves = { 1: false, 2: false, 3: false };
  if (concertMidi !== null && concertMidi !== undefined) {
    const writtenMidi = concertMidi + 2; // Bb trumpet: written a major 2nd above concert pitch
    const idx = ((writtenMidi - 60) % 12 + 12) % 12;
    for (const v of FINGERING_PATTERN[idx]) valves[v] = true;
  }
  el.valve1.classList.toggle("pressed", valves[1]);
  el.valve2.classList.toggle("pressed", valves[2]);
  el.valve3.classList.toggle("pressed", valves[3]);
  window.dispatchEvent(new CustomEvent("trumpet:valves", { detail: { valves } }));
}

// ---------------------------------------------------------------------------
// Note preview audio — short synthesized tone so a clicked note can be heard
// ---------------------------------------------------------------------------

function playTone(concertMidi, duration = 0.45) {
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  const ctx = state.audioContext;
  if (ctx.state === "suspended") ctx.resume();

  if (state.soundEngine === "sample") {
    playTrumpetSample(concertMidi, duration, ctx);
    return;
  }

  const freq = 440 * Math.pow(2, (concertMidi - 69) / 12);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = freq;

  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.25, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.05);
}

async function playTrumpetSample(concertMidi, duration, ctx) {
  const [baseMidi, file] = TRUMPET_SAMPLES.reduce((best, item) =>
    Math.abs(item[0] - concertMidi) < Math.abs(best[0] - concertMidi) ? item : best
  );
  try {
    let buffer = trumpetSampleBuffers.get(file);
    if (!buffer) {
      const response = await fetch(`assets/trumpet-samples/${file}`);
      if (!response.ok) throw new Error("sample unavailable");
      buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      trumpetSampleBuffers.set(file, buffer);
    }
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    source.buffer = buffer;
    source.playbackRate.value = Math.pow(2, (concertMidi - baseMidi) / 12);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.linearRampToValueAtTime(.72, now + .018);
    gain.gain.setValueAtTime(.72, now + Math.max(.04, duration - .08));
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    source.connect(gain).connect(ctx.destination);
    source.start(now);
    source.stop(now + duration + .08);
  } catch (_error) {
    const previous = state.soundEngine;
    state.soundEngine = "synth";
    playTone(concertMidi, duration);
    state.soundEngine = previous;
  }
}

// Adds an invisible clickable column over a rendered VexFlow note so clicking
// anywhere on the staff (not just the chip palettes) plays + shows fingering.
function attachNoteClickOverlay(svgRoot, noteX, height, concertMidi, scale = 1, yOffset = 0, onClick = null) {
  if (!svgRoot) return;
  const NS = "http://www.w3.org/2000/svg";
  const halfWidth = 22 * scale; // wide enough to be a comfortable touch target
  const rect = document.createElementNS(NS, "rect");
  rect.setAttribute("x", String(noteX - halfWidth));
  rect.setAttribute("y", String(yOffset));
  rect.setAttribute("width", String(halfWidth * 2));
  rect.setAttribute("height", String(height));
  // fill:transparent can leave a visible edge in some renderers - fill:none
  // + pointer-events:all is invisible everywhere while staying clickable.
  rect.setAttribute("fill", "none");
  rect.setAttribute("stroke", "none");
  rect.setAttribute("pointer-events", "all");
  rect.style.cursor = "pointer";
  rect.style.touchAction = "manipulation";
  rect.addEventListener("click", () => {
    if (onClick) {
      onClick();
      return;
    }
    playTone(concertMidi);
    updatePistons(concertMidi);
    setTrumpetCurrentNote(concertMidi);
  });
  svgRoot.appendChild(rect);
}

// Shared click handler for notes drawn on the manual/transcription staff
// (drawFullScore, drawMeasureWindow): normally just previews the note, but
// switches to deleting it when "Supprimer une note" mode is on - lets stray/
// wrong notes (e.g. from an imperfect MIDI import) be pruned by clicking
// them directly on the score, without turning every ordinary click into an
// accidental deletion.
function handleStaffNoteClick(event) {
  if (state.deleteNoteMode && state.mode === "manual") {
    deleteManualNoteAt(event);
    return;
  }
  if (state.mode === "manual") {
    state.selectedManualNoteIndex = findManualNoteIndex(event);
    drawFullScore(state.manualMeasures, null);
    setStatus("Note sélectionnée — Suppr pour effacer, ↑/↓ pour modifier.");
  }
  playTone(event.midi);
  updatePistons(event.midi);
  setTrumpetCurrentNote(event.midi);
}

function findManualNoteIndex(event) {
  let idx = -1;
  let bestDiff = Infinity;
  state.manualNotes.forEach((note, i) => {
    if (note.midi !== event.midi) return;
    const diff = Math.abs(note.time - event.startTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      idx = i;
    }
  });
  return idx;
}

function isManualEventSelected(event) {
  if (state.mode !== "manual" || state.selectedManualNoteIndex === null) return false;
  return findManualNoteIndex(event) === state.selectedManualNoteIndex;
}

function deleteSelectedManualNote() {
  const idx = state.selectedManualNoteIndex;
  if (state.mode !== "manual" || idx === null || !state.manualNotes[idx]) return false;
  state.manualNotes.splice(idx, 1);
  state.selectedManualNoteIndex = null;
  rebuildManualMeasures();
  updateSongKeyPanel();
  buildPitchPalette();
  drawFullScore(state.manualMeasures, null);
  setStatus("Note supprimée.");
  return true;
}

function alterSelectedManualNote(semitones) {
  const idx = state.selectedManualNoteIndex;
  if (state.mode !== "manual" || idx === null || !state.manualNotes[idx]) return false;
  state.manualNotes[idx].midi = Math.max(36, Math.min(96, state.manualNotes[idx].midi + semitones));
  rebuildManualMeasures();
  updateSongKeyPanel();
  buildPitchPalette();
  drawFullScore(state.manualMeasures, null);
  playTone(state.manualNotes[idx].midi);
  updatePistons(state.manualNotes[idx].midi);
  setStatus(semitones > 0 ? "Note montée d’un demi-ton." : "Note descendue d’un demi-ton.");
  return true;
}

function deleteManualNoteAt(event) {
  // event.startTime is the QUANTIZED time (rounded to the nearest 16th note
  // by buildNoteEvents), not the note's original stored time - so match by
  // nearest same-pitch note instead of exact equality, which would miss due
  // to that rounding drift.
  let idx = -1;
  let bestDiff = Infinity;
  state.manualNotes.forEach((n, i) => {
    if (n.midi !== event.midi) return;
    const diff = Math.abs(n.time - event.startTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      idx = i;
    }
  });
  if (idx === -1) return;
  state.manualNotes.splice(idx, 1);
  state.selectedManualNoteIndex = null;
  rebuildManualMeasures();
  updateSongKeyPanel();
  buildPitchPalette();
  state.lastRenderKey = null;
  drawFullScore(state.manualMeasures, null);
  setStatus("Note supprimée.");
  setTimeout(() => setStatus(""), 1500);
}

// ---------------------------------------------------------------------------
// Score playback — synthesizes and loops whatever notation is on screen
// (the current mode's notes), independent of the original recording.
// ---------------------------------------------------------------------------

function flattenMeasures(measuresArr) {
  const events = [];
  let totalDuration = 0;
  for (const measure of measuresArr) {
    for (const e of measure) {
      if (e.type === "note") events.push({ startTime: e.startTime, endTime: e.endTime, midi: e.midi });
      totalDuration = Math.max(totalDuration, e.endTime);
    }
  }
  return { events, totalDuration };
}

function buildScaleLoopEvents() {
  const writtenMidis = buildScaleReference(state.scaleRoot, state.scaleType);
  const beat = 60 / state.bpm;
  const sequence = writtenMidis.concat(writtenMidis.slice(0, -1).reverse());
  const events = sequence.map((midi, i) => ({
    startTime: i * beat,
    endTime: (i + 0.9) * beat,
    midi: midi - 2,
  }));
  return { events, totalDuration: sequence.length * beat };
}

function getCurrentModeEvents() {
  if (state.mode === "manual") return flattenMeasures(state.manualMeasures);
  if (state.mode === "improvisation") return buildScaleLoopEvents();
  return flattenMeasures(state.measures);
}

function openKaraoke(eventsData, title = "Partition en cours") {
  if (document.body.classList.contains("karaoke-transitioning")) return;
  const events = eventsData.events
    .filter((event) => Number.isFinite(event.midi))
    .map((event) => ({
      startTime: event.startTime,
      endTime: Math.max(event.endTime, event.startTime + 0.08),
      midi: event.midi,
    }));
  if (!events.length) {
    setStatus("Ajoute des notes avant d'ouvrir le mode karaoké.", true);
    setTimeout(() => setStatus(""), 2600);
    return;
  }
  sessionStorage.setItem("trumpetKaraokeSession", JSON.stringify({
    title,
    bpm: state.bpm,
    events,
    totalDuration: Math.max(eventsData.totalDuration, ...events.map((event) => event.endTime)),
  }));
  document.body.classList.add("karaoke-transitioning");
  window.setTimeout(() => { window.location.href = "karaoke.html"; }, 420);
}

// Routed through a single persistent gain node (rather than baking mute
// state into each note at schedule time) so muting takes effect instantly,
// including for notes already scheduled ahead by the lookahead scheduler.
function getScoreMasterGain() {
  if (!state.scoreMasterGain) {
    state.scoreMasterGain = state.audioContext.createGain();
    state.scoreMasterGain.gain.value = state.scoreMuted ? 0 : 1;
    state.scoreMasterGain.connect(state.audioContext.destination);
  }
  return state.scoreMasterGain;
}

function setScoreMuted(muted) {
  state.scoreMuted = muted;
  if (state.scoreMasterGain) {
    state.scoreMasterGain.gain.setTargetAtTime(muted ? 0 : 1, state.audioContext.currentTime, 0.01);
  }
}

function scheduleTone(concertMidi, when, duration) {
  const ctx = state.audioContext;
  const freq = 440 * Math.pow(2, (concertMidi - 69) / 12);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = freq;

  const attack = 0.01;
  const release = Math.min(0.08, duration * 0.3);
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(0.22, when + attack);
  gain.gain.setValueAtTime(0.22, Math.max(when + attack, when + duration - release));
  gain.gain.linearRampToValueAtTime(0.0001, when + duration);

  osc.connect(gain);
  gain.connect(getScoreMasterGain());
  osc.start(when);
  osc.stop(when + duration + 0.02);

  state.scheduledOscillators.push(osc);
  osc.onended = () => {
    const i = state.scheduledOscillators.indexOf(osc);
    if (i >= 0) state.scheduledOscillators.splice(i, 1);
  };
}

const SCORE_LOOKAHEAD_SECONDS = 2;

function startScorePlayback() {
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.audioContext.state === "suspended") state.audioContext.resume();
  stopScorePlayback();

  const { events, totalDuration } = getCurrentModeEvents();
  if (!events.length || totalDuration <= 0) return;

  state.scoreLoopActive = true;
  state.scoreLoopEvents = events;
  state.scoreLoopDuration = totalDuration;
  state.scoreLoopLastKey = null;
  const loopOrigin = state.audioContext.currentTime + 0.1;
  state.scoreLoopStartTime = loopOrigin;
  let nextLoopStart = loopOrigin;

  function scheduleLoopPass() {
    const passStart = nextLoopStart;
    for (const e of events) {
      scheduleTone(e.midi, passStart + e.startTime, e.endTime - e.startTime);
    }
    nextLoopStart += totalDuration;
  }

  scheduleLoopPass();
  state.scoreLoopTimer = setInterval(() => {
    if (!state.scoreLoopActive) return;
    while (nextLoopStart < state.audioContext.currentTime + SCORE_LOOKAHEAD_SECONDS) {
      scheduleLoopPass();
    }
  }, 200);

  el.playScoreBtn.hidden = true;
  el.stopScoreBtn.hidden = false;
  scoreLoopVisualTick();
}

function stopScorePlayback() {
  const wasActive = state.scoreLoopActive;
  state.scoreLoopActive = false;
  if (state.scoreLoopTimer) {
    clearInterval(state.scoreLoopTimer);
    state.scoreLoopTimer = null;
  }
  if (state.scoreLoopRafHandle) {
    cancelAnimationFrame(state.scoreLoopRafHandle);
    state.scoreLoopRafHandle = null;
  }
  if (state.audioContext) {
    for (const osc of state.scheduledOscillators.slice()) {
      try {
        osc.stop(state.audioContext.currentTime);
      } catch (e) { /* already stopped */ }
    }
  }
  state.scheduledOscillators = [];
  el.playScoreBtn.hidden = false;
  el.stopScoreBtn.hidden = true;

  if (wasActive) {
    updatePistons(null);
    setCurrentNoteLabel("--");
    Array.from(el.degreeChips.children).forEach((c) => c.classList.remove("active"));

    state.lastRenderKey = null;
    if (state.mode === "improvisation") {
      renderScaleReference();
    } else {
      const measuresArr = state.mode === "manual" ? state.manualMeasures : state.measures;
      drawFullScore(measuresArr, null);
    }
  }
}

// Drives piston / staff-highlight / note-label updates while the score loop
// plays, since the scheduled oscillators carry no timing info of their own
// back to the UI. Redraws only when the active note actually changes.
function scoreLoopVisualTick() {
  if (!state.scoreLoopActive) return;

  const elapsed = state.audioContext.currentTime - state.scoreLoopStartTime;
  const posInLoop = ((elapsed % state.scoreLoopDuration) + state.scoreLoopDuration) % state.scoreLoopDuration;

  if (state.mode === "improvisation") {
    updateImprovisationHighlight(posInLoop);
  } else {
    refreshPlayhead(posInLoop);
  }

  state.scoreLoopRafHandle = requestAnimationFrame(scoreLoopVisualTick);
}

function updateImprovisationHighlight(posInLoop) {
  let active = null;
  for (const e of state.scoreLoopEvents) {
    if (posInLoop >= e.startTime && posInLoop < e.endTime) {
      active = e;
      break;
    }
  }

  const key = active ? `${active.startTime}` : "none";
  if (key === state.scoreLoopLastKey) return;
  state.scoreLoopLastKey = key;

  updatePistons(active ? active.midi : null);
  if (active) setTrumpetCurrentNote(active.midi);
  else setCurrentNoteLabel("--");

  const writtenMidis = buildScaleReference(state.scaleRoot, state.scaleType);
  renderScaleStaff(writtenMidis, active ? active.midi + 2 : null);

  Array.from(el.degreeChips.children).forEach((chip) => {
    chip.classList.toggle("active", active !== null && Number(chip.dataset.concertMidi) === active.midi);
  });
}

// ---------------------------------------------------------------------------
// Metronome — click track only, independent of any melody/notation
// ---------------------------------------------------------------------------

const METRONOME_LOOKAHEAD_SECONDS = 2;

function scheduleClick(when, accented) {
  const ctx = state.audioContext;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = accented ? 1600 : 1000;

  gain.gain.setValueAtTime(0.001, when);
  gain.gain.linearRampToValueAtTime(accented ? 0.35 : 0.22, when + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.05);

  state.metronomeOscillators.push(osc);
  osc.onended = () => {
    const i = state.metronomeOscillators.indexOf(osc);
    if (i >= 0) state.metronomeOscillators.splice(i, 1);
  };
}

function startMetronome() {
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.audioContext.state === "suspended") state.audioContext.resume();
  stopMetronome();

  state.metronomeActive = true;
  let beatIndex = 0;
  let nextClickTime = state.audioContext.currentTime + 0.1;

  function scheduleAhead() {
    while (nextClickTime < state.audioContext.currentTime + METRONOME_LOOKAHEAD_SECONDS) {
      scheduleClick(nextClickTime, beatIndex % 4 === 0);
      nextClickTime += 60 / state.bpm;
      beatIndex++;
    }
  }

  scheduleAhead();
  state.metronomeTimer = setInterval(() => {
    if (!state.metronomeActive) return;
    scheduleAhead();
  }, 100);

  el.metronomeBtn.textContent = "⏹ Stop métronome";
  el.metronomeBtn.classList.add("active");
}

function stopMetronome() {
  state.metronomeActive = false;
  if (state.metronomeTimer) {
    clearInterval(state.metronomeTimer);
    state.metronomeTimer = null;
  }
  if (state.audioContext) {
    for (const osc of state.metronomeOscillators.slice()) {
      try {
        osc.stop(state.audioContext.currentTime);
      } catch (e) { /* already stopped */ }
    }
  }
  state.metronomeOscillators = [];
  el.metronomeBtn.textContent = "🎵 Métronome";
  el.metronomeBtn.classList.remove("active");
}

// ---------------------------------------------------------------------------
// Saved scores — persisted in localStorage, replayable independent of
// whichever audio file happens to be loaded.
// ---------------------------------------------------------------------------

function getSavedScores() {
  try {
    const raw = localStorage.getItem(SAVED_SCORES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function setSavedScores(list) {
  try {
    localStorage.setItem(SAVED_SCORES_STORAGE_KEY, JSON.stringify(list));
  } catch (e) { /* storage full or unavailable - fail silently */ }
}

function captureCurrentNotes() {
  if (state.mode === "manual") {
    return { notes: state.manualNotes.map((n) => ({ time: n.time, midi: n.midi })), duration: state.duration };
  }
  if (state.mode === "transcription") {
    const notes = state.noteEvents
      .filter((e) => e.type === "note")
      .map((e) => ({ time: e.startTime, midi: e.midi }));
    return { notes, duration: state.duration };
  }
  return null;
}

function renderSavedScoresList() {
  const scores = getSavedScores();
  el.savedScoresList.innerHTML = "";

  if (!scores.length) {
    const empty = document.createElement("p");
    empty.className = "saved-score-empty";
    empty.textContent = "Aucune partition sauvegardée pour l'instant.";
    el.savedScoresList.appendChild(empty);
    return;
  }

  scores
    .slice()
    .reverse()
    .forEach((entry) => {
      const item = document.createElement("div");
      item.className = "saved-score-item";

      const info = document.createElement("div");
      info.className = "saved-score-info";
      const name = document.createElement("div");
      name.className = "saved-score-name";
      name.textContent = entry.name;
      const meta = document.createElement("div");
      meta.className = "saved-score-meta";
      const date = new Date(entry.createdAt);
      meta.textContent = `${entry.notes.length} note(s) — ${entry.bpm.toFixed(1)} BPM — ${date.toLocaleDateString("fr-FR")} ${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
      info.appendChild(name);
      info.appendChild(meta);

      const playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "btn btn-primary";
      playBtn.textContent = "▶ Rejouer";
      playBtn.addEventListener("click", () => loadSavedScore(entry));

      const karaokeBtn = document.createElement("button");
      karaokeBtn.type = "button";
      karaokeBtn.className = "btn";
      karaokeBtn.textContent = "🎤 Karaoké";
      karaokeBtn.addEventListener("click", () => {
        const beat = 60 / entry.bpm;
        const notes = entry.notes.slice().sort((a, b) => a.time - b.time);
        const events = notes.map((note, index) => ({
          startTime: note.time,
          endTime: notes[index + 1]?.time ?? note.time + beat * 0.9,
          midi: note.midi,
        }));
        openKaraoke({ events, totalDuration: Math.max(entry.duration, ...events.map((event) => event.endTime)) }, entry.name);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn";
      deleteBtn.textContent = "🗑";
      deleteBtn.addEventListener("click", () => {
        if (!confirm(`Supprimer "${entry.name}" ?`)) return;
        setSavedScores(getSavedScores().filter((s) => s.id !== entry.id));
        renderSavedScoresList();
      });

      item.appendChild(info);
      item.appendChild(playBtn);
      item.appendChild(karaokeBtn);
      item.appendChild(deleteBtn);
      el.savedScoresList.appendChild(item);
    });
}

function saveCurrentScore() {
  const captured = captureCurrentNotes();
  if (!captured || !captured.notes.length) {
    setStatus("Rien à sauvegarder dans ce mode — place ou détecte d'abord des notes.", true);
    setTimeout(() => setStatus(""), 3000);
    return;
  }

  const defaultName = `Partition du ${new Date().toLocaleDateString("fr-FR")} ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  const name = prompt("Nom de la partition :", defaultName);
  if (name === null) return;

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || defaultName,
    createdAt: Date.now(),
    bpm: state.bpm,
    duration: captured.duration,
    notes: captured.notes,
  };

  const scores = getSavedScores();
  scores.push(entry);
  setSavedScores(scores);
  renderSavedScoresList();
}

function loadSavedScore(entry) {
  stopScorePlayback();
  state.manualNotes = entry.notes.map((n) => ({ time: n.time, midi: n.midi }));
  state.manualCaptureMode = true;
  state.bpm = entry.bpm;
  state.duration = entry.duration;
  el.bpmInput.value = entry.bpm.toFixed(1);
  el.bpmDisplay.textContent = entry.bpm.toFixed(1);
  state.manualMeasures = buildManualMeasuresFor(state.manualNotes, state.bpm, Math.max(state.duration, entry.duration));

  setMode("manual");
  startScorePlayback();
}

// ---------------------------------------------------------------------------
// Playback engine — native AudioBufferSourceNode loop (sample-accurate)
// ---------------------------------------------------------------------------

function snapTime(time, bpm, fractionOfBeat) {
  const step = (60 / bpm) * fractionOfBeat;
  return Math.round(time / step) * step;
}

function currentPlaybackPosition() {
  if (!state.isPlaying) return state.startOffset;
  const elapsed = state.audioContext.currentTime - state.startContextTime;
  let pos = state.startOffset + elapsed;

  if (state.loopEnabled && state.loopA !== null && state.loopB !== null && state.loopB > state.loopA) {
    const loopLen = state.loopB - state.loopA;
    if (pos >= state.loopB) {
      pos = state.loopA + ((pos - state.loopA) % loopLen);
    }
  } else if (pos >= state.duration) {
    pos = state.duration;
  }
  return pos;
}

function startPlayback(fromOffset) {
  if (!state.audioBuffer) return;
  stopSourceNode();

  const source = state.audioContext.createBufferSource();
  source.buffer = state.audioBuffer;
  source.connect(state.audioContext.destination);

  if (state.loopEnabled && state.loopA !== null && state.loopB !== null && state.loopB > state.loopA) {
    source.loop = true;
    source.loopStart = state.loopA;
    source.loopEnd = state.loopB;
  }

  const offset = fromOffset !== undefined ? fromOffset : state.startOffset;
  source.start(0, offset);

  state.sourceNode = source;
  state.startContextTime = state.audioContext.currentTime;
  state.startOffset = offset;
  state.isPlaying = true;

  source.onended = () => {
    if (state.sourceNode === source && !source.loop) {
      state.isPlaying = false;
      state.startOffset = 0;
      el.playBtn.hidden = false;
      el.pauseBtn.hidden = true;
      updatePlayheadUI(0);
    }
  };

  el.playBtn.hidden = true;
  el.pauseBtn.hidden = false;
  startAnimationLoop();
}

function stopSourceNode() {
  if (state.sourceNode) {
    try {
      state.sourceNode.onended = null;
      state.sourceNode.stop();
    } catch (e) { /* already stopped */ }
    state.sourceNode = null;
  }
}

function pausePlayback() {
  if (!state.isPlaying) return;
  state.startOffset = currentPlaybackPosition();
  stopSourceNode();
  state.isPlaying = false;
  el.playBtn.hidden = false;
  el.pauseBtn.hidden = true;
  stopAnimationLoop();
}

function stopPlayback() {
  stopSourceNode();
  state.isPlaying = false;
  state.startOffset = 0;
  el.playBtn.hidden = false;
  el.pauseBtn.hidden = true;
  stopAnimationLoop();
  updatePlayheadUI(0);
}

function startAnimationLoop() {
  stopAnimationLoop();
  function tick() {
    const pos = currentPlaybackPosition();
    updatePlayheadUI(pos);
    if (state.isPlaying) {
      state.rafHandle = requestAnimationFrame(tick);
    }
  }
  state.rafHandle = requestAnimationFrame(tick);
}

function stopAnimationLoop() {
  if (state.rafHandle) {
    cancelAnimationFrame(state.rafHandle);
    state.rafHandle = null;
  }
}

function updatePlayheadUI(pos) {
  el.currentTimeLabel.textContent = formatTime(pos);
  if (state.duration > 0) {
    el.seekBar.value = String(Math.round((pos / state.duration) * 1000));
  }
  if (state.mode !== "improvisation") {
    refreshPlayhead(pos);
  }
}

function formatTime(seconds) {
  if (!isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

el.playBtn.addEventListener("click", () => {
  if (state.audioContext.state === "suspended") state.audioContext.resume();
  startPlayback(state.startOffset);
});

el.pauseBtn.addEventListener("click", pausePlayback);
el.stopBtn.addEventListener("click", stopPlayback);

el.seekBar.addEventListener("input", () => {
  const frac = Number(el.seekBar.value) / 1000;
  const newOffset = frac * state.duration;
  state.startOffset = newOffset;
  updatePlayheadUI(newOffset);
  if (state.isPlaying) startPlayback(newOffset);
});

el.bpmInput.addEventListener("change", () => {
  const val = Number(el.bpmInput.value);
  if (!val || val <= 0) return;
  state.bpm = val;
  el.bpmDisplay.textContent = val.toFixed(1);
  if (state.noteEvents.length) {
    // Re-quantize with the corrected tempo.
    const segments = state.noteEvents
      .filter((e) => e.type === "note")
      .map((e) => ({ startTime: e.startTime, endTime: e.endTime, midi: e.midi }));
    state.noteEvents = buildNoteEvents(segments, state.duration, state.bpm);
    state.measures = groupIntoMeasures(state.noteEvents);
  }
  rebuildManualMeasures();
  if (state.mode !== "improvisation") {
    state.lastRenderKey = null;
    state.renderedMeasureWindowStart = -1;
    drawFullScore(state.mode === "manual" ? state.manualMeasures : state.measures, null);
  }
  if (state.scoreLoopActive) startScorePlayback();
});

el.setLoopABtn.addEventListener("click", () => {
  const pos = currentPlaybackPosition();
  const fraction = Number(el.snapGridSelect.value);
  state.loopA = snapTime(pos, state.bpm, fraction);
  applyLoopBounds();
  updateLoopLabels();
});

el.setLoopBBtn.addEventListener("click", () => {
  const pos = currentPlaybackPosition();
  const fraction = Number(el.snapGridSelect.value);
  state.loopB = snapTime(pos, state.bpm, fraction);
  applyLoopBounds();
  updateLoopLabels();
});

el.clearLoopBtn.addEventListener("click", () => {
  state.loopA = null;
  state.loopB = null;
  state.loopEnabled = false;
  el.loopEnabledCheckbox.checked = false;
  applyLoopBounds();
  updateLoopLabels();
});

el.loopEnabledCheckbox.addEventListener("change", () => {
  state.loopEnabled = el.loopEnabledCheckbox.checked;
  applyLoopBounds();
});

function applyLoopBounds() {
  if (state.sourceNode && state.loopEnabled && state.loopA !== null && state.loopB !== null && state.loopB > state.loopA) {
    state.sourceNode.loop = true;
    state.sourceNode.loopStart = state.loopA;
    state.sourceNode.loopEnd = state.loopB;
  } else if (state.sourceNode) {
    state.sourceNode.loop = false;
  }
}

function updateLoopLabels() {
  el.loopALabel.textContent = `A: ${state.loopA !== null ? formatTime(state.loopA) : "--"}`;
  el.loopBLabel.textContent = `B: ${state.loopB !== null ? formatTime(state.loopB) : "--"}`;
}

function renderTwelveKeys() {
  if (!el.twelveKeysGrid) return;
  el.twelveKeysGrid.innerHTML = "";
  const activeRoot = state.songScaleRoot;
  FRENCH_NOTE_NAMES.forEach((name, root) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn twelve-key-btn";
    button.textContent = `${name} / ${INTERNATIONAL_NOTE_NAMES[root]}`;
    button.classList.toggle("active", root === activeRoot);
    button.addEventListener("click", () => transposeManualPhraseTo(root));
    el.twelveKeysGrid.appendChild(button);
  });
}

function transposeManualPhraseTo(targetRoot) {
  if (!state.manualNotes.length) {
    setStatus("Ajoute d’abord une phrase à la partition.");
    return;
  }
  if (!state.twelveKeyBaseNotes) {
    state.twelveKeyBaseNotes = state.manualNotes.map((note) => ({ ...note }));
    state.twelveKeyBaseRoot = state.songScaleRoot;
  }
  let delta = targetRoot - state.twelveKeyBaseRoot;
  if (delta > 6) delta -= 12;
  if (delta < -6) delta += 12;
  state.manualNotes = state.twelveKeyBaseNotes.map((note) => ({ ...note, midi: note.midi + delta }));
  state.selectedManualNoteIndex = null;
  rebuildManualMeasures();
  state.songScaleRoot = targetRoot;
  updateSongKeyPanel();
  buildPitchPalette();
  drawFullScore(state.manualMeasures, null);
  renderTwelveKeys();
  setStatus(`Phrase transposée en ${FRENCH_NOTE_NAMES[targetRoot]}.`);
}

function exportCurrentScorePdf() {
  const measures = state.mode === "manual" ? state.manualMeasures : state.mode === "transcription" ? state.measures : null;
  if (measures && measures.length) drawFullScore(measures, null);
  document.body.classList.add("print-score");
  const cleanup = () => document.body.classList.remove("print-score");
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
  setTimeout(cleanup, 1200);
}

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (target && (target.matches("input, textarea, select") || target.isContentEditable)) return;
  if (event.key === "Delete" || event.key === "Backspace") {
    if (deleteSelectedManualNote()) event.preventDefault();
  } else if (event.key === "ArrowUp") {
    if (alterSelectedManualNote(1)) event.preventDefault();
  } else if (event.key === "ArrowDown") {
    if (alterSelectedManualNote(-1)) event.preventDefault();
  } else if (event.key === "Escape" && state.selectedManualNoteIndex !== null) {
    state.selectedManualNoteIndex = null;
    drawFullScore(state.manualMeasures, null);
  }
});

// ---------------------------------------------------------------------------
// Mode UI wiring (improvisation + manual)
// ---------------------------------------------------------------------------

el.modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

el.cleanTranscriptionBtn.addEventListener("click", cleanTranscription);
el.editTranscriptionBtn.addEventListener("click", editDetectedTranscription);
el.toggleScannerBtn.addEventListener("click", () => {
  if (noteScanner.active) stopNoteScanner();
  else startNoteScanner();
});
el.captureScannedNoteBtn.addEventListener("click", captureScannedNote);

el.scaleRootSelect.addEventListener("change", () => {
  state.scaleRoot = Number(el.scaleRootSelect.value);
  if (state.mode === "improvisation") {
    if (state.chordMode === "chord") {
      applyChordSelection();
    } else {
      renderScaleReference();
      if (state.scoreLoopActive) startScorePlayback();
    }
  }
});

el.scaleTypeSelect.addEventListener("change", () => {
  state.scaleType = el.scaleTypeSelect.value;
  if (state.mode === "improvisation") {
    renderScaleReference();
    if (state.scoreLoopActive) startScorePlayback();
  }
});

el.undoManualNoteBtn.addEventListener("click", () => {
  state.manualNotes.pop();
  state.selectedManualNoteIndex = null;
  state.twelveKeyBaseNotes = null;
  rebuildManualMeasures();
  if (state.mode === "manual") {
    state.lastRenderKey = null;
    updatePlayheadUI(currentPlaybackPosition());
  }
});

el.clearManualNotesBtn.addEventListener("click", () => {
  state.manualNotes = [];
  state.selectedManualNoteIndex = null;
  state.twelveKeyBaseNotes = null;
  rebuildManualMeasures();
  if (state.mode === "manual") {
    state.lastRenderKey = null;
    updatePlayheadUI(currentPlaybackPosition());
  }
});

el.deleteNoteModeBtn.addEventListener("click", () => {
  state.deleteNoteMode = !state.deleteNoteMode;
  el.deleteNoteModeBtn.classList.toggle("btn-danger-active", state.deleteNoteMode);
  el.deleteNoteModeBtn.textContent = state.deleteNoteMode
    ? "🗑️ Clique une note pour la supprimer (actif)"
    : "🗑️ Supprimer une note";
});

el.toggleTwelveKeysBtn.addEventListener("click", () => {
  el.twelveKeysPanel.hidden = !el.twelveKeysPanel.hidden;
  if (!el.twelveKeysPanel.hidden) {
    state.twelveKeyBaseNotes = state.manualNotes.map((note) => ({ ...note }));
    state.twelveKeyBaseRoot = state.songScaleRoot;
    renderTwelveKeys();
  }
});

el.exportScorePdfBtn.addEventListener("click", exportCurrentScorePdf);
el.soundEngineSelect.addEventListener("change", () => {
  state.soundEngine = el.soundEngineSelect.value;
  setStatus(state.soundEngine === "sample" ? "Son de trompette échantillonné activé." : "Synthé rapide activé.");
});

FRENCH_NOTE_NAMES.forEach((_name, idx) => {
  const opt = document.createElement("option");
  opt.value = String(idx);
  opt.textContent = trumpetPitchClassLabel(idx);
  el.scaleRootSelect.appendChild(opt);
});

function populateScaleTypeSelect() {
  const groups = {};
  Object.entries(SCALE_DEFINITIONS).forEach(([key, def]) => {
    if (!groups[def.group]) groups[def.group] = [];
    groups[def.group].push([key, def]);
  });

  Object.entries(groups).forEach(([groupName, entries]) => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = groupName;
    entries.forEach(([key, def]) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = def.label;
      optgroup.appendChild(opt);
    });
    el.scaleTypeSelect.appendChild(optgroup);
  });
}
populateScaleTypeSelect();
el.scaleTypeSelect.value = state.scaleType;

populateChordQualitySelect();
el.chordQualitySelect.value = state.chordQuality;

el.chordModeBtns.forEach((btn) => {
  btn.addEventListener("click", () => setChordMode(btn.dataset.chordmode));
});

el.chordQualitySelect.addEventListener("change", () => {
  state.chordQuality = el.chordQualitySelect.value;
  if (state.chordMode === "chord") applyChordSelection();
});

el.insideScaleBtn.addEventListener("click", () => {
  state.chordSide = "inside";
  el.insideScaleBtn.classList.add("active");
  el.outsideScaleBtn.classList.remove("active");
  if (state.chordMode === "chord") applyChordSelection();
});

el.outsideScaleBtn.addEventListener("click", () => {
  state.chordSide = "outside";
  el.outsideScaleBtn.classList.add("active");
  el.insideScaleBtn.classList.remove("active");
  if (state.chordMode === "chord") applyChordSelection();
});

buildPitchPalette();

el.addChordSlotBtn.addEventListener("click", addChordSlot);
el.clearPianoRollBtn.addEventListener("click", clearPianoRoll);
el.jazzifyBtn.addEventListener("click", jazzifyChord);
el.sendChordToTrumpetBtn.addEventListener("click", sendChordToTrumpet);
loadSharedChordProgression();
renderPianoRoll();

el.startQuizBtn.addEventListener("click", () => {
  startQuiz();
});
el.stopQuizBtn.addEventListener("click", () => {
  stopQuiz(false);
});
el.quizCorrectBtn.addEventListener("click", () => resolveQuizRound(true));
el.quizWrongBtn.addEventListener("click", () => resolveQuizRound(false));

el.startSongQuizBtn.addEventListener("click", () => {
  if (state.chordMode === "chord") setChordMode("free");
  state.scaleRoot = state.songScaleRoot;
  state.scaleType = state.songScaleType;
  el.scaleRootSelect.value = String(state.scaleRoot);
  el.scaleTypeSelect.value = state.scaleType;
  setMode("improvisation");
  startQuiz();
});

el.startSongNotesQuizBtn.addEventListener("click", () => {
  const uniqueConcert = [...new Set(state.manualNotes.map((n) => n.midi))];
  if (state.chordMode === "chord") setChordMode("free");
  setMode("improvisation");
  startQuiz(uniqueConcert);
});

el.octaveDownBtn.addEventListener("click", () => {
  setOctaveShift(state.octaveShift - 12);
});
el.octaveUpBtn.addEventListener("click", () => {
  setOctaveShift(state.octaveShift + 12);
});

el.playScoreBtn.addEventListener("click", startScorePlayback);
el.stopScoreBtn.addEventListener("click", stopScorePlayback);
el.openKaraokeBtn.addEventListener("click", () => openKaraoke(getCurrentModeEvents()));

el.metronomeBtn.addEventListener("click", () => {
  if (state.metronomeActive) {
    stopMetronome();
  } else {
    startMetronome();
  }
});

el.muteScoreCheckbox.addEventListener("change", () => {
  setScoreMuted(el.muteScoreCheckbox.checked);
});

el.saveScoreBtn.addEventListener("click", saveCurrentScore);
renderSavedScoresList();

el.toggleFavoriteScaleBtn.addEventListener("click", toggleFavoriteScale);
renderFavoriteScalesList();

setFileControlsEnabled(false);
el.bpmInput.value = state.bpm.toFixed(1);
el.bpmDisplay.textContent = state.bpm.toFixed(1);
applyStandaloneLayout();

// Training catalog links here as index.html?track=<id> to preload a
// transcription straight into Manual mode. Playback isn't auto-started -
// browsers block audio without a real user gesture, so it just gets the
// data ready and the user presses play themselves. When a track is pending,
// skip the default Gammes view entirely (it used to flash on screen for the
// fetch's round-trip before swapping to the real score, which read as "the
// score only shows up once you press play") and show a loading status instead.
// ---------------------------------------------------------------------------
// Boarding space — the app's entry screen (pick Trompette or Piano) instead
// of landing straight in the workspace. A catalog link (?track=) implies the
// choice was already made, so it skips straight past the boarding screen.
// ---------------------------------------------------------------------------

function enterTrumpetWorkspace() {
  el.boardingSpace.hidden = true;
  el.mainApp.hidden = false;
  document.body.classList.add("trumpet-workspace-open");
  // trumpet-3d.js sizes its canvas from #instrumentStage's clientWidth/Height
  // the moment it loads/activates - which happens while the boarding space
  // still hides the whole app (0x0 layout), leaving the canvas stuck at
  // 1x1px forever. Re-open (re-frame) it now that the panel is actually on
  // screen with real dimensions.
  openInstrumentStage();
  requestAnimationFrame(() => {
    if (state.mode === "improvisation") renderScaleReference();
    else {
      state.lastRenderKey = null;
      refreshPlayhead(currentPlaybackPosition());
    }
  });
}

function showBoardingSpace() {
  el.mainApp.hidden = true;
  el.boardingSpace.hidden = false;
  document.body.classList.remove("trumpet-workspace-open", "tools-open");
  toolsDrawer.hidden = true;
}

el.boardTrumpetBtn.addEventListener("click", enterTrumpetWorkspace);
el.backToBoardingLink.addEventListener("click", (event) => {
  event.preventDefault();
  showBoardingSpace();
});

let workspaceResizeTimer = null;
window.addEventListener("resize", () => {
  if (el.mainApp.hidden) return;
  clearTimeout(workspaceResizeTimer);
  workspaceResizeTimer = setTimeout(() => {
    if (state.mode === "improvisation") renderScaleReference();
    else {
      state.lastRenderKey = null;
      refreshPlayhead(currentPlaybackPosition());
    }
  }, 120);
});

// ---------------------------------------------------------------------------
// Keep the default Trompette workspace down to just the score + the 3D
// trumpet ("page blanche, c'est tout"). The treble clef reveals the gamme/
// tonalité picker; the gear icon reveals everything else (transport/BPM/
// looper, the chord tool, saved scores) - both start closed.
// ---------------------------------------------------------------------------

function toggleScaleOptions() {
  if (!state.scaleOptionsOpen && state.moreToolsOpen) toggleMoreTools();
  state.scaleOptionsOpen = !state.scaleOptionsOpen;
  el.clefToggleBtn.setAttribute("aria-expanded", String(state.scaleOptionsOpen));
  if (state.mode === "improvisation") {
    el.improvisationControls.hidden = !state.scaleOptionsOpen;
  }
}

function toggleMoreTools() {
  if (!state.moreToolsOpen && state.scaleOptionsOpen) toggleScaleOptions();
  state.moreToolsOpen = !state.moreToolsOpen;
  el.moreToolsToggleBtn.setAttribute("aria-expanded", String(state.moreToolsOpen));
  toolsDrawer.hidden = !state.moreToolsOpen;
  document.body.classList.toggle("tools-open", state.moreToolsOpen);
  el.transportPanel.hidden = !state.moreToolsOpen;
  el.pianoToolPanel.hidden = !state.moreToolsOpen;
  el.savedScoresPanel.hidden = !state.moreToolsOpen;
  el.hiddenModeToggle.hidden = !state.moreToolsOpen;
  el.scorePlaybackRow.hidden = !state.moreToolsOpen;
}

el.clefToggleBtn.addEventListener("click", toggleScaleOptions);
el.moreToolsToggleBtn.addEventListener("click", toggleMoreTools);
toolsDrawer.querySelector(".tools-drawer-close").addEventListener("click", toggleMoreTools);

const pendingTrackId = new URLSearchParams(window.location.search).get("track");
if (pendingTrackId) {
  enterTrumpetWorkspace();
  setStatus("Chargement de la partition…");
} else {
  setMode("improvisation");
}

async function loadTrackFromQueryParam() {
  if (!pendingTrackId) return;
  const trackId = pendingTrackId;

  try {
    const resp = await fetch(`tracks/${trackId}.json`);
    if (!resp.ok) {
      setMode("improvisation");
      return;
    }
    const entry = await resp.json();

    state.manualNotes = entry.notes.map((n) => ({ time: n.time, midi: n.midi }));
    state.manualCaptureMode = false;
    state.bpm = entry.bpm;
    state.duration = Math.max(state.duration, entry.duration);
    el.bpmInput.value = entry.bpm.toFixed(1);
    el.bpmDisplay.textContent = entry.bpm.toFixed(1);
    el.durationValue.textContent = formatTime(state.duration);
    state.manualMeasures = buildManualMeasuresFor(state.manualNotes, state.bpm, state.duration);
    setMode("manual");
    setStatus(`"${entry.name}" chargé — clique "Jouer la partition en boucle" pour l'écouter.`);
    setTimeout(() => setStatus(""), 5000);
  } catch (e) {
    console.error("Failed to load track from query param", e);
    setMode("improvisation");
  }
}
loadTrackFromQueryParam();
