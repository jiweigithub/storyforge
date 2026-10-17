import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseLimitedAITransports } from '../../src/lib/agent/limited-ai-transport'
import { assertFormalAIEntryCallV1, parseFormalAIEntryRegistryV1 } from '../../src/lib/agent/formal-ai-entry'

const caller = 'scripts/ttrpg-local-tts/evaluate.mjs'
const registry = JSON.parse(readFileSync('src/lib/agent/ai-entry-registry.json', 'utf8'))
const transport = registry.limitedTransports.find((entry: { entryId: string }) => entry.entryId === 'ttrpg.local-voice.eval')

describe('R-TTRPGOPEN10 fixed offline voice evaluation boundary', () => {
  it('checks a real fixed-case CLI without models, author input, adoption or playback', () => {
    const output = execFileSync(process.execPath, [caller, '--check-only', '--case', 'narration-zh'], { encoding: 'utf8' })
    expect(JSON.parse(output)).toMatchObject({ entryId: 'ttrpg.local-voice.eval', caseId: 'narration-zh',
      evaluationOnly: true, adoptAllowed: false, modelCalled: false, generationReady: false })
    expect(JSON.parse(output).caseHash).toMatch(/^[a-f0-9]{64}$/)
  })
  it.each([['--check-only', '--case', 'author-project'], ['--case', 'narration-zh', '--text', 'secret'],
    ['--case', 'narration-zh', '--project', '/author/project'], ['--case', 'narration-zh', '--case', 'long-zh'],
    ['--check-only'], ['--case']])('rejects non-fixture or ambiguous CLI args %j', (...args) => {
    const result = spawnSync(process.execPath, [caller, ...args], { encoding: 'utf8' })
    expect(result.status).toBe(1); expect(result.stdout).toBe('')
    expect(result.stderr).toContain('ttrpg-local-tts-eval')
  })
  it('does not grant the evaluation transport creative or legacy binding authority', () => {
    expect(parseLimitedAITransports([transport])[0]).toMatchObject({ boundary: 'offline-fixture-audio-eval', adoptAllowed: false })
    expect(parseFormalAIEntryRegistryV1(registry).entries).toHaveLength(58)
    const frozen = structuredClone(registry); delete frozen.limitedTransports
    expect(parseFormalAIEntryRegistryV1(frozen).entries).toHaveLength(58)
    expect(() => assertFormalAIEntryCallV1({ formalEntryId: 'ttrpg.local-voice.eval', category: 'runtime.ttrpg-open.intent' })).toThrow(/未登记正式 AI 入口/)
    for (const patch of [{ adoptAllowed: true }, { adoptionTargets: ['work'] }, { allowedCallers: ['src/components/Ttrpg.tsx'] },
      { allowedCallers: ['scripts/ttrpg-local-tts/../adopt.mjs'] }, { boundary: 'product-runtime' }]) {
      expect(() => parseLimitedAITransports([{ ...transport, ...patch }])).toThrow(/有限语音/)
    }
    expect(() => parseLimitedAITransports([{ ...registry.limitedTransports.find((row: { boundary: string }) => row.boundary === 'read-only-audio'),
      allowedCallers: [caller] }])).toThrow(/有限语音/)
  })
  it('the actual Node guard rejects duplicate registration, authority changes and forged fixture bytes before any child', () => {
    const script = `
      import { assertVoiceTransport, selectEvaluationCase } from './${caller}';
      import { readFileSync } from 'node:fs';
      const registry=JSON.parse(readFileSync('src/lib/agent/ai-entry-registry.json','utf8'));
      const entry=registry.limitedTransports.find(row=>row.entryId==='ttrpg.local-voice.eval');
      const rejected=[];
      for(const patch of [{adoptAllowed:true},{boundary:'read-only-audio'},{allowedCallers:['src/fake.ts']}]) {
        try { assertVoiceTransport(entry.entryId,'${caller}',{...registry,limitedTransports:[{...entry,...patch}]}); rejected.push(false) }
        catch { rejected.push(true) }
      }
      try { assertVoiceTransport(entry.entryId,'${caller}',{...registry,limitedTransports:[entry,entry]}); rejected.push(false) }catch{ rejected.push(true) }
      try { selectEvaluationCase('narration-zh',Buffer.from('author secret')); rejected.push(false) }catch{ rejected.push(true) }
      console.log(JSON.stringify(rejected));
    `
    expect(JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }))).toEqual([true, true, true, true, true])
  })
})
