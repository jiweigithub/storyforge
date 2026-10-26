import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { root, validateNarrativeBaselineFiles } from './narrative-world-baseline-contract.mjs'

validateNarrativeBaselineFiles()
const args = process.argv.slice(2)
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--output')) {
  throw new Error('Usage: npm run test:narrative-world:baseline -- [--output report.json]')
}
// Explicit regeneration writes a run receipt, never the frozen gold corpus.
// Tests without this environment variable compare with the committed receipt.
const report = path.resolve(root, args[1] ?? 'test-results/narrative-world/baseline.json')
if (!report.endsWith('.json') || report === path.join(root, 'tests/acceptance/narrative-world/corpus-v1.json')
  || report === path.join(root, 'tests/acceptance/narrative-world/manifest-v1.json')) throw new Error('Invalid report destination')
fs.mkdirSync(path.dirname(report), { recursive: true })
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run',
  'tests/regression/R-NW-0B-evidence.test.ts'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, NW_BASELINE_REPORT: report },
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
console.log(`NW-0B receipt written to ${path.relative(root, report)}; inspect gap/unsupported counts separately from test success.`)
