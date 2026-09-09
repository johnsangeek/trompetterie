import * as THREE from "three";
import { GLTFLoader } from "./vendor/three/addons/loaders/GLTFLoader.js";

const stage = document.getElementById("instrumentStage");
const canvas = document.getElementById("trumpet3dCanvas");
const statusLabel = document.getElementById("instrument3dStatus");
const noteLabel = document.getElementById("instrumentNoteLabel");
const clef = document.getElementById("instrumentTrebleClef");
const playPauseButton = document.getElementById("instrumentPlayPauseBtn");
const stopButton = document.getElementById("instrumentStopBtn");
const valveDots = [1, 2, 3].map((index) => document.getElementById(`instrumentValve${index}`));
const fingeringDots = document.getElementById("instrumentFingeringDots");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x777a78, 0.032);

const camera = new THREE.OrthographicCamera(-5, 5, 3, -3, 0.1, 100);
const instrumentRoot = new THREE.Group();
scene.add(instrumentRoot);

scene.add(new THREE.HemisphereLight(0xf5efe5, 0x262a29, 2.8));

const keyLight = new THREE.DirectionalLight(0xffe1b0, 5.2);
keyLight.position.set(-4, 6, 8);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xa7d8ce, 3.4);
rimLight.position.set(5, -2, 4);
scene.add(rimLight);

const valveNodes = [null, null, null];
const valveHomeY = [0, 0, 0];
const valveAmount = [0, 0, 0];
const valveTargets = [0, 0, 0];
let modelBounds = null;
let isOpen = !stage.hidden;

function frameModel() {
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  renderer.setSize(width, height, false);

  const aspect = width / height;
  const modelWidth = modelBounds ? modelBounds.size.x * 1.2 : 10;
  const modelHeight = modelBounds ? modelBounds.size.y * 1.44 : 4;
  const viewHeight = Math.max(modelHeight, modelWidth / aspect);
  const viewWidth = viewHeight * aspect;

  camera.left = -viewWidth / 2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();

  if (modelBounds) {
    camera.position.set(modelBounds.center.x, modelBounds.center.y + 0.03, modelBounds.center.z + 12);
    camera.lookAt(modelBounds.center);
  }
}

new GLTFLoader().load(
  "./assets/trumpet/trumpet.glb",
  (gltf) => {
    instrumentRoot.add(gltf.scene);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    modelBounds = {
      size: box.getSize(new THREE.Vector3()),
      center: box.getCenter(new THREE.Vector3()),
    };

    for (let index = 0; index < 3; index++) {
      const node = gltf.scene.getObjectByName(`Piston_${index + 1}`);
      valveNodes[index] = node;
      if (!node) continue;
      // Keep the moving piston behind the trumpet body. The main brass tube then
      // naturally masks the coloured lower plate as the piston goes down.
      node.position.z -= 0.32;
      valveHomeY[index] = node.position.y;
      node.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        child.material = child.material.clone();
        child.material.emissive = new THREE.Color(0x000000);
      });
    }

    frameModel();
    statusLabel.textContent = "Prêt";
    statusLabel.classList.add("ready");
  },
  undefined,
  () => {
    statusLabel.textContent = "Modèle indisponible";
    statusLabel.classList.add("error");
  }
);

function animate() {
  requestAnimationFrame(animate);
  for (let index = 0; index < 3; index++) {
    const responseSpeed = valveTargets[index] > valveAmount[index] ? 0.62 : 0.36;
    valveAmount[index] += (valveTargets[index] - valveAmount[index]) * responseSpeed;
    const node = valveNodes[index];
    if (!node) continue;
    // Stop with the coloured finger capsule still visible on top of the brass
    // valve cap, like a real piston reaching its mechanical travel limit.
    node.position.y = valveHomeY[index] - valveAmount[index] * 0.26;
    node.traverse((child) => {
      if (!child.isMesh || !child.material?.emissive) return;
      child.material.emissive.copy(child.material.color).multiplyScalar(valveAmount[index] * 0.5);
    });
  }
  if (isOpen) renderer.render(scene, camera);
}
animate();

function readCurrentValves() {
  return [1, 2, 3].map((index) => document.getElementById(`valve${index}`)?.classList.contains("pressed"));
}

function setValves(pressed) {
  pressed.forEach((value, index) => {
    valveTargets[index] = value ? 1 : 0;
    valveDots[index].classList.toggle("pressed", value);
  });
  const active = pressed.map((value, index) => value ? index + 1 : null).filter(Boolean);
  const values = active.length ? active : [0];
  fingeringDots.innerHTML = values.map((value) => `<span class="current-fingering-dot fingering-${value}">${value}</span>`).join("");
  fingeringDots.setAttribute("aria-label", active.length ? `Pistons ${active.join(", ")}` : "Doigté ouvert");
}

function activateStage() {
  isOpen = true;
  noteLabel.textContent = document.getElementById("currentNoteLabel")?.textContent || "--";
  clef.classList.toggle("sounding", noteLabel.textContent !== "--");
  setValves(readCurrentValves());
  frameModel();
}

function deactivateStage() {
  isOpen = false;
}

window.addEventListener("trumpet:view-open", activateStage);
window.addEventListener("trumpet:view-close", deactivateStage);
window.addEventListener("resize", frameModel);
window.addEventListener("trumpet:valves", (event) => {
  const valves = event.detail?.valves || {};
  setValves([Boolean(valves[1]), Boolean(valves[2]), Boolean(valves[3])]);
});
window.addEventListener("trumpet:note", (event) => {
  noteLabel.textContent = event.detail?.label || "--";
  clef.classList.toggle("sounding", noteLabel.textContent !== "--");
});

playPauseButton.addEventListener("click", () => {
  const pause = document.getElementById("pauseBtn");
  const play = document.getElementById("playBtn");
  const playScore = document.getElementById("playScoreBtn");
  const stopScore = document.getElementById("stopScoreBtn");
  if (pause && !pause.hidden) {
    pause.click();
    playPauseButton.textContent = "▶ Reprendre";
  } else if (stopScore && !stopScore.hidden) {
    stopScore.click();
    playPauseButton.textContent = "▶ Jouer";
  } else if (play && !play.disabled) {
    play.click();
    playPauseButton.textContent = "Ⅱ Pause";
  } else {
    playScore?.click();
    playPauseButton.textContent = "Ⅱ Pause";
  }
});

stopButton.addEventListener("click", () => {
  document.getElementById("stopBtn")?.click();
  const scoreStop = document.getElementById("stopScoreBtn");
  if (scoreStop && !scoreStop.hidden) scoreStop.click();
  playPauseButton.textContent = "▶ Jouer";
  setValves([false, false, false]);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isOpen && document.fullscreenElement !== stage) {
    document.getElementById("closeInstrumentViewBtn")?.click();
  }
});
