import type {AgentRunSnapshotV1} from '../agent/run/event-store'
import {parseContextManifestV1, verifyContextManifestIntegrityV1} from '../agent/run/context-manifest'
import {readAgentRunArtifactExactV1} from '../memory/artifact-store'
import {sha256Text} from '../ai/chapter-memory/text-normalization'
import {chatRetrievalVersionForReader, type ChatRetrievalVersion} from './context-selection'
import type {CharacterInteractionRuntimeState} from '../types'
import {buildInteractionContextWindow} from './runtime'
import {formatInteractionRuntimeContextV1} from './context-format'

/** A review follows its saved producer's reader. Old situation runs did not
 * retain a packet and keep the conservative v1 memory policy. */
export async function readChatCandidateRetrievalVersion(snapshot: AgentRunSnapshotV1, projectId: number,
  sourceKey: 'interactionRuntime' | 'chatSituationRuntime', participantKey?: string, state?: CharacterInteractionRuntimeState): Promise<ChatRetrievalVersion> {
  const packet = snapshot.events.find(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'context-packet'
    && e.payload.stepId === 'interaction:runtime-candidate' && e.payload.attempt === 1)
  if (packet?.type !== 'evidence.artifact.recorded') return sourceKey === 'interactionRuntime' ? 'legacy' : 'chat-relevance-v1'
  const body = JSON.parse(await readAgentRunArtifactExactV1({projectId, artifactKind: 'context-packet', contentHash: packet.payload.contentHash}))
  const manifest = parseContextManifestV1(body.manifest), source = manifest.sources.find(s => s.key === sourceKey)
  const assembled = snapshot.events.find(e => e.type === 'context.assembled' && e.payload.stepId === 'interaction:runtime-candidate' && e.payload.attempt === 1)
  if (!await verifyContextManifestIntegrityV1(manifest) || typeof body.text !== 'string' || !source
    || source.status !== 'included' || assembled?.type !== 'context.assembled' || assembled.payload.manifestHash !== manifest.manifestHash
    || participantKey != null && body.participantKey !== participantKey) throw new Error('行动来源读取版本无法核验，已停止审查。')
  const version = sourceKey === 'interactionRuntime' ? chatRetrievalVersionForReader(source.readerVersion)
    : source.readerVersion === 'chat-situation-runtime-view-v8' ? 'chat-relevance-v4' : source.readerVersion === 'chat-situation-runtime-view-v7' ? 'chat-relevance-v3' : source.readerVersion === 'chat-situation-runtime-view-v6' ? 'chat-relevance-v2' : source.readerVersion === 'chat-situation-runtime-view-v5' ? 'chat-relevance-v1' : null
  if (!version) throw new Error('行动来源读取版本无法核验，已停止审查。')
  if (sourceKey === 'interactionRuntime') {
    const profile = state?.profiles.find(p => p.participantKey === participantKey)
    if (!profile || !state) throw new Error('行动来源读取版本缺少原角色视角。')
    const expected = formatInteractionRuntimeContextV1(profile, buildInteractionContextWindow(state, profile.participantKey, {retrievalVersion: version}))
    if (source.contentHash !== await sha256Text(expected) || !body.text.includes(expected)) throw new Error('行动来源正文与读取版本不一致。')
  } else if (source.contentHash !== await sha256Text(body.text)) throw new Error('情境来源正文与记录不一致。')
  return version
}
