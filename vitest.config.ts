import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests run in node; core logic needs no browser (PLAN D-04).
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
