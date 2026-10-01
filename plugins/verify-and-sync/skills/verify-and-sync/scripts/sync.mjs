#!/usr/bin/env node
// verify-and-sync · sync.mjs — after a verified commit: push the branch, move the main branch forward, and bring
// other worktrees (a second agent, a teammate) up to date when they are idle.
//
//   node scripts/sync.mjs            do it
//   node scripts/sync.mjs --dry-run  only say what would happen
//
// The main branch moves only when the last full verify (not --quick) passed on exactly this code. Files changed
// after the verification may only be docs (*.md, docs/**), such as the handoff note. Nothing is ever forced.
// Settings (optional) in verify.config.json → "sync": { "mainBranch": "main", "remote": "origin", "push": true }.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const root = process.cwd();
const config = existsSync(path.join(root, 'verify.config.json'))
  ? JSON.parse(readFileSync(path.join(root, 'verify.config.json'), 'utf8'))
  : {};
const lang = config.language === 'he' ? 'he' : 'en';
const sync = { mainBranch: 'main', remote: 'origin', push: true, ...(config.sync ?? {}) };
const OUT = path.join(root, config.outputDir ?? '.verify');

const T = {
  en: {
    dirty: '❌ There are uncommitted changes. Commit first, then sync.',
    pushed: (b, h) => `✅ ${b} @ ${h} pushed to ${sync.remote}`,
    pushFailed: (o) => `❌ Push failed:\n${o}`,
    noVerify: 'no run of verify was found',
    quickRun: 'the last verification was --quick (no end-to-end / tour)',
    failedRun: 'the last verification did not pass',
    noTree: 'the last verification has no fingerprint',
    codeChanged: (f) => `code changed after the last verification (${f})`,
    mainNotMoved: (why) => `⚪ ${sync.mainBranch} not moved: ${why}. Run verify, then sync again.`,
    onMain: `✅ ${sync.mainBranch} is the current branch and was pushed`,
    mainMoved: (h) => `✅ ${sync.mainBranch} moved to ${h} (local and ${sync.remote})`,
    mainFailed: (o) => `❌ Moving ${sync.mainBranch} failed:\n${o}`,
    diverged: `⚪ ${sync.mainBranch} moved on in parallel: merge it (git merge ${sync.mainBranch}), verify, then sync again.`,
    wtNotVerified: (w) => `⚪ ${w}: not updated (${sync.mainBranch} did not move)`,
    wtBusy: (w, b) => `⚪ ${w} (${b}): has unfinished work — it will merge ${sync.mainBranch} at its next task`,
    wtUpdated: (w, b) => `✅ ${w} (${b}) updated to the latest version`,
    wtFailed: (w, o) => `❌ ${w}: update failed:\n${o}`,
    wtAhead: (w, b) => `⚪ ${w} (${b}): has commits of its own — review and merge them, then verify`,
    dry: '(dry run — nothing was changed)',
  },
  he: {
    dirty: '❌ יש שינויים שלא נשמרו בקומיט. קודם קומיט, ואז סנכרון.',
    pushed: (b, h) => `✅ ${b} @ ${h} הועלה ל־${sync.remote}`,
    pushFailed: (o) => `❌ ההעלאה נכשלה:\n${o}`,
    noVerify: 'לא נמצאה הרצה של verify',
    quickRun: 'הבדיקה האחרונה הייתה מהירה (--quick), בלי בדיקות מקצה לקצה וסיור',
    failedRun: 'הבדיקה האחרונה לא עברה',
    noTree: 'אין טביעת אצבע לבדיקה האחרונה',
    codeChanged: (f) => `קוד השתנה אחרי הבדיקה האחרונה (${f})`,
    mainNotMoved: (why) => `⚪ ${sync.mainBranch} לא קודם: ${why}. מריצים verify ואז שוב סנכרון.`,
    onMain: `✅ ${sync.mainBranch} הוא הענף הנוכחי, והוא כבר הועלה`,
    mainMoved: (h) => `✅ ${sync.mainBranch} קודם אל ${h} (במחשב וב־${sync.remote})`,
    mainFailed: (o) => `❌ קידום ${sync.mainBranch} נכשל:\n${o}`,
    diverged: `⚪ ${sync.mainBranch} התקדם במקביל: צריך מיזוג (git merge ${sync.mainBranch}), בדיקה, ואז שוב סנכרון.`,
    wtNotVerified: (w) => `⚪ ${w}: לא עודכן (${sync.mainBranch} לא קודם)`,
    wtBusy: (w, b) => `⚪ ${w} (${b}): באמצע עבודה — ימזג את ${sync.mainBranch} בתחילת המשימה הבאה`,
    wtUpdated: (w, b) => `✅ ${w} (${b}) עודכן לגרסה האחרונה`,
    wtFailed: (w, o) => `❌ ${w}: העדכון נכשל:\n${o}`,
    wtAhead: (w, b) => `⚪ ${w} (${b}): יש בו קומיטים משלו — לבדוק, למזג, ואז verify`,
    dry: '(הרצת ניסיון — שום דבר לא שונה)',
  },
}[lang];

const sh = (cmd, cwd) =>
  execSync(cmd, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
const tryRun = (cmd, cwd) => {
  try {
    return { ok: true, out: sh(cmd, cwd) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() };
  }
};
/** Runs a command that changes something (skipped, but reported, in a dry run). */
const act = (cmd, cwd) => (dryRun ? { ok: true, out: `[dry-run] ${cmd}` } : tryRun(cmd, cwd));
const isAncestor = (a, b, cwd) => tryRun(`git merge-base --is-ancestor ${a} ${b}`, cwd).ok;

let failed = false;

// 1. Everything committed.
if (sh('git status --porcelain')) {
  console.log(T.dirty);
  process.exit(1);
}
const branch = sh('git branch --show-current');
const head = sh('git rev-parse --short HEAD');

// 2. Push the branch.
if (sync.push) {
  const push = act(branch ? `git push -u ${sync.remote} ${branch}` : 'git push');
  console.log(push.ok ? T.pushed(branch, head) : T.pushFailed(push.out));
  if (!push.ok) failed = true;
}

// 3. Move the main branch — only on verified code.
const summaryFile = path.join(OUT, 'summary.json');
let verified = false;
let why = T.noVerify;
if (existsSync(summaryFile)) {
  const summary = JSON.parse(readFileSync(summaryFile, 'utf8'));
  if (summary.quick) why = T.quickRun;
  else if (!summary.ok) why = T.failedRun;
  else if (!summary.tree) why = T.noTree;
  else {
    const changed = tryRun(`git diff --name-only ${summary.tree} HEAD`);
    const code = changed.ok
      ? changed.out
          .split(/\r?\n/)
          .filter(Boolean)
          .filter((f) => !(f.endsWith('.md') || f.startsWith('docs/')))
      : ['?'];
    if (code.length) why = T.codeChanged(code.slice(0, 5).join(', '));
    else verified = true;
  }
}
if (!verified) {
  console.log(T.mainNotMoved(why));
} else if (branch === sync.mainBranch) {
  console.log(T.onMain);
} else if (isAncestor(sync.mainBranch, 'HEAD')) {
  const moved = sync.push ? act(`git push ${sync.remote} HEAD:${sync.mainBranch}`) : { ok: true };
  if (moved.ok) {
    act(`git branch -f ${sync.mainBranch} HEAD`);
    console.log(T.mainMoved(head));
  } else {
    console.log(T.mainFailed(moved.out));
    failed = true;
  }
} else {
  console.log(T.diverged);
}

// 4. Other worktrees: fast-forward now when idle; otherwise they merge the main branch at their next task.
const me = sh('git rev-parse --show-toplevel').toLowerCase();
const worktrees = sh('git worktree list --porcelain')
  .split(/\r?\n/)
  .filter((l) => l.startsWith('worktree '))
  .map((l) => l.slice('worktree '.length).trim())
  .filter((p) => p.toLowerCase() !== me);
for (const wt of worktrees) {
  const otherBranch = tryRun('git branch --show-current', wt).out;
  const dirty = tryRun('git status --porcelain', wt).out;
  if (!verified) console.log(T.wtNotVerified(wt));
  else if (dirty) console.log(T.wtBusy(wt, otherBranch));
  else if (otherBranch && isAncestor(otherBranch, sync.mainBranch, wt)) {
    const ff = act(`git merge --ff-only ${sync.mainBranch}`, wt);
    if (ff.ok) {
      if (sync.push) act(`git push ${sync.remote} ${otherBranch}`, wt);
      console.log(T.wtUpdated(wt, otherBranch));
    } else {
      console.log(T.wtFailed(wt, ff.out));
      failed = true;
    }
  } else console.log(T.wtAhead(wt, otherBranch));
}

if (dryRun) console.log(T.dry);
process.exit(failed ? 1 : 0);
