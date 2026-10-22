import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

// Tests run against package sources, so they never depend on a stale build.
const alias = {
  '@mdarai/shared-types': pkg('shared-types'),
  '@mdarai/pricing-engine': pkg('pricing-engine'),
  '@mdarai/product-matcher': pkg('product-matcher'),
  '@mdarai/ai-order-parser': pkg('ai-order-parser'),
  '@mdarai/speech-providers': pkg('speech-providers'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'services/*/src/**/*.test.ts', 'apps/api/src/**/*.spec.ts', 'tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
