import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { sha256 } from '../../scripts/narrative-reader-contract.mjs'

/** Test-only replay: the copied calls exercise the current CLI without model
 * dispatch. This synthetic parent is not historical evaluation evidence. */
export function bindReaderCliTestParentToCurrentRuntime(root, directory) {
  const path = resolve(root, directory)
  if (!relative(root, path).startsWith('tests/acceptance/narrative-world/raw/test-')) {
    throw Error('Only an isolated reader test parent may be rebound')
  }
  const file = resolve(path, 'manifest.json')
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  const previousHash = sha256(manifest)
  manifest.runtimeHashes = Object.fromEntries(Object.keys(manifest.runtimeHashes)
    .map(source => [source, sha256(readFileSync(resolve(root, source)))]))
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
  for (const name of readdirSync(path).filter(name => /^summary-.*\.json$/.test(name))) {
    const summaryPath = resolve(path, name)
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'))
    if (summary.manifestSha256 !== previousHash) continue
    summary.manifestSha256 = sha256(manifest)
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n')
  }
  return sha256(readFileSync(file))
}
