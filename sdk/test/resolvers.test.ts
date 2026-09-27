import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ResolveError,
  defaultXResolver,
  fxTwitterResolver,
  parseTweetUrl,
  resolveGithubRepo,
  resolveGithubRepoById,
  resolveGithubUser,
  xApiResolver,
} from "../src/index.ts";
import { fakeFetch, fixture } from "./helpers.ts";

const GH = "https://api.github.com";

test("resolveGithubRepo (recorded octocat/Hello-World)", async () => {
  const f = fakeFetch({ [`${GH}/repos/octocat/Hello-World`]: { body: fixture("github/repos-octocat-Hello-World.json") } });
  const r = await resolveGithubRepo("octocat", "Hello-World", { fetch: f, token: "ghs_test" });
  assert.equal(r.platform, 2);
  assert.equal(r.id, "1296269");
  assert.equal(r.fullName, "octocat/Hello-World");
  assert.equal(r.defaultBranch, "master");
  assert.deepEqual(r.owner, { id: "583231", login: "octocat", type: "User" });
  const h = new Headers(f.calls[0]!.init!.headers);
  assert.equal(h.get("authorization"), "Bearer ghs_test");
  assert.equal(h.get("x-github-api-version"), "2022-11-28");
});

test("resolveGithubRepoById + org-owned repo", async () => {
  const f = fakeFetch({
    [`${GH}/repositories/1296269`]: { body: fixture("github/repositories-1296269.json") },
    [`${GH}/repos/github/gitignore`]: { body: fixture("github/repos-github-gitignore.json") },
  });
  assert.equal((await resolveGithubRepoById("1296269", { fetch: f })).fullName, "octocat/Hello-World");
  const org = await resolveGithubRepo("github", "gitignore", { fetch: f });
  assert.equal(org.id, "1062897");
  assert.equal(org.owner.type, "Organization");
  assert.equal(org.defaultBranch, "main");
  assert.equal(f.calls[0]!.init?.headers && new Headers(f.calls[0]!.init.headers).has("authorization"), false);
});

test("resolveGithubUser: user vs organization", async () => {
  const f = fakeFetch({
    [`${GH}/users/octocat`]: { body: fixture("github/users-octocat.json") },
    [`${GH}/users/github`]: { body: fixture("github/users-github.json") },
  });
  const u = await resolveGithubUser("octocat", { fetch: f });
  assert.deepEqual([u.platform, u.id, u.login, u.type], [1, "583231", "octocat", "User"]);
  const o = await resolveGithubUser("github", { fetch: f });
  assert.deepEqual([o.id, o.type], ["9919", "Organization"]);
});

test("GitHub errors: 404, rate limit, malformed", async () => {
  const f = fakeFetch({
    [`${GH}/repos/octocat/nope`]: { status: 404, body: fixture("github/not-found.json") },
    [`${GH}/users/limited`]: { status: 403, body: { message: "API rate limit exceeded" }, headers: { "x-ratelimit-remaining": "0" } },
    [`${GH}/users/weird`]: { body: { id: "not-a-number", login: "weird" } },
  });
  await assert.rejects(resolveGithubRepo("octocat", "nope", { fetch: f }), (e: unknown) => e instanceof ResolveError && e.status === 404);
  await assert.rejects(resolveGithubUser("limited", { fetch: f }), (e: unknown) => e instanceof ResolveError && e.status === 429);
  await assert.rejects(resolveGithubUser("weird", { fetch: f }), (e: unknown) => e instanceof ResolveError && e.status === 502);
});

const FX = "https://api.fxtwitter.com";

test("fxtwitter: user by handle and tweet by id (recorded)", async () => {
  const f = fakeFetch({
    [`${FX}/solana`]: { body: fixture("fxtwitter/user-solana.json") },
    [`${FX}/status/20`]: { body: fixture("fxtwitter/status-20.json") },
  });
  const x = fxTwitterResolver({ fetch: f });
  assert.deepEqual(await x.userByHandle("@solana"), { id: "951329744804392960", handle: "solana", name: "Solana" });
  const t = await x.tweet("20");
  assert.equal(t.text, "just setting up my twttr");
  assert.deepEqual(t.author, { id: "12", handle: "jack", name: "jack" });
  assert.equal(t.createdAt, 1142974214);
});

test("fxtwitter: not found (404 JSON and redirect for invalid paths)", async () => {
  const f = fakeFetch({
    [`${FX}/zzq9x8w7v6u5t4`]: { status: 404, body: fixture("fxtwitter/user-not-found.json") },
    [`${FX}/status/1999999999999999999`]: { status: 404, body: fixture("fxtwitter/status-not-found.json") },
    [`${FX}/redirected`]: { status: 302, body: "<html>", headers: { location: "https://github.com/FxEmbed/FxEmbed", "content-type": "text/html" } },
  });
  const x = fxTwitterResolver({ fetch: f });
  const is404 = (e: unknown) => e instanceof ResolveError && e.status === 404;
  await assert.rejects(x.userByHandle("zzq9x8w7v6u5t4"), is404);
  await assert.rejects(x.tweet("1999999999999999999"), is404);
  await assert.rejects(x.userByHandle("redirected"), is404);
  await assert.rejects(x.userByHandle("bad-handle"), (e: unknown) => e instanceof ResolveError && e.status === 400);
  await assert.rejects(x.tweet("12a"), (e: unknown) => e instanceof ResolveError && e.status === 400);
});

test("official X API v2 resolver (documented response shapes)", async () => {
  const f = fakeFetch({
    "https://api.x.com/2/users/by/username/solana": { body: { data: { id: "951329744804392960", name: "Solana", username: "solana" } } },
    "https://api.x.com/2/tweets/20?expansions=author_id&tweet.fields=created_at,author_id,note_tweet&user.fields=username,name": {
      body: {
        data: { id: "20", text: "just setting up my twttr", author_id: "12", created_at: "2006-03-21T20:50:14.000Z", edit_history_tweet_ids: ["20"] },
        includes: { users: [{ id: "12", name: "jack", username: "jack" }] },
      },
    },
    "https://api.x.com/2/tweets/21?expansions=author_id&tweet.fields=created_at,author_id,note_tweet&user.fields=username,name": {
      body: { errors: [{ value: "21", detail: "Could not find tweet with id: [21].", title: "Not Found Error" }] },
    },
  });
  const x = defaultXResolver({ bearerToken: "AAAA-test", fetch: f });
  assert.equal(x.name, "x-api-v2");
  assert.equal((await x.userByHandle("solana")).id, "951329744804392960");
  const t = await x.tweet("20");
  assert.deepEqual(t, { id: "20", text: "just setting up my twttr", author: { id: "12", handle: "jack", name: "jack" }, createdAt: 1142974214 });
  await assert.rejects(x.tweet("21"), (e: unknown) => e instanceof ResolveError && e.status === 404);
  assert.equal(new Headers(f.calls[0]!.init!.headers).get("authorization"), "Bearer AAAA-test");
  assert.equal(defaultXResolver({ fetch: f }).name, "fxtwitter");
  assert.equal(xApiResolver({ bearerToken: "x" }).name, "x-api-v2");
});

test("parseTweetUrl", () => {
  assert.deepEqual(parseTweetUrl("https://x.com/jack/status/20"), { tweetId: "20", handle: "jack" });
  assert.deepEqual(parseTweetUrl("twitter.com/jack/status/20?s=46&t=abc"), { tweetId: "20", handle: "jack" });
  assert.deepEqual(parseTweetUrl("https://mobile.twitter.com/jack/status/20/photo/1"), { tweetId: "20", handle: "jack" });
  assert.deepEqual(parseTweetUrl("https://x.com/i/web/status/20"), { tweetId: "20", handle: null });
  assert.deepEqual(parseTweetUrl("https://fxtwitter.com/jack/status/20"), { tweetId: "20", handle: "jack" });
  for (const bad of ["https://evil.com/jack/status/20", "https://x.com/jack", "https://x.com/jack/status/abc", "not a url at all"]) {
    assert.throws(() => parseTweetUrl(bad), ResolveError, bad);
  }
});
