#!/usr/bin/env node
// verify-and-sync · verify.mjs — run every automatic check of a project, in order, and record the result.
//
//   node scripts/verify.mjs               everything
//   node scripts/verify.mjs --quick       skip the slow steps (marked "slow" in the config: end-to-end, screen tour…)
//   node scripts/verify.mjs --reset-demo  run the config's "resetDemo" commands before the step it names (default:
//                                         the screen tour) — never when an earlier step failed (the evidence stays)
//                                         and never while another git worktree has uncommitted work
//
// Steps come from verify.config.json (see templates/verify.config.json). Without it, the usual package.json scripts
// are used when present: typecheck, lint, format:check, test, build, test:e2e, tour.
// Output (add it to .gitignore): <outputDir>/summary.json, one log per step, and the tour gallery if you use one.
// Only one verification runs at a time per repository (a lock in the shared git directory), because worktrees of
// the same repo often share a database and ports.
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const quick = args.has('--quick');
const resetDemo = args.has('--reset-demo');
const root = process.cwd();
const config = existsSync(path.join(root, 'verify.config.json'))
  ? JSON.parse(readFileSync(path.join(root, 'verify.config.json'), 'utf8'))
  : {};
const lang = config.language === 'he' ? 'he' : 'en';
const OUT = path.join(root, config.outputDir ?? '.verify');

const T = {
  en: {
    busy: (wt, min) => `⏸ Another verification is running (${wt}, started ${min} min ago). Try again when it ends.`,
    skippedQuick: (s) => `⚪ ${s}: skipped (--quick)`,
    skippedBuild: (s) => `⚪ ${s}: skipped (the build failed)`,
    resetSkippedFailed: '⚪ Demo data not reset: an earlier step failed, so the evidence stays for investigation',
    resetSkippedBusy: (p) => `⚪ Demo data not reset: another worktree has unfinished work (${p})`,
    resetting: 'Resetting the demo data',
    fullLog: 'full log',
    allOk: (q) => `\n✅ All steps passed${q ? ' (slow steps skipped)' : ''}.`,
    someFailed: (n, list) => `\n❌ ${n} step(s) failed: ${list}`,
    gallery: (p) => `Screen tour gallery: ${p}`,
    noSteps: 'No steps found: add verify.config.json or package.json scripts (typecheck, lint, test, build…).',
  },
  he: {
    busy: (wt, min) => `⏸ בדיקה אחרת כבר רצה (${wt}, התחילה לפני ${min} דק׳). נסו שוב כשהיא תסתיים.`,
    skippedQuick: (s) => `⚪ ${s}: דילגתי (--quick)`,
    skippedBuild: (s) => `⚪ ${s}: דילגתי (הבנייה נכשלה)`,
    resetSkippedFailed: '⚪ לא איפסתי את נתוני הדמו: שלב קודם נכשל, והראיות נשארות לבדיקה',
    resetSkippedBusy: (p) => `⚪ לא איפסתי את נתוני הדמו: יש עבודה פתוחה ב־${p}`,
    resetting: 'החזרת נתוני הדמו למצב ההתחלתי',
    fullLog: 'יומן מלא',
    allOk: (q) => `\n✅ כל השלבים עברו${q ? ' (בלי הבדיקות האיטיות)' : ''}.`,
    someFailed: (n, list) => `\n❌ ${n} שלבים נכשלו: ${list}`,
    gallery: (p) => `גלריית הסיור: ${p}`,
    noSteps: 'לא נמצאו שלבים: הוסיפו verify.config.json או סקריפטים ב־package.json (typecheck, lint, test, build…).',
  },
}[lang];

// ---------- steps ----------
function packageRunner() {
  if (existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(root, 'bun.lockb')) || existsSync(path.join(root, 'bun.lock'))) return 'bun run';
  return 'npm run';
}

function defaultSteps() {
  const pkgFile = path.join(root, 'package.json');
  if (!existsSync(pkgFile)) return [];
  const scripts = JSON.parse(readFileSync(pkgFile, 'utf8')).scripts ?? {};
  const run = packageRunner();
  const known = [
    { id: 'typecheck', label: { en: 'Type check', he: 'בדיקת טיפוסים' } },
    { id: 'lint', label: { en: 'Code quality (lint)', he: 'איכות קוד' } },
    { id: 'format:check', label: { en: 'Formatting', he: 'פורמט קוד' } },
    { id: 'test', label: { en: 'Unit and integration tests', he: 'בדיקות יחידה ואינטגרציה' } },
    { id: 'build', label: { en: 'Production build', he: 'בניית גרסת ייצור' } },
    { id: 'test:e2e', label: { en: 'End-to-end tests', he: 'בדיקות מקצה לקצה' }, slow: true, env: { CI: '1' } },
    { id: 'tour', label: { en: 'Screen tour', he: 'סיור מסכים' }, slow: true, env: { CI: '1' } },
  ];
  return known.filter((s) => scripts[s.id]).map((s) => ({ ...s, run: `${run} ${s.id}` }));
}

const steps = (config.steps ?? defaultSteps()).map((s) => ({
  ...s,
  name: typeof s.label === 'string' ? s.label : (s.label?.[lang] ?? s.label?.en ?? s.id),
}));
if (!steps.length) {
  console.log(T.noSteps);
  process.exit(1);
}

// ---------- one verification at a time ----------
mkdirSync(OUT, { recursive: true });
const LOCK = path.resolve(execSync('git rev-parse --git-common-dir', { encoding: 'utf8' }).trim(), 'verify-and-sync.lock');
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
if (existsSync(LOCK)) {
  try {
    const other = JSON.parse(readFileSync(LOCK, 'utf8'));
    const minutes = Math.round((Date.now() - other.startedAt) / 60000);
    if (minutes < 120 && alive(other.pid)) {
      console.log(T.busy(other.worktree, minutes));
      process.exit(2);
    }
  } catch {
    // An unreadable lock is stale.
  }
}
writeFileSync(LOCK, JSON.stringify({ pid: process.pid, startedAt: Date.now(), worktree: root }));
process.on('exit', () => {
  try {
    if (JSON.parse(readFileSync(LOCK, 'utf8')).pid === process.pid) rmSync(LOCK);
  } catch {
    // Already gone.
  }
});
process.on('SIGINT', () => process.exit(130));

// ---------- helpers ----------
/** A fingerprint of exactly the files being verified (committed or not, .gitignore respected), for sync.mjs. */
function workingTreeId() {
  const index = path.join(os.tmpdir(), `verify-and-sync-index-${process.pid}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    execSync('git add -A', { env, stdio: 'ignore' });
    return execSync('git write-tree', { env, encoding: 'utf8' }).trim();
  } finally {
    rmSync(index, { force: true });
  }
}

function run(cmd, env = {}) {
  const started = Date.now();
  const r = spawnSync(cmd, {
    shell: true,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  return {
    ok: r.status === 0,
    seconds: Math.round((Date.now() - started) / 1000),
    output: `${r.stdout ?? ''}${r.stderr ?? ''}`,
  };
}

function save(name, content) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, name), content);
}

/** The lines that explain a failure: Playwright's "N failed" block, else errors and counts, never server noise. */
function failureHint(output) {
  const lines = output.split(/\r?\n/).filter((l) => l.trim() && !l.includes('[WebServer]'));
  const summary = lines.findIndex((l) => /^\s+\d+ failed$/.test(l));
  if (summary >= 0) return lines.slice(summary, summary + 9).join('\n');
  const interesting = lines.filter((l) => /(failed|error|✘|×|not ok|passed|Tests\s+\d|exit code)/i.test(l));
  return (interesting.length ? interesting : lines).slice(-8).join('\n');
}

/** Other worktrees with uncommitted work: never reset shared demo data under someone mid-task. */
function busyWorktrees() {
  const me = path.resolve(root).toLowerCase();
  return execSync('git worktree list --porcelain', { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length).trim())
    .filter((p) => path.resolve(p).toLowerCase() !== me)
    .filter((p) => {
      try {
        return execSync(`git -C "${p}" status --porcelain`, { encoding: 'utf8' }).trim() !== '';
      } catch {
        return false;
      }
    });
}

const results = [];

function resetDemoData() {
  const reset = config.resetDemo;
  if (!reset?.run) return;
  if (results.some((r) => r.state === 'failed')) {
    results.push({ id: 'reset-demo', name: T.resetting, state: 'skipped', reason: 'earlier step failed' });
    console.log(T.resetSkippedFailed);
    return;
  }
  const busy = busyWorktrees();
  if (busy.length) {
    results.push({ id: 'reset-demo', name: T.resetting, state: 'skipped', reason: `busy: ${busy.join(', ')}` });
    console.log(T.resetSkippedBusy(busy.join(', ')));
    return;
  }
  process.stdout.write(`⏳ ${T.resetting}… `);
  let ok = true;
  let log = '';
  for (const cmd of [].concat(reset.run)) {
    const r = run(cmd);
    log += `$ ${cmd}\n${r.output}\n`;
    if (!r.ok) {
      ok = false;
      break;
    }
  }
  save('reset-demo.log', log);
  results.push({ id: 'reset-demo', name: T.resetting, state: ok ? 'ok' : 'failed' });
  console.log(ok ? '✅' : `❌ (${path.relative(root, path.join(OUT, 'reset-demo.log'))})`);
}

// ---------- run ----------
const verifiedTree = workingTreeId();
const verifiedHead = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
const resetBefore = config.resetDemo?.before ?? steps.find((s) => s.slow && /tour/i.test(s.id))?.id;
let buildOk = true;
let resetDone = false;

for (const step of steps) {
  if (resetDemo && !resetDone && step.id === resetBefore && !quick && buildOk) {
    resetDemoData();
    resetDone = true;
  }
  if (quick && step.slow) {
    results.push({ id: step.id, name: step.name, state: 'skipped', reason: '--quick' });
    console.log(T.skippedQuick(step.name));
    continue;
  }
  if (step.slow && !buildOk) {
    results.push({ id: step.id, name: step.name, state: 'skipped', reason: 'build failed' });
    console.log(T.skippedBuild(step.name));
    continue;
  }
  process.stdout.write(`⏳ ${step.name}… `);
  const r = run(step.run, step.env);
  const logName = `${step.id.replace(/[^\w.-]+/g, '-')}.log`;
  save(logName, r.output);
  if (/build/i.test(step.id)) buildOk = r.ok;
  results.push({ id: step.id, name: step.name, cmd: step.run, state: r.ok ? 'ok' : 'failed', seconds: r.seconds });
  console.log(r.ok ? `✅ (${r.seconds}s)` : `❌ (${r.seconds}s)`);
  if (!r.ok)
    console.log(
      `   ${failureHint(r.output).replaceAll('\n', '\n   ')}\n   ${T.fullLog}: ${path.relative(root, path.join(OUT, logName))}`,
    );
}
if (resetDemo && !resetDone) resetDemoData();

const failed = results.filter((r) => r.state === 'failed');
save(
  'summary.json',
  JSON.stringify(
    {
      finishedAt: new Date().toISOString(),
      quick,
      ok: failed.length === 0,
      tree: verifiedTree,
      head: verifiedHead,
      branch: execSync('git branch --show-current', { encoding: 'utf8' }).trim(),
      results,
    },
    null,
    2,
  ),
);
console.log(failed.length ? T.someFailed(failed.length, failed.map((r) => r.name).join(', ')) : T.allOk(quick));
if (config.tourGallery && !quick) console.log(T.gallery(config.tourGallery));
process.exit(failed.length ? 1 : 0);
