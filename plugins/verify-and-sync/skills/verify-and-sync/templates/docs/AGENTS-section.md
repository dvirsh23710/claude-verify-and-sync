## Stay in sync and finish every task the same way (verify-and-sync)

<!-- Paste this into AGENTS.md (or your second agent's instructions) when two agents or people work in the same repo,
     e.g. a second git worktree. Adjust the branch names. -->

**At the start of every task:**
1. Run `git status`. It must be clean; commit your own unfinished work first.
2. Run `git merge --ff-only main`. If it can't fast-forward, run `git merge main` and resolve the conflicts. Never discard either side.
3. Read `docs/HANDOFF.md`, the live "where we stand", and the project instructions.

**At the end of every task:**
1. Record the request and its acceptance check in `docs/owner-requests.md` and in the tour (`tests/tour/stops.ts`).
2. Run `node scripts/verify.mjs --reset-demo`.
   - It takes a lock, so only one verification runs at a time.
   - It never resets shared demo data while another worktree has uncommitted work.
3. Update `docs/HANDOFF.md`, then commit.
4. Run `node scripts/sync.mjs`. It pushes your branch and reports what it did. The main branch only moves after review and merge.
5. Report per request, with the tour gallery. The owner never verifies by hand.

**Shared resources:** use `verify` instead of resetting the database or running the e2e suite directly.
