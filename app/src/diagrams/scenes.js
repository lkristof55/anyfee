// The diagrams, as pure functions of time. Each scene's build(t, params, opts) returns
// { prims, labels, phase } in world units (see iso.js). The same output drives the WebGL engine
// (animated), the SVG renderer (static frame: opts.static) and the DOM labels. No DOM, no three.
//
// Primitives:
//   box   { id, k: "box", c, s: [w, h, d], ry?, m: "paper" | "ink" | "accent" | "glass", edge?: "line" | "dash" | "none", o? }
//   cyl   { id, k: "cyl", c, r, h, m, o? }                        (axis Y; c is the centre)
//   plate { id, k: "plate", c, size, h, glyph: "github" | "x", o? } (ink slab with a glyph on top; c = bottom centre)
//   line  { id, k: "line", pts, tone: "line" | "line2" | "accent", dash?, o? }
//   segs  { id, k: "segs", pts: [a, b, a, b, ...], tone, o?, layer? }
// Labels: { id, at, text (upper-cased keyword), sub? (data, shown as is), anchor: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw", o?, tone? }
// Colour: accent is money on the move (tokens, a vault's contents); ink is identity and proof.

import { BASE } from "./iso.js";

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const seg = (t, a, b) => clamp01((t - a) / (b - a));
export const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const mix = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const bez = (a, c, b, u) => mix(mix(a, c, u), mix(c, b, u), u);

const TOKEN = 0.2;

// ---- building blocks ---------------------------------------------------------------------------

function grid(id, x0, x1, z0, z1, step = 1) {
  const pts = [];
  for (let x = x0; x <= x1 + 1e-9; x += step) pts.push([x, 0, z0], [x, 0, z1]);
  for (let z = z0; z <= z1 + 1e-9; z += step) pts.push([x0, 0, z], [x1, 0, z]);
  return { id, k: "segs", pts, tone: "grid", layer: -1 };
}

function vault(id, [x, , z], size, { fill = 0, edge = "line", glyph = null, o = 1 } = {}) {
  const out = [{ id, k: "box", c: [x, size / 2, z], s: [size, size, size], m: "glass", edge, o }];
  if (fill > 0.005) {
    const inner = size - 0.2;
    const fh = (size - 0.16) * fill;
    out.push({ id: `${id}.fill`, k: "box", c: [x, 0.06 + fh / 2, z], s: [inner, fh, inner], m: "accent", o });
  }
  if (glyph) out.push({ id: `${id}.glyph`, k: "plate", c: [x, size + 0.004, z], size: size * 0.52, h: 0.07, glyph, o });
  return out;
}

function coin(id, [x, , z], n = 3, r = 0.5) {
  const h = 0.13;
  const out = [];
  for (let i = 0; i < n; i++) out.push({ id: `${id}.${i}`, k: "cyl", c: [x, h / 2 + i * (h + 0.03), z], r, h, m: "paper" });
  return out;
}

function wallet(id, [x, , z], { o = 1, edge = "line" } = {}) {
  return [
    { id, k: "box", c: [x, 0.15, z], s: [1.1, 0.3, 0.78], m: "paper", edge, o },
    { id: `${id}.chip`, k: "box", c: [x + 0.18, 0.32, z + 0.12], s: [0.3, 0.04, 0.22], m: "ink", o },
  ];
}

function pad(id, [x, , z], size = 0.95) {
  return { id, k: "box", c: [x, 0.03, z], s: [size, 0.06, size], m: "paper" };
}

const token = (id, c, o = 1) => ({ id, k: "box", c, s: [TOKEN, TOKEN, TOKEN], m: "accent", o });
const trace = (id, pts, { tone = "line2", dash = true, o = 1 } = {}) => ({ id, k: "line", pts, tone, dash, o });

/** Tokens emitted at `starts` travelling a→b in `dur` seconds, visible only while moving. */
function stream(id, t, starts, dur, a, b) {
  const out = [];
  starts.forEach((s, i) => {
    const u = (t - s) / dur;
    if (u > 0 && u < 1) out.push(token(`${id}.${i}`, mix(a, b, ease(u))));
  });
  return out;
}

/** Tokens frozen along a→b at fractions `us` (static frames). */
const frozen = (id, us, a, b) => us.map((u, i) => token(`${id}.${i}`, mix(a, b, u)));

const range = (n, first, gap) => Array.from({ length: n }, (_, i) => first + i * gap);

// Label anchors on an object's screen silhouette (camera at yaw 45): the top is its back-top
// corner, the bottom its front-bottom corner, left and right its side corners.
const S2 = Math.SQRT1_2;
const topOf = ([x, , z], w, h, d = w) => [x - w / 2, h, z - d / 2];
const bottomOf = ([x, , z], w, d = w) => [x + w / 2, 0, z + d / 2];
const leftOf = ([x, , z], w, y, d = w) => [x - w / 2, y, z + d / 2];
const rightOf = ([x, , z], w, y, d = w) => [x + w / 2, y, z - d / 2];
const discTop = ([x, , z], r, h) => [x - r * S2, h, z - r * S2];
const WALLET = { w: 1.1, h: 0.34, d: 0.78 };
const walletTop = (c) => topOf(c, WALLET.w, WALLET.h, WALLET.d);
const walletBottom = (c) => bottomOf(c, WALLET.w, WALLET.d);

// ---- hero: the whole flow ------------------------------------------------------------------------

const H = { R: 3.3, V: 1.5 };

const hero = {
  name: "hero",
  frame: { w: 7.6, h: 5.8, cx: 0, cy: 0.5 },
  T: 12,
  loop: true,
  phases: 3,
  build(t, p = {}, { static: still = false } = {}) {
    const { R, V } = H;
    const y = TOKEN / 2;
    const coinPath = [[-R + 0.55, y, 0], [-0.25, y, 0]];
    const tipPath = [[0, y, R - 0.5], [0, y, 0.25]];
    const outPath = [[0.25, y, 0], [R - 0.6, y, 0]];
    const pad0 = [0, 0.06, -R];
    const dock = [0, V + 0.004, 0];
    const arc = (u) => bez(pad0, [0, V + 0.9, -R * 0.55], dock, u);

    let fill, proofAt, proofO, bound, check, tokens;
    if (still) {
      fill = 0.34;
      proofAt = dock;
      proofO = 1;
      bound = true;
      check = 0;
      tokens = [
        ...frozen("in", [0.18, 0.4], ...coinPath),
        ...frozen("tip", [0.5], ...tipPath),
        ...frozen("out", [0.35, 0.72], ...outPath),
      ];
    } else {
      fill = 0.46 * ease(seg(t, 1.1, 4.4)) * (1 - ease(seg(t, 6.6, 9.4)));
      const travel = ease(seg(t, 4.2, 5.8));
      proofAt = arc(travel);
      proofO = t < 11 ? 1 : t < 11.4 ? 1 - seg(t, 11, 11.4) : seg(t, 11.5, 12);
      if (t >= 11.4) proofAt = pad0;
      bound = t >= 6.0 && t < 11.4;
      check = t >= 5.8 && t < 7.4 ? Math.min(seg(t, 5.8, 6.1), 1 - seg(t, 7.0, 7.4)) : 0;
      tokens = [
        ...stream("in", t, range(5, 0.2, 0.7), 1.3, ...coinPath),
        ...stream("tip", t, range(3, 0.7, 1.2), 1.3, ...tipPath),
        ...stream("out", t, range(4, 6.6, 0.6), 1.3, ...outPath),
      ];
    }

    const prims = [
      grid("grid", -4, 4, -4, 4, 1),
      trace("t.coin", [[-R + 0.5, 0, 0], [-V / 2, 0, 0]]),
      trace("t.tip", [[0, 0, R - 0.45], [0, 0, V / 2]]),
      trace("t.proof", [[0, 0, -R + 0.5], [0, 0, -V / 2]]),
      bound ? trace("t.link", [[V / 2, 0, 0], [R - 0.55, 0, 0]], { tone: "line", dash: false }) : trace("t.link", [[V / 2, 0, 0], [R - 0.55, 0, 0]]),
      ...coin("coin", [-R, 0, 0]),
      ...wallet("tipper", [0, 0, R]),
      pad("pad", [0, 0, -R]),
      ...wallet("owner", [R, 0, 0]),
      ...vault("vault", [0, 0, 0], V, { fill }),
      { id: "proof", k: "plate", c: proofAt, size: 0.78, h: 0.08, glyph: "github", o: proofO },
      ...tokens,
    ];
    const labels = [
      { id: "coin", at: discTop([-R, 0, 0], 0.5, 0.45), text: "Coin", sub: "creator fees", anchor: "n" },
      { id: "tipper", at: walletBottom([0, 0, R]), text: "Anyone", sub: "SOL · USDC tips", anchor: "s" },
      { id: "vault", at: bottomOf([0, 0, 0], V), text: check > 0.5 ? "✓ Verified on-chain" : "Vault", sub: p.vaultLabel ?? "github-repo · 1296269", anchor: "s", tone: check > 0.5 ? "accent" : undefined },
      { id: "proof", at: topOf(proofAt, 0.78, proofAt[1] + 0.4), text: "Proof", sub: "GitHub OIDC", anchor: "n", o: proofO },
      { id: "owner", at: walletBottom([R, 0, 0]), text: "Owner wallet", sub: bound ? "bound · withdraws" : "not bound yet", anchor: "s" },
    ];
    const phase = still ? -1 : t < 4.2 ? 0 : t < 6.3 ? 1 : 2;
    return { prims, labels, phase };
  },
};

// ---- 1. derive: id -> hash -> vault address ----------------------------------------------------------

const derive = {
  name: "derive",
  frame: { w: 5.8, h: 4.5, cx: 0, cy: 0.02 },
  T: 7,
  loop: true,
  build(t, p = {}, { static: still = false } = {}) {
    const S = 2.3;
    const V = 1.1;
    let tok = null;
    let spin = [0, 0, 0];
    let made;
    if (still) {
      tok = token("tok", [S * 0.55, TOKEN / 2, 0]);
      spin = [0.5, 0.25, 0];
      made = 1;
    } else {
      if (t < 1.6) tok = token("tok", mix([-S, 0.2, 0], [-0.1, 0.25, 0], ease(seg(t, 0.3, 1.6))), seg(t, 0, 0.3));
      else if (t >= 3.0 && t < 4.0) tok = token("tok", mix([0.55, TOKEN / 2, 0], [S - 0.2, TOKEN / 2, 0], ease(seg(t, 3.0, 4.0))));
      spin = [0, 1, 2].map((i) => ease(seg(t, 1.5 + i * 0.28, 2.4 + i * 0.28)));
      made = t < 6.3 ? seg(t, 3.9, 4.3) : 1 - seg(t, 6.3, 6.9);
    }
    const prims = [
      grid("grid", -3, 3, -1.5, 1.5, 1),
      trace("t.a", [[-S + 0.5, 0, 0], [-0.5, 0, 0]]),
      trace("t.b", [[0.5, 0, 0], [S - V / 2, 0, 0]]),
      { id: "id", k: "plate", c: [-S, 0, 0], size: 0.9, h: 0.1, glyph: p.glyph ?? "github" },
      ...[0, 1, 2].map((i) => ({ id: `h${i}`, k: "box", c: [0, 0.1 + i * 0.25, 0], s: [0.95, 0.2, 0.95], ry: (spin[i] * Math.PI) / 2, m: "paper" })),
      ...vault("vault", [S, 0, 0], V, { edge: made > 0.5 ? "line" : "dash" }),
      ...(tok ? [tok] : []),
    ];
    const labels = [
      { id: "id", at: topOf([-S, 0, 0], 0.9, 0.1), text: "id", sub: p.idLabel ?? "1296269", anchor: "n" },
      { id: "hash", at: topOf([0, 0, 0], 0.95, 0.7), text: "PDA", anchor: "n" },
      { id: "vault", at: bottomOf([S, 0, 0], V), text: "vault", sub: made > 0.5 ? p.addrLabel ?? "" : "…", anchor: "sw", o: 0.35 + 0.65 * made },
    ];
    return { prims, labels, phase: -1 };
  },
};

// ---- 2. fund: tips and creator fees in -------------------------------------------------------------------

const fund = {
  name: "fund",
  frame: { w: 5.8, h: 4.0, cx: 0, cy: 0.42 },
  T: 6,
  loop: true,
  build(t, p = {}, { static: still = false } = {}) {
    const D = 2.5;
    const V = 1.3;
    const y = TOKEN / 2;
    const feePath = [[-D + 0.5, y, 0], [-0.2, y, 0]];
    const tipPath = [[0, y, -D + 0.45], [0, y, -0.2]];
    let fill;
    let tokens;
    if (still) {
      fill = 0.34;
      tokens = [...frozen("fee", [0.08, 0.3], ...feePath), ...frozen("tip", [0.3], ...tipPath)];
    } else {
      fill = 0.06 + 0.42 * ease(seg(t, 0.9, 5.1)) - 0.42 * ease(seg(t, 5.4, 6));
      tokens = [...stream("fee", t, range(8, 0.05, 0.6), 1.1, ...feePath), ...stream("tip", t, range(4, 0.4, 1.2), 1.1, ...tipPath)];
    }
    const prims = [
      grid("grid", -3, 1, -3, 1, 1),
      trace("t.fee", [[-D + 0.5, 0, 0], [-V / 2, 0, 0]]),
      trace("t.tip", [[0, 0, -D + 0.45], [0, 0, -V / 2]]),
      ...coin("coin", [-D, 0, 0], 3, 0.46),
      ...wallet("tipper", [0, 0, -D]),
      ...vault("vault", [0, 0, 0], V, { fill }),
      ...tokens,
    ];
    const labels = [
      { id: "fees", at: discTop([-D, 0, 0], 0.46, 0.45), text: "creator fees", anchor: "n" },
      { id: "tips", at: walletTop([0, 0, -D]), text: "tips", anchor: "n" },
      { id: "vault", at: bottomOf([0, 0, 0], V), text: "vault", anchor: "s" },
    ];
    return { prims, labels, phase: -1 };
  },
};

// ---- 3. claim: proof -> attester signature -> on-chain check -> bind -> withdraw ---------------------------

const claim = {
  name: "claim",
  frame: { w: 6.2, h: 4.6, cx: 0.1, cy: 0.25 },
  T: 9,
  loop: true,
  build(t, p = {}, { static: still = false, cycle = 0 } = {}) {
    const D = 2.6;
    const V = 1.2;
    const A = 0.8; // attester block
    const y = TOKEN / 2;
    const glyph = cycle % 2 ? "x" : "github";
    const padAt = [-D, 0.06, 0];
    const onAtt = [0, A + 0.004, -D];
    const onVault = [0, V + 0.004, 0];
    const outPath = [[0.25, y, 0], [D - 0.6, y, 0]];
    let proofAt, sigAt, sigO, fill, bound, check, tokens;
    if (still) {
      proofAt = onAtt;
      sigAt = onVault;
      sigO = 1;
      fill = 0.22;
      bound = true;
      check = 1;
      tokens = frozen("out", [0.4], ...outPath);
    } else {
      proofAt = t < 8.2 ? bez(padAt, [-D * 0.5, 1.5, -D * 0.5], onAtt, ease(seg(t, 0.2, 1.4))) : padAt;
      sigO = t < 1.6 ? 0 : t < 7.9 ? seg(t, 1.6, 1.9) : 1 - seg(t, 7.9, 8.2);
      sigAt = bez([0, A + 0.1, -D], [0, 1.9, -D * 0.5], onVault, ease(seg(t, 2.0, 3.2)));
      fill = 0.4 * (1 - ease(seg(t, 4.3, 6.6))) + 0.4 * ease(seg(t, 8.2, 9));
      bound = t >= 3.8 && t < 8.2;
      check = t >= 3.2 && t < 4.6 ? Math.min(seg(t, 3.2, 3.5), 1 - seg(t, 4.3, 4.6)) : 0;
      tokens = stream("out", t, range(4, 4.3, 0.5), 1.1, ...outPath);
    }
    const proofO = still ? 1 : t < 8.2 ? 1 : seg(t, 8.4, 9);
    const prims = [
      grid("grid", -3, 3, -3, 1, 1),
      trace("t.pa", [[-D + 0.5, 0, 0], [-0.4, 0, -D + 0.4]]),
      trace("t.av", [[0, 0, -D + 0.45], [0, 0, -V / 2]]),
      trace("t.link", [[V / 2, 0, 0], [D - 0.55, 0, 0]], bound ? { tone: "line", dash: false } : {}),
      pad("pad", [-D, 0, 0]),
      { id: "att", k: "box", c: [0, A / 2, -D], s: [A, A, A], m: "paper" },
      ...vault("vault", [0, 0, 0], V, { fill }),
      ...wallet("owner", [D, 0, 0]),
      { id: "proof", k: "plate", c: proofAt, size: 0.66, h: 0.08, glyph, o: proofO },
      { id: "sig", k: "box", c: [sigAt[0], sigAt[1] + 0.025, sigAt[2]], s: [0.46, 0.05, 0.3], m: "ink", o: sigO },
      ...tokens,
    ];
    const labels = [
      { id: "proof", at: topOf([-D, 0, 0], 0.95, 0.2), text: "proof", anchor: "n" },
      { id: "att", at: topOf([0, 0, -D], A, A), text: "attester", anchor: "n" },
      { id: "vault", at: bottomOf([0, 0, 0], V), text: check > 0.5 ? "✓ verified" : "program", anchor: "s", tone: check > 0.5 ? "accent" : undefined },
      { id: "owner", at: walletBottom([D, 0, 0]), text: "owner", anchor: "s" },
    ];
    return { prims, labels, phase: -1 };
  },
};

// ---- 4. refund: a 30-day timer returns unclaimed tips ------------------------------------------------

export const TICKS = 30;

const refund = {
  name: "refund",
  frame: { w: 5.8, h: 4.0, cx: -0.12, cy: 0.3 },
  T: 8,
  loop: true,
  build(t, p = {}, { static: still = false } = {}) {
    const D = 2.6;
    const V = 1.1;
    const y = TOKEN / 2;
    const back = [[0.1, y, 0.1], [-D + 0.55, y, 0]];
    let days, tipAt, tipO;
    if (still) {
      days = TICKS;
      tipAt = mix(...back, 0.65);
      tipO = 1;
    } else {
      days = t < 7.3 ? Math.floor(TICKS * seg(t, 0.9, 5.0)) : 0;
      if (t < 0.9) tipAt = mix([-D + 0.55, y, 0], [0.1, y, 0.1], ease(seg(t, 0.05, 0.9)));
      else if (t < 5.1) tipAt = back[0];
      else tipAt = mix(...back, ease(seg(t, 5.1, 6.4)));
      tipO = t < 6.4 ? 1 : 0;
    }
    const r0 = 1.02;
    const r1 = 1.24;
    const all = [];
    const done = [];
    for (let i = 0; i < TICKS; i++) {
      const a = (i / TICKS) * Math.PI * 2 + Math.PI * 0.75; // day 1 at the back, running clockwise
      const c = Math.cos(a);
      const s = -Math.sin(a);
      const pair = [[c * r0, 0, s * r0], [c * r1, 0, s * r1]];
      (i < days ? done : all).push(...pair);
    }
    const prims = [
      grid("grid", -3, 2, -2, 2, 1),
      trace("t.back", [[-D + 0.5, 0, 0], [-r1, 0, 0]]),
      { id: "ticks", k: "segs", pts: all, tone: "line2" },
      { id: "done", k: "segs", pts: done, tone: "accent" },
      ...wallet("sender", [-D, 0, 0]),
      ...vault("vault", [0, 0, 0], V),
      { id: "fees", k: "box", c: [-0.18, 0.2, -0.18], s: [0.5, 0.28, 0.5], m: "ink" },
      token("tip", tipAt, tipO),
    ];
    const labels = [
      { id: "sender", at: walletTop([-D, 0, 0]), text: "sender", anchor: "n" },
      { id: "timer", at: [r1 * S2, 0, r1 * S2], text: still ? "30 days unclaimed" : `day ${Math.max(days, 0)} / 30`, anchor: "s", tone: still || days >= TICKS ? "accent" : undefined },
      { id: "vault", at: rightOf([0, 0, 0], V, V * 0.55), text: "fees stay", anchor: "e" },
    ];
    return { prims, labels, phase: -1 };
  },
};

// ---- a vault page: this vault's state --------------------------------------------------------------------

const vaultScene = {
  name: "vault",
  frame: { w: 5.6, h: 4.8, cx: 0.1, cy: 0.12 },
  T: 1.4,
  loop: false,
  build(t, p = {}, { static: still = false } = {}) {
    const D = 2.4;
    const V = 1.3;
    const status = p.status ?? "unclaimed";
    const claimed = status === "claimed" || (status === "pending" && p.hasClaimant);
    const pending = status === "pending";
    const drop = !still && t > 0 && t < 1.2 ? token("drop", [0, 3.0 - 2.7 * ease(seg(t, 0, 1.0)), 0], 1 - seg(t, 1.0, 1.2)) : null;
    const prims = [
      grid("grid", -3, 3, -2, 3, 1),
      trace("t.link", [[V / 2, 0, 0], [D - 0.55, 0, 0]], claimed ? { tone: "line", dash: false } : {}),
      ...wallet("owner", [D, 0, 0], claimed ? {} : { o: 1, edge: "dash" }),
      ...vault("vault", [0, 0, 0], V, { fill: p.funded ? 0.34 : 0, glyph: p.glyph ?? "github" }),
      ...(pending ? [trace("t.pend", [[0, 0, V / 2], [0, 0, D - 0.4]]), ...wallet("pending", [0, 0, D], { edge: "dash" })] : []),
      ...(drop ? [drop] : []),
    ];
    const labels = [
      { id: "vault", at: topOf([0, 0, 0], V, V), text: p.declined ? "Vault · declined" : "Vault", sub: p.idLabel ?? "", anchor: "n" },
      { id: "owner", at: walletBottom([D, 0, 0]), text: claimed ? "Owner" : "No owner yet", sub: claimed ? p.claimantLabel ?? "" : "claims by proof", anchor: "s" },
      ...(pending ? [{ id: "pending", at: walletBottom([0, 0, D]), text: "Rebind pending", sub: p.pendingLabel ?? "", anchor: "s", tone: "accent" }] : []),
    ];
    return { prims, labels, phase: -1 };
  },
};

// ---- $ANYFEE: a coin -> a fixed splitter -> one vault per share ------------------------------------------

/** World point on the floor under a screen position (camera at yaw 45). */
function floorAt(X, Y) {
  const a = X / BASE.right[0]; // x - z
  const b = -Y / -BASE.up[0]; // x + z
  return [(a + b) / 2, 0, (b - a) / 2];
}

/** Smooth weighted round-robin: a fair repeating order of recipients for the given weights. */
export function splitOrder(weights, length) {
  const current = weights.map(() => 0);
  const total = weights.reduce((a, w) => a + w, 0);
  const out = [];
  for (let n = 0; n < length; n++) {
    let best = 0;
    for (let i = 0; i < weights.length; i++) {
      current[i] += weights[i];
      if (current[i] > current[best]) best = i;
    }
    current[best] -= total;
    out.push(best);
  }
  return out;
}

const DEFAULT_SHARES = [
  { label: "50%", name: "anyfee", bps: 5000 },
  ...["anchor", "solana-web3.js", "noble-curves", "litesvm", "three.js"].map((name) => ({ label: "10%", name, bps: 1000 })),
];

const split = {
  name: "split",
  frame: { w: 7.4, h: 6.0, cx: -0.05, cy: 0.25 },
  T: 12,
  loop: true,
  build(t, p = {}, { static: still = false } = {}) {
    const shares = p.shares?.length ? p.shares : DEFAULT_SHARES;
    const n = shares.length;
    const V = 0.48; // on-screen height 0.76: a clear gap between neighbours in the column
    const gap = Math.min(0.9, 4.5 / Math.max(n - 1, 1));
    const top = ((n - 1) * gap) / 2 + 0.2;
    const vaults = shares.map((_, k) => floorAt(1.05, top - k * gap));
    const coinAt = floorAt(-2.85, 0.35);
    const splitAt = floorAt(-0.95, 0.35);
    const y = TOKEN / 2;
    const lift = (q) => [q[0], y, q[2]];
    const L = 20; // one round of the order, spread over the loop
    const order = splitOrder(shares.map((s) => s.bps), L);
    const maxCount = Math.max(...shares.map((_, k) => order.filter((d) => d === k).length));
    const inPath = [lift(mix(coinAt, splitAt, 0.2)), lift(splitAt)];
    const counts = shares.map(() => 0);
    const tokens = [];
    if (still) {
      order.forEach((d) => counts[d]++);
      counts.forEach((c, k) => (counts[k] = c * 0.62));
      tokens.push(...frozen("in", [0.45], ...inPath));
      shares.forEach((_, k) => tokens.push(token(`b${k}`, mix(lift(splitAt), lift(vaults[k]), k === 0 ? 0.55 : 0.5))));
    } else {
      const drain = 1 - ease(seg(t, 11.1, 11.9));
      for (let j = 0; j < L; j++) {
        const s0 = 0.2 + j * 0.45; // the last cube lands at ~10.2 s; the full split holds until the drain
        const u1 = (t - s0) / 0.55;
        const u2 = (t - s0 - 0.55) / 0.85;
        if (u1 > 0 && u1 < 1) tokens.push(token(`t${j}`, mix(...inPath, ease(u1))));
        else if (u2 > 0 && u2 < 1) tokens.push(token(`t${j}`, mix(lift(splitAt), lift(vaults[order[j]]), ease(u2))));
        else if (u2 >= 1) counts[order[j]] += drain;
      }
    }
    const prims = [
      grid("grid", -4, 3, -3, 4, 1),
      trace("t.in", [mix(coinAt, splitAt, 0.2), splitAt]),
      ...vaults.map((v, k) => trace(`t.b${k}`, [splitAt, mix(splitAt, v, 0.92)])),
      ...coin("coin", coinAt, 3, 0.42),
      { id: "splitter", k: "box", c: [splitAt[0], 0.16, splitAt[2]], s: [0.62, 0.32, 0.62], m: "paper" },
      { id: "splitter.top", k: "box", c: [splitAt[0], 0.345, splitAt[2]], s: [0.34, 0.05, 0.34], m: "ink" },
      ...vaults.flatMap((v, k) => vault(`v${k}`, v, V, { fill: (0.9 * counts[k]) / maxCount })),
      ...tokens,
    ];
    const labels = [
      { id: "coin", at: discTop(coinAt, 0.42, 0.45), text: p.ticker ?? "$ANYFEE", sub: "creator fees", anchor: "n" },
      { id: "split", at: bottomOf(splitAt, 0.62), text: "fixed split", sub: "set once at launch", anchor: "sw" },
      ...shares.map((s, k) => ({ id: `v${k}`, at: rightOf(vaults[k], V, V * 0.5), text: s.label, sub: s.name, anchor: "e" })),
    ];
    return { prims, labels, phase: -1 };
  },
};

export const SCENES = { hero, derive, fund, claim, refund, vault: vaultScene, split };
