import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The simulator core is browser-agnostic; storage is injected, so unit
    // tests run in plain Node without a DOM.
  },
});
