/** Human desk only. Model recall must enter its own registered, consumer-scoped Context Gateway source. */
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertInstanceBinding } from '../product/runtime-instances'
import { readProductRuntimeState, readProductRuntimeStateVersion, readSessionEvents, hashProductRuntimeStateV1 } from '../product/runtime-core'
import { verifyProductRuntimeSessionSourceV1 } from '../product-production/preview-source'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { assertTtrpgOpenAuthorizationCurrentV1, assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { projectTtrpgOpenMemoryRowV1, verifyTtrpgOpenMemoryReceiptsV1, assertTtrpgOpenMemoryLocatorV1 } from './open-memory-proof'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'

export async function readTtrpgOpenNarrativeMemoriesV1(input: { scope: WorkspaceScope; sessionId: number; viewerKey: string }) {
  const session = await assertInstanceBinding(input.sessionId, input.scope)
  const source = await verifyProductRuntimeSessionSourceV1({ scope: input.scope, session, ttrpgProtocol: 2 })
  const state = await readProductRuntimeState(input.sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  const stateHash = await hashProductRuntimeStateV1(state)
  if (!runtime?.authorization || !runtime.openRun) throw new Error('[ttrpg-memory] 请先完成当前分支的真人开团授权')
  const participants = await readTtrpgSessionParticipantsV2(input.sessionId)
  const seat = assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization, participants, viewerKey: input.viewerKey })
  let humanHost = false
  try { assertTtrpgOpenHumanHostV1(runtime.authorization, input.viewerKey); humanHost = true } catch { /* Own notes remain readable. */ }
  await verifyTtrpgOpenMemoryReceiptsV1({ runtime, runtimeSourceHash: source.runtimeSourceHash, events: await readSessionEvents(session) })
  const rows = await db.ttrpgNarrativeMemories.where('sessionId').equals(input.sessionId).toArray()
  if (rows.length !== (runtime.openRun.memoryReceipts?.length ?? 0)) throw new Error('[ttrpg-memory] 记忆表投影缺失或多出未确认内容，请修复原记录')
  const byRevision = new Map(rows.map(row => [row.revisionKey, row]))
  const entries = []
  for (const receipt of runtime.openRun.memoryReceipts ?? []) {
    const row = byRevision.get(receipt.draft.revisionKey)
    if (!row) throw new Error('[ttrpg-memory] 已确认记忆原记录缺失')
    if (row.sourceSessionId !== null) assertTtrpgOpenMemoryLocatorV1(receipt, await db.productRuntimeSessions.get(row.sourceSessionId), session)
    const { id: _id, ...fields } = row
    if (stable(fields) !== stable(projectTtrpgOpenMemoryRowV1(receipt, session, row.sourceSessionId))) throw new Error('[ttrpg-memory] 记忆行与原确认不一致')
    const allowed = receipt.draft.audience === 'public' || receipt.draft.audience === 'party' && (humanHost || seat.actorKey !== null && receipt.recipientActorKeys.includes(seat.actorKey))
      || receipt.draft.audience === 'gm-only' && humanHost
      || receipt.draft.audience === 'private' && (seat.actorKey !== null && receipt.recipientActorKeys.includes(seat.actorKey) || humanHost && receipt.recipientActorKeys.includes('gm'))
    if (allowed) entries.push({ revisionKey: row.revisionKey, summary: row.summary, reliability: row.reliability, audience: row.audience,
      observerKey: row.observerKey, fromEventSequence: row.fromEventSequence, toEventSequence: row.toEventSequence,
      recordedAtWorldTurn: receipt.recordedAtWorldTurn, historical: receipt.sourceRef.sessionKey !== runtime.sessionKey,
      noMechanicalAuthority: true as const, noKnowledgeGrant: true as const })
  }
  const current = await readProductRuntimeStateVersion(input.sessionId)
  const latestParticipants = await readTtrpgSessionParticipantsV2(input.sessionId)
  const latestSession = await assertInstanceBinding(input.sessionId, input.scope)
  if (current.sequence !== state.lastSequence || current.stateHash !== stateHash || latestSession.runtimeSourceHash !== session.runtimeSourceHash
    || latestSession.productReleaseId !== session.productReleaseId || latestSession.productBuildId !== session.productBuildId
    || stable(latestParticipants) !== stable(participants)) throw new TtrpgOpenReadConflictV1('查看记忆期间进度、来源或身份已变化')
  return { sequence: state.lastSequence, actorKey: seat.actorKey, humanHost, entries }
}
