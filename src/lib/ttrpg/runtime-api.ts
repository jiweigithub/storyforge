/** Public deterministic runtime commands owned by the TTRPG product. */
export {
  activateTtrpgCampaignSupplementV2,
  advanceTtrpgCharacterV1,
  changeTtrpgCampaignRosterV2,
  changeTtrpgSafetyStatus,
  classifyTtrpgSubmittedIntentV2,
  commitTtrpgDeterministicFallbackV1,
  commitTtrpgEffectPlanV2,
  commitTtrpgGmActorActionFromHarnessV1,
  commitTtrpgGmNarrationFromHarnessV1,
  commitTtrpgDirectorFromHarnessV1,
  commitTtrpgPrivateGuidanceFromHarnessV1,
  commitTtrpgHumanGmNarrationV1,
  commitTtrpgIntentDispositionV2,
  commitTtrpgItemCommandV2,
  commitTtrpgPlayerActionFromHarnessV1,
  completeTtrpgCampaignEnding,
  completeTtrpgCampaignSessionV2,
  completeTtrpgRestV2,
  completeTtrpgSessionZero,
  customizeTtrpgPlayerCharacterV1,
  discoverTtrpgClue,
  openTtrpgCampaignScene,
  proposeTtrpgEffectChoiceV2,
  recordTtrpgHumanResponseV2,
  recordTtrpgVersionTransitionV2,
  recordTtrpgWorldEvolutionV2,
  resolveTtrpgEffectChoiceV2,
  resolveTtrpgRuleAction,
  resolveTtrpgRuleCheck,
  startTtrpgCampaignSessionV2,
  submitTtrpgActionIntentV2,
  updateTtrpgTabletopV1,
  completeTtrpgOpenSessionZeroV1,
  startTtrpgOpenRunV1,
  consultTtrpgOracleV1,
  commitTtrpgOpenOracleFactV1,
  commitTtrpgOpenOracleCandidateFactV1,
  reviewTtrpgOpenOracleCandidateV1,
  retireTtrpgOpenSessionFactV1,
  discoverTtrpgOpenKnowledgeV1,
  shareTtrpgOpenKnowledgeV1,
  startTtrpgOpenEpochV1,
  closeTtrpgOpenEpochV1,
  inheritTtrpgOpenSourceV1,
  startTtrpgOpenInheritedOperationV1,
  reserveTtrpgOpenModelCallV1,
  dispatchTtrpgOpenModelCallV1,
  finishTtrpgOpenModelCallV1,
  startTtrpgOpenOperationV1,
  startTtrpgOpenIntentCandidateOperationV1,
  confirmTtrpgOpenOperationV1,
  selectTtrpgOpenOperationEffectV1,
  selectTtrpgOpenDiscoveryEffectV1,
  prepareTtrpgOpenPrivateChoiceDisclosureV1,
  discloseTtrpgOpenPrivateChoiceV1,
  disposeTtrpgOpenIntentV1,
  resolveTtrpgOpenOperationRuleV1,
  applyTtrpgOpenOperationEffectV1,
  completeTtrpgOpenOperationStepV1,
  completeTtrpgOpenOperationV1,
  advanceTtrpgWorldTurnV1,
  advanceTtrpgOpenPressureV1,
  prepareTtrpgOpenPressureEffectV1,
  readTtrpgOpenPressureEffectApprovalViewV1,
  proposeTtrpgOpenPressureEffectV1,
  confirmTtrpgOpenPressureEffectV1,
  applyTtrpgOpenPressureEffectV1,
  completeTtrpgOpenPressureSituationV1,
  advanceTtrpgOpenSituationsV1,
  preauthorizeTtrpgOpenCompanionV1,
  acceptTtrpgOpenKpNarrationV1,
  closeTtrpgOpenStageV1,
  advanceTtrpgOpenStageClosureV1,
  prepareTtrpgOpenStageEffectV1,
  readTtrpgOpenStageEffectApprovalViewV1,
  proposeTtrpgOpenStageEffectV1,
  confirmTtrpgOpenStageEffectV1,
  applyTtrpgOpenStageEffectV1,
  evaluateTtrpgOpenOperationTerminalV1,
  evaluateTtrpgOpenOperationGatesV1,
  prepareTtrpgOpenSituationEffectV1,
  readTtrpgOpenSituationEffectApprovalViewV1,
  proposeTtrpgOpenSituationEffectV1,
  confirmTtrpgOpenSituationEffectV1,
  applyTtrpgOpenSituationEffectV1,
  telegraphTtrpgOpenFrontV1,
  ttrpgOpenOperationCommandIdV1,
  type FormalTtrpgCommandEnvelope,
  type TtrpgOpenModelCallCommandV1,
} from './runtime-commands'

/** Internal open recovery is explicit; player routes remain gated until joint acceptance. */
export { resumeTtrpgOpenOperationV1 } from './open-operation-coordinator'
/** Actor reader foundation; formal open Skill/Context registration is still required before model dispatch. */
export { loadTtrpgOpenPlayerContextV1 } from './open-player-context'

export {
  applyProductRuntimeEvent,
  branchProductRuntimeSession,
  createProductRuntimeCheckpoint,
  deleteProductRuntimeSession,
  hashProductRuntimeStateV1,
  parseProductRuntimeState,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
  replayProductRuntimeEvents,
  verifyProductRuntimeCheckpoint,
} from '../product/runtime-api'

export {
  type TtrpgTabletopOperationV1,
} from './runtime-state'
export { prepareTtrpgOpenIntentInputV1, prepareTtrpgOpenOracleInputV1, prepareTtrpgOpenFactNormalizationInputV1 } from './open-intent-input'
export { recoverTtrpgOpenRuntimeCandidateV1, generateTtrpgOpenIntentCandidateV1, executeTtrpgOpenIntentRequestV1, readTtrpgOpenIntentCandidateV1,
  generateTtrpgOpenOracleCandidateV1, executeTtrpgOpenOracleRequestV1, readTtrpgOpenOracleCandidateV1, generateTtrpgOpenFactNormalizationCandidateV1, executeTtrpgOpenFactNormalizationRequestV1, readTtrpgOpenFactNormalizationCandidateV1 } from './open-intent-harness'
export { reconcileTtrpgOpenOracleFactRunV1, TtrpgOpenOracleReceiptPendingError } from './open-oracle-adoption'

export { resumeTtrpgOpenPressureV1 } from './open-pressure-coordinator'

export { resumeTtrpgOpenSituationsV1 } from './open-situation-coordinator'

export { resumeTtrpgOpenChecksV1 } from './open-checks-coordinator'

export { generateTtrpgOpenKpCandidateV1, generateTtrpgOpenCompanionCandidateV1, executeTtrpgOpenKpRequestV1, executeTtrpgOpenCompanionRequestV1 } from './open-intent-harness'
export { readTtrpgOpenKpCandidateV1 } from './open-kp-candidate'
export { reconcileTtrpgOpenKpRunV1 } from './open-kp-adoption'

export { offerTtrpgOpenHandoffV1 } from './runtime-commands'
export { delegateTtrpgOpenHostingV1,stopTtrpgOpenHostingV1 } from './runtime-commands'
export { startTtrpgOpenDelegatedCompanionOperationV1 } from './runtime-commands'
export { acceptTtrpgOpenDelegatedKpNarrationV1 } from './runtime-commands'
export { resumeTtrpgOpenPlayV1 } from './open-play-coordinator'

export { recordTtrpgOpenHumanNarrationV1 } from './runtime-commands'
export { recordTtrpgOpenNarrativeMemoryV1 } from './runtime-commands'
export { readTtrpgOpenNarrativeMemoriesV1 } from './open-memory-service'
export { reconcileTtrpgOpenHumanNarrationV1 } from './open-human-narration-recovery'
export { cancelTtrpgOpenPreparedRequestV1 } from './open-request-cancellation'

export { recoverTtrpgOpenOperationGatesV1, stopTtrpgOpenOperationGateRecoveryV1 } from './runtime-commands'

export { resumeTtrpgOpenHostingV1, type TtrpgOpenHostingInputV1, type TtrpgOpenHostingResultV1 } from './open-hosting-coordinator'

export { prepareTtrpgOpenBriefInputV1 } from './open-intent-input'
export { generateTtrpgOpenBriefCandidateV1, executeTtrpgOpenBriefRequestV1 } from './open-intent-harness'
export { readTtrpgOpenBriefCandidateV1 } from './open-brief-candidate'
