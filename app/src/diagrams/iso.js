// Orthographic "iso" projection shared by the SVG renderer, the WebGL engine and the DOM labels,
// so all three agree to the pixel. World: Y up, objects axis-aligned on the XZ floor. The camera
// looks down 30 degrees (2:1 dimetric) from yaw 45 degrees: world +X runs to the screen's lower
// right, +Z to its lower left, -X upper left, -Z upper right. Pure math, no DOM.

export const EL = Math.PI / 6;
export const YAW = Math.PI / 4;

/** Camera basis for a yaw/elevation: dir points from the scene toward the camera. */
export function basis(yaw = YAW, el = EL) {
  const c = Math.cos(el);
  const s = Math.sin(el);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  return { yaw, el, dir: [c * sy, s, c * cy], right: [cy, 0, -sy], up: [-s * sy, c, -s * cy] };
}

export const BASE = basis();

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** World point -> [screen x, screen up, depth toward the camera]. */
export function project(p, B = BASE) {
  return [dot(p, B.right), dot(p, B.up), dot(p, B.dir)];
}

/** World point -> SVG user coordinates (y down). */
export function toSvg(p, B = BASE) {
  return [dot(p, B.right), -dot(p, B.up)];
}

/** SVG viewBox for a frame { w, h, cx, cy } given in screen units (cy = screen up). */
export function viewBox(frame) {
  return [frame.cx - frame.w / 2, -(frame.cy + frame.h / 2), frame.w, frame.h];
}

/** World point -> [x, y] as fractions (0..1) of the frame, y from the top. */
export function toFrame(p, frame, B = BASE) {
  const x = dot(p, B.right);
  const y = dot(p, B.up);
  return [(x - (frame.cx - frame.w / 2)) / frame.w, (frame.cy + frame.h / 2 - y) / frame.h];
}

/** Camera yaw for a live frame: a slow, small sway around 45 degrees (none when static). */
export function swayYaw(t, amp = 0.07, period = 18) {
  return YAW + amp * Math.sin((2 * Math.PI * t) / period);
}
