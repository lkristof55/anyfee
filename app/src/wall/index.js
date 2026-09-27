// Wall controller (in the main bundle). Lazy-loads the three.js scene, keeps one renderer for
// the whole visit (moved between pages), and falls back to a CSS wall without WebGL.
import { h, prefersReducedMotion } from "../lib/dom.js";
import { groupDigits } from "../lib/format.js";

let instance = null;
let fallback = null;
let loading = null;
let host = null;
let desired = null; // last showBox payload, or null for "no box"
let pendingLetter = false;

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function applyDesired(target) {
  if (desired) target.showBox(desired);
  else target.clearBox();
  if (pendingLetter) {
    pendingLetter = false;
    target.dropLetter();
  }
}

function useFallback() {
  instance?.dispose();
  instance = null;
  fallback ??= createFallback();
  host?.append(fallback.el);
  host?.classList.add("is-ready");
  applyDesired(fallback);
}

/** Mounts (or moves) the wall into `container`. */
export function mountWall(container) {
  host = container;
  if (instance) {
    container.append(instance.canvas);
    container.classList.add("is-ready");
    instance.resize();
    return;
  }
  if (fallback) {
    container.append(fallback.el);
    container.classList.add("is-ready");
    return;
  }
  if (!webglAvailable()) {
    useFallback();
    return;
  }
  loading ??= Promise.all([import("./scene.js"), document.fonts?.ready ?? Promise.resolve()])
    .then(async ([m]) => {
      // the engraving is drawn with the site's faces: make sure they are loaded first
      await Promise.all(
        ['800 64px "Big Shoulders Display"', '600 20px "IBM Plex Mono"', '700 20px "Public Sans"'].map((f) => document.fonts?.load(f).catch(() => null)),
      );
      instance = m.createWall(host, { reducedMotion: prefersReducedMotion(), onReady: () => host.classList.add("is-ready") });
      instance.onLost = useFallback;
      applyDesired(instance);
    })
    .catch(() => useFallback());
}

function target() {
  return instance ?? fallback;
}

export const wall = {
  showBox(b) {
    desired = b;
    target()?.showBox(b);
  },
  updateBox(b) {
    if (desired && desired.key === b.key) desired = b;
    target()?.updateBox(b);
  },
  clearBox() {
    desired = null;
    target()?.clearBox();
  },
  dropLetter() {
    const t = target();
    if (t) t.dropLetter();
    else pendingLetter = true;
  },
};

// ---- CSS fallback: a small wall of DOM doors ------------------------------------------------------

function createFallback() {
  const COLS = 7;
  const ROWS = 4;
  const FEAT = 1 * COLS + 4;
  const doors = [];
  const grid = h("div.fb-wall");
  for (let k = 0; k < COLS * ROWS; k++) {
    const num = h("span.fb-num");
    const d = h("div.fb-door", h("span.fb-window"), h("span.fb-slot"), num, h("span.fb-dial"));
    if (k === FEAT) d.classList.add("fb-featured");
    grid.append(d);
    doors.push(num);
  }
  const letter = h("span.fb-letter");
  const el = h("div.fb", { "aria-hidden": "true" }, grid, letter);
  const setNumbers = (base) => {
    doors.forEach((n, k) => {
      const v = base + BigInt(k - FEAT);
      n.textContent = v > 0n ? groupDigits(v.toString()) : "";
    });
  };
  setNumbers(1024n);
  const featured = grid.children[FEAT];
  return {
    el,
    showBox(b) {
      setNumbers(BigInt(b.number));
      featured.dataset.status = b.status ?? "";
      featured.classList.add("is-out");
    },
    updateBox(b) {
      featured.dataset.status = b.status ?? "";
    },
    clearBox() {
      featured.classList.remove("is-out");
      setNumbers(1024n);
    },
    dropLetter() {
      if (prefersReducedMotion()) return;
      letter.classList.remove("is-dropping");
      void letter.offsetWidth;
      letter.classList.add("is-dropping");
    },
  };
}
