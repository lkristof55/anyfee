import { test } from "node:test";
import assert from "node:assert/strict";
import { metaTags, renderShell } from "../server/shell.ts";

const template = `<html><head><!--meta:start--><title>old</title><!--meta:end--></head><body></body></html>`;

test("renderShell replaces the meta block per route", () => {
  const { status, html } = renderShell(template, "/v/gh/octocat", "https://example.test");
  assert.equal(status, 200);
  assert.ok(!html.includes("<title>old</title>"));
  assert.match(html, /<title>octocat · anyfee box<\/title>/);
  assert.match(html, /property="og:image" content="https:\/\/example.test\/og.png"/);
  assert.match(html, /property="og:url" content="https:\/\/example.test\/v\/gh\/octocat"/);
  assert.match(html, /twitter:card" content="summary_large_image"/);
});

test("unknown paths get a 404 status and noindex", () => {
  const { status, html } = renderShell(template, "/v/github/only-owner");
  assert.equal(status, 404);
  assert.match(html, /noindex/);
});

test("meta values are HTML-escaped", () => {
  const { html } = metaTags("/v/github/a/b.c", "https://x.test/\"><script>");
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&quot;&gt;&lt;script&gt;/);
});
