/* Eyedrop — mobile-first color collector
 * Live camera -> tap a grid cell -> sample that pixel's hex -> save collections.
 * Pixel sampling is done from a canvas snapshot of the video so it works on
 * mobile (the EyeDropper API is desktop-only and is used as an enhancement).
 */

const COLS = 4;
const ROWS = 7;
const CELL_COUNT = COLS * ROWS;
const STORE_KEY = "eyedrop.collections.v1";

const state = {
  cells: Array.from({ length: CELL_COUNT }, () => ({ color: null, selected: false })),
  selecting: false,
  collections: loadCollections(),
  streaming: false,
  facingMode: "environment",
  stream: null,
};

/* ---------- DOM ---------- */
const el = (id) => document.getElementById(id);
const video = el("video");
const gridEl = el("grid");
const toast = el("toast");
const sampleCanvas = document.createElement("canvas");
const sctx = sampleCanvas.getContext("2d", { willReadFrequently: true });

/* ---------- Camera ---------- */
async function startCamera() {
  stopCamera();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: state.facingMode } },
      audio: false,
    });
    state.stream = stream;
    video.srcObject = stream;
    // Mirror the front camera so it reads like a selfie view.
    video.classList.toggle("mirrored", state.facingMode === "user");
    await video.play();
    state.streaming = true;
  } catch (err) {
    showToast("Camera unavailable — " + (err && err.name ? err.name : "error"));
    console.error("getUserMedia failed:", err);
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  state.streaming = false;
}

async function flipCamera() {
  state.facingMode = state.facingMode === "environment" ? "user" : "environment";
  await startCamera();
}

/* ---------- Grid ---------- */
function buildGrid() {
  gridEl.style.setProperty("--cols", COLS);
  gridEl.innerHTML = "";
  state.cells.forEach((_, i) => {
    const c = document.createElement("button");
    c.className = "cell";
    c.dataset.index = i;
    c.setAttribute("aria-label", "grid cell " + (i + 1));
    c.addEventListener("click", () => onCellTap(i, c));
    gridEl.appendChild(c);
  });
  renderCells();
}

function renderCells() {
  const nodes = gridEl.children;
  state.cells.forEach((cell, i) => {
    const node = nodes[i];
    node.classList.toggle("filled", !!cell.color);
    node.classList.toggle("selected", !!cell.selected);
    node.style.setProperty("--cell-color", cell.color || "transparent");
  });
  gridEl.classList.toggle("selecting", state.selecting);
  updateControls();
}

function onCellTap(i, node) {
  const cell = state.cells[i];
  if (state.selecting) {
    if (!cell.color) return;
    cell.selected = !cell.selected;
    renderCells();
    return;
  }
  if (cell.color) return; // already collected — tap again in Select mode to pick it
  const hex = samplePixel(node);
  if (!hex) return;
  cell.color = hex;
  renderCells();
  showToast(hex, hex);
}

/* Map the center of a displayed cell back to a source pixel of the video,
 * accounting for object-fit: cover cropping. */
function samplePixel(node) {
  const vW = video.videoWidth, vH = video.videoHeight;
  if (!vW || !vH) { showToast("Camera not ready"); return null; }

  const vrect = video.getBoundingClientRect();
  const crect = node.getBoundingClientRect();
  const cx = crect.left + crect.width / 2;
  const cy = crect.top + crect.height / 2;

  const scale = Math.max(vrect.width / vW, vrect.height / vH);
  const dispW = vW * scale, dispH = vH * scale;
  const offX = (vrect.width - dispW) / 2;
  const offY = (vrect.height - dispH) / 2;

  let sx = Math.round((cx - vrect.left - offX) / scale);
  let sy = Math.round((cy - vrect.top - offY) / scale);
  sx = Math.min(Math.max(sx, 0), vW - 1);
  sy = Math.min(Math.max(sy, 0), vH - 1);
  // The front camera is displayed mirrored, so flip x back to source space.
  if (state.facingMode === "user") sx = vW - 1 - sx;

  sampleCanvas.width = vW;
  sampleCanvas.height = vH;
  sctx.drawImage(video, 0, 0, vW, vH);
  const d = sctx.getImageData(sx, sy, 1, 1).data;
  return rgbToHex(d[0], d[1], d[2]);
}

/* ---------- Controls / actions ---------- */
function collectedColors() {
  return state.cells.filter((c) => c.color).map((c) => c.color);
}

function updateControls() {
  const filled = collectedColors().length;
  const selectBtn = el("select-btn");
  selectBtn.classList.toggle("active", state.selecting);
  selectBtn.textContent = state.selecting ? "Done" : "Select";
  const collectBtn = el("collect-btn");
  collectBtn.dataset.count = String(filled);
  collectBtn.disabled = filled === 0;
}

function toggleSelect() {
  state.selecting = !state.selecting;
  if (!state.selecting) state.cells.forEach((c) => (c.selected = false));
  renderCells();
}

function collect() {
  const colors = collectedColors();
  if (!colors.length) return;
  const num = state.collections.length + 1;
  state.collections.unshift({
    id: Date.now(),
    name: "Collection #" + String(num).padStart(3, "0"),
    colors,
    date: new Date().toISOString(),
  });
  saveCollections();
  clearGrid();
  showToast("Saved " + colors.length + " color" + (colors.length > 1 ? "s" : ""));
}

function clearGrid() {
  state.cells = Array.from({ length: CELL_COUNT }, () => ({ color: null, selected: false }));
  state.selecting = false;
  renderCells();
}

/* ---------- Screens / navigation ---------- */
function show(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  el(screenId).classList.add("active");
}

function renderReflect() {
  const list = el("reflect-list");
  list.innerHTML = "";
  if (!state.collections.length) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.textContent = "No collections yet. Sample some colors on the camera, then tap Collect.";
    list.appendChild(note);
    return;
  }
  state.collections.forEach((col) => {
    const item = document.createElement("button");
    item.className = "list-item";
    item.textContent = col.name + "  ·  " + col.colors.length;
    item.addEventListener("click", () => renderCollection(col));
    list.appendChild(item);
  });
}

function renderCollection(col) {
  el("collection-title").textContent = col.name;
  const wrap = el("collection-swatches");
  wrap.innerHTML = "";
  col.colors.forEach((hex) => {
    const tile = document.createElement("div");
    tile.className = "swatch-tile";
    tile.style.background = hex;
    tile.innerHTML = '<span class="hex">' + hex.toUpperCase() + "</span>";
    tile.addEventListener("click", () => copyText(hex, hex));
    wrap.appendChild(tile);
  });
  el("share-current").onclick = () => shareCollection(col);
  show("screen-collection");
}

async function shareCollection(col) {
  const text = col.name + "\n" + col.colors.map((c) => c.toUpperCase()).join("\n");
  if (navigator.share) {
    try { await navigator.share({ title: col.name, text }); return; } catch (e) { /* cancelled */ }
  }
  copyText(text, null, "Palette copied");
}

/* ---------- Helpers ---------- */
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

let toastTimer;
function showToast(text, swatch) {
  toast.innerHTML = swatch
    ? '<span class="swatch" style="background:' + swatch + '"></span>' + text
    : text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1600);
}

async function copyText(text, swatch, label) {
  try { await navigator.clipboard.writeText(text); showToast(label || "Copied " + text, swatch); }
  catch { showToast(text, swatch); }
}

function loadCollections() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
  catch { return []; }
}
function saveCollections() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.collections)); }
  catch (e) { console.warn("Could not persist collections", e); }
}

/* ---------- Wire up ---------- */
function init() {
  buildGrid();

  el("collect-btn").addEventListener("click", collect);
  el("select-btn").addEventListener("click", toggleSelect);
  el("options-btn").addEventListener("click", () => show("screen-options"));
  el("flip-btn").addEventListener("click", flipCamera);

  el("opt-collect").addEventListener("click", () => show("screen-camera"));
  el("opt-back").addEventListener("click", () => show("screen-camera"));
  el("opt-reflect").addEventListener("click", () => { renderReflect(); show("screen-reflect"); });
  el("opt-share").addEventListener("click", () => {
    const colors = collectedColors();
    if (colors.length) {
      shareCollection({ name: "Current palette", colors });
    } else {
      showToast("Nothing to share yet");
    }
  });

  el("reflect-options").addEventListener("click", () => show("screen-options"));
  el("reflect-collect").addEventListener("click", () => show("screen-camera"));
  el("collection-back").addEventListener("click", () => { renderReflect(); show("screen-reflect"); });

  startCamera();
}

document.addEventListener("DOMContentLoaded", init);
