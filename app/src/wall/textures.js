// Procedural canvas textures for the brass P.O. box doors: color, roughness/metalness (ORM:
// G = roughness, B = metalness, as three.js reads them) and a bump map for the engraving.
// Everything is drawn in "door units": x in [-0.5, 0.5], y in [-0.32, 0.32] (door 1.0 x 0.64).

export const DOOR_W = 1.0;
export const DOOR_H = 0.64;

export const LAYOUT = {
  window: { x0: -0.43, x1: -0.04, y0: -0.245, y1: 0.245 },
  slot: { x0: 0.04, x1: 0.44, y0: 0.2, y1: 0.245 },
  plate: { x0: 0.04, x1: 0.44, y0: 0.035, y1: 0.165 },
  dial: { cx: 0.24, cy: -0.125, r: 0.115 },
};

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mapper(W, H) {
  return {
    x: (u) => (u + DOOR_W / 2) * (W / DOOR_W),
    y: (v) => ((DOOR_H / 2 - v) / DOOR_H) * H,
    s: (d) => d * (W / DOOR_W),
  };
}

function rect(ctx, m, r) {
  const x = m.x(r.x0);
  const y = m.y(r.y1);
  return [x, y, m.x(r.x1) - x, m.y(r.y0) - y];
}

function makeCanvas(W, H) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  return c;
}

const DIAL_LETTERS = "ABCDEFGHIJ";

/**
 * Draws one door into three canvases.
 * opts: { featured, number, platformLabel, holder, status, seed }
 * status: "unclaimed" | "claimed" | "declined" | "pending" | null
 */
export function drawDoor(W, H, opts = {}) {
  const color = makeCanvas(W, H);
  const orm = makeCanvas(W, H);
  const bump = makeCanvas(W, H);
  const c = color.getContext("2d");
  const o = orm.getContext("2d");
  const b = bump.getContext("2d");
  const m = mapper(W, H);
  const rand = rng(opts.seed ?? 7);
  const px = W / 512;

  // --- brushed brass base
  const g = c.createLinearGradient(0, 0, W * 0.35, H);
  g.addColorStop(0, "#dcbd74");
  g.addColorStop(0.5, "#bc974c");
  g.addColorStop(1, "#94702f");
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  o.fillStyle = "rgb(0, 92, 255)";
  o.fillRect(0, 0, W, H);
  b.fillStyle = "rgb(150,150,150)";
  b.fillRect(0, 0, W, H);
  for (let i = 0; i < H * 1.4; i++) {
    const y = rand() * H;
    const a = 0.025 + rand() * 0.06;
    c.fillStyle = rand() < 0.5 ? `rgba(255,238,190,${a})` : `rgba(70,45,10,${a})`;
    const x0 = rand() * W * 0.3;
    c.fillRect(x0, y, W - x0 * rand(), Math.max(1, px * 0.8));
    o.fillStyle = `rgba(0,${rand() < 0.5 ? 120 : 70},255,${0.25 + rand() * 0.25})`;
    o.fillRect(0, y, W, Math.max(1, px * 0.8));
  }
  // soft edge darkening
  const edge = c.createRadialGradient(W * 0.45, H * 0.4, H * 0.2, W * 0.5, H * 0.5, W * 0.62);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(1, "rgba(40,25,5,0.35)");
  c.fillStyle = edge;
  c.fillRect(0, 0, W, H);

  // --- engraved border
  const inset = 0.022;
  const eb = [m.x(-0.5 + inset), m.y(0.32 - inset), m.s(1 - inset * 2), m.s(0.64 - inset * 2)];
  c.lineWidth = 2 * px;
  c.strokeStyle = "rgba(60,38,8,0.75)";
  c.strokeRect(...eb);
  c.strokeStyle = "rgba(255,240,200,0.45)";
  c.strokeRect(eb[0] + 1.5 * px, eb[1] + 1.5 * px, eb[2], eb[3]);
  b.lineWidth = 2.5 * px;
  b.strokeStyle = "rgb(80,80,80)";
  b.strokeRect(...eb);

  // --- window (glass over a dark box interior)
  const [wx, wy, ww, wh] = rect(c, m, LAYOUT.window);
  const frame = 7 * px;
  c.fillStyle = "#6f5220";
  c.fillRect(wx - frame, wy - frame, ww + frame * 2, wh + frame * 2);
  c.fillStyle = "#e9cf8c";
  c.fillRect(wx - frame, wy - frame, ww + frame * 2, 2 * px);
  const gl = c.createLinearGradient(wx, wy, wx + ww, wy + wh);
  gl.addColorStop(0, "#15201b");
  gl.addColorStop(1, "#070b09");
  c.fillStyle = gl;
  c.fillRect(wx, wy, ww, wh);
  if (opts.featured && (opts.holder || opts.status)) drawSlip(c, wx, wy, ww, wh, opts, px);
  // glass sheen
  const sh = c.createLinearGradient(wx, wy, wx + ww, wy + wh * 0.6);
  sh.addColorStop(0, "rgba(255,255,255,0.10)");
  sh.addColorStop(0.35, "rgba(255,255,255,0.02)");
  sh.addColorStop(0.36, "rgba(255,255,255,0)");
  c.fillStyle = sh;
  c.fillRect(wx, wy, ww, wh);
  o.fillStyle = "rgb(0,40,0)";
  o.fillRect(wx, wy, ww, wh);
  o.fillStyle = "rgb(0,70,255)";
  o.fillRect(wx - frame, wy - frame, ww + frame * 2, frame);
  b.fillStyle = "rgb(200,200,200)";
  b.fillRect(wx - frame, wy - frame, ww + frame * 2, wh + frame * 2);
  b.fillStyle = "rgb(110,110,110)";
  b.fillRect(wx, wy, ww, wh);
  // muntins: two thin vertical bars
  for (const f of [1 / 3, 2 / 3]) {
    const bx = wx + ww * f - 2 * px;
    c.fillStyle = "#a88641";
    c.fillRect(bx, wy, 4 * px, wh);
    c.fillStyle = "rgba(255,236,180,0.5)";
    c.fillRect(bx, wy, 1.2 * px, wh);
    o.fillStyle = "rgb(0,80,255)";
    o.fillRect(bx, wy, 4 * px, wh);
    b.fillStyle = "rgb(190,190,190)";
    b.fillRect(bx, wy, 4 * px, wh);
  }

  // --- mail slot
  const [sx, sy, sw, shh] = rect(c, m, LAYOUT.slot);
  c.fillStyle = "#e7cb86";
  c.fillRect(sx - 4 * px, sy - 4 * px, sw + 8 * px, shh + 8 * px);
  c.fillStyle = "#5c4218";
  c.fillRect(sx - 3 * px, sy + shh, sw + 6 * px, 3 * px);
  c.fillStyle = "#050605";
  c.fillRect(sx, sy, sw, shh);
  o.fillStyle = "rgb(0,235,0)";
  o.fillRect(sx, sy, sw, shh);
  b.fillStyle = "rgb(215,215,215)";
  b.fillRect(sx - 4 * px, sy - 4 * px, sw + 8 * px, shh + 8 * px);
  b.fillStyle = "rgb(30,30,30)";
  b.fillRect(sx, sy, sw, shh);
  c.font = `600 ${9 * px}px "IBM Plex Mono", monospace`;
  c.fillStyle = "rgba(70,45,10,0.8)";
  c.textBaseline = "top";
  c.fillText("LETTERS", sx, sy + shh + 6 * px);

  // --- number plate (recessed)
  const [plx, ply, plw, plh] = rect(c, m, LAYOUT.plate);
  c.fillStyle = "rgba(90,62,18,0.28)";
  c.fillRect(plx, ply, plw, plh);
  c.strokeStyle = "rgba(60,38,8,0.7)";
  c.lineWidth = 1.5 * px;
  c.strokeRect(plx, ply, plw, plh);
  c.strokeStyle = "rgba(255,240,200,0.35)";
  c.strokeRect(plx + 1.5 * px, ply + 1.5 * px, plw, plh);
  b.fillStyle = "rgb(128,128,128)";
  b.fillRect(plx, ply, plw, plh);
  if (opts.featured) drawEngraving(c, b, o, [plx, ply, plw, plh], opts, px);

  // --- combination dial
  const dcx = m.x(LAYOUT.dial.cx);
  const dcy = m.y(LAYOUT.dial.cy);
  const dr = m.s(LAYOUT.dial.r);
  const ring = c.createRadialGradient(dcx - dr * 0.3, dcy - dr * 0.3, dr * 0.1, dcx, dcy, dr);
  ring.addColorStop(0, "#f0d995");
  ring.addColorStop(0.7, "#b18a41");
  ring.addColorStop(1, "#6d501c");
  c.fillStyle = ring;
  c.beginPath();
  c.arc(dcx, dcy, dr, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "rgba(50,30,5,0.8)";
  c.lineWidth = 1.5 * px;
  c.stroke();
  b.fillStyle = "rgb(205,205,205)";
  b.beginPath();
  b.arc(dcx, dcy, dr, 0, Math.PI * 2);
  b.fill();
  c.font = `600 ${Math.round(dr * 0.2)}px "IBM Plex Mono", monospace`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 - Math.PI / 2;
    const r0 = dr * (i % 4 === 0 ? 0.74 : 0.82);
    c.strokeStyle = "rgba(55,35,6,0.85)";
    c.lineWidth = 1.1 * px;
    c.beginPath();
    c.moveTo(dcx + Math.cos(a) * r0, dcy + Math.sin(a) * r0);
    c.lineTo(dcx + Math.cos(a) * dr * 0.92, dcy + Math.sin(a) * dr * 0.92);
    c.stroke();
    if (i % 4 === 0) {
      c.fillStyle = "rgba(55,35,6,0.9)";
      c.fillText(DIAL_LETTERS[i / 4], dcx + Math.cos(a) * dr * 0.58, dcy + Math.sin(a) * dr * 0.58);
    }
  }
  const knob = c.createRadialGradient(dcx - dr * 0.12, dcy - dr * 0.12, 1, dcx, dcy, dr * 0.34);
  knob.addColorStop(0, "#fff0c0");
  knob.addColorStop(1, "#8a6627");
  c.fillStyle = knob;
  c.beginPath();
  c.arc(dcx, dcy, dr * 0.34, 0, Math.PI * 2);
  c.fill();
  b.fillStyle = "rgb(245,245,245)";
  b.beginPath();
  b.arc(dcx, dcy, dr * 0.34, 0, Math.PI * 2);
  b.fill();
  // pointer notch above the dial
  c.fillStyle = "#3b2708";
  c.beginPath();
  c.moveTo(dcx - 4 * px, dcy - dr - 7 * px);
  c.lineTo(dcx + 4 * px, dcy - dr - 7 * px);
  c.lineTo(dcx, dcy - dr - 1 * px);
  c.fill();

  c.textAlign = "left";
  c.textBaseline = "alphabetic";
  return { color, orm, bump };
}

function fitFont(ctx, text, weight, family, maxW, maxH) {
  let size = maxH;
  ctx.font = `${weight} ${size}px ${family}`;
  const w = ctx.measureText(text).width;
  if (w > maxW) size = Math.floor((size * maxW) / w);
  ctx.font = `${weight} ${size}px ${family}`;
  return size;
}

const DISPLAY = '"Big Shoulders Display", "Arial Narrow", sans-serif';
const THIN = " ";

function groupDigits(id) {
  return String(id).replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
}

/** Engraved platform label + box number on the featured door's plate. */
function drawEngraving(c, b, o, [x, y, w, h], opts, px) {
  const label = (opts.platformLabel ?? "P.O. BOX").toUpperCase();
  const num = opts.number ? groupDigits(opts.number) : "";
  const pad = 6 * px;
  c.textBaseline = "top";
  c.font = `600 ${Math.round(h * 0.2)}px "IBM Plex Mono", monospace`;
  engrave(c, b, label, x + pad, y + pad * 0.8, px, "rgba(52,33,6,0.9)");
  if (!num) return;
  c.textBaseline = "alphabetic";
  const size = fitFont(c, num, 800, DISPLAY, w - pad * 2, h * 0.64);
  engrave(c, b, num, x + pad, y + h - pad * 0.7 - (h * 0.64 - size) / 2, px, "rgba(45,28,4,0.95)");
  void o;
}

function engrave(c, b, text, x, y, px, ink) {
  c.fillStyle = "rgba(255,240,200,0.55)";
  c.fillText(text, x + 1.2 * px, y + 1.2 * px);
  c.fillStyle = ink;
  c.fillText(text, x, y);
  b.font = c.font;
  b.textBaseline = c.textBaseline;
  b.fillStyle = "rgb(60,60,60)";
  b.fillText(text, x, y);
}

const STATUS = {
  unclaimed: { text: "UNCLAIMED", ink: "#2d3f8c", sub: "unverified until claimed" },
  claimed: { text: "CLAIMED", ink: "#2f6b45", sub: "holder on file" },
  declined: { text: "RETURN TO SENDER", ink: "#b4362a", sub: "tips declined" },
  pending: { text: "CHANGE PENDING", ink: "#b4362a", sub: "rebind requested" },
};

/** A paper slip seen through the window: holder name and a rubber stamp for the status. */
function drawSlip(c, wx, wy, ww, wh, opts, px) {
  const st = STATUS[opts.status] ?? null;
  c.save();
  c.beginPath();
  c.rect(wx, wy, ww, wh);
  c.clip();
  c.translate(wx + ww * 0.52, wy + wh * 0.56);
  c.rotate(-0.045);
  const sw = ww * 0.9;
  const sh = wh * 0.72;
  c.fillStyle = "#e6e9df";
  c.fillRect(-sw / 2, -sh / 2, sw, sh);
  c.fillStyle = "rgba(0,0,0,0.08)";
  for (let i = 1; i < 6; i++) c.fillRect(-sw / 2 + 8 * px, -sh / 2 + (sh * i) / 6, sw - 16 * px, 1 * px);
  c.fillStyle = "#1b231e";
  c.textBaseline = "top";
  const holder = opts.holder ?? "";
  if (holder) {
    fitFont(c, holder, 700, '"Public Sans", sans-serif', sw - 20 * px, sh * 0.16);
    c.fillText(holder, -sw / 2 + 10 * px, -sh / 2 + 10 * px);
  }
  if (st) {
    c.translate(0, sh * 0.12);
    c.rotate(-0.08);
    fitFont(c, st.text, 800, DISPLAY, sw * 0.8, sh * 0.26);
    const tw = c.measureText(st.text).width;
    const bh = sh * 0.34;
    c.strokeStyle = st.ink;
    c.globalAlpha = 0.85;
    c.lineWidth = 3 * px;
    c.strokeRect(-tw / 2 - 8 * px, -bh / 2, tw + 16 * px, bh);
    c.lineWidth = 1 * px;
    c.strokeRect(-tw / 2 - 4 * px, -bh / 2 + 4 * px, tw + 8 * px, bh - 8 * px);
    c.fillStyle = st.ink;
    c.textBaseline = "middle";
    c.textAlign = "center";
    c.fillText(st.text, 0, 1 * px);
    c.globalAlpha = 1;
    c.textAlign = "left";
  }
  c.restore();
  c.textBaseline = "alphabetic";
}

/** Atlas of small engraved numbers for the rest of the wall: cols x rows cells. */
export function drawNumberAtlas(numbers, cols = 8, cellW = 256, cellH = 56) {
  const rows = Math.ceil(numbers.length / cols);
  const cv = makeCanvas(cols * cellW, rows * cellH);
  const c = cv.getContext("2d");
  c.textBaseline = "middle";
  numbers.forEach((n, i) => {
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * cellH;
    const text = n === null ? "" : groupDigits(n);
    if (!text) return;
    fitFont(c, text, 800, DISPLAY, cellW - 16, cellH * 0.78);
    c.fillStyle = "rgba(255,240,200,0.5)";
    c.fillText(text, x + 9, y + cellH / 2 + 1.5);
    c.fillStyle = "rgba(48,30,5,0.95)";
    c.fillText(text, x + 8, y + cellH / 2);
  });
  return { canvas: cv, cols, rows, cellW, cellH };
}

/** Envelope for the tip animation. */
export function drawEnvelope(W = 512, H = 320) {
  const cv = makeCanvas(W, H);
  const c = cv.getContext("2d");
  c.fillStyle = "#eceee6";
  c.fillRect(0, 0, W, H);
  c.strokeStyle = "rgba(0,0,0,0.12)";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(W / 2, H * 0.52);
  c.lineTo(W, 0);
  c.stroke();
  // stamp
  c.fillStyle = "#c9a45a";
  c.fillRect(W - 110, 18, 86, 104);
  c.strokeStyle = "#eceee6";
  c.setLineDash([4, 4]);
  c.lineWidth = 3;
  c.strokeRect(W - 110, 18, 86, 104);
  c.setLineDash([]);
  c.fillStyle = "#1e2c25";
  c.font = '800 40px "Big Shoulders Display", sans-serif';
  c.fillText("◎", W - 86, 86);
  // postmark waves
  c.strokeStyle = "rgba(45,63,140,0.75)";
  c.lineWidth = 3;
  for (let k = 0; k < 4; k++) {
    c.beginPath();
    for (let x = W - 250; x < W - 60; x += 6) c.lineTo(x, 60 + k * 14 + Math.sin(x / 14) * 5);
    c.stroke();
  }
  c.beginPath();
  c.arc(W - 250, 80, 38, 0, Math.PI * 2);
  c.stroke();
  // address lines
  c.fillStyle = "rgba(20,30,25,0.55)";
  for (let k = 0; k < 3; k++) c.fillRect(W * 0.28, H * 0.6 + k * 26, W * (0.42 - k * 0.06), 8);
  return cv;
}
