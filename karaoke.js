import * as THREE from "three";
import { GLTFLoader } from "./vendor/three/addons/loaders/GLTFLoader.js";

const FINGERINGS = { 0: [], 1: [1, 2, 3], 2: [1, 3], 3: [2, 3], 4: [1, 2], 5: [1], 6: [2], 7: [], 8: [2, 3], 9: [1, 2], 10: [1], 11: [2] };
const NOTE_NAMES = ["Do", "Do♯", "Ré", "Mib", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "Sib", "Si"];
const fallback = {
  title: "Gamme blues · Démonstration",
  bpm: 112,
  events: [58, 61, 63, 64, 65, 68, 70, 68, 65, 64, 63, 61].map((midi, index) => ({ startTime: index * .54, endTime: index * .54 + .46, midi })),
  totalDuration: 6.55,
};

function readSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem("trumpetKaraokeSession"));
    if (value?.events?.length) return value;
  } catch (error) { /* fall through to demo */ }
  return fallback;
}

const session = readSession();
const events = session.events.slice().sort((a, b) => a.startTime - b.startTime);
const origin = Math.min(...events.map((event) => event.startTime));
events.forEach((event, index) => {
  event.startTime -= origin;
  event.endTime = Math.max(event.startTime + .08, event.endTime - origin);
  event.index = index;
});
const totalDuration = Math.max(session.totalDuration - origin, ...events.map((event) => event.endTime));

const title = document.getElementById("karaokeTitle");
const noteTrack = document.getElementById("noteTrack");
const staffViewport = document.getElementById("staffViewport");
const activeNote = document.getElementById("activeNote");
const activeFingering = document.getElementById("activeFingering");
const playPauseBtn = document.getElementById("playPauseBtn");
const restartBtn = document.getElementById("restartBtn");
const speedSelect = document.getElementById("speedSelect");
const progressFill = document.getElementById("progressFill");
const currentTimeLabel = document.getElementById("currentTime");
const totalTimeLabel = document.getElementById("totalTime");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const valveDots = [1, 2, 3].map((index) => document.getElementById(`karaokeValve${index}`));

title.textContent = session.title || "Partition en cours";
totalTimeLabel.textContent = "∞";

const noteElements = [];
for (let cycle = 0; cycle < 2; cycle++) {
  events.forEach((event) => {
    const writtenMidi = event.midi + 2;
    const fingering = fingeringDotsHTML(event.midi);
    const note = document.createElement("div");
    note.className = "karaoke-note";
    note.dataset.index = event.index;
    note.dataset.cycle = cycle;
    note.style.top = `${92 - (writtenMidi - 71) * 3.3}px`;
    note.innerHTML = `<span class="stem"></span><span class="head"></span><span class="duration"></span><span class="name">${writtenName(event.midi)}</span><span class="fingering">${fingering}</span>`;
    noteTrack.appendChild(note);
    noteElements.push({ element: note, event, cycle });
  });
}

let audioContext = null;
let playing = false;
let pausedAt = 0;
let startedAt = 0;
let speed = 1;
let lastActiveIndex = -1;
let activeOscillators = [];

function formatTime(seconds) {
  const safe = Math.max(0, seconds || 0);
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

function writtenName(concertMidi) {
  const midi = concertMidi + 2;
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function fingeringValues(concertMidi) {
  const writtenMidi = concertMidi + 2;
  return FINGERINGS[((writtenMidi - 60) % 12 + 12) % 12];
}

function fingeringDotsHTML(concertMidi) {
  const values = fingeringValues(concertMidi);
  return (values.length ? values : [0]).map((value) => `<span class="karaoke-fingering-dot fingering-${value}">${value}</span>`).join("");
}

function ensureAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

function soundNote(event) {
  const ctx = ensureAudio();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const duration = Math.max(.08, (event.endTime - event.startTime) / speed);
  const now = ctx.currentTime;
  oscillator.type = "triangle";
  oscillator.frequency.value = 440 * Math.pow(2, (event.midi - 69) / 12);
  gain.gain.setValueAtTime(.0001, now);
  gain.gain.exponentialRampToValueAtTime(.2, now + .012);
  gain.gain.setValueAtTime(.2, Math.max(now + .013, now + duration - .045));
  gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + .02);
  activeOscillators.push(oscillator);
  oscillator.addEventListener("ended", () => { activeOscillators = activeOscillators.filter((item) => item !== oscillator); });
}

function stopSound() {
  activeOscillators.forEach((oscillator) => { try { oscillator.stop(); } catch (error) { /* already stopped */ } });
  activeOscillators = [];
}

function currentPosition() {
  if (!playing || !audioContext) return pausedAt;
  return Math.max(0, (audioContext.currentTime - startedAt) * speed);
}

function start() {
  const ctx = ensureAudio();
  startedAt = ctx.currentTime - pausedAt / speed;
  lastActiveIndex = -1;
  playing = true;
  playPauseBtn.textContent = "Ⅱ Pause";
}

function pause() {
  pausedAt = currentPosition();
  playing = false;
  stopSound();
  playPauseBtn.textContent = "▶ Reprendre";
}

function restart(autoPlay = playing) {
  stopSound();
  pausedAt = 0;
  lastActiveIndex = -1;
  if (autoPlay) {
    const ctx = ensureAudio();
    startedAt = ctx.currentTime;
    playing = true;
    playPauseBtn.textContent = "Ⅱ Pause";
  } else {
    playing = false;
    playPauseBtn.textContent = "▶ Jouer";
  }
  updateFrame();
}

function findActive(position) {
  return events.find((event) => position >= event.startTime && position < event.endTime) || null;
}

function setActive(event) {
  const index = event?.index ?? -1;
  if (index === lastActiveIndex) return;
  lastActiveIndex = index;
  noteElements.forEach(({ element, event: renderedEvent }) => element.classList.toggle("active", renderedEvent.index === index));
  const values = event ? fingeringValues(event.midi) : [];
  valveDots.forEach((dot, dotIndex) => dot.classList.toggle("pressed", values.includes(dotIndex + 1)));
  valveTargets.forEach((_, targetIndex) => { valveTargets[targetIndex] = values.includes(targetIndex + 1) ? 1 : 0; });
  if (event) {
    activeNote.textContent = writtenName(event.midi);
    activeFingering.innerHTML = fingeringDotsHTML(event.midi);
    if (playing) soundNote(event);
  } else {
    activeNote.textContent = playing ? "—" : "Prêt";
    activeFingering.innerHTML = '<span class="karaoke-fingering-dot fingering-0">0</span>';
  }
}

function updateFrame() {
  const elapsed = currentPosition();
  const position = totalDuration ? elapsed % totalDuration : 0;

  const anchor = staffViewport.clientWidth * .5;
  const pixelsPerSecond = Math.max(128, staffViewport.clientWidth * .14);
  noteElements.forEach(({ element, event, cycle }) => {
    element.style.left = `${anchor + (event.startTime + cycle * totalDuration) * pixelsPerSecond}px`;
    element.querySelector(".duration").style.width = `${Math.max(20, (event.endTime - event.startTime) * pixelsPerSecond)}px`;
    element.classList.toggle("past", cycle === 0 && event.endTime < position);
  });
  noteTrack.style.transform = `translateX(${-position * pixelsPerSecond}px)`;
  const active = findActive(position);
  setActive(active);
  progressFill.style.width = `${Math.min(100, position / totalDuration * 100)}%`;
  currentTimeLabel.textContent = formatTime(position);
}

playPauseBtn.addEventListener("click", () => playing ? pause() : start());
restartBtn.addEventListener("click", () => restart(playing));
speedSelect.addEventListener("change", () => {
  const position = currentPosition();
  speed = Number(speedSelect.value);
  pausedAt = position;
  if (playing) startedAt = ensureAudio().currentTime - position / speed;
});
fullscreenBtn.addEventListener("click", async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen();
});
document.addEventListener("fullscreenchange", () => { fullscreenBtn.textContent = document.fullscreenElement ? "Quitter plein écran" : "Plein écran"; });
document.addEventListener("keydown", (event) => {
  if (event.code === "Space") { event.preventDefault(); playing ? pause() : start(); }
  if (event.key === "Escape" && !document.fullscreenElement) window.location.href = "index.html";
});

const canvas = document.getElementById("karaokeTrumpetCanvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xeee8dc, .026);
const camera = new THREE.OrthographicCamera(-5, 5, 3, -3, .1, 100);
scene.add(new THREE.HemisphereLight(0xfffbf2, 0x75694f, 3.05));
const keyLight = new THREE.DirectionalLight(0xffdfaa, 5.2); keyLight.position.set(-4, 6, 8); scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xa7d8ce, 3.4); rimLight.position.set(5, -2, 4); scene.add(rimLight);
const valveNodes = [null, null, null];
const valveHomeY = [0, 0, 0];
const valveAmounts = [0, 0, 0];
const valveTargets = [0, 0, 0];
let bounds = null;

function frameTrumpet() {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  renderer.setSize(width, height, false);
  const aspect = width / height;
  const modelWidth = bounds ? bounds.size.x * 1.16 : 10;
  const modelHeight = bounds ? bounds.size.y * 1.42 : 4;
  const viewHeight = Math.max(modelHeight, modelWidth / aspect);
  const viewWidth = viewHeight * aspect;
  camera.left = -viewWidth / 2; camera.right = viewWidth / 2; camera.top = viewHeight / 2; camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
  if (bounds) { camera.position.set(bounds.center.x, bounds.center.y, bounds.center.z + 12); camera.lookAt(bounds.center); }
}

new GLTFLoader().load("./assets/trumpet/trumpet.glb", (gltf) => {
  scene.add(gltf.scene);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  bounds = { size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) };
  for (let index = 0; index < 3; index++) {
    const node = gltf.scene.getObjectByName(`Piston_${index + 1}`);
    valveNodes[index] = node;
    if (!node) continue;
    node.position.z -= .32;
    valveHomeY[index] = node.position.y;
    node.traverse((child) => { if (child.isMesh && child.material) { child.material = child.material.clone(); child.material.emissive = new THREE.Color(0); } });
  }
  frameTrumpet();
});

function render() {
  requestAnimationFrame(render);
  updateFrame();
  for (let index = 0; index < 3; index++) {
    const responseSpeed = valveTargets[index] > valveAmounts[index] ? .62 : .36;
    valveAmounts[index] += (valveTargets[index] - valveAmounts[index]) * responseSpeed;
    const node = valveNodes[index];
    if (!node) continue;
    node.position.y = valveHomeY[index] - valveAmounts[index] * .26;
    node.traverse((child) => { if (child.isMesh && child.material?.emissive) child.material.emissive.copy(child.material.color).multiplyScalar(valveAmounts[index] * .5); });
  }
  renderer.render(scene, camera);
}

window.addEventListener("resize", frameTrumpet);
updateFrame();
render();
