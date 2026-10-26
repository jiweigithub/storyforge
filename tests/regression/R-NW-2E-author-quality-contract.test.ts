import { it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'

it('keeps paired source, blind review and no-redispatch evaluation contracts in normal CI', () => {
  const result = spawnSync(process.execPath, ['--test',
    'scripts/narrative-author-quality-contract.test.mjs', 'scripts/narrative-author-quality-runner.test.mjs',
    'scripts/narrative-author-quality-review.test.mjs'], {
    encoding: 'utf8', timeout: 20_000,
  })
  expect(result.status, result.stdout + result.stderr + (result.error?.message ?? '')).toBe(0)
}, 25_000)
