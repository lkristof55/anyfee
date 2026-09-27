Recorded API responses used by the offline tests (no network in `npm test`).

Recorded on 2026-09-27 with curl:
- `github/*` — `api.github.com` (`/repos/octocat/Hello-World`, `/repositories/1296269`, `/repos/github/gitignore`, `/users/octocat`, `/users/github`, a 404).
- `fxtwitter/*` — `api.fxtwitter.com` (`/solana`, `/jack/status/20`, `/zzq9x8w7v6u5t4` → 404, `/status/1999999999999999999` → 404).

Claim-post fixtures are derived from the recorded `status-20.json` shape (only `text`,
`raw_text` and timestamps changed) because a real `anyfee:<wallet>` post cannot be recorded
offline; they live next to the tests that use them.
