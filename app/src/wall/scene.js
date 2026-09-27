// The lobby wall: numbered brass P.O. boxes in three.js. Loaded lazily (dynamic import) so the
// app is usable before the 3D arrives. Renders on demand only: nothing runs while idle.
//
// Signature moves: resolving an identity slides its box out of the wall with the numeric id
// engraved on the door; a confirmed tip drops a letter into the slot on top of the drawer.
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SpotLight,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { DOOR_H, DOOR_W, LAYOUT, drawDoor, drawEnvelope, drawNumberAtlas, rng } from "./textures.js";

const COLS = 13;
const ROWS = 8;
const PX = 1.1;
const PY = 0.76;
const FC = 8; // featured column
const FR = 3; // featured row
const FEATURED = FR * COLS + FC;
const DEPTH = 0.05;
const PULL = 0.95;
const BODY = 1.6;
const BG = new Color("#16211c");

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t) => {
  const c1 = 1.2;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
const easeInQuad = (t) => t * t;

function cellPos(c, r) {
  return { x: (c - (COLS - 1) / 2) * PX, y: ((ROWS - 1) / 2 - r) * PY };
}

function texture(canvas, { srgb = false, aniso = 1 } = {}) {
  const t = new CanvasTexture(canvas);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function doorMaterial(set, aniso) {
  return new MeshStandardMaterial({
    map: texture(set.color, { srgb: true, aniso }),
    roughnessMap: texture(set.orm, { aniso }),
    metalnessMap: texture(set.orm, { aniso }),
    bumpMap: texture(set.bump, { aniso }),
    bumpScale: 1.2,
    roughness: 1,
    metalness: 1,
  });
}

function wallNumbers(base) {
  const out = [];
  for (let k = 0; k < COLS * ROWS; k++) {
    if (k === FEATURED) {
      out.push(null);
      continue;
    }
    const n = base + BigInt(k - FEATURED);
    out.push(n > 0n && n < 1n << 64n ? n.toString() : null);
  }
  return out;
}

export function createWall(container, { reducedMotion = false, onReady } = {}) {
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(BG, 1);
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  canvas.className = "wall-canvas";
  container.append(canvas);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new Scene();
  scene.background = BG;
  scene.fog = new Fog(BG, 7.5, 17);
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentIntensity = 0.55;
  room.dispose?.();
  pmrem.dispose();

  const camera = new PerspectiveCamera(28, 1, 0.1, 60);
  const f = cellPos(FC, FR);

  // lights: a warm key from the upper left, a soft lobby fill
  const key = new SpotLight("#ffe2b0", 140, 0, 0.55, 0.85, 2);
  key.position.set(f.x - 3.2, f.y + 3.6, 5.2);
  key.target.position.set(f.x + 0.2, f.y - 0.2, 0.6);
  scene.add(key, key.target);
  scene.add(new HemisphereLight("#fff4dc", "#0b1410", 0.45));

  // wall plate (dark lobby enamel)
  const plate = new Mesh(
    new BoxGeometry(COLS * PX + 2, ROWS * PY + 2, 0.3),
    new MeshStandardMaterial({ color: "#17231d", roughness: 0.62, metalness: 0.35 }),
  );
  plate.position.z = -0.15;
  scene.add(plate);

  // cell recesses: a thin darker frame behind every door
  const recessGeo = new BoxGeometry(DOOR_W + 0.06, DOOR_H + 0.06, 0.012);
  const recess = new InstancedMesh(recessGeo, new MeshStandardMaterial({ color: "#0c120f", roughness: 0.8, metalness: 0.2 }), COLS * ROWS);
  // doors
  const doorGeo = new BoxGeometry(DOOR_W * 0.985, DOOR_H * 0.985, DEPTH);
  const wallDoor = drawDoor(512, 328, { seed: 11 });
  const doors = new InstancedMesh(doorGeo, doorMaterial(wallDoor, aniso), COLS * ROWS);
  const m4 = new Matrix4();
  const obj = new Object3D();
  const tint = new Color();
  const rand = rng(42);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const k = r * COLS + c;
      const p = cellPos(c, r);
      obj.position.set(p.x, p.y, DEPTH / 2);
      obj.scale.setScalar(k === FEATURED ? 0 : 1);
      obj.updateMatrix();
      doors.setMatrixAt(k, obj.matrix);
      m4.makeTranslation(p.x, p.y, 0.006);
      recess.setMatrixAt(k, m4);
      const v = 0.86 + rand() * 0.2;
      tint.setRGB(v, v * (0.97 + rand() * 0.04), v * (0.9 + rand() * 0.1));
      doors.setColorAt(k, tint);
    }
  }
  doors.instanceMatrix.needsUpdate = true;
  scene.add(recess, doors);

  // engraved numbers on every other door: one merged quad mesh over an atlas
  const plateW = LAYOUT.plate.x1 - LAYOUT.plate.x0;
  const plateH = LAYOUT.plate.y1 - LAYOUT.plate.y0;
  const numberMat = new MeshStandardMaterial({
    transparent: true,
    roughness: 0.55,
    metalness: 0.5,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const numberMesh = new Mesh(new BufferGeometry(), numberMat);
  scene.add(numberMesh);
  let atlasTex = null;

  function setWallNumbers(base) {
    const nums = wallNumbers(base);
    const atlas = drawNumberAtlas(nums, 8, 256, 64);
    atlasTex?.dispose();
    atlasTex = texture(atlas.canvas, { srgb: true, aniso });
    numberMat.map = atlasTex;
    numberMat.needsUpdate = true;
    const pos = [];
    const uv = [];
    const idx = [];
    let q = 0;
    nums.forEach((n, k) => {
      if (n === null) return;
      const c = k % COLS;
      const r = Math.floor(k / COLS);
      const p = cellPos(c, r);
      const x0 = p.x + LAYOUT.plate.x0 + 0.012;
      const x1 = x0 + plateW - 0.024;
      const y0 = p.y + LAYOUT.plate.y0 + 0.012;
      const y1 = y0 + plateH - 0.024;
      const z = DEPTH + 0.0015;
      pos.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z);
      const ac = k % atlas.cols;
      const ar = Math.floor(k / atlas.cols);
      const u0 = (ac * atlas.cellW) / atlas.canvas.width;
      const u1 = ((ac + 1) * atlas.cellW) / atlas.canvas.width;
      const v1 = 1 - (ar * atlas.cellH) / atlas.canvas.height;
      const v0 = 1 - ((ar + 1) * atlas.cellH) / atlas.canvas.height;
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      idx.push(q, q + 1, q + 2, q, q + 2, q + 3);
      q += 4;
    });
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    g.setAttribute("normal", new Float32BufferAttribute(new Array((pos.length / 3) * 3).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
    g.setIndex(idx);
    numberMesh.geometry.dispose();
    numberMesh.geometry = g;
  }

  // the featured box: a drawer body + its own high-resolution door
  const featured = new Group();
  featured.position.set(f.x, f.y, 0);
  scene.add(featured);
  const steel = new MeshStandardMaterial({ color: "#48514b", roughness: 0.36, metalness: 0.7 });
  const body = new Mesh(new BoxGeometry(DOOR_W * 0.965, DOOR_H * 0.965, BODY), steel);
  body.position.z = -BODY / 2;
  featured.add(body);
  // letter slot on top of the drawer, near the front
  const slotLip = new Mesh(new PlaneGeometry(0.46, 0.085), new MeshStandardMaterial({ color: "#c9a45a", roughness: 0.3, metalness: 1 }));
  slotLip.rotation.x = -Math.PI / 2;
  slotLip.position.set(0, (DOOR_H * 0.965) / 2 + 0.001, -0.16);
  const slotHole = new Mesh(new PlaneGeometry(0.4, 0.035), new MeshStandardMaterial({ color: "#030403", roughness: 1, metalness: 0 }));
  slotHole.rotation.x = -Math.PI / 2;
  slotHole.position.set(0, (DOOR_H * 0.965) / 2 + 0.002, -0.16);
  featured.add(slotLip, slotHole);
  let featuredMat = null;
  const featuredDoor = new Mesh(doorGeo, new MeshStandardMaterial());
  featuredDoor.position.z = DEPTH / 2;
  featured.add(featuredDoor);

  function setFeaturedDoor(opts) {
    const set = drawDoor(1024, 656, { ...opts, featured: true, seed: 3 });
    const mat = doorMaterial(set, aniso);
    if (featuredMat) {
      for (const k of ["map", "roughnessMap", "metalnessMap", "bumpMap"]) featuredMat[k]?.dispose();
      featuredMat.dispose();
    }
    featuredMat = mat;
    featuredDoor.material = mat;
  }

  // the letter
  const letter = new Mesh(
    new PlaneGeometry(0.34, 0.21),
    new MeshStandardMaterial({ map: texture(drawEnvelope(), { srgb: true, aniso }), roughness: 0.85, metalness: 0, side: DoubleSide }),
  );
  letter.visible = false;
  featured.add(letter);

  // ---- rendering and tweens -------------------------------------------------------------------
  const tweens = new Set();
  let raf = 0;
  let visible = true;
  let disposed = false;
  const camFinal = new Vector3();
  const lookFinal = new Vector3();
  const lookNow = new Vector3();

  function frame() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    const aspect = w / h;
    camera.aspect = aspect;
    if (aspect < 1.15) {
      camFinal.set(f.x - 0.8, f.y + 1.2, 6.6);
      lookFinal.set(f.x - 0.02, f.y - 0.12, 0.45);
    } else {
      camFinal.set(f.x - 3.0, f.y + 1.6, 9.6);
      lookFinal.set(f.x - 1.45, f.y - 0.1, 0.4);
    }
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function render() {
    camera.lookAt(lookNow);
    renderer.render(scene, camera);
  }

  function loop(now) {
    raf = 0;
    if (disposed) return;
    for (const t of [...tweens]) {
      const p = t.dur <= 0 ? 1 : Math.min(1, (now - t.start) / t.dur);
      t.fn(t.ease(p));
      if (p >= 1) {
        tweens.delete(t);
        t.done();
      }
    }
    render();
    if (tweens.size && visible) raf = requestAnimationFrame(loop);
  }

  function kick() {
    if (!raf && !disposed && visible) raf = requestAnimationFrame(loop);
  }

  function tween(dur, fn, ease = easeOutCubic) {
    if (reducedMotion) dur = 0;
    return new Promise((done) => {
      tweens.add({ start: performance.now(), dur, fn, ease, done });
      kick();
    });
  }

  const ro = new ResizeObserver(() => {
    frame();
    if (!tweens.size) {
      camera.position.copy(camFinal);
      lookNow.copy(lookFinal);
    }
    render();
  });
  ro.observe(container);
  const onVis = () => {
    visible = document.visibilityState === "visible";
    if (visible) kick();
  };
  document.addEventListener("visibilitychange", onVis);
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    api.onLost?.();
  });

  // ---- state ----------------------------------------------------------------------------------
  let out = 0; // 0 = in the wall, 1 = pulled out
  let currentKey = null;
  let busy = Promise.resolve();

  function setOut(v) {
    out = v;
    featured.position.z = v * PULL;
  }

  async function slide(to, dur = 900) {
    const from = out;
    if (from === to) return;
    await tween(dur, (p) => setOut(from + (to - from) * p), to > from ? easeOutBack : easeInOutCubic);
  }

  const api = {
    onLost: null,
    /** Pull out the box for an identity: { key, number, platformLabel, holder, status }. */
    showBox(b) {
      busy = busy.then(async () => {
        if (disposed) return;
        if (currentKey === b.key) {
          setFeaturedDoor(b);
          if (out < 1) await slide(1);
          else render();
          return;
        }
        if (out > 0) await slide(0, 420);
        currentKey = b.key;
        setWallNumbers(BigInt(b.number));
        setFeaturedDoor(b);
        render();
        await slide(1);
      });
      return busy;
    },
    /** Update the slip/status of the box that is out, without moving it. */
    updateBox(b) {
      busy = busy.then(() => {
        if (disposed || currentKey !== b.key) return;
        setFeaturedDoor(b);
        render();
      });
      return busy;
    },
    clearBox() {
      busy = busy.then(async () => {
        if (disposed || currentKey === null) return;
        await slide(0, 520);
        currentKey = null;
        setWallNumbers(1024n);
        setFeaturedDoor({ number: "1024", platformLabel: "P.O. BOX" });
        render();
      });
      return busy;
    },
    /** A letter falls into the slot on top of the drawer. */
    dropLetter() {
      busy = busy.then(async () => {
        if (disposed || out < 0.5 || reducedMotion) return;
        const top = (DOOR_H * 0.965) / 2;
        letter.visible = true;
        letter.position.set(0.05, top + 1.5, -0.16);
        letter.rotation.set(-0.35, 0.25, 0.5);
        await tween(
          780,
          (p) => {
            letter.position.y = top + 1.5 - 1.34 * p;
            letter.position.x = 0.05 * (1 - p) + Math.sin(p * 5) * 0.03 * (1 - p);
            letter.rotation.set(-0.35 * (1 - p), 0.25 * (1 - p), 0.5 * (1 - p) + Math.sin(p * 7) * 0.12 * (1 - p));
          },
          easeInQuad,
        );
        await tween(380, (p) => {
          letter.position.y = top + 0.16 - 0.4 * p;
        }, easeInQuad);
        letter.visible = false;
        // the drawer answers with a small bump
        await tween(260, (p) => {
          featured.position.y = f.y - Math.sin(p * Math.PI) * 0.018;
        });
        featured.position.y = f.y;
        render();
      });
      return busy;
    },
    resize() {
      frame();
      render();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      renderer.dispose();
      canvas.remove();
    },
    canvas,
  };

  // first frame: idle wall, then a short dolly into place
  setWallNumbers(1024n);
  setFeaturedDoor({ number: "1024", platformLabel: "P.O. BOX" });
  frame();
  const camStart = camFinal.clone().add(new Vector3(-0.5, -0.25, 1.4));
  const lookStart = lookFinal.clone().add(new Vector3(-0.3, 0, 0));
  camera.position.copy(reducedMotion ? camFinal : camStart);
  lookNow.copy(reducedMotion ? lookFinal : lookStart);
  render();
  onReady?.();
  tween(
    1300,
    (p) => {
      camera.position.lerpVectors(camStart, camFinal, p);
      lookNow.lerpVectors(lookStart, lookFinal, p);
    },
    easeInOutCubic,
  );
  return api;
}
