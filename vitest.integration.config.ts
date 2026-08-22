import { defineConfig } from "vitest/config";

// Real-Dataverse integration tests — hits ZaneTest over the network via
// src/testSupport/dataverseTestClient.ts. Requires a one-time `node
// scripts/dataverse-test-login.mjs` interactive login first (see that script's own doc comment);
// tests that need it skip themselves with a clear message when the token cache isn't present
// rather than failing the whole run, so this is safe to invoke on a machine that was never set up
// for it. Kept in a separate config/npm script from the default `npm run test` (see
// vitest.config.ts) specifically so the fast, offline, no-credentials-needed suite never
// accidentally depends on network access or this machine's cached login.
export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
    exclude: ["node_modules/**"],
    // Real network round-trips, especially metadata writes, are much slower than pure-logic
    // assertions — creating a custom table alone took ~40s when this was measured against
    // ZaneTest live (see 01-开发进度.md 2026-08-21). hookTimeout covers beforeAll/afterAll, which
    // is where table creation/teardown lives for most of these suites.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // Vitest's default runs test files in parallel workers — fine for pure logic, but every suite
    // here that calls createTable/createColumn hits Dataverse's own org-wide
    // CustomizationLockException the moment two files do it at the same moment ("Cannot start
    // another [EntityCustomization] because there is a previous [EntityCustomization] running at
    // this moment"), a real environment constraint, not a bug in this app or these tests. Force
    // sequential file execution so table/column/relationship-creating suites never race each other.
    fileParallelism: false,
  },
});
