# verify-and-sync — a Claude Code skill

**[עברית ←](README.he.md)**

**Stop clicking through your app to check what the AI changed.** After every fix or feature, this skill makes Claude *prove* it works, then save and sync it:

1. **It records what you asked for,** as a request with a concrete acceptance check ("as an admin, on the reports page, the total equals the rows").
2. **It runs every automatic check:** types, lint, formatting, unit and integration tests, database tests, the production build and end-to-end tests.
3. **It takes a screen tour.** It signs in as **each kind of user**, opens **every screen**, and checks each one for:
   - your requests (texts that must appear, or must be gone);
   - browser errors;
   - sideways scrolling on a phone;
   - serious accessibility problems.

   It photographs every screen into **one gallery page**, with your requests and their ✅/❌ at the top.
4. **It saves and syncs:**
   - commits and pushes;
   - moves `main` **only if the full verification passed on exactly that code**;
   - updates other git worktrees (for example a second AI agent) when they're idle;
   - rewrites a live `docs/HANDOFF.md` ("where we stand").
5. **It reports in plain words** (English or Hebrew), one line per request, with the gallery attached.

It was built for a non-technical product owner who was spending hours re-checking every screen after each AI change. Now they scan one page.

## Install

**Claude Code (recommended):**

```
/plugin marketplace add dvirsh23710/claude-verify-and-sync
/plugin install verify-and-sync@claude-verify-and-sync
```

**Claude.ai / the Claude app:** download [`dist/verify-and-sync.skill`](dist/verify-and-sync.skill) and add it under *Settings → Capabilities → Skills*. The scripts are meant to run in your project, so Claude Code is where it shines.

**Manually:** copy `plugins/verify-and-sync/skills/verify-and-sync/` into your repo's `.claude/skills/`.

## First use

Open your project in Claude Code and say: **"set up verify-and-sync for this project"**. Claude will:
- copy `scripts/verify.mjs` and `scripts/sync.mjs` into your repo;
- write a `verify.config.json` mapped to your real commands (npm, pnpm, yarn or bun; Playwright, Vitest, Jest…);
- create the screen tour (`tests/tour/stops.ts`: your roles and screens);
- create `docs/owner-requests.md` and `docs/HANDOFF.md`;
- run everything once.

After that, it runs by itself whenever Claude finishes a change. You can also just say "verify everything" or "commit and sync".

## What you need

- **Required:** a git repo and Node.js 18+.
- **For the screen tour:** a web app with [Playwright](https://playwright.dev) end-to-end tests that save signed-in sessions (`storageState`) per role.
- **Optional:** `@axe-core/playwright` for the accessibility check.

## Commands it adds

| Command | What it does |
|---|---|
| `node scripts/verify.mjs` | All checks + the screen tour. `--quick` skips the slow ones. `--reset-demo` restores demo data before the tour. |
| `node scripts/sync.mjs` | Push, move `main` (verified code only), update idle worktrees. `--dry-run` only shows what it would do. |
| `npx playwright test --config playwright.tour.config.ts` | The screen tour alone. `TOUR_SELFTEST=1` proves the checker catches planted problems. |

## Safety by design

- **`main` only moves on verified code.** sync compares a fingerprint of the files that were verified with what's committed; only docs may differ.
- **One verification at a time** per repository, through a lock in the shared git directory. Worktrees often share a database and ports.
- **Demo data is never reset** while another worktree has uncommitted work, or after a failure, so the evidence stays.
- **Nothing is ever force-pushed.** Diverged branches are reported, not overwritten.
- **Tests are never weakened to get green.** The skill tells Claude to fix the product or update the test, and to cite the decision that changed it.

## Files

```
plugins/verify-and-sync/skills/verify-and-sync/
├── SKILL.md                     ← the routine Claude follows
├── scripts/verify.mjs           ← runs the checks, lock, fingerprint, Hebrew/English summary
├── scripts/sync.mjs             ← push, move main, update worktrees
└── templates/
    ├── verify.config.json
    ├── tour/tour.spec.ts        ← the screen-tour engine (you don't edit it)
    ├── tour/stops.ts            ← your roles, screens and requests
    ├── tour/playwright.tour.config.ts
    └── docs/owner-requests.md · HANDOFF.md · AGENTS-section.md
```

## License

MIT © 2026 dvirsh23710
