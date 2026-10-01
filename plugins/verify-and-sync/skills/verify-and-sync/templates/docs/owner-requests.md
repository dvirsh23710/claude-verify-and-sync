# Requests, and how each one is proven

Every request the owner makes gets a row here with **the check that proves it works**. The checks run after every change, so something that was fixed can't quietly break again.

The "proven by" column uses:
- **Tour:** a screen in the automatic screen tour (`tests/tour/stops.ts`).
- **E2E:** an end-to-end browser test.
- **DB:** a database test.
- **Unit:** a unit test.

| # | Date | Request (in the owner's words, short) | How we know it works | Proven by |
|---|---|---|---|---|
| R-01 | YYYY-MM-DD | | As \<role\>, on \<screen\>, \<text\> appears / no longer appears / totals add up | Tour: \<screen\> · E2E: \<test\> |

## When a new request comes in
1. Add a row with the next id.
2. If it's visible on a screen, add the id and its `expect` / `forbid` texts to the matching stop in `tests/tour/stops.ts`, and add it to `REQUESTS`.
3. If it's a flow, add an E2E test. If it's a data or permission rule, add a database test. If it's pure logic, add a unit test.
4. Run the full verification and report per request.
