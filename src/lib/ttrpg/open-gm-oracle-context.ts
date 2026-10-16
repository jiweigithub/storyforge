import { TtrpgOpenReadConflictV1 } from './open-read-conflict'
import { verifyTtrpgOpenOracleReviewHashesV1 } from './open-oracle-review'
/** Oracle-specific GM input. Public consultations never bring unrelated GM secrets into the model. */
import type { WorkspaceScope } from '../types'
import { assertInstanceBinding } from '../product/runtime-instances'
import { verifyProductRuntimeSessionSourceV1 } from '../product-production/preview-source'
import { readProductRuntimeState, readProductRuntimeStateVersion, hashProductRuntimeStateV1 } from '../product/runtime-core'
import { isTtrpgRuntimeContentV2 } from './content-version'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { assertTtrpgOpenAuthorizationRowsCurrentV1 } from './open-authorization'
import { verifyTtrpgOpenOracleJournalV1 } from './open-oracle-contract'
import { verifyTtrpgOpenFactLedgerV1, ttrpgOpenSessionFactsV1 } from './open-fact-ledger'
import { ttrpgOpenMechanicalStateHashV1 } from './open-rule-plan'
import { hashProductProductionValueV2 } from '../product-production/hash'

export async function loadTtrpgOpenGmOracleContextV1(input: { scope: WorkspaceScope; sessionId: number; actorKey: string }) {
  if (input.actorKey !== 'gm') throw new Error('[ttrpg-open-gm] Oracle 主持来源需要明确 GM 视角')
  const session = await assertInstanceBinding(input.sessionId, input.scope)
  if (session.kind !== 'ttrpg') throw new Error('[ttrpg-open-gm] 实例不是跑团')
  const source = await verifyProductRuntimeSessionSourceV1({ scope: input.scope, session, ttrpgProtocol: 2 })
  const content = source.runtimePackage.ttrpg
  if (!content || !isTtrpgRuntimeContentV2(content) || source.runtimeSourceHash !== session.runtimeSourceHash) throw new Error('[ttrpg-open-gm] 实例缺少准确冻结 open 来源')
  const state = await readProductRuntimeState(input.sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.authorization || !runtime.openRun) throw new Error('[ttrpg-open-gm] 请先完成桌面授权与开局')
  const authorization = assertTtrpgOpenAuthorizationRowsCurrentV1({ authorization: runtime.authorization, participants: await readTtrpgSessionParticipantsV2(input.sessionId) })
  const gm = authorization.seats.find(seat => seat.role === 'gm')
  if (!gm || !gm.consent.aiIdentityDisclosed || !gm.consent.aiAdviceAllowed) throw new Error('[ttrpg-open-gm] 未授权 AI 主持读取与解释')
  await verifyTtrpgOpenOracleJournalV1({ receipts: runtime.openRun.oracleReceipts ?? [], rulePack: content.rulePack.content,
    sessionKey: runtime.sessionKey, seed: session.seed, ancestors: runtime.branchLineage?.ancestors ?? [] })
  await verifyTtrpgOpenOracleReviewHashesV1(runtime.openRun.oracleReviews ?? [])
  await verifyTtrpgOpenFactLedgerV1({ ledger: runtime.openRun.factLedger, content, runtimeSourceHash: session.runtimeSourceHash,
    oracleReceipts: runtime.openRun.oracleReceipts ?? [], entityOperations: runtime.openRun.entityOperations, storyFacts: runtime.product.effectLedger.storyFacts })
  const facts = ttrpgOpenSessionFactsV1(runtime.openRun.factLedger).filter(fact => !fact.retired)
  const rank: Record<string, number> = { public: 0, party: 1, private: 2, 'gm-only': 3 }
  const resources = [{ suffix: 'gm-oracle-contract', title: '本桌 Oracle 解释边界', mandatory: true,
    value: { schema: 'storyforge.ttrpg-open-gm-oracle-contract', version: 1, actorKey: 'gm', selectedActorKeys: authorization.selectedActorKeys,
      rulePackContentHash: content.rulePack.contentHash, worldReleaseHash: content.campaign.sourceWorld.contentHash,
      factPolicy: content.rulePack.content.factPolicy, rawOutcomeIsFinal: true, outputIsCandidate: true,
      mechanicalOwnersAndPlayerDecisionsForbidden: true, noWorldWriteBack: true } } as {
      suffix: string; title: string; mandatory: boolean; value: unknown
    }]
  for (const receipt of runtime.openRun.oracleReceipts ?? []) {
    const visible = (audience: string) => rank[audience] <= rank[receipt.audience]
    const table = content.rulePack.content.oracles.find(table => table.oracleKey === receipt.resolution.outcome.oracleKey)!
    resources.push({ suffix: `oracle.${await hashProductProductionValueV2(receipt.sourceRef)}`, title: receipt.resolution.outcome.question, mandatory: false,
      value: { schema: 'storyforge.ttrpg-open-gm-oracle-input', version: 1, sourceRef: receipt.sourceRef, audience: receipt.audience,
        outcome: receipt.resolution.outcome, interpretationPolicy: table.interpretation,
        permittedFrozenFacts: content.campaign.frozenWorldPredicateIndex.entries.filter(fact => visible(fact.audience)),
        permittedSessionFacts: facts.filter(fact => visible(fact.audience)),
        permittedEntityRefs: content.campaign.entityBindings.filter(binding => visible(binding.audience)).map(binding => ({
          entityRef: binding.bindingKey, kind: binding.kind, audience: binding.audience, knownByActorKeys: binding.knownByActorKeys,
          playerControlled: content.campaign.characterTemplates.some(character => character.characterKey === binding.bindingKey && character.role === 'player') })) } })
  }
  for (const review of runtime.openRun.oracleReviews ?? []) {
    if (review.interpretationDecision !== 'accept') continue
    resources.push({ suffix: `review.${await hashProductProductionValueV2(review.sourceRef)}`, title: '已由真人确认的 Oracle 解释', mandatory: false,
      value: { schema: 'storyforge.ttrpg-open-gm-fact-normalization-input', version: 1, sourceRef: review.sourceRef, reviewHash: review.reviewHash,
        oracleSourceRef: review.oracleSourceRef, interpretation: review.interpretation, audience: review.audience,
        discardedProposals: review.choices.filter(choice => choice.decision === 'discard').map(choice => review.proposals[choice.proposalIndex]),
        adoptedFactKeys: review.adoptedFactKeys, worldWriteBackForbidden: true, outputIsCandidate: true } })
  }
  const visibilityHash = await hashProductProductionValueV2(resources)
  const admissionStateHash = await ttrpgOpenMechanicalStateHashV1(state), stateHash = await hashProductRuntimeStateV1(state)
  const after = await readProductRuntimeStateVersion(input.sessionId)
  if (after.sequence !== state.lastSequence || after.stateHash !== stateHash) throw new TtrpgOpenReadConflictV1('[ttrpg-open-gm] 读取期间状态已变化')
  assertTtrpgOpenAuthorizationRowsCurrentV1({ authorization, participants: await readTtrpgSessionParticipantsV2(input.sessionId) })
  return { resources, visibilityHash, admissionStateHash, readEvidence: { sequence: state.lastSequence, stateHash,
    runtimeSourceHash: session.runtimeSourceHash, sessionKey: runtime.sessionKey } }
}
