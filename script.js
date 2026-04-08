const MOBILE_MAX_WIDTH = 860;
/** Layer strip is horizontal below this width; keep in sync with styles.css @media. */
const layerStripMobileMql = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);

const SYNC_DRIFT_SEC = 0.08;

function getVideoBaseUrl() {
  const [owner] = window.location.hostname.split(".");
  const repo = window.location.pathname.split("/").filter(Boolean)[0];
  return `https://github.com/${owner}/${repo}/raw/main/assets/`;
}

const VIDEO_BASE_URL = getVideoBaseUrl();

const config = {
  totalLayers: 2233,
  videoA: "Cotton Candy Cloud.mp4",
  videoB: "Blueberry Bubblegum.mp4"
};

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

const videoA = document.getElementById("videoA");
const videoB = document.getElementById("videoB");
const videoSelectA = document.getElementById("videoSelectA");
const videoSelectB = document.getElementById("videoSelectB");
const swatchA = document.getElementById("swatchA");
const swatchB = document.getElementById("swatchB");
const compareRange = document.getElementById("compareRange");
const playPauseBtn = document.getElementById("playPauseBtn");
const stopBtn = document.getElementById("stopBtn");
const videoOverlay = document.getElementById("videoOverlay");
const compareWrap = document.getElementById("compareWrap");
const compareDivider = document.getElementById("compareDivider");
const compareSection = document.querySelector(".compare-section");
const layerRange = document.getElementById("layerRange");
const layerStripWrap = document.querySelector(".layer-strip-wrap");
const layerMaxTop = document.getElementById("layerMaxTop");

let compareThumbPx = 18;
let layerThumbPx = 16;

function syncRangeThumbMetrics() {
  const root = getComputedStyle(document.documentElement);
  const c = parseFloat(root.getPropertyValue("--range-compare-thumb"));
  const l = parseFloat(root.getPropertyValue("--range-layer-thumb"));
  if (Number.isFinite(c) && c > 0) compareThumbPx = c;
  if (Number.isFinite(l) && l > 0) layerThumbPx = l;
}

const videoColors = {
  "Arctic Whisper.mp4": ["#9CDBD9", "#FFFFFF"],
  "Solar Breeze.mp4": ["#E94B3C", "#FFFFFF"],
  "Ocean to Meadow.mp4": ["#307FE2", "#54FF9B"],
  "Cotton Candy Cloud.mp4": ["#E7C1D5", "#8EC9E9"],
  "Blueberry Bubblegum.mp4": ["#6FCAEF", "#8573DD"],
  "Mint Lime.mp4": ["#B6FF43", "#4EC939"],
  "Pink Citrus.mp4": ["#F78F77", "#E4505A"],
  "Dusk Glare.mp4": ["#ED9558", "#CE4406"]
};

function buildVideoUrl(fileName) {
  return `${VIDEO_BASE_URL}${encodeURIComponent(fileName)}`;
}

function setOverlayWidth(percent) {
  const clamped = clamp(percent, 0, 100);
  const ratio = clamped / 100;
  const thumbSize = compareThumbPx;
  const rangeRect = compareRange.getBoundingClientRect();
  const wrapRect = compareWrap.getBoundingClientRect();
  const rangeWidth = rangeRect.width || 1;
  const wrapWidth = wrapRect.width || 1;
  const thumbCenterX =
    rangeRect.left + thumbSize / 2 + ratio * (rangeWidth - thumbSize);
  const thumbCenterInWrap = thumbCenterX - wrapRect.left;
  const alignedPercent = clamp((thumbCenterInWrap / wrapWidth) * 100, 0, 100);
  videoOverlay.style.clipPath = `inset(0 0 0 ${alignedPercent}%)`;
  compareDivider.style.left = `${alignedPercent}%`;
}

function setSwatchGradient(targetElement, videoPath) {
  const [from, to] = videoColors[videoPath] || ["#2D2D31", "#414147"];
  targetElement.style.background = `linear-gradient(135deg, ${from}, ${to})`;
}

function syncStripWrapHeight() {
  if (layerStripMobileMql.matches) {
    layerStripWrap.style.height = "";
    return;
  }
  const compareHeight = compareSection.getBoundingClientRect().height;
  layerStripWrap.style.height = `${Math.round(compareHeight)}px`;
}

/** Copy currentTime from `source` onto `target` when they drift (used while seeking). */
function syncVideoTime(source, target) {
  if (!Number.isFinite(source.currentTime) || !Number.isFinite(target.duration)) return;
  if (Math.abs(target.currentTime - source.currentTime) > SYNC_DRIFT_SEC) {
    target.currentTime = source.currentTime;
  }
}

function mirrorPlayFrom(primary) {
  const other = primary === videoA ? videoB : videoA;
  if (other.paused) other.play();
  updateButtonsState();
}

function mirrorPauseFrom(primary) {
  const other = primary === videoA ? videoB : videoA;
  if (!other.paused) other.pause();
  updateButtonsState();
}

function updateLayerTrail() {
  const min = Number(layerRange.min) || 1;
  const max = Number(layerRange.max) || config.totalLayers;
  let val = Number(layerRange.value);
  if (!Number.isFinite(val)) val = min;
  val = clamp(val, min, max);
  const thumb = layerThumbPx;
  const rect = layerRange.getBoundingClientRect();

  if (layerStripMobileMql.matches) {
    const w = rect.width || 1;
    const ratio = (val - min) / Math.max(1, max - min);
    const centerPx = thumb / 2 + ratio * Math.max(0, w - thumb);
    const pct = clamp((centerPx / w) * 100, 0, 100);
    layerRange.style.setProperty("--layer-fill-pct", `${pct}%`);
  } else {
    const h = rect.height || 1;
    const ratioFromTop = (max - val) / Math.max(1, max - min);
    const centerPx = thumb / 2 + ratioFromTop * Math.max(0, h - thumb);
    const pct = clamp((centerPx / h) * 100, 0, 100);
    layerRange.style.setProperty("--layer-fill-pct", `${pct}%`);
  }
}

function applyLayerByTime(currentSec, durationSec) {
  if (!durationSec || durationSec <= 0) {
    layerRange.value = "1";
    updateLayerTrail();
    return;
  }
  const progress = clamp(currentSec / durationSec, 0, 1);
  const mapped = Math.ceil(progress * (config.totalLayers - 1)) + 1;
  layerRange.value = String(clamp(mapped, 1, config.totalLayers));
  updateLayerTrail();
}

function getCurrentLayer() {
  const value = Number(layerRange.value);
  if (!Number.isFinite(value)) return 1;
  return clamp(Math.round(value), 1, config.totalLayers);
}

function updateButtonsState() {
  const playing = !videoA.paused && !videoB.paused;
  playPauseBtn.textContent = playing ? "I I" : "▶";
  playPauseBtn.classList.toggle("is-pause", playing);
  playPauseBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
  stopBtn.disabled = getCurrentLayer() <= 1;
}

videoA.src = buildVideoUrl(config.videoA);
videoB.src = buildVideoUrl(config.videoB);
videoSelectA.value = config.videoA;
videoSelectB.value = config.videoB;
setSwatchGradient(swatchA, config.videoA);
setSwatchGradient(swatchB, config.videoB);

layerRange.max = String(config.totalLayers);
layerMaxTop.textContent = String(config.totalLayers);
syncRangeThumbMetrics();
updateLayerTrail();
setOverlayWidth(Number(compareRange.value));

stopBtn.innerHTML = "<span class=\"stop-icon\">■</span>";
stopBtn.setAttribute("aria-label", "Stop");

function switchVideo(targetVideo, sourcePath) {
  const wasPlaying = !videoA.paused || !videoB.paused;
  const anchorTime = videoA.currentTime || videoB.currentTime || 0;
  targetVideo.src = buildVideoUrl(sourcePath);
  targetVideo.load();
  targetVideo.addEventListener("loadedmetadata", () => {
    const maxTime = Math.max(0, (targetVideo.duration || 0) - 0.01);
    targetVideo.currentTime = Math.min(anchorTime, maxTime);
    if (wasPlaying) {
      videoA.play();
      videoB.play();
    }
    updateButtonsState();
  }, { once: true });
}

layerRange.addEventListener("input", () => {
  updateLayerTrail();
  if (!videoA.duration || videoA.duration <= 0) return;
  const targetLayer = Number(layerRange.value);
  const progress = (targetLayer - 1) / (config.totalLayers - 1);
  const targetTime = progress * videoA.duration;
  videoA.currentTime = targetTime;
  videoB.currentTime = targetTime;
  updateButtonsState();
});

compareRange.addEventListener("input", (event) => {
  setOverlayWidth(Number(event.target.value));
});

videoSelectA.addEventListener("change", (event) => {
  setSwatchGradient(swatchA, event.target.value);
  switchVideo(videoA, event.target.value);
});

videoSelectB.addEventListener("change", (event) => {
  setSwatchGradient(swatchB, event.target.value);
  switchVideo(videoB, event.target.value);
});

playPauseBtn.addEventListener("click", () => {
  if (!videoA.paused || !videoB.paused) {
    videoA.pause();
    videoB.pause();
    return;
  }
  Promise.allSettled([videoA.play(), videoB.play()]);
});

stopBtn.addEventListener("click", () => {
  videoA.pause();
  videoB.pause();
  videoA.currentTime = 0;
  videoB.currentTime = 0;
  applyLayerByTime(0, videoA.duration);
  updateButtonsState();
});

videoA.addEventListener("play", () => mirrorPlayFrom(videoA));
videoB.addEventListener("play", () => mirrorPlayFrom(videoB));
videoA.addEventListener("pause", () => mirrorPauseFrom(videoA));
videoB.addEventListener("pause", () => mirrorPauseFrom(videoB));

videoA.addEventListener("seeking", () => syncVideoTime(videoA, videoB));
videoB.addEventListener("seeking", () => syncVideoTime(videoB, videoA));
videoA.addEventListener("timeupdate", () => {
  applyLayerByTime(videoA.currentTime, videoA.duration);
  updateButtonsState();
});
videoB.addEventListener("timeupdate", () => {
  syncVideoTime(videoB, videoA);
  updateButtonsState();
});

videoA.addEventListener("loadedmetadata", () => {
  applyLayerByTime(videoA.currentTime, videoA.duration);
  updateButtonsState();
  syncStripWrapHeight();
});

window.addEventListener("resize", () => {
  syncRangeThumbMetrics();
  syncStripWrapHeight();
  setOverlayWidth(Number(compareRange.value));
  updateLayerTrail();
});
syncStripWrapHeight();
updateLayerTrail();
updateButtonsState();
