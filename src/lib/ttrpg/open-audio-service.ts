/** Human audio desk. Reads never generate, import, confirm or play; file import is explicit. */
import type { WorkspaceScope } from '../types'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { readSessionEvents } from '../product/runtime-core'
import { verifyTtrpgOpenAudioReceiptsV1 } from './open-audio-proof'
import { assertTtrpgOpenAudioWriteAllowedV1, createTtrpgOpenAudioReceiptV1, parseTtrpgOpenAudioRequestV1, ttrpgOpenAudioKindV1,
  ttrpgOpenAudioNarrationV1, ttrpgOpenAudioReceiptVisibleV1, ttrpgOpenAudioSourceEqualV1,
  type TtrpgOpenAudioRequestV1, type TtrpgOpenAudioAssetV1, type TtrpgOpenAudioReceiptV1 } from './open-audio-contract'
import { projectTtrpgOpenScopedAudioV1 } from './open-audio-scope'
import { issueTtrpgOpenAudioUploadTicketV1, readTtrpgOpenAudioMediaWitnessV1, ttrpgOpenAudioAssetSnapshotV1,
  type TtrpgOpenAudioUploadTicketV1 } from './open-audio-media'
import { importProductRuntimeMediaAssetV1 } from '../product/runtime-media-library'
import { sha256MediaData } from '../product-production/media-blob-store'
import { detectProductMediaMimeTypeV1 } from '../product-production/media-adapters'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { applyTtrpgOpenAudioCueV1 } from './runtime-commands'
import { ttrpgOpenScopedKeyV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import * as p from './open-contract-parse'

export interface TtrpgOpenAudioDeskInputV1 { scope: WorkspaceScope; sessionId: number; viewerKey: string }
export interface TtrpgOpenAudioReviewV1 {
  schema: 'storyforge.ttrpg-open-audio-review'; version: 1; reviewKey: string
  sessionId: number; viewerKey: string; sequence: number; request: TtrpgOpenAudioRequestV1
  asset: TtrpgOpenAudioAssetV1 | null; recipients: string[]; fallbackText: string
}
interface ReviewOwner { input: TtrpgOpenAudioDeskInputV1; body: string; baseStateHash: string; submissionKey: string; uploadTicket?: TtrpgOpenAudioUploadTicketV1 }
const reviews = new WeakMap<TtrpgOpenAudioReviewV1, ReviewOwner>()
async function owner(input: TtrpgOpenAudioDeskInputV1) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const events = await readSessionEvents(loaded.session)
  await verifyTtrpgOpenAudioReceiptsV1({ runtime: loaded.runtime, runtimeSourceHash: loaded.session.runtimeSourceHash, events })
  await loaded.assertCurrent(); return loaded
}
type Loaded = Awaited<ReturnType<typeof owner>>
function visible(loaded: Loaded, viewerKey: string) { return (loaded.runtime.openRun!.audioReceipts ?? []).filter(row => ttrpgOpenAudioReceiptVisibleV1(row, loaded.runtime, viewerKey)) }
function active(loaded: Loaded, viewerKey: string) {
  const receipts = visible(loaded, viewerKey), projection = projectTtrpgOpenScopedAudioV1({ events: receipts.map(row => row.envelope), authorization: loaded.authorization, reader: { kind: 'human', viewerKey } })
  return Object.values(projection.channels).flatMap(cue => {
    if (!cue) return []
    const matches = receipts.filter(row => row.request.action === 'play' && row.envelope.event.slotKey === cue.slotKey), receipt = matches[0]
    if (matches.length !== 1 || !receipt?.asset) p.fail('当前音轨缺少唯一原播放回执')
    return [{ cue, receipt }]
  })
}
function receiverLabels(loaded: Loaded, receipt: TtrpgOpenAudioReceiptV1) {
  return receipt.envelope.scope.recipients.map(row => row.role === 'gm' ? '主持' : loaded.state.entities[row.actorKey!]?.name ?? '原角色')
}
function createReview(input: TtrpgOpenAudioDeskInputV1, loaded: Loaded, request: TtrpgOpenAudioRequestV1, asset: TtrpgOpenAudioAssetV1 | null,
  submissionKey: string, uploadTicket?: TtrpgOpenAudioUploadTicketV1) {
  const receipt = createTtrpgOpenAudioReceiptV1({ runtime: loaded.runtime, runtimeSourceHash: loaded.session.runtimeSourceHash, viewerKey: input.viewerKey,
    request, asset, sequence: loaded.state.lastSequence + 1, commandId: 'audio.review.pending', submissionKey })
  const review: TtrpgOpenAudioReviewV1 = { schema: 'storyforge.ttrpg-open-audio-review', version: 1, reviewKey: crypto.randomUUID(), sessionId: input.sessionId, viewerKey: input.viewerKey,
    sequence: loaded.state.lastSequence, request: structuredClone(request), asset: asset ? structuredClone(asset) : null, recipients: receiverLabels(loaded, receipt), fallbackText: receipt.envelope.event.fallbackText }
  reviews.set(review, { input: { scope: structuredClone(input.scope), sessionId: input.sessionId, viewerKey: input.viewerKey }, body: stable(review), baseStateHash: loaded.stateHash, submissionKey, ...(uploadTicket ? { uploadTicket } : {}) })
  return review
}
export async function readTtrpgOpenAudioDeskV1(input: TtrpgOpenAudioDeskInputV1) {
  const loaded = await owner(input), runtime = loaded.runtime
  let canPlay = false, canStop = false, unavailable = ''
  if (loaded.humanHost) {
    try { assertTtrpgOpenAudioWriteAllowedV1(runtime, input.viewerKey, 'play'); canPlay = true } catch { unavailable = '本轮处理完成且未暂停时，可核对并切换音轨。' }
    try { assertTtrpgOpenAudioWriteAllowedV1(runtime, input.viewerKey, 'stop'); canStop = true } catch { /* Local mute remains independent. */ }
  }
  const tracks = active(loaded, input.viewerKey).map(({ cue, receipt }) => ({ channel: cue.channel, slotKey: cue.slotKey, audience: cue.audience, fallbackText: cue.fallbackText,
    sourceRef: receipt.envelope.sourceRef, clipKey: `${cue.slotKey}:${receipt.asset!.contentHash}`, fade: cue.fade, durationMs: receipt.asset!.durationMs,
    voiceMarks: cue.voiceTimeline?.marks ?? null }))
  const library = loaded.humanHost ? visible(loaded, input.viewerKey).filter(row => row.request.action === 'play').map(row => ({
    sourceRef: row.envelope.sourceRef, name: row.asset!.name, channel: row.request.channel, audience: row.request.audience, privateActorKey: row.request.privateActorKey,
    narrationSourceRef: row.request.narrationSourceRef, source: row.asset!.source, license: row.asset!.license, recipients: receiverLabels(loaded, row) })) : []
  const causes = loaded.humanHost ? (runtime.openRun!.narrations ?? []).flatMap(row => {
    try { ttrpgOpenAudioNarrationV1(runtime, row.sourceRef) } catch { return [] }
    if (loaded.seat?.role !== 'gm' && (!loaded.seat?.actorKey || !row.recipientActorKeys.includes(loaded.seat.actorKey))) return []
    return [{ sourceRef: row.sourceRef, text: row.narration.paragraphs.map(paragraph => paragraph.text).join('\n\n') }]
  }) : []
  await loaded.assertCurrent()
  return { sessionId: input.sessionId, viewerKey: input.viewerKey, sequence: loaded.state.lastSequence, authorizationRevision: loaded.authorization.revision,
    paused: runtime.product.safety.status !== 'active', humanHost: loaded.humanHost, privateControlAllowed: loaded.humanHost && loaded.seat?.role === 'gm', canPlay, canStop, unavailable, tracks, library, causes,
    players: loaded.humanHost ? loaded.authorization.seats.filter(row => row.role === 'player').map(row => ({ actorKey: row.actorKey!, name: loaded.state.entities[row.actorKey!]?.name ?? '角色' })) : [] }
}
export type TtrpgOpenAudioDeskV1 = Awaited<ReturnType<typeof readTtrpgOpenAudioDeskV1>>

export async function prepareTtrpgOpenAudioUploadV1(input: TtrpgOpenAudioDeskInputV1 & {
  request: TtrpgOpenAudioRequestV1; file: Blob; name: string; source: string; license: string; durationMs: number | null
  decision: 'prepare-this-file-for-reviewed-audio'
}): Promise<TtrpgOpenAudioReviewV1> {
  p.literal(input.decision, 'prepare-this-file-for-reviewed-audio', 'audio file preparation')
  const loaded = await owner(input), request = parseTtrpgOpenAudioRequestV1(input.request)
  assertTtrpgOpenAudioWriteAllowedV1(loaded.runtime, input.viewerKey, 'play')
  if (request.media.kind !== 'upload' || request.action !== 'play') p.fail('上传核对仅适用于这次明确提供的新文件')
  if (!input.file || input.file.size < 1 || input.file.size > 100 * 1024 * 1024) p.fail('音频文件必须在 1 byte 到 100 MiB 之间')
  const data = await input.file.arrayBuffer(), mimeType = p.oneOf(detectProductMediaMimeTypeV1(data), ['audio/wav', 'audio/mpeg', 'audio/ogg'], 'actual audio format')
  const assetKey = await ttrpgOpenScopedKeyV1(loaded.runtime.sessionKey, 'audio-asset', [input.viewerKey, request.media.submissionKey])
  const proposed: TtrpgOpenAudioAssetV1 = { originSessionKey: loaded.runtime.sessionKey, assetKey, version: 1, kind: ttrpgOpenAudioKindV1(request.channel),
    name: p.text(input.name, 'audio upload name', 500), mimeType, byteSize: data.byteLength, durationMs: input.durationMs,
    contentHash: await sha256MediaData(data), source: p.text(input.source, 'audio source declaration', 5000), license: p.text(input.license, 'audio license declaration', 5000) }
  // Validate disclosure, settled cause and voice script before storing any imported bytes.
  createTtrpgOpenAudioReceiptV1({ runtime: loaded.runtime, runtimeSourceHash: loaded.session.runtimeSourceHash, viewerKey: input.viewerKey, request,
    asset: proposed, sequence: loaded.state.lastSequence + 1, commandId: 'audio.upload.pending', submissionKey: request.media.submissionKey })
  await loaded.assertCurrent()
  const row = await importProductRuntimeMediaAssetV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, assetKey, kind: proposed.kind, name: proposed.name,
    blob: new Blob([data], { type: mimeType }), source: proposed.source, license: proposed.license, durationMs: proposed.durationMs })
  const asset = ttrpgOpenAudioAssetSnapshotV1(row, loaded.runtime.sessionKey)
  if (stable(asset) !== stable({ ...proposed, version: row.version })) p.fail('该上传标识已有不同的原元数据，请重新明确选择文件')
  await loaded.assertCurrent()
  const uploadTicket = issueTtrpgOpenAudioUploadTicketV1({ scope: input.scope, sessionId: input.sessionId, sessionKey: loaded.runtime.sessionKey,
    runtimeSourceHash: loaded.session.runtimeSourceHash, viewerKey: input.viewerKey, sequence: loaded.state.lastSequence, stateHash: loaded.stateHash,
    request, asset, assetId: row.id! })
  return createReview(input, loaded, request, asset, request.media.submissionKey, uploadTicket)
}
export async function prepareTtrpgOpenRetainedAudioV1(input: TtrpgOpenAudioDeskInputV1 & { sourceRef: TtrpgOpenSourceRefV1; submissionKey: string; action: 'play' | 'stop' }): Promise<TtrpgOpenAudioReviewV1> {
  const loaded = await owner(input), original = visible(loaded, input.viewerKey).find(row => row.request.action === 'play' && ttrpgOpenAudioSourceEqualV1(row.envelope.sourceRef, input.sourceRef))
  if (!original) p.fail('本人没有该原音频的读取权限')
  const action = p.oneOf(input.action, ['play', 'stop'], 'audio retained control'), request = parseTtrpgOpenAudioRequestV1({ ...original.request, action,
    media: { kind: action === 'stop' ? 'stop' : 'retained', sourceRef: original.envelope.sourceRef }, voiceTimeline: action === 'stop' ? null : original.request.voiceTimeline })
  const result = createReview(input, loaded, request, action === 'stop' ? null : original.asset, p.key(input.submissionKey, 'retained audio submission'))
  await loaded.assertCurrent(); return result
}
export async function confirmTtrpgOpenAudioReviewV1(input: TtrpgOpenAudioDeskInputV1 & { review: TtrpgOpenAudioReviewV1; decision: 'confirm-this-audio-and-audience' }): Promise<{ sequence: number }> {
  p.literal(input.decision, 'confirm-this-audio-and-audience', 'audio explicit confirmation')
  const saved = reviews.get(input.review)
  if (!saved || stable(saved.input) !== stable({ scope: input.scope, sessionId: input.sessionId, viewerKey: input.viewerKey }) || saved.body !== stable(input.review)) p.fail('请在当前本人页面重新核对音频；复制或刷新不能恢复未保存的确认')
  return applyTtrpgOpenAudioCueV1({ sessionId: input.sessionId, viewerKey: input.viewerKey, submissionKey: saved.submissionKey, request: input.review.request,
    baseSequence: input.review.sequence, baseStateHash: saved.baseStateHash, commandId: 'audio.explicit.confirmation', decision: input.decision,
    ...(saved.uploadTicket ? { uploadTicket: saved.uploadTicket } : {}) })
}
export async function readTtrpgOpenAudioClipV1(input: TtrpgOpenAudioDeskInputV1 & { sourceRef: TtrpgOpenSourceRefV1; expectedClipKey: string }): Promise<{ blob: Blob; slotKey: string }> {
  const loaded = await owner(input)
  if (loaded.runtime.product.safety.status !== 'active') p.fail('暂停期间不能读取新播放文件')
  const track = active(loaded, input.viewerKey).find(row => ttrpgOpenAudioSourceEqualV1(row.receipt.envelope.sourceRef, input.sourceRef))
  if (!track?.receipt.asset || `${track.cue.slotKey}:${track.receipt.asset.contentHash}` !== input.expectedClipKey) p.fail('音轨已变化或本人没有当前播放权限')
  const { data } = await readTtrpgOpenAudioMediaWitnessV1({ scope: input.scope, session: loaded.session, expected: track.receipt.asset })
  await loaded.assertCurrent()
  return { blob: new Blob([data], { type: track.receipt.asset.mimeType }), slotKey: track.cue.slotKey }
}
