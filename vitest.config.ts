import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: { lines: 60, functions: 65, branches: 75 },
    },
  },
});
