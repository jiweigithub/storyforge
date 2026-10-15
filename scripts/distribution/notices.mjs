import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
const notices = ['StoryForge third-party notices. Package names/licenses below describe installed build dependencies; their notices are retained for distribution.\n']
for (const [directory, entry] of Object.entries(lock.packages)) {
  if (!directory.startsWith('node_modules/') || !existsSync(directory)) continue
  const name = directory.split('node_modules/').at(-1)
  notices.push(`\n=== ${name} ${entry.version || ''} (${entry.license || 'see notice'}) ===\n`)
  for (const file of readdirSync(directory)) {
    if (/^(?:licen[sc]e|copying|notice)(?:[.\-_]|$)/i.test(file)) {
      try { notices.push(readFileSync(join(directory, file), 'utf8')) } catch { /* Directory entries are not notices. */ }
    }
  }
}
writeFileSync('dist/THIRD-PARTY-NOTICES.txt', notices.join('\n'))
