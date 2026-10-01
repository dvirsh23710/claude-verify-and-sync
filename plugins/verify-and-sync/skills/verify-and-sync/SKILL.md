---
name: verify-and-sync
description: >-
  Finish every code change the same way: prove it works, save it, sync it — so the person you build for never has
  to click through screens to check your work. Records each request with an acceptance check, runs every automatic
  check (types, lint, format, unit and integration, database, production build, end-to-end) plus a screen tour that
  signs in as each user role, opens every screen, checks it and photographs it into a gallery, then commits, pushes,
  moves the main branch only on verified code, updates other worktrees and a handoff note, and reports per request
  with evidence. Use it whenever you finish a bug fix, feature, refactor or migration in a web app repo, before
  saying done, and whenever the user asks to verify, test everything, check that it works, commit, push or sync —
  even if they never mention tests. Includes a one-time setup for new projects.
---

# Verify and sync

People who commission software often can't read a test log, and clicking through every screen after each change costs them hours. This skill's job is to **prove**, not claim, two things after every change:

1. What they asked for now works on the real screens, as the right user.
2. Nothing that worked before broke.

Then it saves the work and syncs it, so the remote, the main branch, other agents and the handoff note all know where things stand. Never ask the user to verify by hand. If they must act (an account, a button in a dashboard), give numbered click-by-click steps.

The skill's own files are in its base directory, which is shown when the skill loads:
- `scripts/verify.mjs`, `scripts/sync.mjs`;
- `templates/tour/` (`tour.spec.ts`, `stops.ts`, `playwright.tour.config.ts`);
- `templates/verify.config.json`;
- `templates/docs/` (`owner-requests.md`, `HANDOFF.md`, `AGENTS-section.md`).

## 0. First time in a project: set up (once)

Check whether `scripts/verify.mjs` and `verify.config.json` exist in the repo. If they don't:

1. Copy `scripts/verify.mjs` and `scripts/sync.mjs` into the project's `scripts/`.
2. Create `verify.config.json` from the template:
   - Map each step to the project's real commands: typecheck, lint, format check, unit tests, database tests, build, end-to-end. Mark the browser suites `"slow": true`.
   - If the project resets demo or seed data, fill in `resetDemo`.
   - Set `language` to the user's language (`he` gives right-to-left Hebrew output) and `appUrl` to the local app address.
3. Add package scripts if the project uses them: `"verify": "node scripts/verify.mjs"`, `"sync": "node scripts/sync.mjs"`, and `"tour"` (below).
4. Add `.verify/` to `.gitignore`.
5. **Screen tour** (web apps with Playwright):
   - Copy `templates/tour/tour.spec.ts` and `stops.ts` into `tests/tour/`, and `playwright.tour.config.ts` to the root. Point the config at the project's Playwright config.
   - Fill `stops.ts`: the roles (sign-in state files that the e2e setup already saves), every screen per role, and `TOUR.language`.
   - Run it once and fix what it finds, or record it as known.
   - Run `TOUR_SELFTEST=1` once to prove the checker catches problems: it plants two and must report exactly those two.
6. Create `docs/owner-requests.md` and `docs/HANDOFF.md` from the templates. If another agent or person works in the same repo (for example a second git worktree), paste `templates/docs/AGENTS-section.md` into their instructions.
7. Commit the setup.

The tour is the part people value most: a gallery of every screen per user, with the requests on top, that they can scan in a minute. Invest in its stops.

## 1. Pin down what was asked — before or while you change code

A check written from the requester's own words catches "the code changed, but not what they meant". It also stays forever as a guard, so the same thing can't silently break again.

- Add or update the row in `docs/owner-requests.md` with:
  - the next `R-xx` id and the date;
  - the request in their words, short;
  - the acceptance check ("as \<role\>, on \<screen\>, \<text\> appears / no longer appears / totals add up");
  - where it's proven.
- Make the check executable, choosing the cheapest layer that really proves it:
  - **Visible on a screen:** add the id plus `expect`/`forbid` texts to that screen's stop in `tests/tour/stops.ts`, and add it to `REQUESTS`. Add a stop if the screen is new. Use a RegExp when the text has variable numbers or non-breaking spaces.
  - **A flow:** an end-to-end test signed in as the right role. Name it after the request.
  - **A permission or data rule:** a database or API test.
  - **Pure logic:** a unit test.
- If a request changes an earlier decision, older tests may assert the old behavior. Update them and say which decision replaced it. Never delete them silently.

## 2. Run everything

```bash
node scripts/verify.mjs --reset-demo
```

- On large projects this can take 10–30 minutes. Run it in the background, tell the user in one line that it's running, and keep working.
- It runs the configured steps in order. Logs go to `.verify/<step>.log`, the summary with a fingerprint of the verified files to `.verify/summary.json`, and the gallery to `.verify/tour/index.html`.
- `--reset-demo` restores demo data before the tour, so the gallery shows clean data. It is skipped automatically after a failure, so the evidence stays, and while another worktree has uncommitted work.
- Use `--quick` (no slow steps) only for docs or copy changes. sync will not move the main branch on a quick run, by design.
- Only one verification runs per repository at a time: a lock in the shared git directory. If it says ⏸, wait.

## 3. When something fails

- Read the step's log. For Playwright, read `test-results/<test>/error-context.md`, the page at the failure. If you need more, unzip `trace.zip`: `*.network` lists the requests, `*.trace` the actions.
- Classify the failure, because each kind has a different correct move:
  - **A real bug:** fix the product, and say so plainly if you caused it.
  - **The test asserts a superseded decision:** update the test and cite the decision.
  - **A flake:** prove it with a rerun, find the race, and fix it if it's in the tests. Common race: tests sharing demo data. Common blocker: rate limits, because every simulated user comes from one address.
- Never weaken, skip or delete a test to get green; that hides exactly what the user relies on you to catch. Rerun the failed step, then the full verify.
- A bug in the verification tooling itself still counts. Fix it, and mention it.

## 4. Save and sync

1. Update `docs/HANDOFF.md`, the live note the next agent or teammate reads first. Include:
   - the date, the branch and the commit;
   - what changed;
   - the verification result in numbers;
   - what's open and what's next;
   - the decisions waiting for the user.
2. Commit in conventional form (`feat(scope): …`, `fix(scope): …`). Explain *why* in the body. Commit related work together and unrelated work separately.
3. Run `node scripts/sync.mjs`. It does three things:
   - **Pushes the branch.**
   - **Moves the main branch**, but only if the last full verify passed on exactly this code. Docs edits made afterwards are fine.
   - **Fast-forwards other idle worktrees**, so a second agent sees the new code at once. One that's mid-task merges main itself at its next start.

   Read every ⚪ line: it says what wasn't done and why. Never force-push.
4. If another worktree has commits of its own, review them, merge, then verify and sync again.

## 5. Report

Write in the user's language, keep it short, and use plain words, not jargon:

```
## Verified: <what changed, in plain words>

**Your requests**
| Request | How it was checked | Result |
|---|---|---|
| R-xx <title> | <screen + role, or test, in plain words> | ✅ / ❌ <why> |

**All automatic checks:** ✅ N/N (<unit count>, <e2e count>, tour: <screens> screens, <problems> problems)
**Found and fixed on the way:** <only if any>
**Saved and synced:** remote ✅ · main ✅ · other worktrees ✅/⚪ <why>
**Open / needs you:** <only if any; numbered click-by-click steps>

🔗 <appUrl from verify.config.json>
```

- Attach the gallery (`.verify/tour/index.html`) with whatever file-sending tool you have. It's their visual proof.
- Only call something done when a check proved it. An honest ⚪ "not verified, because…" is worth more than a hopeful ✅.
- End with the app link, so they can look themselves if they want to, never as homework.
