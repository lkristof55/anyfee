import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, basis, dot, project, swayYaw, toFrame, toSvg, viewBox } from "../src/diagrams/iso.js";
import { SCENES, TICKS } from "../src/diagrams/scenes.js";
import { glyphMatrix, primsToSvg, renderSvg, toneOf } from "../src/diagrams/svg.js";

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

test("iso basis: orthonormal, 2:1 dimetric, +X to the lower right and +Z to the lower left", () => {
  for (const B of [BASE, basis(swayYaw(3)), basis(0.6)]) {
    for (const v of [B.dir, B.right, B.up]) assert.ok(close(dot(v, v), 1));
    assert.ok(close(dot(B.dir, B.right), 0) && close(dot(B.dir, B.up), 0) && close(dot(B.right, B.up), 0));
  }
  const [xs, xu] = project([1, 0, 0]);
  const [zs, zu] = project([0, 0, 1]);
  assert.ok(xs > 0 && xu < 0, "+X: right and down");
  assert.ok(zs < 0 && zu < 0, "+Z: left and down");
  assert.ok(close(-xu / xs, 0.5, 1e-9), "floor lines run at 1:2");
  assert.deepEqual(toSvg([0, 1, 0]).map((v) => +v.toFixed(6)), [0, -0.866025]);
});

test("toFrame and viewBox agree: the frame centre maps to the middle", () => {
  const f = { w: 6, h: 4, cx: 0.5, cy: 0.25 };
  const centre = [BASE.right[0] * f.cx + BASE.up[0] * f.cy, BASE.right[1] * f.cx + BASE.up[1] * f.cy, BASE.right[2] * f.cx + BASE.up[2] * f.cy];
  const [u, v] = toFrame(centre, f);
  assert.ok(close(u, 0.5) && close(v, 0.5));
  assert.deepEqual(viewBox(f), [-2.5, -2.25, 6, 4]);
});

const PARAMS: Record<string, object> = {
  vault: { status: "claimed", hasClaimant: true, funded: true, glyph: "x", idLabel: "x:12", claimantLabel: "9WzD…AWWM" },
  derive: { idLabel: "1296269", addrLabel: "4X1U…ahmY" },
};

test("every scene builds finite, uniquely keyed frames across its whole loop and its static frame", () => {
  for (const [name, sc] of Object.entries(SCENES)) {
    const frames = [{ still: true, t: 0 }, ...Array.from({ length: Math.ceil(sc.T / 0.1) + 1 }, (_, i) => ({ still: false, t: Math.min(i * 0.1, sc.T - 1e-6) }))];
    for (const { still, t } of frames) {
      const out = sc.build(t, PARAMS[name] ?? {}, { static: still, cycle: 1 });
      const ids = out.prims.map((p: { id: string }) => p.id);
      assert.equal(new Set(ids).size, ids.length, `${name} t=${t}: duplicate prim ids`);
      assert.doesNotMatch(JSON.stringify(out), /NaN|Infinity|null/, `${name} t=${t}`);
      for (const l of out.labels) {
        const [u, v] = toFrame(l.at, sc.frame);
        assert.ok(u > 0 && u < 1 && v > 0 && v < 1, `${name} t=${t}: label ${l.id} anchored outside the frame`);
      }
    }
  }
});

test("hero: loops fund -> prove -> claim, and its static frame shows every step at once", () => {
  const hero = SCENES.hero;
  const phases: number[] = [];
  for (let t = 0; t < hero.T; t += 0.05) {
    const p = hero.build(t, {}, {}).phase;
    if (phases.at(-1) !== p) phases.push(p);
  }
  assert.deepEqual(phases, [0, 1, 2]);
  const still = hero.build(0, {}, { static: true });
  assert.equal(still.phase, -1);
  const ids = still.prims.map((p: { id: string }) => p.id);
  for (const want of ["in.0", "tip.0", "out.0", "proof", "vault.fill", "coin.0", "owner", "tipper"]) assert.ok(ids.includes(want), want);
  const link = still.prims.find((p: { id: string }) => p.id === "t.link");
  assert.equal(link.dash, false, "static frame shows the vault bound to the owner");
});

test("refund: a 30-tick timer, full in the static frame; the tip travels back to the sender", () => {
  const sc = SCENES.refund;
  const ticks = (out: { prims: Array<{ id: string; pts?: unknown[] }> }) => ["ticks", "done"].map((id) => out.prims.find((p) => p.id === id)!.pts!.length / 2);
  assert.equal(TICKS, 30);
  for (const t of [0, 2, 4.9, 6]) {
    const [open, done] = ticks(sc.build(t, {}, {}));
    assert.equal(open + done, 30);
  }
  assert.deepEqual(ticks(sc.build(0, {}, { static: true })), [0, 30]);
  const at = (t: number) => sc.build(t, {}, {}).prims.find((p: { id: string }) => p.id === "tip").c[0];
  assert.ok(at(6.3) < at(5.2), "after day 30 the tip moves toward the sender (-X)");
});

test("vault scene follows the vault's state", () => {
  const sc = SCENES.vault;
  const link = (p: object) => sc.build(-1, p, {}).prims.find((x: { id: string }) => x.id === "t.link");
  assert.equal(link({ status: "claimed", hasClaimant: true }).dash, false);
  assert.equal(link({ status: "unclaimed" }).dash, true);
  const pending = sc.build(-1, { status: "pending", hasClaimant: true, pendingLabel: "→ abc" }, {});
  assert.ok(pending.prims.some((p: { id: string }) => p.id === "pending"));
  assert.equal(pending.labels.find((l: { id: string }) => l.id === "pending").sub, "→ abc");
  assert.match(sc.build(-1, { status: "declined", declined: true }, {}).labels[0].text, /declined/);
  assert.ok(sc.build(0.5, {}, {}).prims.some((p: { id: string }) => p.id === "drop"), "a pulse drops a token in");
  assert.ok(!sc.build(-1, {}, {}).prims.some((p: { id: string }) => p.id === "drop"));
});

test("data in labels (ids, addresses) sits on the second line, which is never upper-cased", () => {
  const d = SCENES.derive.build(0, PARAMS.derive, { static: true });
  const vault = d.labels.find((l: { id: string }) => l.id === "vault");
  assert.equal(vault.sub, "4X1U…ahmY");
  assert.doesNotMatch(vault.text, /4X1U/);
  assert.equal(d.labels.find((l: { id: string }) => l.id === "id").sub, "1296269");
});

test("static SVG: numbers and fixed classes only, painter-sorted, glyph mapped onto the plate", () => {
  for (const [name, sc] of Object.entries(SCENES)) {
    const out = sc.build(0, PARAMS[name] ?? {}, { static: true });
    const svg = renderSvg(sc, out);
    assert.match(svg, /^<svg class="dg-svg" viewBox="[-\d. ]+"/);
    assert.doesNotMatch(svg, /NaN|undefined|<script|on\w+=/);
    for (const l of out.labels) if (l.sub) assert.ok(!svg.includes(l.sub), `${name}: label text must stay out of the SVG`);
  }
  const hero = primsToSvg(SCENES.hero.build(0, {}, { static: true }).prims);
  assert.ok(hero.indexOf('class="ln grid"') < hero.indexOf("m-glass"), "the floor grid is painted first");
  assert.ok(hero.indexOf("m-glass") < hero.indexOf('class="gl"'), "the proof plate rests on top of the glass vault");
  const [a, b, c, d, e, f] = glyphMatrix([0, 1, 0], 1);
  const [cx, cy] = toSvg([0, 1, 0]);
  assert.ok(close(a * 12 + c * 12 + e, cx) && close(b * 12 + d * 12 + f, cy), "glyph centre lands on the plate centre");
  assert.ok(close(b, 0), "glyph stays upright on screen");
  assert.equal(toneOf([0, 1, 0]), "t");
  assert.equal(toneOf([0, 0, 1]), "l");
  assert.equal(toneOf([1, 0, 0]), "r");
});
