import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The briefing cache is anchored on globalThis so that the page bundle and
    // the route bundle share ONE cache in the server (they are separate module
    // graphs). That makes it process-wide state, so test FILES must not share a
    // process: two files filling briefings concurrently would see each other's
    // entries and fail intermittently. One process per file restores the
    // isolation the suite was written under.
    pool: 'forks',
    isolate: true,
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