import { test } from "node:test";
import assert from "node:assert/strict";
import { idPath, matchRoute, routeMeta, vaultPath } from "../src/routes.js";

test("matchRoute: static pages and vault routes", () => {
  assert.equal(matchRoute("/").name, "home");
  assert.equal(matchRoute("/claim/").name, "claim");
  assert.equal(matchRoute("/how").name, "how");
  assert.equal(matchRoute("/faq").name, "faq");
  assert.deepEqual(matchRoute("/v/github/octocat/Hello-World"), {
    name: "vault", kind: "github-repo", platformName: "github-repo", query: "github.com/octocat/Hello-World", label: "octocat/Hello-World",
  });
  assert.equal(matchRoute("/v/gh/octocat").query, "github.com/octocat");
  assert.equal(matchRoute("/v/x/jack").query, "@jack");
  assert.equal(matchRoute("/v/x/%40jack").query, "@jack");
  assert.equal(matchRoute("/v/id/x/12").query, "x:12");
  assert.equal(matchRoute("/v/id/github-repo/1296269").label, "github-repo:1296269");
});

test("matchRoute: junk is a 404, never a lookup", () => {
  for (const p of ["/v/github/octocat", "/v/github/-bad/x", "/v/x/way_too_long_handle_here", "/v/id/x/abc", "/v/id/email/1", "/v/id/x/18446744073709551616", "/v/gh/a%ZZ", "/nope", "/v/github/o/.."]) {
    assert.equal(matchRoute(p).name, "notfound", p);
  }
});

test("vaultPath / idPath: canonical, shareable paths", () => {
  assert.equal(vaultPath({ platformName: "github-repo", display: "octocat/Hello-World", id: "1296269" }), "/v/github/octocat/Hello-World");
  assert.equal(vaultPath({ platformName: "github-user", display: "octocat", id: "583231" }), "/v/gh/octocat");
  assert.equal(vaultPath({ platformName: "x", display: "@jack", id: "12" }), "/v/x/jack");
  assert.equal(vaultPath({ platformName: "x", display: "x:12", id: "12" }), "/v/id/x/12");
  assert.equal(idPath("github-user", "583231"), "/v/id/github-user/583231");
});

test("routeMeta: honest titles, 404 for unknown paths", () => {
  const m = routeMeta("/v/github/octocat/Hello-World");
  assert.equal(m.status, 200);
  assert.match(m.title, /octocat\/Hello-World/);
  assert.match(m.description, /Unverified until claimed, not an endorsement/);
  assert.match(m.description, /Devnet only/);
  assert.equal(routeMeta("/nope").status, 404);
});
