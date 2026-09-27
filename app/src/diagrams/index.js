// Diagram slots. Every diagram paints first as a static SVG frame (also the prefers-reduced-motion
// and no-WebGL version), with its labels as DOM text. After first paint, and only if motion is
// allowed and WebGL works, the three.js engine (gl.js, a lazy chunk) takes over: one renderer for
// every diagram on the page, rendering only the ones on screen (IntersectionObserver), paused in
// background tabs, device pixel ratio capped at 2.
import { h, prefersReducedMotion, svg } from "../lib/dom.js";
import { BASE, basis, swayYaw, toFrame } from "./iso.js";
import { SCENES } from "./scenes.js";
import { renderSvg } from "./svg.js";

const PALETTE_KEYS = [
  "paper-t", "paper-l", "paper-r", "ink-t", "ink-l", "ink-r", "accent-t", "accent-l", "accent-r", "glass-t", "glass-l", "glass-r",
  "line", "line2", "grid", "accent", "glyph", "glassAlpha", "ghostAlpha",
];

const slots = new Set();
let engine = null;
let loading = null;
let state = "idle"; // idle | loading | live | static
let raf = 0;
let io = null;
let ro = null;

const now = () => performance.now() / 1000;

function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const k of PALETTE_KEYS) out[k] = cs.getPropertyValue(`--dg-${k}`).trim();
  return out;
}

function dpr() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

function observers() {
  io ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const s = e.target.__slot;
        if (!s) continue;
        s.visible = e.isIntersecting;
        if (s.visible) s.dirty = true;
      }
      kick();
    },
    { rootMargin: "120px 0px" },
  );
  ro ??= new ResizeObserver((entries) => {
    for (const e of entries) {
      const s = e.target.__slot;
      if (s) sizeCanvas(s);
    }
    kick();
  });
}

function sizeCanvas(s) {
  const r = s.stage.getBoundingClientRect();
  const d = dpr();
  s.pw = Math.max(1, Math.round(r.width * d));
  s.ph = Math.max(1, Math.round(r.height * d));
  if (s.canvas && (s.canvas.width !== s.pw || s.canvas.height !== s.ph)) {
    s.canvas.width = s.pw;
    s.canvas.height = s.ph;
  }
  s.dirty = true;
}

// ---- labels ---------------------------------------------------------------------------------------

function placeLabels(s, labels, B) {
  const seen = new Set();
  for (const l of labels) {
    let el = s.labelEls.get(l.id);
    if (!el) {
      const main = h("span.dg-l1");
      const sub = h("span.dg-l2");
      el = h(`span.dg-label.at-${l.anchor ?? "n"}`, main, sub);
      el.__parts = { main, sub };
      s.labelEls.set(l.id, el);
      s.labels.append(el);
    }
    const [x, y] = toFrame(l.at, s.scene.frame, B);
    const left = `${(x * 100).toFixed(2)}%`;
    const top = `${(y * 100).toFixed(2)}%`;
    if (el.style.left !== left) el.style.left = left;
    if (el.style.top !== top) el.style.top = top;
    const o = l.o ?? 1;
    const op = o >= 0.999 ? "" : o.toFixed(2);
    if (el.style.opacity !== op) el.style.opacity = op;
    el.classList.toggle("is-accent", l.tone === "accent");
    if (el.__parts.main.textContent !== l.text) el.__parts.main.textContent = l.text;
    const sub = l.sub ?? "";
    if (el.__parts.sub.textContent !== sub) el.__parts.sub.textContent = sub;
    el.hidden = o <= 0.01;
    seen.add(l.id);
  }
  for (const [id, el] of s.labelEls) if (!seen.has(id)) el.hidden = true;
}

// ---- static frame ---------------------------------------------------------------------------------

function drawStatic(s) {
  const out = s.scene.build(0, s.params, { static: true });
  s.svgHost.replaceChildren(svg(renderSvg(s.scene, out)));
  if (!s.canvas) {
    placeLabels(s, out.labels, BASE);
    s.onPhase?.(-1);
  }
}

// ---- live ------------------------------------------------------------------------------------------

function goLive(s) {
  if (s.canvas || !engine) return;
  s.canvas = h("canvas.dg-canvas", { "aria-hidden": "true" });
  s.ctx = s.canvas.getContext("2d");
  s.stage.insertBefore(s.canvas, s.labels);
  sizeCanvas(s);
  s.t0 = now();
}

function goStatic(s) {
  s.live = false;
  s.canvas?.remove();
  s.canvas = null;
  s.ctx = null;
  s.el.classList.remove("is-live");
  drawStatic(s);
}

function drop(s) {
  slots.delete(s);
  io?.unobserve(s.el);
  ro?.unobserve(s.stage);
  engine?.forget(s);
}

function kick() {
  if (!raf && state === "live" && !document.hidden) raf = requestAnimationFrame(frame);
}

function frame() {
  raf = 0;
  if (state !== "live" || !engine) return;
  const t = now();
  let again = false;
  for (const s of slots) {
    if (!s.el.isConnected) {
      if (s.seen && !s.keep) drop(s);
      continue;
    }
    s.seen = true;
    if (!s.canvas) goLive(s);
    if (!s.visible) continue;
    const pulsing = s.pulseAt >= 0 && t - s.pulseAt < s.scene.T;
    const animate = s.scene.loop || pulsing;
    if (!animate && !s.dirty) continue;
    s.dirty = false;
    let lt;
    let cycle = 0;
    let B = BASE;
    if (s.scene.loop) {
      const run = t - s.t0;
      lt = run % s.scene.T;
      cycle = Math.floor(run / s.scene.T);
      B = basis(swayYaw(run));
    } else {
      lt = pulsing ? t - s.pulseAt : -1;
    }
    const out = engine.render(s, lt, B, { cycle });
    placeLabels(s, out.labels, B);
    if (!s.live) {
      s.live = true;
      s.el.classList.add("is-live");
    }
    if (out.phase !== s.phase) {
      s.phase = out.phase;
      s.onPhase?.(out.phase);
    }
    if (animate) again = true;
  }
  if (again) kick();
}

/** Cheap capability probe, so a browser without WebGL never downloads three.js. */
function webglWorks() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function startEngine() {
  if (loading || state !== "idle") return;
  if (prefersReducedMotion() || !webglWorks()) {
    state = "static";
    return;
  }
  state = "loading";
  loading = import("./gl.js")
    .then((m) => {
      engine = m.createEngine(readPalette());
      engine.onLost = () => {
        state = "static";
        engine = null;
        for (const s of slots) goStatic(s);
      };
      state = "live";
      for (const s of slots) if (s.el.isConnected) goLive(s);
      kick();
    })
    .catch(() => {
      state = "static";
      engine = null;
    });
}

function afterFirstPaint(fn) {
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 250));
  if (document.readyState === "complete") requestAnimationFrame(() => requestAnimationFrame(idle));
  else window.addEventListener("load", () => requestAnimationFrame(idle), { once: true });
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      for (const s of slots) s.dirty = true;
      kick();
    }
  });
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    engine?.setPalette(readPalette());
    for (const s of slots) s.dirty = true;
    kick();
  });
  afterFirstPaint(startEngine);
}

/**
 * A diagram: `diagram("hero", params, { label, onPhase, keep })` -> { el, set(params), pulse(), destroy() }.
 * `label` is the accessible description of the whole figure (its parts are text overlays).
 * Detached diagrams are forgotten automatically unless `keep` is set (then the owner destroys them).
 */
export function diagram(name, params = {}, { label, onPhase, className, keep = false } = {}) {
  const scene = SCENES[name];
  if (!scene) throw new Error(`unknown diagram ${name}`);
  observers();
  wire();
  for (const old of slots) {
    if (old.el.isConnected) old.seen = true;
    else if (old.seen && !old.keep) drop(old);
  }
  const svgHost = h("div.dg-static");
  const labels = h("div.dg-labels", { "aria-hidden": label ? "true" : undefined });
  const stage = h("div.dg-stage", { style: `aspect-ratio:${scene.frame.w} / ${scene.frame.h}` }, svgHost, labels);
  const el = h(`div.dg.dg-${name}${className ? "." + className : ""}`, label ? { role: "img", "aria-label": label } : {}, stage);
  const s = {
    scene,
    params,
    el,
    stage,
    svgHost,
    labels,
    labelEls: new Map(),
    canvas: null,
    ctx: null,
    visible: false,
    seen: false,
    dirty: true,
    pulseAt: -1,
    t0: now(),
    phase: undefined,
    onPhase,
    keep,
    pw: 0,
    ph: 0,
  };
  el.__slot = s;
  stage.__slot = s;
  slots.add(s);
  drawStatic(s);
  io.observe(el);
  ro.observe(stage);
  if (state === "live") queueMicrotask(() => (goLive(s), kick()));
  return {
    el,
    set(next) {
      s.params = { ...s.params, ...next };
      drawStatic(s);
      s.dirty = true;
      kick();
    },
    /** Stops tracking the diagram (views that keep diagrams across renders call this on leave). */
    destroy() {
      drop(s);
    },
    /** One-shot animation (the vault scene: a tip landing). Static pages skip it. */
    pulse() {
      if (state !== "live") return;
      s.pulseAt = now();
      kick();
    },
  };
}
