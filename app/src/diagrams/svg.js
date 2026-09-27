// Static SVG rendering of a scene frame: the first paint, the prefers-reduced-motion version and
// the no-WebGL fallback. Returns markup built only from numbers and fixed class names (labels
// are DOM overlays, never part of this string), so it is safe to insert as a trusted template.
// Colours come from CSS classes (see .dg-svg in main.css), so light and dark follow the page.
import { BASE, dot, toSvg, viewBox } from "./iso.js";
import { GLYPHS } from "./glyphs.js";

const n = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};
const P = (p, B) => {
  const [x, y] = toSvg(p, B);
  return `${n(x)},${n(y)}`;
};

// Box corners are indexed (ix << 2) | (iy << 1) | iz.
const FACES = [
  { n: [1, 0, 0], i: [4, 6, 7, 5] },
  { n: [-1, 0, 0], i: [0, 2, 3, 1] },
  { n: [0, 1, 0], i: [2, 6, 7, 3] },
  { n: [0, -1, 0], i: [0, 4, 5, 1] },
  { n: [0, 0, 1], i: [1, 5, 7, 3] },
  { n: [0, 0, -1], i: [0, 4, 6, 2] },
];
const EDGES = [];
for (let i = 0; i < 8; i++) for (const bit of [4, 2, 1]) if (!(i & bit)) EDGES.push([i, i | bit]);

const rotY = ([x, y, z], a) => (a ? [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)] : [x, y, z]);

export function boxCorners(c, s, ry = 0) {
  const out = [];
  for (let k = 0; k < 8; k++) {
    const l = [((k >> 2) & 1 ? 0.5 : -0.5) * s[0], ((k >> 1) & 1 ? 0.5 : -0.5) * s[1], (k & 1 ? 0.5 : -0.5) * s[2]];
    const r = rotY(l, ry);
    out.push([c[0] + r[0], c[1] + r[1], c[2] + r[2]]);
  }
  return out;
}

/** "t" (top), "l" (faces screen-left) or "r" for a face normal. */
export function toneOf(normal, B = BASE) {
  if (normal[1] > 0.5) return "t";
  return dot(normal, B.right) < 0 ? "l" : "r";
}

function boxItems(p, B) {
  const corners = boxCorners(p.c, p.s, p.ry ?? 0);
  const depth = dot(p.c, B.dir);
  const visible = FACES.map((f) => ({ ...f, nr: rotY(f.n, p.ry ?? 0) })).filter((f) => dot(f.nr, B.dir) > 1e-6);
  const poly = (f) => f.i.map((k) => P(corners[k], B)).join(" ");
  if (p.m === "glass") {
    // hidden corner = the one farthest from the camera; its three edges show through the glass
    let far = 0;
    corners.forEach((c, k) => {
      if (dot(c, B.dir) < dot(corners[far], B.dir)) far = k;
    });
    const hidden = EDGES.filter((e) => e.includes(far));
    const front = EDGES.filter((e) => !e.includes(far));
    const path = (list) => list.map(([a, b]) => `M${P(corners[a], B)}L${P(corners[b], B)}`).join("");
    const R = Math.hypot(...p.s) / 2;
    const dash = p.edge === "dash" ? " dash" : "";
    return [
      { layer: 1, depth: depth - R, o: p.o, svg: `<path class="e2 dash" d="${path(hidden)}"/>` },
      {
        layer: 1,
        depth: depth + 1e-3, // contents sit below the centre, anything resting on top above it
        o: p.o,
        svg: visible.map((f) => `<polygon class="f m-glass ${toneOf(f.nr, B)}" points="${poly(f)}"/>`).join("") + `<path class="e${dash}" d="${path(front)}"/>`,
      },
    ];
  }
  const cls = p.edge === "dash" ? " ghost" : p.edge === "none" ? " ns" : "";
  return [{ layer: 1, depth, o: p.o, svg: visible.map((f) => `<polygon class="f m-${p.m} ${toneOf(f.nr, B)}${cls}" points="${poly(f)}"/>`).join("") }];
}

function cylItems(p, B) {
  const [x, y, z] = p.c;
  const [tx, ty] = toSvg([x, y + p.h / 2, z], B);
  const [bx, by] = toSvg([x, y - p.h / 2, z], B);
  const rx = p.r;
  const ry = p.r * Math.sin(B.el);
  const e = (cx, cy) => `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}"`;
  const side =
    `<path class="f m-${p.m} l" d="M${n(bx - rx)},${n(by)}A${n(rx)},${n(ry)} 0 0 0 ${n(bx + rx)},${n(by)}L${n(tx + rx)},${n(ty)}L${n(tx - rx)},${n(ty)}Z"/>`;
  return [{ layer: 1, depth: dot(p.c, B.dir), o: p.o, svg: `${side}${e(tx, ty)} class="f m-${p.m} t"/>` }];
}

/** Affine map of the 24x24 glyph grid onto the top face of a plate, upright on screen. */
export function glyphMatrix(center, size, B = BASE) {
  const g = (size / Math.SQRT2) * 0.92;
  const s = Math.SQRT1_2;
  const U = [s, 0, -s]; // screen-right along the face
  const V = [s, 0, s]; // screen-down along the face
  const k = g / 24;
  const a = dot(U, B.right) * k;
  const b = -dot(U, B.up) * k;
  const c = dot(V, B.right) * k;
  const d = -dot(V, B.up) * k;
  const [sx, sy] = toSvg(center, B);
  return [a, b, c, d, sx - 12 * (a + c), sy - 12 * (b + d)];
}

function plateItems(p, B) {
  const c = [p.c[0], p.c[1] + p.h / 2, p.c[2]];
  const [box] = boxItems({ c, s: [p.size, p.h, p.size], m: "ink", o: p.o }, B);
  const m = glyphMatrix([p.c[0], p.c[1] + p.h, p.c[2]], p.size, B).map(n).join(" ");
  const glyph = GLYPHS[p.glyph] ? `<path class="gl" transform="matrix(${m})" d="${GLYPHS[p.glyph]}"/>` : "";
  return [{ ...box, svg: box.svg + glyph }];
}

function lineItems(p, B) {
  const cls = `ln ${p.tone ?? "line2"}${p.dash ? " dash" : ""}`;
  return [{ layer: p.layer ?? 0, depth: 0, o: p.o, svg: `<polyline class="${cls}" points="${p.pts.map((q) => P(q, B)).join(" ")}"/>` }];
}

function segsItems(p, B) {
  if (!p.pts.length) return [];
  let d = "";
  for (let i = 0; i + 1 < p.pts.length; i += 2) d += `M${P(p.pts[i], B)}L${P(p.pts[i + 1], B)}`;
  return [{ layer: p.layer ?? 0, depth: 0, o: p.o, svg: `<path class="ln ${p.tone ?? "line2"}" d="${d}"/>` }];
}

const KINDS = { box: boxItems, cyl: cylItems, plate: plateItems, line: lineItems, segs: segsItems };

/** Inner SVG markup (no <svg> wrapper) for a list of primitives, painter-sorted. */
export function primsToSvg(prims, B = BASE) {
  const items = [];
  for (const p of prims) {
    if (p.o !== undefined && p.o <= 0.01) continue;
    items.push(...KINDS[p.k](p, B));
  }
  items.sort((a, b) => a.layer - b.layer || a.depth - b.depth);
  return items.map((it) => (it.o !== undefined && it.o < 0.999 ? `<g opacity="${n(it.o)}">${it.svg}</g>` : it.svg)).join("");
}

/** A complete <svg> for one frame of a scene. */
export function renderSvg(scene, out, B = BASE) {
  const vb = viewBox(scene.frame).map(n).join(" ");
  return `<svg class="dg-svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${primsToSvg(out.prims, B)}</svg>`;
}
