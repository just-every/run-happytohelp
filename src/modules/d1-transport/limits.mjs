/** Cloudflare D1 per-query limits, supplied from the platform limits page
 * (updated 24 Oct 2026). Expression depth 100 is OBSERVED-NOT-DOCUMENTED:
 * native D1 rejected a concatenation tree of depth 101 on 27 Oct 2026.
 * FROM items 100 is OBSERVED-NOT-DOCUMENTED (K21, 10 Nov 2026): native D1
 * refuses a statement with "VIEWs and/or subqueries nested too deep" once its
 * FROM-clause items, counted with every CTE and view reference expanded in
 * place, reach 100. Local SQLite and Miniflare accept such a statement.
 * Node 22.20.0 ignores DatabaseSync limits options: preflight is mandatory.
 * Queries per Worker invocation (Paid 1000, Free 50, batch counts once) and
 * the 30 second query deadline are NOT-ENFORCEABLE-LOCALLY here: a database
 * connection has neither the invocation boundary nor the provider scheduler.
 */
export const d1NativeLimits = Object.freeze({ length: 2_000_000, sqlLength: 100_000,
  column: 100, variableNumber: 100, functionArg: 32, likePatternLength: 50, exprDepth: 100, fromItems: 100 });
