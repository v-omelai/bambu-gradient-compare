const MOBILE_MAX_WIDTH = 860;
/** Layer strip is horizontal below this width; keep in sync with styles.css @media. */
const layerStripMobileMql = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);

const SYNC_DRIFT_SEC = 0.08;

function getVideoBaseUrl() {
  const [owner] = window.location.hostname.split(".");
  const repo = window.location.pathname.split("/").filter(Boolean)[0];
  return `https://media.githubusercontent.com/media/${owner}/${repo}/main/assets/`;
}

const VIDEO_BASE_URL = getVideoBaseUrl();
const PRELOAD_REQUEST_TIMEOUT_MS = 300000;
const PRELOAD_CONCURRENCY = 2;
const LOADER_MESSAGES = {
  downloading: (pct, done, total) => `Downloading videos... ${pct}% (${done}/${total})`,
  failedAt: (pct, done, total) => `Download failed at ${pct}% (${done}/${total})`,
  unexpected: "Unexpected preload error"
};

const config = {
  totalLayers: 2233,
  videoA: "Cotton Candy Cloud.mp4",
  videoB: "Blueberry Bubblegum.mp4"
};

/** Timeline cap: 1:33 — longer files play only this much; shorter files unchanged. */
const PLAYBACK_MAX_SEC = 60 + 33;

function getPlaybackLimit() {
  const a = Number(videoA.duration);
  const b = Number(videoB.duration);
  let limit = PLAYBACK_MAX_SEC;
  if (Number.isFinite(a) && a > 0) limit = Math.min(limit, a);
  if (Number.isFinite(b) && b > 0) limit = Math.min(limit, b);
  return Math.max(0, limit);
}

function clampTimelineTime(t) {
  const lim = getPlaybackLimit();
  if (!lim) return t;
  return clamp(t, 0, Math.max(0, lim - 0.01));
}

/** True when Play should rewind to 0 (at cap or native ended). */
function shouldRestartPlaybackFromStart() {
  if (videoA.ended || videoB.ended) return true;
  const lim = getPlaybackLimit();
  if (!lim) return false;
  const tail = 0.06;
  return (
    videoA.currentTime >= lim - tail && videoB.currentTime >= lim - tail
  );
}

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
const appLoader = document.getElementById("appLoader");
const appLoaderBar = document.getElementById("appLoaderBar");
const appLoaderStatus = document.getElementById("appLoaderStatus");
const appLoaderBytes = document.getElementById("appLoaderBytes");
const appLoaderRetry = document.getElementById("appLoaderRetry");
const preloadedVideoUrls = new Map();
let preloadInFlight = false;

function clearPreloadedVideos() {
  for (const url of preloadedVideoUrls.values()) {
    URL.revokeObjectURL(url);
  }
  preloadedVideoUrls.clear();
}

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
  "Solar Breeze.mp4": ["#E94B3C", "#FFFFFF"],
  "Ocean to Meadow.mp4": ["#307FE2", "#54FF9B"],
  "Cotton Candy Cloud.mp4": ["#E7C1D5", "#8EC9E9"],
  "Blueberry Bubblegum.mp4": ["#6FCAEF", "#8573DD"]
};

function buildVideoUrl(fileName) {
  return `${VIDEO_BASE_URL}${encodeURIComponent(fileName)}`;
}

function getAllVideoFiles() {
  const files = new Set();
  for (const option of videoSelectA.options) files.add(option.value);
  for (const option of videoSelectB.options) files.add(option.value);
  return Array.from(files);
}

function setUiLocked(locked) {
  videoSelectA.disabled = locked;
  videoSelectB.disabled = locked;
  compareRange.disabled = locked;
  layerRange.disabled = locked;
  playPauseBtn.disabled = locked;
  stopBtn.disabled = locked;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const digits = idx === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[idx]}`;
}

function updateLoaderProgress(done, total, downloadedBytes = 0) {
  const safeTotal = Math.max(1, total);
  const pct = Math.round((done / safeTotal) * 100);
  const bytesText = `${formatBytes(downloadedBytes)}`;
  appLoaderBar.style.width = `${pct}%`;
  appLoaderStatus.textContent = LOADER_MESSAGES.downloading(pct, done, safeTotal);
  appLoaderBytes.textContent = bytesText;
}

function hideLoader() {
  appLoader.classList.add("is-hidden");
}

function setLoaderStateLoading() {
  appLoaderStatus.classList.remove("is-error");
  appLoaderBytes.textContent = "";
  appLoaderRetry.hidden = true;
}

function setLoaderStateError(message) {
  appLoaderStatus.classList.add("is-error");
  appLoaderStatus.textContent = message;
  appLoaderBytes.textContent = "";
  appLoaderRetry.hidden = false;
}

async function preloadVideoFully(fileName, controller, onChunk) {
  const timeoutId = setTimeout(() => controller.abort(), PRELOAD_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(buildVideoUrl(fileName), {
      cache: "force-cache",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Failed to download ${fileName} (${response.status})`);

    let blob;
    if (response.body && response.body.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        if (onChunk) onChunk(fileName, value.byteLength);
      }
      blob = new Blob(chunks, { type: response.headers.get("content-type") || "video/mp4" });
    } else {
      blob = await response.blob();
      if (onChunk) onChunk(fileName, blob.size);
    }
    const objectUrl = URL.createObjectURL(blob);
    const previousUrl = preloadedVideoUrls.get(fileName);
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
    }
    preloadedVideoUrls.set(fileName, objectUrl);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function preloadAllVideos(files, onProgress) {
  const workerCount = Math.min(PRELOAD_CONCURRENCY, Math.max(1, files.length));
  const controllers = new Set();
  let nextIndex = 0;
  let done = 0;
  let stopped = false;
  let firstFailureDone = null;
  let downloadedBytes = 0;
  const emitProgress = () => onProgress(done, downloadedBytes);

  const stopAll = () => {
    stopped = true;
    for (const controller of controllers) {
      controller.abort();
    }
  };

  async function worker() {
    while (!stopped) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= files.length) return;

      const file = files[currentIndex];
      const controller = new AbortController();
      controllers.add(controller);

      try {
        await preloadVideoFully(
          file,
          controller,
          (_fileName, chunkBytes) => {
            downloadedBytes += chunkBytes;
            emitProgress();
          }
        );
        if (stopped) return;
        done += 1;
        emitProgress();
      } catch (error) {
        if (!stopped) {
          firstFailureDone = done;
          stopAll();
          throw error;
        }
        return;
      } finally {
        controllers.delete(controller);
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } catch (error) {
    const failure = new Error("preload-failed");
    failure.doneBeforeFailure = firstFailureDone ?? done;
    throw failure;
  }
}

function resolveVideoSrc(fileName) {
  const url = preloadedVideoUrls.get(fileName);
  if (!url) {
    throw new Error(`Video is not preloaded: ${fileName}`);
  }
  return url;
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
setUiLocked(true);

function switchVideo(targetVideo, sourcePath) {
  const wasPlaying = !videoA.paused || !videoB.paused;
  const anchorTime = videoA.currentTime || videoB.currentTime || 0;
  targetVideo.src = resolveVideoSrc(sourcePath);
  targetVideo.load();
  targetVideo.addEventListener("loadedmetadata", () => {
    const lim = getPlaybackLimit();
    const rawMax = Math.max(0, (targetVideo.duration || 0) - 0.01);
    const maxTime = lim > 0 ? Math.min(rawMax, lim) : rawMax;
    targetVideo.currentTime = clampTimelineTime(Math.min(anchorTime, maxTime));
    if (wasPlaying) {
      videoA.play();
      videoB.play();
    }
    updateButtonsState();
  }, { once: true });
}

layerRange.addEventListener("input", () => {
  updateLayerTrail();
  const lim = getPlaybackLimit();
  if (!lim || lim <= 0) return;
  const targetLayer = Number(layerRange.value);
  const progress = (targetLayer - 1) / (config.totalLayers - 1);
  const targetTime = progress * lim;
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
  if (shouldRestartPlaybackFromStart()) {
    videoA.currentTime = 0;
    videoB.currentTime = 0;
    applyLayerByTime(0, getPlaybackLimit() || videoA.duration);
    updateButtonsState();
  }
  Promise.allSettled([videoA.play(), videoB.play()]);
});

stopBtn.addEventListener("click", () => {
  videoA.pause();
  videoB.pause();
  videoA.currentTime = 0;
  videoB.currentTime = 0;
  applyLayerByTime(0, getPlaybackLimit() || videoA.duration);
  updateButtonsState();
});

videoA.addEventListener("play", () => mirrorPlayFrom(videoA));
videoB.addEventListener("play", () => mirrorPlayFrom(videoB));
videoA.addEventListener("pause", () => mirrorPauseFrom(videoA));
videoB.addEventListener("pause", () => mirrorPauseFrom(videoB));

videoA.addEventListener("seeking", () => syncVideoTime(videoA, videoB));
videoB.addEventListener("seeking", () => syncVideoTime(videoB, videoA));
videoA.addEventListener("timeupdate", () => {
  const lim = getPlaybackLimit();
  if (lim > 0 && videoA.currentTime > lim) {
    videoA.currentTime = lim;
    videoB.currentTime = lim;
    videoA.pause();
    videoB.pause();
  }
  syncVideoTime(videoA, videoB);
  applyLayerByTime(videoA.currentTime, lim || videoA.duration);
  updateButtonsState();
});
videoB.addEventListener("timeupdate", () => {
  const lim = getPlaybackLimit();
  if (lim > 0 && videoB.currentTime > lim) {
    videoA.currentTime = lim;
    videoB.currentTime = lim;
    videoA.pause();
    videoB.pause();
  }
  syncVideoTime(videoB, videoA);
  updateButtonsState();
});

videoA.addEventListener("loadedmetadata", () => {
  applyLayerByTime(videoA.currentTime, getPlaybackLimit() || videoA.duration);
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

async function bootstrapPreload() {
  if (preloadInFlight) return;
  preloadInFlight = true;
  clearPreloadedVideos();
  setLoaderStateLoading();
  const files = getAllVideoFiles();
  const total = files.length;
  let done = 0;
  updateLoaderProgress(done, total, 0);

  try {
    await preloadAllVideos(files, (completed, downloadedBytes) => {
      done = completed;
      updateLoaderProgress(done, total, downloadedBytes);
    });

    videoA.src = resolveVideoSrc(config.videoA);
    videoB.src = resolveVideoSrc(config.videoB);
    videoA.load();
    videoB.load();

    hideLoader();
    setUiLocked(false);
    updateButtonsState();
  } catch (error) {
    if (error?.message === "preload-failed") {
      const failedStep = Math.min((error.doneBeforeFailure ?? done) + 1, total);
      const failedPct = Math.round((failedStep / Math.max(1, total)) * 100);
      setLoaderStateError(LOADER_MESSAGES.failedAt(failedPct, failedStep, total));
    } else {
      setLoaderStateError(LOADER_MESSAGES.unexpected);
      console.error(error);
    }
  } finally {
    preloadInFlight = false;
  }
}

appLoaderRetry.addEventListener("click", () => {
  bootstrapPreload();
});

window.addEventListener("beforeunload", () => {
  clearPreloadedVideos();
});

bootstrapPreload();
