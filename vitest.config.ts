import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // node is enough for the pure helpers; hook/DOM tests opt into jsdom with a
    // `// @vitest-environment jsdom` pragma at the top of the file.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
