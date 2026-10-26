import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('NW-2D model impact suggestions remain separate from deterministic proof', () => {
  it('checks gold blinding, exact targets and quotes, uncertainty scoring and fixed subscription budgets without live calls', () => {
    const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap',
      'scripts/narrative-impact-contract.test.mjs'], { encoding: 'utf8' })
    expect(output).toMatch(/# fail 0/)
  })
})
