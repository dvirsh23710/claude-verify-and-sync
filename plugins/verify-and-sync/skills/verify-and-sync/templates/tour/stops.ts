/**
 * verify-and-sync · screen tour — the only tour file you edit (copy into tests/tour/stops.ts).
 *
 * ROLES     the users the tour signs in as. `storageState` is a Playwright sign-in file your e2e setup saves
 *           (e.g. playwright/.auth/admin.json); leave it out for a signed-out visitor.
 * REQUESTS  the owner's requests the tour proves (keep the same ids as docs/owner-requests.md).
 * STOPS     every screen of every role, with what must and must not be on it.
 * loadData  optional: look up live ids (a record to open, a report…) before the tour starts.
 */

export interface TourRoleInfo {
  title: string;
  storageState?: string;
}

export interface TourRequest {
  id: string;
  title: string;
}

/** Whatever loadData returns; stops read it to build their paths. */
export type TourData = Record<string, string | null>;

export interface TourStop {
  role: keyof typeof ROLES & string;
  title: string;
  /** The path to open, or null when there is no data for it right now (reported as skipped). */
  path: (d: TourData) => string | null;
  /** Request ids this screen proves. */
  requests?: string[];
  /** Must be visible. Use a RegExp for flexible matches (e.g. numbers, non-breaking spaces). */
  expect?: (string | RegExp)[];
  /** Must not appear anywhere on the page. */
  forbid?: (string | RegExp)[];
  /** Also keep a phone screenshot (every screen is checked for sideways scrolling at 375px anyway). */
  mobile?: boolean;
  /** Open this screen in another language (needs TOUR.localeCookie). */
  locale?: string;
}

export const TOUR = {
  appName: 'My App',
  /** Gallery language: 'en' or 'he' (right-to-left). */
  language: 'en' as 'en' | 'he',
  /** If your app picks its language from a cookie, name it here to tour screens in another language. */
  localeCookie: undefined as string | undefined,
  defaultLocale: undefined as string | undefined,
};

export const ROLES: Record<string, TourRoleInfo> = {
  admin: { title: 'Admin', storageState: 'playwright/.auth/admin.json' },
  member: { title: 'Member', storageState: 'playwright/.auth/member.json' },
  visitor: { title: 'Visitor (signed out)' },
};

export const REQUESTS: TourRequest[] = [
  { id: 'R-01', title: 'The dashboard greets the user by name' },
  { id: 'R-02', title: 'Members never see the billing page' },
];

export async function loadData(): Promise<TourData> {
  // Example: read an id from your API or database so a stop can open a real record.
  return { firstProject: null };
}

export const STOPS: TourStop[] = [
  { role: 'admin', title: 'Dashboard', path: () => '/dashboard', requests: ['R-01'], expect: [/Welcome, /], mobile: true },
  {
    role: 'admin',
    title: 'A project',
    path: (d) => (d.firstProject ? `/projects/${d.firstProject}` : null),
  },
  { role: 'admin', title: 'Billing', path: () => '/billing' },
  { role: 'member', title: 'Dashboard', path: () => '/dashboard', requests: ['R-02'], forbid: ['Billing'] },
  { role: 'visitor', title: 'Sign in', path: () => '/login', mobile: true },
];
