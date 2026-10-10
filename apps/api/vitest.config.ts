import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts', 'test/*.spec.ts'],
        },
      },
      {
        // Runs against a real PostgreSQL and a real S3-compatible server (MinIO),
        // started with Testcontainers; needs Docker.
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.spec.ts'],
          globalSetup: ['test/support/containers.global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
