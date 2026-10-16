/** Session-owned immutable adoption. Generated prose is private until this exact human disclosure. */
import type { TtrpgSituationTemplateV1 } from './open-contract'
import { parseTtrpgSituationTemplateV1 } from './situation-engine'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import * as p from './open-contract-parse'
import { extractExactArtifactOwnerRootsV1 } from '../memory/artifact-roots'
import type { ExactRunArtifactIdentityV1 } from '../types'

export interface TtrpgOpenSessionSituationReceiptV1 {
  schema: 'storyforge.ttrpg-open-session-situation'; version: 1;
  sourceRef: TtrpgOpenSourceRefV1; authorizationRef: TtrpgOpenSourceRefV1; runtimeSourceHash: string;
  acceptedAtWorldTurn: number; template: TtrpgSituationTemplateV1; templateHash: string; receiptHash: string; personalizationSourceKeys: string[];
  /** Exact historical contract/events with original physical locators. Opaque, immutable and never executable. */
  runOriginJson: string;
  artifactRefs: ExactRunArtifactIdentityV1[];
  model: { requestKey: string; epochKey: string; runContractHash: string; candidateHash: string; rawResponseHash: string;
    inputManifestHash: string; contextHash: string; basisHash: string; proposalHash: string; referencesHash: string };
  disclosure: { kind: 'human-gm-reviewed'; viewerKey: string; seatKey: string; authorizationHash: string;
    templateHash: string; scope: 'player-and-discovery-text-reviewed' };
}
export function parseTtrpgOpenSessionSituationReceiptV1(value: unknown): TtrpgOpenSessionSituationReceiptV1 {
  const r = p.record(value, ['schema', 'version', 'sourceRef', 'authorizationRef', 'runtimeSourceHash', 'acceptedAtWorldTurn',
    'template', 'templateHash', 'receiptHash', 'personalizationSourceKeys', 'runOriginJson', 'artifactRefs', 'model', 'disclosure'], 'session situation receipt')
  const model = p.record(r.model, ['requestKey', 'epochKey', 'runContractHash', 'candidateHash', 'rawResponseHash',
    'inputManifestHash', 'contextHash', 'basisHash', 'proposalHash', 'referencesHash'], 'original situation model proof')
  const disclosure = p.record(r.disclosure, ['kind', 'viewerKey', 'seatKey', 'authorizationHash', 'templateHash', 'scope'], 'human situation disclosure')
  const template = parseTtrpgSituationTemplateV1(r.template), templateHash = p.hash(r.templateHash, 'accepted template hash')
  const sourceRef = parseTtrpgOpenSourceRefV1(r.sourceRef), authorizationRef = parseTtrpgOpenSourceRefV1(r.authorizationRef)
  if (!/^generated\.[a-f0-9]{40}$/.test(template.templateKey) || template.evidence.some(e => !e.clueRef.startsWith(template.templateKey + '.'))
    || disclosure.templateHash !== templateHash || sourceRef.sessionKey !== authorizationRef.sessionKey || sourceRef.sequence <= authorizationRef.sequence) p.fail('采用身份、披露版本或原始授权不一致')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-session-situation', 'session situation schema'), version: p.literal(r.version, 1, 'session situation version'),
    sourceRef, authorizationRef, runtimeSourceHash: p.hash(r.runtimeSourceHash, 'accepted runtime source'),
    acceptedAtWorldTurn: p.integer(r.acceptedAtWorldTurn, 'situation acceptance turn', 0, Number.MAX_SAFE_INTEGER), template, templateHash,
    receiptHash: p.hash(r.receiptHash, 'session situation receipt hash'), personalizationSourceKeys: p.keys(r.personalizationSourceKeys, 'accepted personalization sources', 100, 1),
    runOriginJson: p.text(r.runOriginJson, 'immutable historical Run archive', 8000000), artifactRefs: parseTtrpgOpenSituationArtifactRefsV1(r.artifactRefs), model: {
      requestKey: p.key(model.requestKey, 'original situation request'), epochKey: p.key(model.epochKey, 'original situation epoch'),
      runContractHash: p.hash(model.runContractHash, 'original situation run'), candidateHash: p.hash(model.candidateHash, 'original situation candidate'),
      rawResponseHash: p.hash(model.rawResponseHash, 'original situation response'), inputManifestHash: p.hash(model.inputManifestHash, 'original situation manifest'),
      contextHash: p.hash(model.contextHash, 'original situation context'), basisHash: p.hash(model.basisHash, 'original situation basis'),
      proposalHash: p.hash(model.proposalHash, 'original situation proposal'), referencesHash: p.hash(model.referencesHash, 'actual delivered references'),
    }, disclosure: { kind: p.literal(disclosure.kind, 'human-gm-reviewed', 'human disclosure kind'), viewerKey: p.key(disclosure.viewerKey, 'actual human GM'),
      seatKey: p.key(disclosure.seatKey, 'actual human GM seat'), authorizationHash: p.hash(disclosure.authorizationHash, 'current human GM authorization'), templateHash,
      scope: p.literal(disclosure.scope, 'player-and-discovery-text-reviewed', 'explicit player/discovery text disclosure') } }
}

/** The shared registered-root parser owns the exact identity grammar and canonical set order. */
export function parseTtrpgOpenSituationArtifactRefsV1(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 1000) p.fail('已采用局势必须保留有界的真实逐字证据引用')
  return extractExactArtifactOwnerRootsV1({ refsJson: JSON.stringify(value) }, [{ field: 'refsJson', path: [] }])
}
