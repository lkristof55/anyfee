// The live diagrams: ONE three.js WebGLRenderer for the whole page. Each visible diagram is
// rendered into the bottom-left corner of that renderer's (detached) canvas with a scissored
// viewport, then copied into the diagram's own 2D canvas. Loaded lazily (dynamic import) after
// first paint; the static SVG of the same scene is what shows before, instead, and on failure.
// Imported module by module from three's sources: esbuild then bundles only what the engine
// uses (the prebuilt three.module.js does not tree-shake well).
import { BoxGeometry } from "three/src/geometries/BoxGeometry.js";
import { CylinderGeometry } from "three/src/geometries/CylinderGeometry.js";
import { EdgesGeometry } from "three/src/geometries/EdgesGeometry.js";
import { PlaneGeometry } from "three/src/geometries/PlaneGeometry.js";
import { BufferGeometry } from "three/src/core/BufferGeometry.js";
import { Float32BufferAttribute } from "three/src/core/BufferAttribute.js";
import { CanvasTexture } from "three/src/textures/CanvasTexture.js";
import { Color } from "three/src/math/Color.js";
import { Group } from "three/src/objects/Group.js";
import { Line } from "three/src/objects/Line.js";
import { LineLoop } from "three/src/objects/LineLoop.js";
import { LineSegments } from "three/src/objects/LineSegments.js";
import { Mesh } from "three/src/objects/Mesh.js";
import { LineBasicMaterial } from "three/src/materials/LineBasicMaterial.js";
import { LineDashedMaterial } from "three/src/materials/LineDashedMaterial.js";
import { MeshBasicMaterial } from "three/src/materials/MeshBasicMaterial.js";
import { OrthographicCamera } from "three/src/cameras/OrthographicCamera.js";
import { Scene } from "three/src/scenes/Scene.js";
import { SRGBColorSpace } from "three/src/constants.js";
import { WebGLRenderer } from "three/src/renderers/WebGLRenderer.js";
import { GLYPHS, GLYPH_STROKE } from "./glyphs.js";
import { dot } from "./iso.js";

const BOX = new BoxGeometry(1, 1, 1);
const BOX_EDGES = new EdgesGeometry(BOX);
const CYL = new CylinderGeometry(1, 1, 1, 56, 1);
const PLANE = new PlaneGeometry(1, 1);
const FACE_NORMALS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function ring(y) {
  const pts = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push(Math.cos(a), y, Math.sin(a));
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pts, 3));
  return g;
}
const RING_TOP = ring(0.5);
const RING_BOTTOM = ring(-0.5);

// Glass boxes are only ever seen from the (+x, +y, +z) side: the (-,-,-) corner is hidden.
function glassEdges() {
  const c = (k) => [((k >> 2) & 1) - 0.5, ((k >> 1) & 1) - 0.5, (k & 1) - 0.5];
  const front = [];
  const back = [];
  for (let i = 0; i < 8; i++)
    for (const bit of [4, 2, 1])
      if (!(i & bit)) (i === 0 ? back : front).push(...c(i), ...c(i | bit));
  const mk = (arr) => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(arr, 3));
    return g;
  };
  return { front: mk(front), back: mk(back) };
}
const GLASS = glassEdges();

const rotY = ([x, y, z], a) => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];

export function createEngine(palette) {
  const canvas = document.createElement("canvas");
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  let W = 0;
  let H = 0;
  let pal = {};
  const lineMats = new Map(); // "tone" or "tone:dash" -> shared material
  const textures = new Map(); // glyph -> { tex, ctx }

  const engine = { onLost: null };
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    engine.onLost?.();
  });

  function setPalette(p) {
    pal = {};
    for (const [k, v] of Object.entries(p)) pal[k] = String(v).startsWith("#") ? new Color(v) : Number.parseFloat(v);
    for (const m of lineMats.values()) m.color.copy(pal[m.userData.tone] ?? pal.line);
    for (const t of textures.values()) drawGlyph(t);
  }

  function lineMat(tone, dash = false) {
    const key = `${tone}${dash ? ":dash" : ""}`;
    let m = lineMats.get(key);
    if (!m) {
      m = dash ? new LineDashedMaterial({ dashSize: 0.1, gapSize: 0.07 }) : new LineBasicMaterial();
      m.userData.tone = tone;
      m.color.copy(pal[tone] ?? pal.line);
      // The floor grid is drawn first and writes no depth, so traces that run exactly along a
      // grid line (same depth) always draw over it instead of z-fighting.
      if (tone === "grid") m.depthWrite = false;
      lineMats.set(key, m);
    }
    return m;
  }

  // Faces sit a hair behind their edges (polygon offset), so edge lines never z-fight.
  const faceMat = () => new MeshBasicMaterial({ polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });

  function glyphTexture(name) {
    let t = textures.get(name);
    if (!t) {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      t = { name, ctx: c.getContext("2d"), tex: new CanvasTexture(c) };
      t.tex.colorSpace = SRGBColorSpace;
      t.tex.anisotropy = 4;
      drawGlyph(t);
      textures.set(name, t);
    }
    return t.tex;
  }

  function drawGlyph(t) {
    const { ctx } = t;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, 128, 128);
    ctx.scale(128 / 24, 128 / 24);
    ctx.lineWidth = GLYPH_STROKE;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = `#${(pal.glyph ?? new Color("#fff")).getHexString()}`;
    ctx.stroke(new Path2D(GLYPHS[t.name]));
    t.tex.needsUpdate = true;
  }

  // ---- objects ---------------------------------------------------------------------------------

  function setOpacity(mats, o, forceTransparent = false) {
    for (const m of mats) {
      const tr = forceTransparent || o < 0.999;
      if (m.transparent !== tr) {
        m.transparent = tr;
        m.needsUpdate = true;
      }
      m.opacity = o * (m.userData.alpha ?? 1);
    }
  }

  /** Flat tones per face: top, and a left-to-right blend by how the face turns to the camera. */
  function tint(prim, B, mats) {
    const mat = prim.m;
    const ry = prim.ry ?? 0;
    mats.forEach((m, i) => {
      const nrm = rotY(FACE_NORMALS[i] ?? [0, 1, 0], ry);
      if (i === 2 || nrm[1] > 0.5) {
        m.color.copy(pal[`${mat}-t`]);
        return;
      }
      const u = Math.min(1, Math.max(0, (dot(nrm, B.right) + 0.7071) / 1.4142));
      m.color.copy(pal[`${mat}-l`]).lerp(pal[`${mat}-r`], u);
    });
  }

  function makeBox(prim) {
    const g = new Group();
    const mats = FACE_NORMALS.map(() => faceMat());
    const mesh = new Mesh(BOX, mats);
    g.add(mesh);
    let edges;
    if (prim.m === "glass") {
      for (const m of mats) m.depthWrite = false;
      edges = new LineSegments(GLASS.front, lineMat("line"));
      const hidden = new LineSegments(GLASS.back, lineMat("line2", true));
      hidden.computeLineDistances();
      g.add(edges, hidden);
    } else {
      edges = new LineSegments(BOX_EDGES, lineMat("line"));
      g.add(edges);
    }
    edges.computeLineDistances();
    let edgeStyle = null;
    return {
      obj: g,
      update(p, B) {
        g.position.set(p.c[0], p.c[1], p.c[2]);
        g.scale.set(p.s[0], p.s[1], p.s[2]);
        g.rotation.y = p.ry ?? 0;
        tint(p, B, mats);
        const style = p.edge ?? "line";
        if (style !== edgeStyle) {
          edgeStyle = style;
          edges.visible = style !== "none";
          edges.material = style === "dash" ? lineMat(p.m === "glass" ? "line" : "line2", true) : lineMat("line");
        }
        const alpha = p.m === "glass" ? pal.glassAlpha : style === "dash" ? pal.ghostAlpha : 1;
        for (const m of mats) m.userData.alpha = alpha;
        setOpacity(mats, p.o ?? 1, p.m === "glass" || style === "dash");
      },
    };
  }

  function makeCyl(prim) {
    const g = new Group();
    const mats = [faceMat(), faceMat(), faceMat()];
    const mesh = new Mesh(CYL, mats);
    const top = new LineLoop(RING_TOP, lineMat("line"));
    const bottom = new LineLoop(RING_BOTTOM, lineMat("line"));
    const silGeom = new BufferGeometry();
    silGeom.setAttribute("position", new Float32BufferAttribute(new Float32Array(12), 3));
    const sil = new LineSegments(silGeom, lineMat("line"));
    g.add(mesh, top, bottom, sil);
    return {
      obj: g,
      update(p, B) {
        g.position.set(p.c[0], p.c[1], p.c[2]);
        g.scale.set(p.r, p.h, p.r);
        mats[0].color.copy(pal[`${p.m}-l`]);
        mats[1].color.copy(pal[`${p.m}-t`]);
        mats[2].color.copy(pal[`${p.m}-r`]);
        const [rx, , rz] = B.right;
        const a = silGeom.attributes.position.array;
        a.set([rx, 0.5, rz, rx, -0.5, rz, -rx, 0.5, -rz, -rx, -0.5, -rz]);
        silGeom.attributes.position.needsUpdate = true;
        setOpacity(mats, p.o ?? 1);
      },
    };
  }

  function makePlate(prim) {
    const g = new Group();
    const box = makeBox({ ...prim, m: "ink" });
    const glyphMat = new MeshBasicMaterial({ map: glyphTexture(prim.glyph), transparent: true, depthWrite: false });
    const plane = new Mesh(PLANE, glyphMat);
    plane.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
    g.add(box.obj, plane);
    let glyph = prim.glyph;
    return {
      obj: g,
      update(p, B) {
        box.update({ c: [p.c[0], p.c[1] + p.h / 2, p.c[2]], s: [p.size, p.h, p.size], m: "ink", o: p.o }, B);
        if (p.glyph !== glyph) {
          glyph = p.glyph;
          glyphMat.map = glyphTexture(glyph);
        }
        const gsz = (p.size / Math.SQRT2) * 0.92;
        plane.position.set(p.c[0], p.c[1] + p.h + 0.003, p.c[2]);
        plane.scale.set(gsz, gsz, 1);
        glyphMat.opacity = p.o ?? 1;
      },
    };
  }

  function makeLines(prim, Kind) {
    const geom = new BufferGeometry();
    const obj = new Kind(geom, lineMat(prim.tone ?? "line2", !!prim.dash));
    let last = null;
    return {
      obj,
      update(p) {
        const flat = p.pts.flat();
        const same = last && last.length === flat.length && last.every((v, i) => v === flat[i]);
        if (!same) {
          geom.setAttribute("position", new Float32BufferAttribute(flat, 3));
          geom.computeBoundingSphere();
          if (p.dash) obj.computeLineDistances();
          last = flat;
        }
        obj.material = lineMat(p.tone ?? "line2", !!p.dash);
        obj.renderOrder = p.layer ?? 0;
      },
    };
  }

  const MAKERS = {
    box: makeBox,
    cyl: makeCyl,
    plate: makePlate,
    line: (p) => makeLines(p, Line),
    segs: (p) => makeLines(p, LineSegments),
  };

  function world(slot) {
    if (!slot.gl) slot.gl = { scene: new Scene(), camera: new OrthographicCamera(-1, 1, 1, -1, 0.1, 200), objs: new Map() };
    return slot.gl;
  }

  /** Renders one diagram frame into slot.ctx (a 2D canvas of slot.pw x slot.ph pixels). */
  function render(slot, t, B, opts) {
    const out = slot.scene.build(t, slot.params, opts);
    const { scene, camera, objs } = world(slot);
    const seen = new Set();
    for (const p of out.prims) {
      let o = objs.get(p.id);
      if (!o || o.kind !== p.k) {
        if (o) scene.remove(o.obj);
        o = MAKERS[p.k](p);
        o.kind = p.k;
        objs.set(p.id, o);
        scene.add(o.obj);
      }
      o.update(p, B);
      o.obj.visible = (p.o ?? 1) > 0.01 && (!p.pts || p.pts.length > 0);
      seen.add(p.id);
    }
    for (const [id, o] of objs) if (!seen.has(id)) o.obj.visible = false;

    const w = slot.pw;
    const h = slot.ph;
    if (!w || !h) return out;
    const f = slot.scene.frame;
    const scale = Math.min(w / f.w, h / f.h);
    const hw = w / scale / 2;
    const hh = h / scale / 2;
    camera.left = -hw;
    camera.right = hw;
    camera.top = hh;
    camera.bottom = -hh;
    const tx = B.right[0] * f.cx + B.up[0] * f.cy;
    const ty = B.right[1] * f.cx + B.up[1] * f.cy;
    const tz = B.right[2] * f.cx + B.up[2] * f.cy;
    camera.position.set(tx + B.dir[0] * 40, ty + B.dir[1] * 40, tz + B.dir[2] * 40);
    camera.up.set(0, 1, 0);
    camera.lookAt(tx, ty, tz);
    camera.updateProjectionMatrix();

    if (w > W || h > H) {
      W = Math.max(W, w);
      H = Math.max(H, h);
      renderer.setSize(W, H, false);
    }
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.setScissorTest(true);
    renderer.render(scene, camera);
    slot.ctx.clearRect(0, 0, w, h);
    slot.ctx.drawImage(canvas, 0, H - h, w, h, 0, 0, w, h);
    return out;
  }

  function forget(slot) {
    if (!slot.gl) return;
    for (const [, o] of slot.gl.objs) {
      o.obj.traverse?.((c) => {
        if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
        else if (c.material && c.isMesh) c.material.dispose();
        if (c.geometry && c.geometry !== BOX && c.geometry !== BOX_EDGES && c.geometry !== CYL && c.geometry !== PLANE && c.geometry !== RING_TOP && c.geometry !== RING_BOTTOM && c.geometry !== GLASS.front && c.geometry !== GLASS.back) c.geometry.dispose();
      });
    }
    slot.gl = null;
  }

  setPalette(palette);
  return Object.assign(engine, { render, setPalette, forget, renderer });
}
