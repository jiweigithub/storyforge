// Deterministic maintainer operation. Does not install, download or run models.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = new URL('../../', import.meta.url), target = new URL('./product-profile.json', import.meta.url)
const paths = [
  'scripts/ttrpg-local-tts/product-contract.mjs', 'scripts/ttrpg-local-tts/product-worker.py',
  'scripts/ttrpg-local-tts/product-jobs.mjs', 'scripts/ttrpg-local-tts/product-bridge.mjs',
  'scripts/ttrpg-local-tts/engine.py', 'scripts/ttrpg-local-tts/reading_frontend.py',
  'scripts/ttrpg-local-tts/reading-preview.mjs', 'src/lib/ttrpg/open-local-voice-transport.ts',
  'src/lib/ttrpg/open-voice-execution.ts',
]
const profile = JSON.parse(readFileSync(target, 'utf8'))
const current = { ...profile, version: 2, profileId: 'melo-zh-product-v2', maxSegmentAudioSeconds: 60, maxConcurrentJobs: 1,
  minimumFreeBytes: 5 * 1024 ** 3, maxDiagnosticBytes: 65536,
  authorizationLeaseMs: 10000, authorizationRenewMs: 2000,
  statusRequestTimeoutMs: 15000, rawResponseTimeoutMs: 120000,
  implementation: { version: 'storyforge-local-tts-worker-v1', sources: paths.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex') })) } }
const output = JSON.stringify(current, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Product implementation profile drifted')
} else writeFileSync(fileURLToPath(target), output)
