/** Browser-side original-output adapter. No inference, storage or adoption.
 * The supported V2 physical contract is frozen independently of today's pin. */
import wireProfile from '../../../scripts/ttrpg-local-tts/product-profile-v2.json'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { sha256MediaData } from '../product-production/media-blob-store'
import type { TtrpgOpenVoiceRequestV1 } from './open-voice-request-contract'
import { verifyTtrpgOpenVoiceSampleClockV1 } from './open-voice-timeline-contract'
import * as p from './open-contract-parse'

export interface TtrpgOpenVoiceResultIdentityV1 {
  jobKey: string; inputArtifactHash: string; profileHash: string; profile: unknown
  sourceTextHash: string; originalPart: TtrpgOpenVoiceRequestV1['part']
  normalizedText: string; normalizedTextSha256: string; previewHash: string
}
export class TtrpgOpenVoiceResultErrorV1 extends Error {
  constructor() { super('原语音返回未通过准确输入、物理文件或片段证据校验；保留原始响应。'); this.name = 'TtrpgOpenVoiceResultErrorV1' }
}
function invalid(): never { throw new TtrpgOpenVoiceResultErrorV1() }
const integer = (v: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER, minimum = 0) => p.integer(v,label,minimum,maximum)
function decodeOriginalBase64(value: unknown): ArrayBuffer {
  if (typeof value !== 'string' || !value.length || value.length % 4 || value.length > Math.ceil(wireProfile.maxAudioBytes / 3) * 4
    || /[^A-Za-z0-9+/=]/.test(value)) invalid()
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0, equals = value.indexOf('=')
  if (equals >= 0 && equals !== value.length - padding) invalid()
  const size = value.length / 4 * 3 - padding
  if (size < 46 || size > wireProfile.maxAudioBytes) invalid()
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  if (padding && (alphabet.indexOf(value[value.length - padding - 1]) & (padding === 2 ? 15 : 3))) invalid()
  let binary: string
  try { binary = atob(value) } catch { return invalid() }
  if (binary.length !== size) invalid()
  const buffer = new ArrayBuffer(size), bytes = new Uint8Array(buffer)
  for (let i = 0; i < size; i++) bytes[i] = binary.charCodeAt(i)
  return buffer
}
async function verify(raw: string, expected: TtrpgOpenVoiceResultIdentityV1) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > Math.ceil(wireProfile.maxAudioBytes / 3) * 4 + 1048576) invalid()
  p.hash(expected.inputArtifactHash,'original input hash'); p.hash(expected.profileHash,'original profile hash'); p.hash(expected.previewHash,'original preview hash')
  integer(expected.originalPart.textLength,'original source length',wireProfile.maxSourceUtf16,1)
  integer(expected.originalPart.textOffset,'original source offset')
  if (!new RegExp('^ttrpg\\.voice\\.[1-9][0-9]*\\.' + expected.inputArtifactHash + '$').test(expected.jobKey)
    || !expected.normalizedText.length || expected.normalizedText.length > wireProfile.maxReadingUtf16) invalid()
  const original = p.object(expected.profile,'original speech profile'), { implementation, ...core } = original
  const { implementation: supportedImplementation, ...supportedCore } = wireProfile
  const impl = p.record(implementation,['version','sources'],'original speech implementation')
  const sources = p.list(impl.sources,'implementation sources',(value,label) => {
    const row = p.record(value,['path','sha256'],label); p.hash(row.sha256,label); return row
  },supportedImplementation.sources.length,supportedImplementation.sources.length)
  if (canonicalStringify(core) !== canonicalStringify(supportedCore) || impl.version !== supportedImplementation.version
    || canonicalStringify(sources.map(s => s.path)) !== canonicalStringify(supportedImplementation.sources.map(s => s.path))
    || await hashCanonicalValue(original) !== expected.profileHash || await sha256Text(expected.normalizedText) !== expected.normalizedTextSha256
    || expected.originalPart.textHash !== expected.sourceTextHash) invalid()
  const envelope = p.record(p.json(raw),['schema','version','result','workerExecutionKind','completionEvidence','cancellationRequested','audio','candidateAccepted','adoptionAllowed'],'original audio envelope')
  if (envelope.schema !== 'storyforge.ttrpg-local-tts-product-raw-response' || envelope.version !== 1 || envelope.workerExecutionKind !== 'pinned-offline-worker'
    || !['observed-child-close','verified-result-worker-absent'].includes(String(envelope.completionEvidence))
    || envelope.candidateAccepted !== false || envelope.adoptionAllowed !== false) invalid()
  const cancellationRequested = p.bool(envelope.cancellationRequested,'first-delivery cancellation')
  const transport = p.record(envelope.audio,['encoding','data'],'original audio bytes')
  p.literal(transport.encoding,'base64','original audio encoding')
  const bytes = decodeOriginalBase64(transport.data), view = new DataView(bytes)
  const r = p.record(envelope.result,['schema','version','status','jobKey','inputArtifactHash','profileHash','implementationHash','sourceTextHash',
    'normalizedTextSha256','previewHash','audio','alignment','usage','metrics','network','candidateAccepted','adoptionAllowed','humanListening'],'original speech result')
  if (r.schema !== 'storyforge.ttrpg-local-tts-product-result' || r.version !== 1 || r.status !== 'generated' || r.jobKey !== expected.jobKey
    || r.inputArtifactHash !== expected.inputArtifactHash || r.profileHash !== expected.profileHash || r.implementationHash !== await hashCanonicalValue(impl)
    || r.sourceTextHash !== expected.sourceTextHash || r.normalizedTextSha256 !== expected.normalizedTextSha256 || r.previewHash !== expected.previewHash
    || r.network !== 'disabled' || r.candidateAccepted !== false || r.adoptionAllowed !== false || r.humanListening !== 'unproven') invalid()
  const a = p.record(r.audio,['mimeType','byteSize','sha256','sampleRate','channels','sampleFormat','samples','durationMs'],'actual PCM descriptor')
  const samples = integer(a.samples,'PCM samples',wireProfile.sampleRate * wireProfile.maxAudioSeconds,1)
  const audioHash = await sha256MediaData(bytes), durationMs = Math.round(samples * 1000 / wireProfile.sampleRate)
  const ascii = (offset: number,length: number) => String.fromCharCode(...new Uint8Array(bytes,offset,length))
  if (a.mimeType !== 'audio/wav' || a.byteSize !== bytes.byteLength || a.sha256 !== audioHash || a.sampleRate !== wireProfile.sampleRate
    || a.channels !== 1 || a.sampleFormat !== 's16le' || a.durationMs !== durationMs || samples * 2 !== bytes.byteLength - 44
    || ascii(0,4) !== 'RIFF' || view.getUint32(4,true) + 8 !== bytes.byteLength || ascii(8,8) !== 'WAVEfmt '
    || view.getUint32(16,true) !== 16 || view.getUint16(20,true) !== 1 || view.getUint16(22,true) !== 1 || view.getUint32(24,true) !== wireProfile.sampleRate
    || view.getUint32(28,true) !== wireProfile.sampleRate * 2 || view.getUint16(32,true) !== 2 || view.getUint16(34,true) !== 16
    || ascii(36,4) !== 'data' || view.getUint32(40,true) !== bytes.byteLength - 44) invalid()
  const alignment = p.record(r.alignment,['kind','wordAlignmentProvided','originalPart','segments'],'actual segment clock')
  if (alignment.kind !== 'normalized-reading-segments' || alignment.wordAlignmentProvided !== false || canonicalStringify(alignment.originalPart) !== canonicalStringify(expected.originalPart)) invalid()
  const timeline = await verifyTtrpgOpenVoiceSampleClockV1({ ...alignment, sampleRate: wireProfile.sampleRate, samples }, expected.normalizedText)
  const { segments } = timeline
  const u = p.record(r.usage,['textEncoderCallsStarted','textEncoderCallsCompleted','speechCallsStarted','speechCallsCompleted'],'actual physical model usage')
  if (Object.values(u).some(v => v !== segments.length)
    || segments.length > wireProfile.maxSpeechInferenceCalls || segments.length > wireProfile.maxTextEncoderCalls) invalid()
  let energy = 0, peak = 0
  for (let i = 44; i < bytes.byteLength; i += 2) { const value = view.getInt16(i,true) / 32767; energy += value * value; peak = Math.max(peak,Math.abs(value)) }
  const rms = Math.sqrt(energy / samples), m = p.record(r.metrics,['wallMs','cpuMs','maxRssBytes','rms','peak'],'actual PCM metrics')
  const wallMs = integer(m.wallMs,'actual wall time'), cpuMs = integer(m.cpuMs,'actual CPU time'), maxRssBytes = integer(m.maxRssBytes,'actual RSS')
  const reportedRms = p.number(m.rms,'actual RMS',0,2), reportedPeak = p.number(m.peak,'actual peak',0,2)
  if (Math.abs(reportedRms - rms) > 1e-7 || Math.abs(reportedPeak - peak) > 1e-7 || rms < .00001 || peak > .9901) invalid()
  return { bytes, resultHash: await hashCanonicalValue(r), audio: { mimeType: 'audio/wav' as const, contentHash: audioHash, byteLength: bytes.byteLength, durationMs },
    timeline,
    usage: { textEncoderCallsStarted: segments.length, textEncoderCallsCompleted: segments.length, speechCallsStarted: segments.length, speechCallsCompleted: segments.length },
    metrics: { wallMs,cpuMs,maxRssBytes,rms: reportedRms,peak: reportedPeak }, completionEvidence: p.oneOf(envelope.completionEvidence,['observed-child-close','verified-result-worker-absent'],'completion evidence'), cancellationRequested }
}
export async function verifyTtrpgOpenVoiceRawResultForKernelV1(raw: string, identity: TtrpgOpenVoiceResultIdentityV1) {
  try { return await verify(raw,structuredClone(identity)) }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('[ttrpg-open]')) invalid()
    throw error
  }
}
