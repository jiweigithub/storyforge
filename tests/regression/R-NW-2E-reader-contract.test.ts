import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('NW-2E offline reader: preflight, no-gold, budget, output and citation counterexamples run in normal CI without a model', () => {
  const result = execFileSync(process.execPath, ['--test', '--test-reporter=tap', 'scripts/narrative-reader-contract.test.mjs',
    'scripts/narrative-reader-report.test.mjs', 'scripts/narrative-reader-preflight.test.mjs',
    'scripts/narrative-reader-continuation.test.mjs', 'scripts/narrative-reader-storage.test.mjs',
    'scripts/narrative-reader-quarantine.test.mjs'], { encoding: 'utf8' })
  expect(result).toContain('# pass 52')
  expect(result).toContain('# fail 0')
}, 10_000)
