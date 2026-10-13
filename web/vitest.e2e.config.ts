import { defineConfig } from 'vitest/config'

/** `npm run e2e`: tests against the running devnet (see e2e/devnet.e2e.test.ts). */
export default defineConfig({
  define: { __HMM_DEVNET__: 'true' },
  test: {
    environment: 'node',
    include: ['e2e/**/*.e2e.test.ts'],
    testTimeout: 20 * 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    reporters: ['verbose'],
  },
})
