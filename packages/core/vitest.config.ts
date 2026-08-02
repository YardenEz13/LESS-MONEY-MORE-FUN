import { defineConfig } from 'vitest/config';

export default defineConfig({
  // This package is pure TS with no styles; pinning an empty postcss config keeps
  // Vite from walking up and picking one out of a parent directory.
  css: { postcss: {} },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
