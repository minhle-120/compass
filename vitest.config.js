import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.js', 'services/**/*.test.js'],
    environment: 'node',
    // Run test files sequentially to prevent database state collision in memory
    fileParallelism: false,
    sequence: {
      concurrent: false
    }
  },
});
