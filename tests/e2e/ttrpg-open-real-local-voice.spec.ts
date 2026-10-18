import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'

// Opt-in engineering evidence for the real product API/IndexedDB/HTTP/CPU
// path. This is not normal author UI acceptance or independent listening.
test('real pinned offline speech uses the original registered source and reading without adopting media or changing the game', async ({ page }, info) => {
  test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1'
    || process.env.STORYFORGE_TTRPG_REAL_VOICE_ACCEPTANCE !== '1'
    || !process.env.STORYFORGE_TTRPG_LOCAL_TTS_RUNTIME_DIR, 'explicit isolated real-model acceptance only')
  test.setTimeout(180000)
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await load('/storyforge/tests/helpers/open-voice-execution-runtime.ts')).setupConfirmedVoiceExecutionRuntimeV1()
  })
  const proof = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const api = await load('/storyforge/src/lib/ttrpg/open-audio-service.ts')
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    const core = await load('/storyforge/src/lib/product/runtime-core.ts')
    const artifacts = await load('/storyforge/src/lib/memory/artifact-store.ts')
    const ledger = await load('/storyforge/src/lib/agent/run/event-store.ts')
    const before = await core.readProductRuntimeState(f.owner.sessionId)
    const generated = await api.generateTtrpgOpenLocalVoiceV1({ ...f.owner, requestKey: f.requestKey, decision: 'generate-this-original-confirmed-local-voice' })
    const { prepared, result } = generated
    const execution = JSON.parse(await artifacts.readAgentRunArtifactExactV1({ projectId: f.owner.scope.projectId, artifactKind: 'source-snapshot', contentHash: prepared.inputArtifactHash }))
    const raw = await artifacts.readAgentRunArtifactExactV1({ projectId: f.owner.scope.projectId, artifactKind: 'raw-response', contentHash: result.responseArtifactHash })
    const snapshot = await ledger.readInstanceAgentRunV1(f.owner.scope, result.runId)
    return { before, after: await core.readProductRuntimeState(f.owner.sessionId), generated, raw, snapshot,
      packet: { jobKey: result.jobKey, inputArtifactHash: prepared.inputArtifactHash, execution },
      runs: await db.agentRuns.count(), media: await db.productMediaAssets.count(), desk: await api.readTtrpgOpenVoiceRequestDeskV1(f.owner) }
  }, f)
  // Preserve the exact response and original source/Run evidence, even if a
  // subsequent assertion fails. No audio is relabelled as accepted/listened.
  await info.attach('original-local-voice-raw-response', { body: proof.raw, contentType: 'application/json' })
  await info.attach('original-local-voice-run', { body: JSON.stringify({ ...proof, raw: undefined }, null, 2), contentType: 'application/json' })
  expect(proof.generated.result.status).toBe('raw-response-recorded')
  expect(proof.packet.execution.source.text).toBe('编号001。')
  expect(proof.packet.execution.reading.normalizedText).toBe('编号零零一.')
  expect(proof.after).toEqual(proof.before)
  expect(proof.runs).toBe(2); expect(proof.media).toBe(0)
  expect(proof.snapshot.events.filter((e: any) => e.type === 'model.requested')).toHaveLength(1)
  expect(proof.snapshot.events.filter((e: any) => e.type === 'model.responded')).toHaveLength(1)
  expect(proof.snapshot.events.some((e: any) => ['candidate.persisted', 'verification.accepted', 'writeback.committed'].includes(e.type))).toBe(false)
  const raw = JSON.parse(proof.raw)
  expect(raw.workerExecutionKind).toBe('pinned-offline-worker')
  expect(raw.candidateAccepted).toBe(false); expect(raw.adoptionAllowed).toBe(false)
  expect(raw.result.humanListening).toBe('unproven')
  const physical = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
import {readFileSync} from 'node:fs';import path from 'node:path';
import {validateProductJob,verifyProductResult,digest} from './scripts/ttrpg-local-tts/product-contract.mjs';
const {packet,raw}=JSON.parse(readFileSync(0,'utf8'));validateProductJob(packet);
verifyProductResult(raw.result,Buffer.from(raw.audio.data,'base64'),packet);
const dir=path.join(process.env.STORYFORGE_TTRPG_LOCAL_TTS_RUNTIME_DIR,'product-jobs-v2',digest(packet.jobKey));
const job=JSON.parse(readFileSync(path.join(dir,'job.json'),'utf8'));
const started=JSON.parse(readFileSync(path.join(dir,'worker-started.json'),'utf8'));
const calls=readFileSync(path.join(dir,'calls.jsonl'),'utf8').trim().split(String.fromCharCode(10)).map(line=>JSON.parse(line));
if(job.terminal?.kind!=='observed-child-close'||job.terminal.code!==0||started.jobKey!==packet.jobKey
 ||digest(readFileSync(path.join(dir,'audio.wav')))!==raw.result.audio.sha256)throw Error('Missing actual original worker/PCM terminal proof');
console.log(JSON.stringify({job,started,calls,audio:raw.result.audio,usage:raw.result.usage}));
`], { encoding: 'utf8', input: JSON.stringify({ packet: proof.packet, raw }), maxBuffer: 4 * 1024 * 1024 }))
  expect(physical.job.workerExecutionKind).toBe('pinned-offline-worker')
  expect(physical.calls.map((e: any) => e.type)).toEqual(['encoder.requested', 'encoder.returned', 'speech.requested', 'speech.returned'])
  expect(physical.usage).toEqual({ textEncoderCallsStarted: 1, textEncoderCallsCompleted: 1, speechCallsStarted: 1, speechCallsCompleted: 1 })
  await info.attach('actual-original-worker-terminal', { body: JSON.stringify(physical, null, 2), contentType: 'application/json' })
})
