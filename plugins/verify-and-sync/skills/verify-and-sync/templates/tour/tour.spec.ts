import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { loadData, REQUESTS, ROLES, STOPS, TOUR, type TourData, type TourStop } from './stops';

/**
 * verify-and-sync · screen tour engine (copy into tests/tour/; you edit stops.ts, not this file).
 *
 * Signs in as every role, opens every screen, checks it, takes screenshots, and writes one page:
 * <TOUR_OUT or .verify/tour>/index.html — every request with its result, then every screen by role.
 * Checks per screen: HTTP status, not redirected away, expected / forbidden texts, browser console errors,
 * sideways scrolling on a phone (375px), serious accessibility problems (if @axe-core/playwright is installed).
 *
 * TOUR_SELFTEST=1 proves the checker itself: the first stop gets a text that exists nowhere (must be reported) and
 * its first expected text as forbidden (must be reported); exactly those two problems must come back.
 */

const OUT = path.resolve(process.env.TOUR_OUT ?? path.join('.verify', 'tour'));
const he = TOUR.language === 'he';
const L = he
  ? {
      title: 'סיור מסכים אוטומטי',
      intro: 'נכנסתי כל פעם כמשתמש אחר, פתחתי כל מסך ובדקתי שהוא עובד. לחיצה על צילום מגדילה אותו.',
      ran: 'הורץ ב־',
      screens: 'מסכים נבדקו',
      fine: 'תקינים',
      issues: 'עם בעיות',
      skipped: 'דילגתי (אין נתונים)',
      requests: 'הבקשות',
      works: '✅ עובד',
      broken: '❌ לא תקין',
      notToured: '⚪ לא נבדק בסיור',
      ok: '✅ תקין',
      problems: (n: number) => `⚠️ ${n} בעיות`,
      skip: 'דילגתי: אין נתונים למסך הזה כרגע',
      desktop: 'מחשב',
      phone: 'טלפון',
      http: (s: number) => `השרת החזיר שגיאה ${s}`,
      redirected: (p: string) => `במקום המסך הועבר אל ${p}`,
      missing: (t: string) => `חסר במסך: ${t}`,
      present: (t: string) => `מופיע ולא אמור להופיע: ${t}`,
      a11y: (ids: string) => `בעיית נגישות: ${ids}`,
      overflow: (px: number) => `בטלפון המסך גולש הצידה ב־${px} פיקסלים`,
      crashed: (m: string) => `המסך לא נטען: ${m}`,
      console: (m: string) => `שגיאה בדפדפן: ${m}`,
      selftestMissing: 'טקסט שלא קיים באף מסך (בדיקה עצמית)',
    }
  : {
      title: 'Automatic screen tour',
      intro: 'Signed in as each user, opened every screen and checked it. Click a screenshot to enlarge it.',
      ran: 'Run on ',
      screens: 'screens checked',
      fine: 'fine',
      issues: 'with problems',
      skipped: 'skipped (no data)',
      requests: 'Requests',
      works: '✅ works',
      broken: '❌ broken',
      notToured: '⚪ not covered by the tour',
      ok: '✅ fine',
      problems: (n: number) => `⚠️ ${n} problems`,
      skip: 'Skipped: no data for this screen right now',
      desktop: 'Desktop',
      phone: 'Phone',
      http: (s: number) => `The server answered ${s}`,
      redirected: (p: string) => `Redirected to ${p} instead`,
      missing: (t: string) => `Missing on screen: ${t}`,
      present: (t: string) => `Shown but must not be: ${t}`,
      a11y: (ids: string) => `Accessibility problem: ${ids}`,
      overflow: (px: number) => `On a phone the page scrolls sideways by ${px}px`,
      crashed: (m: string) => `The screen did not load: ${m}`,
      console: (m: string) => `Browser error: ${m}`,
      selftestMissing: 'A text that exists on no screen (self-test)',
    };

interface StopResult {
  role: string;
  title: string;
  path: string | null;
  requests: string[];
  skipped: boolean;
  problems: string[];
  desktop?: string;
  mobile?: string;
}

async function contextFor(browser: Browser, role: string): Promise<BrowserContext> {
  const storageState = ROLES[role]?.storageState;
  return browser.newContext({ viewport: { width: 1280, height: 900 }, ...(storageState ? { storageState } : {}) });
}

async function setLocaleCookie(page: Page, value: string) {
  if (!TOUR.localeCookie) return;
  const origin = new URL(test.info().project.use.baseURL ?? 'http://localhost:3000');
  await page.context().addCookies([{ name: TOUR.localeCookie, value, domain: origin.hostname, path: '/' }]);
}

async function axeProblems(page: Page): Promise<string[]> {
  // Optional dependency: the tour still runs without it.
  const mod = await import('@axe-core/playwright').catch(() => null);
  if (!mod) return [];
  const results = await new mod.default({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
}

async function visit(page: Page, stop: TourStop, data: TourData, index: number): Promise<StopResult> {
  const url = stop.path(data);
  const result: StopResult = {
    role: stop.role,
    title: stop.title,
    path: url,
    requests: stop.requests ?? [],
    skipped: url === null,
    problems: [],
  };
  if (url === null) return result;

  const consoleErrors: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  };
  const onError = (e: Error) => consoleErrors.push(e.message);
  page.on('console', onConsole);
  page.on('pageerror', onError);
  if (stop.locale) await setLocaleCookie(page, stop.locale);
  try {
    const response = await page.goto(url, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    const status = response?.status() ?? 0;
    if (status >= 400) result.problems.push(L.http(status));
    const wanted = new URL(url, 'http://x').pathname;
    const landed = new URL(page.url()).pathname;
    if (landed !== wanted) result.problems.push(L.redirected(landed));

    for (const text of stop.expect ?? []) {
      if (!(await page.getByText(text).first().isVisible().catch(() => false)))
        result.problems.push(L.missing(String(text)));
    }
    for (const text of stop.forbid ?? []) {
      if ((await page.getByText(text).count()) > 0) result.problems.push(L.present(String(text)));
    }
    const a11y = await axeProblems(page);
    if (a11y.length) result.problems.push(L.a11y(a11y.join(', ')));

    const base = `${String(index).padStart(2, '0')}-${stop.role}`;
    result.desktop = `${base}-desktop.jpg`;
    await page.screenshot({ path: path.join(OUT, result.desktop), fullPage: true, type: 'jpeg', quality: 55 });

    await page.setViewportSize({ width: 375, height: 800 });
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    if (overflow > 0) result.problems.push(L.overflow(overflow));
    if (stop.mobile) {
      result.mobile = `${base}-mobile.jpg`;
      await page.screenshot({ path: path.join(OUT, result.mobile), fullPage: true, type: 'jpeg', quality: 55 });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  } catch (e) {
    result.problems.push(L.crashed((e as Error).message.split('\n')[0] ?? ''));
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onError);
    if (stop.locale && TOUR.defaultLocale) await setLocaleCookie(page, TOUR.defaultLocale);
  }
  for (const err of consoleErrors) result.problems.push(L.console(err.slice(0, 200)));
  return result;
}

const esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const image = (file?: string) =>
  file ? `data:image/jpeg;base64,${readFileSync(path.join(OUT, file)).toString('base64')}` : '';
const roleTitle = (role: string) => ROLES[role]?.title ?? role;

function gallery(results: StopResult[], startedAt: Date): string {
  const visited = results.filter((r) => !r.skipped);
  const bad = visited.filter((r) => r.problems.length);
  const requestRows = REQUESTS.map((req) => {
    const stops = results.filter((r) => r.requests.includes(req.id));
    const checked = stops.filter((r) => !r.skipped);
    const failed = checked.filter((r) => r.problems.length);
    const state = checked.length === 0 ? 'skip' : failed.length ? 'bad' : 'ok';
    const label = state === 'ok' ? L.works : state === 'bad' ? L.broken : L.notToured;
    const where = stops.map((r) => `${esc(roleTitle(r.role))}: ${esc(r.title)}`).join(' · ');
    const why = failed.flatMap((r) => r.problems.map((p) => `${esc(r.title)} — ${esc(p)}`)).join('<br>');
    return `<tr class="${state}"><td class="id">${esc(req.id)}</td><td>${esc(req.title)}<div class="where">${where}</div>${
      why ? `<div class="why">${why}</div>` : ''
    }</td><td class="state">${label}</td></tr>`;
  }).join('');
  const sections = [...new Set(results.map((r) => r.role))]
    .map((role) => {
      const cards = results
        .filter((r) => r.role === role)
        .map((r) => {
          const status = r.skipped
            ? `<span class="chip skip">${L.skip}</span>`
            : r.problems.length
              ? `<span class="chip bad">${L.problems(r.problems.length)}</span>`
              : `<span class="chip ok">${L.ok}</span>`;
          const problems = r.problems.length
            ? `<ul class="problems">${r.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`
            : '';
          const shots = r.skipped
            ? ''
            : `<div class="shots"><figure><img loading="lazy" src="${image(r.desktop)}" alt="${esc(r.title)} — ${L.desktop}"><figcaption>${L.desktop}</figcaption></figure>${
                r.mobile
                  ? `<figure class="phone"><img loading="lazy" src="${image(r.mobile)}" alt="${esc(r.title)} — ${L.phone}"><figcaption>${L.phone}</figcaption></figure>`
                  : ''
              }</div>`;
          return `<article class="card"><header><h3>${esc(r.title)}</h3>${status}</header><code dir="ltr">${esc(r.path ?? '—')}</code>${problems}${shots}</article>`;
        })
        .join('');
      return `<section><h2>${esc(roleTitle(role))}</h2><div class="grid">${cards}</div></section>`;
    })
    .join('');
  return `<!doctype html>
<html lang="${he ? 'he' : 'en'}" dir="${he ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(L.title)}${TOUR.appName ? ` · ${esc(TOUR.appName)}` : ''}</title>
<style>
:root { --bg:#f8fafc; --card:#fff; --fg:#0f172a; --muted:#475569; --line:#e2e8f0; --ok:#15803d; --okbg:#dcfce7; --bad:#b91c1c; --badbg:#fee2e2; --skip:#475569; --skipbg:#f1f5f9; }
@media (prefers-color-scheme: dark) { :root { --bg:#0b1220; --card:#111a2e; --fg:#e2e8f0; --muted:#94a3b8; --line:#1e293b; --okbg:#052e16; --badbg:#450a0a; --skipbg:#1e293b; --ok:#4ade80; --bad:#f87171; --skip:#94a3b8; } }
* { box-sizing:border-box; } body { margin:0; padding:24px 16px 64px; background:var(--bg); color:var(--fg); font:15px/1.55 system-ui,"Segoe UI",Arial,sans-serif; }
main { max-width:1200px; margin:0 auto; } h1 { margin:0 0 4px; font-size:26px; } .meta { color:var(--muted); margin:0 0 20px; }
.summary { display:flex; flex-wrap:wrap; gap:12px; margin-bottom:24px; } .summary div { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 16px; min-width:150px; } .summary strong { display:block; font-size:26px; }
table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; margin-bottom:32px; }
td { padding:10px 12px; border-top:1px solid var(--line); vertical-align:top; } td.id { font-weight:700; white-space:nowrap; color:var(--muted); } td.state { white-space:nowrap; font-weight:600; }
tr.ok td.state { color:var(--ok); } tr.bad td.state { color:var(--bad); } tr.skip td.state { color:var(--skip); } .where { color:var(--muted); font-size:13px; margin-top:2px; } .why { color:var(--bad); font-size:13px; margin-top:4px; }
h2 { margin:32px 0 12px; font-size:20px; } .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:16px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px; min-width:0; } .card header { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; } .card h3 { margin:0; font-size:16px; }
code { display:block; color:var(--muted); font-size:12px; margin:4px 0 8px; overflow-wrap:anywhere; text-align:left; }
.chip { border-radius:999px; padding:2px 10px; font-size:13px; font-weight:600; } .chip.ok { background:var(--okbg); color:var(--ok); } .chip.bad { background:var(--badbg); color:var(--bad); } .chip.skip { background:var(--skipbg); color:var(--skip); }
.problems { margin:0 0 8px; padding-inline-start:18px; color:var(--bad); font-size:13px; } .shots { display:flex; gap:8px; align-items:flex-start; } figure { margin:0; flex:1; min-width:0; } figure.phone { flex:0 0 30%; }
figure img { width:100%; max-height:360px; object-fit:cover; object-position:top; border:1px solid var(--line); border-radius:8px; cursor:zoom-in; display:block; } figure img.open { max-height:none; cursor:zoom-out; } figcaption { color:var(--muted); font-size:12px; text-align:center; }
</style>
</head>
<body><main>
<h1>${esc(L.title)}${TOUR.appName ? ` · ${esc(TOUR.appName)}` : ''}</h1>
<p class="meta">${L.ran}${esc(startedAt.toLocaleString(he ? 'he-IL' : 'en-GB'))}. ${esc(L.intro)}</p>
<div class="summary"><div><strong>${visited.length}</strong>${L.screens}</div><div><strong>${visited.length - bad.length}</strong>${L.fine}</div><div><strong>${bad.length}</strong>${L.issues}</div><div><strong>${results.length - visited.length}</strong>${L.skipped}</div></div>
${REQUESTS.length ? `<h2>${L.requests}</h2><table><tbody>${requestRows}</tbody></table>` : ''}
${sections}
</main>
<script>document.addEventListener('click', (e) => { if (e.target instanceof HTMLImageElement) e.target.classList.toggle('open'); });</script>
</body></html>`;
}

const SELFTEST = !!process.env.TOUR_SELFTEST;

test('screen tour: every role, every screen', async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const startedAt = new Date();
  const data = await loadData();
  let stops: TourStop[] = STOPS;
  const planted = SELFTEST ? (STOPS[0]?.expect?.[0] ?? null) : null;
  if (SELFTEST) {
    expect(planted, 'TOUR_SELFTEST needs an expected text on the first stop').not.toBeNull();
    const [first, ...rest] = STOPS;
    stops = [
      { ...first!, expect: [...(first!.expect ?? []), L.selftestMissing], forbid: [...(first!.forbid ?? []), planted!] },
      ...rest,
    ];
  }
  const results: StopResult[] = [];
  let index = 0;
  for (const role of [...new Set(stops.map((s) => s.role))]) {
    const context = await contextFor(browser, role);
    const page = await context.newPage();
    for (const stop of stops.filter((s) => s.role === role)) {
      index += 1;
      results.push(await visit(page, stop, data, index));
    }
    await context.close();
  }
  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ startedAt, data, results }, null, 2));
  writeFileSync(path.join(OUT, 'index.html'), gallery(results, startedAt));

  const problems = results.flatMap((r) => r.problems.map((p) => `${roleTitle(r.role)} › ${r.title}: ${p}`));
  if (SELFTEST) {
    expect(problems.some((p) => p.includes(L.selftestMissing))).toBe(true);
    expect(problems.some((p) => p.includes(String(planted)))).toBe(true);
    expect(problems).toHaveLength(2);
    return;
  }
  expect(problems, `the tour found problems — see ${path.join(OUT, 'index.html')}`).toEqual([]);
});
