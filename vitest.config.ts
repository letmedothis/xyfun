import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

import electronViteConfig from './electron.vite.config';

const mainConfig = (electronViteConfig as any).main;
const rendererConfig = (electronViteConfig as any).renderer;

export default defineConfig({
  test: {
    projects: [
      // main
      {
        extends: true,
        plugins: mainConfig.plugins,
        resolve: {
          alias: mainConfig.resolve.alias,
        },
        test: {
          name: 'main',
          environment: 'node',
          setupFiles: ['tests/main.setup.ts'],
          include: ['src/main/**/*.{test,spec}.{ts,tsx}', 'src/main/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
          exclude: ['**/*.upgrade.test.ts'],
        },
      },
      // Real SQLite files and filesystem; do not inherit main.setup.ts filesystem mocks.
      {
        extends: true,
        resolve: { alias: mainConfig.resolve.alias },
        test: {
          name: 'upgrade',
          environment: 'node',
          setupFiles: [],
          include: ['src/main/**/*.upgrade.test.ts'],
        },
      },
      // renderer
      {
        extends: true,
        plugins: rendererConfig.plugins,
        resolve: {
          alias: rendererConfig.resolve.alias,
        },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          setupFiles: ['@vitest/web-worker', 'tests/renderer.setup.ts'],
          include: ['src/renderer/**/*.{test,spec}.{ts,tsx}', 'src/renderer/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
        },
      },
      // shared
      {
        extends: true,
        resolve: {
          alias: {
            '@shared': resolve('src/shared'),
          },
        },
        test: {
          name: 'shared',
          environment: 'node',
          include: ['src/shared/**/*.{test,spec}.{ts,tsx}', 'src/shared/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
        },
      },
      // script
      {
        extends: true,
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.{test,spec}.{ts,tsx}', 'scripts/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
        },
      },
    ],
    // global
    globals: true,
    setupFiles: [],
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/build/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov', 'text-summary'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/out/**',
        '**/build/**',
        '**/coverage/**',
        '**/tests/**',
        '**/.yarn/**',
        '**/.cursor/**',
        '**/.vscode/**',
        '**/.github/**',
        '**/.husky/**',
        '**/*.d.ts',
        '**/types/**',
        '**/__tests__/**',
        '**/*.{test,spec}.{ts,tsx}',
        '**/*.config.{js,ts}',
      ],
    },
    testTimeout: 20000,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },
  },
});
