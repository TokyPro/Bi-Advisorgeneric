import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Environnement node ; alias `@/` identique à tsconfig.json ; JSX automatique (tsconfig utilise « preserve » pour Next).
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 30_000,
  },
});
