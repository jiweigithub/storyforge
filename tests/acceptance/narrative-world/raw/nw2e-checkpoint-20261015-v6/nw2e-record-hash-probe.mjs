import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { hashNarrativeValueV1, hashNarrativeValueWithoutKeysV1 } from '/Users/qinyingying/.codex/worktrees/narrative-world-design/storyforge/src/lib/narrative-domain/json.ts'

const root = '/Users/qinyingying/.codex/worktrees/narrative-world-design/storyforge/'
const goldenPath = 'tests/acceptance/narrative-world/worldrelease-v4-content-golden.json'
const golden = JSON.parse(readFileSync(root + goldenPath, 'utf8'))
const records = golden.compiled.manifest.narrative.bundle.records
const excluded = ['revisionHash', 'revisionVectorHash']
// Exact former production algorithm, preserved as the comparison condition.
const strip = value => Array.isArray(value) ? value.map(strip) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.includes(key)).map(([key, child]) => [key, strip(child)])) : value
const methods = { prior: value => hashNarrativeValueV1(strip(value)), streaming: value => hashNarrativeValueWithoutKeysV1(value, excluded) }
for (const record of records) assert.equal(await methods.prior(record), await methods.streaming(record))
const execute = async (name, repetitions) => {
  const start = performance.now()
  for (let i = 0; i < repetitions; i++) for (const record of records) await methods[name](record)
  return performance.now() - start
}
await execute('prior', 20); await execute('streaming', 20)
const rounds = []
for (let round = 0; round < 8; round++) {
  const order = round % 2 ? ['streaming', 'prior'] : ['prior', 'streaming']
  const values = {}
  for (const name of order) values[name] = await execute(name, 100)
  rounds.push({ round, order, milliseconds: values, ratio: values.streaming / values.prior })
}
const median = values => { const sorted = [...values].sort((a, b) => a - b); return (sorted[3] + sorted[4]) / 2 }
const sourcePaths = ['src/lib/narrative-domain/json.ts', 'src/lib/world-engine/narrative-ir.ts', goldenPath]
const result = { schema: 'storyforge.record-hash-microdiagnostic', version: 1, createdAt: new Date().toISOString(), node: process.version,
  sourceHashes: Object.fromEntries(sourcePaths.map(path => [path, createHash('sha256').update(readFileSync(root + path)).digest('hex')])),
  harnessSha256: createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex'),
  recordKinds: records.map(record => record.kind), recordsPerConditionPerRound: records.length * 100, rounds,
  medianPairedRatio: median(rounds.map(round => round.ratio)),
  boundary: 'One Node process, alternating order after warmup, original frozen record fixtures; background CI active. Not browser performance or independent repeated full-system acceptance.',
  equalHashes: true, accepted: false }
writeFileSync(root + 'tests/acceptance/narrative-world/record-hash-diagnostic-20261015-v1.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ records: records.length, medianPairedRatio: result.medianPairedRatio, equalHashes: true, accepted: false }))
