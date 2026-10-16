/** Immutable instance identities for versioned consumers. A snapshot grants no read, action or adoption permission. */
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenAudience, TtrpgOpenEntityKind } from './open-contract'
import type { TtrpgOpenEntityOperationV1 } from './open-entity-contract'
import { parseTtrpgOpenEntityOperationV1 } from './open-entity-contract'
import { ttrpgOpenEntityIdentityCatalogV1, ttrpgOpenEntityReferenceVisibleV1 } from './open-entity-catalog'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'

export interface TtrpgOpenRuntimeEntityReferenceV1 {
  entityRef: string; kind: TtrpgOpenEntityKind; templateKey: string; dynamicTemplateKey: string | null;
  audience: TtrpgOpenAudience; recipientActorKeys: string[];
  sourceRef: TtrpgOpenSourceRefV1; operationKey: string; planHash: string;
}
export interface TtrpgOpenRuntimeEntityReferencesV1 {
  schema: 'storyforge.ttrpg-open-runtime-entity-references'; version: 1;
  runtimeSourceHash: string; rulePackContentHash: string; references: TtrpgOpenRuntimeEntityReferenceV1[]; snapshotHash: string;
}
/** The new policy is optional in old windows. Its absence must keep the original source and candidate grammar. */
export interface TtrpgOpenSituationRuntimeReferencePolicyV1 {
  schema: 'storyforge.ttrpg-open-situation-runtime-reference-policy'; version: 1;
  consumer: 'private-gm' | 'common-party'; references: TtrpgOpenRuntimeEntityReferencesV1;
}
export function parseTtrpgOpenSituationRuntimeReferencePolicyV1(value: unknown): TtrpgOpenSituationRuntimeReferencePolicyV1 {
  const r = p.record(value, ['schema', 'version', 'consumer', 'references'], 'situation runtime reference policy')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-situation-runtime-reference-policy', 'runtime reference policy schema'),
    version: p.literal(r.version, 1, 'runtime reference policy version'), consumer: p.oneOf(r.consumer, ['private-gm', 'common-party'], 'runtime reference consumer'),
    references: parseTtrpgOpenRuntimeEntityReferencesV1(r.references) }
}
export function parseTtrpgOpenRuntimeEntityReferencesV1(value: unknown): TtrpgOpenRuntimeEntityReferencesV1 {
  const r = p.record(value, ['schema', 'version', 'runtimeSourceHash', 'rulePackContentHash', 'references', 'snapshotHash'], 'runtime entity references')
  const references = p.list(r.references, 'runtime entity reference rows', value => {
    const row = p.record(value, ['entityRef', 'kind', 'templateKey', 'dynamicTemplateKey', 'audience', 'recipientActorKeys', 'sourceRef', 'operationKey', 'planHash'], 'runtime entity reference')
    const entityRef = p.key(row.entityRef, 'committed instance identity'), audience = p.oneOf(row.audience, p.AUDIENCES, 'committed instance audience')
    const recipientActorKeys = p.keys(row.recipientActorKeys, 'committed instance recipients', 1000)
    if (!/^entity\.[a-f0-9]{48}(?:\.equipment\.(?:0|[1-9][0-9]*))?$/.test(entityRef)
      || audience === 'gm-only' && recipientActorKeys.length || audience === 'private' && !recipientActorKeys.length) p.fail('运行实例引用身份或准确接收者不闭合')
    return { entityRef, kind: p.oneOf(row.kind, ['actor', 'location', 'item'], 'committed instance kind'), templateKey: p.key(row.templateKey, 'original instance definition'),
      dynamicTemplateKey: p.nullable(row.dynamicTemplateKey, p.key, 'original dynamic instance template'), audience, recipientActorKeys,
      sourceRef: parseTtrpgOpenSourceRefV1(row.sourceRef), operationKey: p.key(row.operationKey, 'original instance operation'), planHash: p.hash(row.planHash, 'original instance plan') }
  }, 10000)
  const keys = references.map(row => row.entityRef)
  p.unique(keys, 'runtime entity reference identities')
  if (stable(keys) !== stable([...keys].sort())) p.fail('运行实例引用须保留规范顺序')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-runtime-entity-references', 'runtime entity reference schema'), version: p.literal(r.version, 1, 'runtime entity reference version'),
    runtimeSourceHash: p.hash(r.runtimeSourceHash, 'runtime reference source'), rulePackContentHash: p.hash(r.rulePackContentHash, 'runtime reference rules'), references,
    snapshotHash: p.hash(r.snapshotHash, 'runtime reference snapshot hash') }
}
type Journal = { content: TtrpgRuntimeContentV2; operations: readonly TtrpgOpenEntityOperationV1[]; runtimeSourceHash: string }
/** Caller must obtain the journal from the trusted replay/source loader; neither a model nor an imported snapshot can grant it. */
function referenceBody(input: Journal & { entityRefs?: readonly string[] }) {
  const operations = input.operations.map(parseTtrpgOpenEntityOperationV1).filter(row => row.resolution?.kind === 'materialized')
  const catalog = ttrpgOpenEntityIdentityCatalogV1(input.content, operations)
  const sourceKey = (ref: TtrpgOpenSourceRefV1) => stable(ref), frozenContentJson = stable(input.content)
  const originKeys = operations.map(row => sourceKey(row.resolution!.sourceRef))
  p.unique(originKeys, 'runtime entity creation events')
  const origins = new Map(operations.map((row, index) => [originKeys[index], row]))
  const eligible = catalog.filter(row => row.dynamic)
  if (input.entityRefs && (new Set(input.entityRefs).size !== input.entityRefs.length || input.entityRefs.some(key => !eligible.some(row => row.entityKey === key)))) p.fail('运行实例引用选择包含重复、未创建或冻结绑定身份')
  const references = eligible.filter(row => !input.entityRefs || input.entityRefs.includes(row.entityKey)).map(row => {
    const operation = origins.get(sourceKey(row.sourceRef!))
      ?? p.fail('运行实例引用缺少原创建回执')
    if (operation.plan.runtimeSourceHash !== input.runtimeSourceHash || operation.plan.rulePackContentHash !== input.content.rulePack.contentHash
      || operation.plan.frozenContentJson !== frozenContentJson) p.fail('运行实例引用不属于实际冻结来源和原定义')
    return { entityRef: row.entityKey, kind: row.kind, templateKey: row.templateKey, dynamicTemplateKey: row.dynamicTemplateKey,
      audience: row.audience, recipientActorKeys: [...row.recipientActorKeys], sourceRef: { ...row.sourceRef! },
      operationKey: operation.plan.operationKey, planHash: operation.plan.planHash }
  }).sort((a, b) => a.entityRef < b.entityRef ? -1 : a.entityRef > b.entityRef ? 1 : 0)
  return { schema: 'storyforge.ttrpg-open-runtime-entity-references' as const, version: 1 as const,
    runtimeSourceHash: input.runtimeSourceHash, rulePackContentHash: input.content.rulePack.contentHash, references }
}
export async function createTtrpgOpenRuntimeEntityReferencesV1(input: Journal & { entityRefs?: readonly string[] }): Promise<TtrpgOpenRuntimeEntityReferencesV1> {
  const body = referenceBody(input)
  return parseTtrpgOpenRuntimeEntityReferencesV1({ ...body, snapshotHash: await hash(body) })
}
/** Synchronous replay checks the actual prior F13 records; live source loading separately verifies hashes and frozen content. */
export function assertTtrpgOpenSituationRuntimeReferenceJournalV1(input: {
  policy: TtrpgOpenSituationRuntimeReferencePolicyV1; operations: readonly TtrpgOpenEntityOperationV1[];
  recipientActorKeys: readonly string[]; rulePackContentHash: string; consumerRef: TtrpgOpenSourceRefV1;
}) {
  const policy = parseTtrpgOpenSituationRuntimeReferencePolicyV1(input.policy), snapshot = policy.references
  const rows = input.operations.map(parseTtrpgOpenEntityOperationV1).filter(row => row.resolution?.kind === 'materialized').flatMap(operation => {
    const content = p.json(operation.plan.frozenContentJson) as TtrpgRuntimeContentV2
    return referenceBody({ content, operations: [operation], runtimeSourceHash: snapshot.runtimeSourceHash }).references
  })
  p.unique(rows.map(row => row.entityRef), 'actual runtime entity references')
  const eligible = rows.filter(row => policy.consumer === 'private-gm' || input.recipientActorKeys.length > 0
    && input.recipientActorKeys.every(actor => ttrpgOpenEntityReferenceVisibleV1(row.audience, row.recipientActorKeys, actor, false, true)))
    .sort((a, b) => a.entityRef < b.entityRef ? -1 : a.entityRef > b.entityRef ? 1 : 0)
  if (!snapshot.references.length || snapshot.rulePackContentHash !== input.rulePackContentHash || stable(snapshot.references) !== stable(eligible)
    || eligible.some(row => row.sourceRef.sessionKey === input.consumerRef.sessionKey && row.sourceRef.sequence >= input.consumerRef.sequence)) p.fail('局势实例读取策略没有准确的原创建切点及本次接收者范围')
}
/** Hash verification establishes portable integrity only; the actual journal must be matched separately. */
export async function verifyTtrpgOpenRuntimeEntityReferencesHashV1(value: TtrpgOpenRuntimeEntityReferencesV1) {
  const { snapshotHash, ...body } = parseTtrpgOpenRuntimeEntityReferencesV1(value)
  if (await hash(body) !== snapshotHash) p.fail('运行实例引用快照已经损坏')
}
export async function assertTtrpgOpenRuntimeEntityReferencesMatchV1(input: Journal & { snapshot: TtrpgOpenRuntimeEntityReferencesV1 } & (
  { mode: 'current'; entityRefs?: readonly string[] } | { mode: 'historical'; consumerRef: TtrpgOpenSourceRefV1 }
)) {
  await verifyTtrpgOpenRuntimeEntityReferencesHashV1(input.snapshot)
  const snapshot = parseTtrpgOpenRuntimeEntityReferencesV1(input.snapshot)
  const actual = await createTtrpgOpenRuntimeEntityReferencesV1({ ...input, ...(input.mode === 'current' && input.entityRefs ? { entityRefs: input.entityRefs } : {}) })
  if (snapshot.runtimeSourceHash !== actual.runtimeSourceHash || snapshot.rulePackContentHash !== actual.rulePackContentHash) p.fail('运行实例引用属于其他冻结来源')
  if (input.mode === 'current') {
    if (stable(snapshot) !== stable(actual)) p.fail('运行实例引用与当前完整选择不一致')
  } else if (snapshot.references.some(row => !actual.references.some(original => stable(original) === stable(row))
    || row.sourceRef.sessionKey === input.consumerRef.sessionKey && row.sourceRef.sequence >= input.consumerRef.sequence)) p.fail('历史运行实例引用没有准确的先前实际创建来源')
}
