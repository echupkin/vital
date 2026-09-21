import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  // Components are written for the automatic JSX runtime (as Next compiles
  // them), so a component import in a test must be transformed the same way —
  // otherwise JSX would compile to React.createElement and fail with
  // "React is not defined" because no component imports React.
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
});