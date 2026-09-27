// Tiny DOM builder. Text is always inserted as text nodes (never innerHTML), so names and
// descriptions coming from GitHub or X can never inject markup.

/**
 * h("a.btn.primary", { href, onclick, "aria-label": … }, child, [children], "text")
 * Tag may carry classes after dots. Props: class, style (string), dataset (object), on* (functions),
 * boolean attributes (true/false), everything else as attributes.
 */
export function h(tag, props, ...children) {
  const [head, ...classes] = tag.split(".");
  const [name, id] = head.split("#");
  const el = document.createElement(name || "div");
  if (id) el.id = id;
  if (classes.length) el.setAttribute("class", classes.join(" "));
  if (props && (typeof props !== "object" || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.setAttribute("class", [el.getAttribute("class"), v].filter(Boolean).join(" "));
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "value" && "value" in el) el.value = v;
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}

export const $ = (sel, root = document) => root.querySelector(sel);

/** Inline SVG from a trusted, bundled string. */
export function svg(markup, cls) {
  const t = document.createElement("template");
  t.innerHTML = markup.trim();
  const el = t.content.firstElementChild;
  if (cls) el.setAttribute("class", cls);
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("focusable", "false");
  return el;
}

export function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h("textarea", { style: "position:fixed;opacity:0", readonly: true }, text);
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** A copy button that confirms in place ("Copied"). */
export function copyButton(text, label = "Copy", extraClass = "") {
  const btn = h(`button.btn.btn-small.btn-ghost${extraClass ? "." + extraClass : ""}`, { type: "button" }, label);
  btn.addEventListener("click", async () => {
    const ok = await copyText(typeof text === "function" ? text() : text);
    btn.textContent = ok ? "Copied" : "Copy failed";
    setTimeout(() => (btn.textContent = label), 1600);
  });
  return btn;
}
