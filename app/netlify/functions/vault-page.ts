// Netlify Function (v2): /v/* vault pages. Serves the built shell with per-page <title>,
// description and Open Graph tags, so shared links preview without JavaScript. The preview is
// derived from the path only (no network lookups, no balances).
import { renderShell } from "../../server/shell.ts";

let template: string | null = null;

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (!template) {
    const r = await fetch(new URL("/index.html", url.origin));
    if (!r.ok) return new Response("site shell unavailable", { status: 502 });
    template = await r.text();
  }
  const { status, html } = renderShell(template, url.pathname, process.env.SITE_URL || process.env.URL || url.origin);
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" },
  });
}

export const config = { path: "/v/*" };
