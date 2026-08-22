import { defineConfig } from "vitest/config";

// The default `npm run test` suite — pure logic only, no network, no credentials, safe to run on
// any machine/CI. Real-Dataverse integration tests live in *.integration.test.ts and are excluded
// here on purpose; run those separately via `npm run test:integration` (see
// vitest.integration.config.ts and src/testSupport/dataverseTestClient.ts for why they can't just
// live in this same suite).
export default defineConfig({
  test: {
    exclude: ["node_modules/**", "**/*.integration.test.ts"],
  },
});
