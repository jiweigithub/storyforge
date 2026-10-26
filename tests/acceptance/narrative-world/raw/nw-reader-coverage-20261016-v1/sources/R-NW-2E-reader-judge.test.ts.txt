import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('NW-2E independent model judge boundary (no live calls)', () => {
  it('keeps blinding, exact source-bound evidence, abstention denominators and frozen budgets', () => {
    const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap',
      'scripts/narrative-reader-judge-contract.test.mjs', 'scripts/narrative-reader-judge-content.test.mjs',
      'scripts/narrative-reader-judge-coverage.test.mjs'], { encoding: 'utf8' })
    expect(output).toMatch(/# fail 0/)
  })
})
