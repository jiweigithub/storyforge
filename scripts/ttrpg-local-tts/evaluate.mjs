// Fixed development fixtures only; no author input, database, adoption or playback.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const caller = 'scripts/ttrpg-local-tts/evaluate.mjs'
const root = new URL('../../', import.meta.url)
const registryPath = new URL('src/lib/agent/ai-entry-registry.json', root)
const fixturesPath = new URL('./eval-cases.json', import.meta.url)
const contractPath = new URL('./eval-contract.json', import.meta.url)
const json = file => JSON.parse(readFileSync(file, 'utf8'))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const exact = (object, keys) => object && typeof object === 'object' && !Array.isArray(object)
  && Object.keys(object).sort().join(',') === [...keys].sort().join(',')

export function assertVoiceTransport(entryId, actualCaller, registry = json(registryPath)) {
  const entries = registry.limitedTransports?.filter(row => row.entryId === entryId)
  const entry = entries?.[0]
  if (registry.version !== 2 || registry.bindingVersion !== 1 || registry.scope !== 'formal-ai-execution-entry'
    || entries?.length !== 1 || !exact(entry, ['entryId', 'boundary', 'adoptAllowed', 'allowedCallers', 'reason'])
    || entryId !== 'ttrpg.local-voice.eval' || actualCaller !== caller
    || entry.boundary !== 'offline-fixture-audio-eval' || entry.adoptAllowed !== false
    || !Array.isArray(entry.allowedCallers) || entry.allowedCallers.length !== 1 || entry.allowedCallers[0] !== caller
    || typeof entry.reason !== 'string' || !entry.reason.trim()) throw new Error('离线语音评测入口未登记或边界不符')
  return entry
}

export function selectEvaluationCase(caseId, fixturesBytes = readFileSync(fixturesPath), contract = json(contractPath)) {
  if (!exact(contract, ['schema', 'version', 'entryId', 'fixtureSha256', 'maxChars', 'maxAudioSeconds', 'timeoutMs'])
    || contract.schema !== 'storyforge.ttrpg-local-tts-eval-contract' || contract.version !== 1
    || contract.entryId !== 'ttrpg.local-voice.eval' || contract.maxChars !== 300
    || contract.maxAudioSeconds !== 60 || contract.timeoutMs !== 120000
    || digest(fixturesBytes) !== contract.fixtureSha256) throw new Error('离线语音评测合同或固定台词校验失败')
  const fixtures = JSON.parse(fixturesBytes)
  if (!exact(fixtures, ['schema', 'version', 'cases']) || fixtures.schema !== 'storyforge.ttrpg-local-tts-eval-cases'
    || fixtures.version !== 1 || !Array.isArray(fixtures.cases) || fixtures.cases.length !== 4
    || new Set(fixtures.cases.map(row => row.id)).size !== 4
    || fixtures.cases.some(row => !exact(row, ['id', 'text', 'expectation']) || typeof row.id !== 'string'
      || typeof row.text !== 'string' || !row.text.trim() || [...row.text].length > contract.maxChars
      || !['audio', 'unsupported-script'].includes(row.expectation))) throw new Error('固定评测台词格式无效')
  const selected = fixtures.cases.find(row => row.id === caseId)
  if (!selected) throw new Error('仅允许登记的固定台词，不接受作者文本')
  return { selected, contract, caseHash: digest(JSON.stringify(selected)) }
}

export function parseEvaluationArgs(args) {
  const options = { checkOnly: false, caseId: null, runtimeDir: null }
  const seen = new Set()
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (seen.has(flag) || !['--check-only', '--case', '--runtime-dir'].includes(flag)) throw new Error('评测参数无效；不接受文本、提示词或项目路径')
    seen.add(flag)
    if (flag === '--check-only') options.checkOnly = true
    else {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error('评测参数缺少值')
      if (flag === '--case') options.caseId = value
      else options.runtimeDir = path.resolve(value)
    }
  }
  if (!options.caseId) throw new Error('请明确选择固定评测台词 --case')
  return options
}

async function main() {
  assertVoiceTransport('ttrpg.local-voice.eval', 'scripts/ttrpg-local-tts/evaluate.mjs')
  const options = parseEvaluationArgs(process.argv.slice(2))
  const { selected, contract, caseHash } = selectEvaluationCase(options.caseId)
  if (options.checkOnly) {
    console.log(JSON.stringify({ schema: 'storyforge.ttrpg-local-tts-eval-preflight', version: 1,
      entryId: contract.entryId, caseId: selected.id, caseHash, fixtureSha256: contract.fixtureSha256,
      evaluationOnly: true, adoptAllowed: false, modelCalled: false, generationReady: false }, null, 2))
    return
  }
  throw new Error('本机离线评测引擎尚未就绪；当前仅支持 --check-only')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`[ttrpg-local-tts-eval] ${error.message}`); process.exitCode = 1 })
}
