// Server-side page shell: injects per-route <title>, description and Open Graph tags into the
// built index.html, so shared vault links preview correctly without JavaScript. The preview is
// derived from the path only: no network call and no balances (nothing that reads like a
// "claim your funds" lure).
import { routeMeta } from "../src/routes.js";

const START = "<!--meta:start-->";
const END = "<!--meta:end-->";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function metaTags(pathname: string, origin: string | undefined): { status: number; html: string } {
  const m = routeMeta(pathname);
  const base = origin ? origin.replace(/\/+$/, "") : "";
  const url = `${base}${pathname}`;
  const image = `${base}/og.png`;
  const t = escapeHtml(m.title);
  const d = escapeHtml(m.description);
  const lines = [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="anyfee">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="Diagram: creator fees and tips flow into an account's vault; the owner proves control and withdraws.">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d}">`,
    `<meta name="twitter:image" content="${escapeHtml(image)}">`,
  ];
  if (base) lines.push(`<meta property="og:url" content="${escapeHtml(url)}">`, `<link rel="canonical" href="${escapeHtml(url)}">`);
  if (m.status === 404) lines.push(`<meta name="robots" content="noindex">`);
  return { status: m.status, html: lines.join("\n    ") };
}

/** Replaces the meta block of a built page with the tags for `pathname`. */
export function renderShell(template: string, pathname: string, origin?: string): { status: number; html: string } {
  const { status, html } = metaTags(pathname, origin);
  const a = template.indexOf(START);
  const b = template.indexOf(END);
  if (a < 0 || b < a) return { status, html: template };
  return { status, html: `${template.slice(0, a + START.length)}\n    ${html}\n    ${template.slice(b)}` };
}
