import { it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'

it('keeps evaluation admission and gold separation checks in the normal CI suite', () => {
  const result = spawnSync(process.execPath, ['--test', 'scripts/narrative-candidate-story-contract.test.mjs'], {
    encoding: 'utf8', timeout: 20_000,
  })
  expect(result.status, result.stdout + result.stderr + (result.error?.message ?? '')).toBe(0)
})
