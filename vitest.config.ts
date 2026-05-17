import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    // React plugin must come before tsconfigPaths so JSX is transformed
    // before import analysis runs. This is needed because tsconfig.json sets
    // jsx: "preserve" for Next.js, which Vite would otherwise honour and then
    // fail when it encounters raw JSX in .tsx files imported by tests.
    react(),
    tsconfigPaths(),
  ],
  test: {
    include: [
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
      'packages/**/*.test.ts',
      'db/**/*.test.ts',
    ],
    setupFiles: ['./vitest.setup.ts'],
    environment: 'node',
  },
});
