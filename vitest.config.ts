import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Each test file gets a fresh module registry to avoid state leaking
    pool: 'forks',
    isolate: true,
  },
});
