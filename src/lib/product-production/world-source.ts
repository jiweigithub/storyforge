import {
  openWorldSemanticResourceCatalogV1,
  readWorldSemanticResourceV1,
  readWorldSemanticResourcesV1,
  type WorldSemanticResourceSnapshotV1,
  openProductWorldResourceCatalogV2, closeProductWorldResourceCatalogV2, readProductWorldResourcesV2,
} from '../context-gateway/world-release-client'
import type {
  ProductProductionSourceOptionsV1,
  ProductProductionSourceSelectionV1,
  ProductWorldSourceSelection,
  WorkspaceScope,
  WorldReferenceV1,
  ProductSourcePlan,
} from '../types'
import type { WorldReferenceV2 } from '../types/world-query'
import type { NarrativePayloadsV1 } from '../types/narrative-ir'
import { resolveScope } from '../workspace/scope'

export interface ProductProductionWorldSourceItemV2 {
  resourceKey: string
  name: string
  description: string
}

export interface ProductProductionWorldSourceCatalogV2 {
  schema: 'storyforge.product-production-world-source-catalog'
  version: 2
  worldReference: WorldReferenceV1 | WorldReferenceV2
  world: { code: string; name: string; workTitle: string }
  release: { id: number; version: number; label: string; contentHash: string; createdAt: number }
  storySources: ProductProductionWorldSourceItemV2[]
  characters: ProductProductionWorldSourceItemV2[]
  relationships: Array<{
    resourceKey: string
    fromCharacterResourceKey: string
    toCharacterResourceKey: string
    relationType: string
    label: string
    description: string
    isBidirectional: boolean
  }>
  locations: ProductProductionWorldSourceItemV2[]
  artifacts: ProductProductionWorldSourceItemV2[]
  loreEntries: ProductProductionWorldSourceItemV2[]
  storyArcs: Array<ProductProductionWorldSourceItemV2 & { type: string }>
  /** Neutral resources are retained only in memory for product compilation. */
  resources: WorldSemanticResourceSnapshotV1[]
}

export interface ProductProductionConsultationSourceV2 {
  schema: 'storyforge.product-production-consultation-index'
  version: 2
  worldReference: WorldReferenceV1 | WorldReferenceV2
  release: { version: number; label: string; contentHash: string }
  opportunities: {
    storySources: ProductProductionSourceOptionsV1['storySources']
    characters: ProductProductionSourceOptionsV1['characters']
    storyArcs: ProductProductionSourceOptionsV1['storyArcs']
    historicalTimelineEvents: ProductProductionSourceOptionsV1['storyArcs']
  }
  selectionOptions: ProductProductionSourceOptionsV1
  selectionRelations: Array<{
    resourceKey: string
    fromCharacterResourceKey: string
    toCharacterResourceKey: string
  }>
  selectionCatalog: ProductProductionSourceSelectionV1
}

type WorldCatalogDescriptorV2 = Awaited<ReturnType<typeof openWorldSemanticResourceCatalogV1>>['resources'][number]

/**
 * Resolve the exact immutable resources consumed by the deterministic product
 * compiler.  Selection remains product-owned; dependency closure is derived
 * only from neutral semantic relations and is shared by the compiler and the
 * Context Gateway evidence path.
 */
export function resolveProductProductionWorldCompilationDescriptorsV2(input: {
  descriptors: readonly WorldCatalogDescriptorV2[]
  selection: Pick<ProductWorldSourceSelection, 'resourceKeys'>
}): WorldCatalogDescriptorV2[] {
  const selectedKeys = new Set(input.selection.resourceKeys)
  if (selectedKeys.size !== input.selection.resourceKeys.length) {
    throw new Error('[product-production-world-source] selection resourceKeys 重复')
  }
  const descriptorByKey = new Map(input.descriptors.map(descriptor => [descriptor.resourceKey, descriptor]))
  if ([...selectedKeys].some(key => !descriptorByKey.has(key))) {
    throw new Error('[product-production-world-source] selection 含冻结世界之外的资源')
  }
  if (input.descriptors.some(descriptor => descriptor.worldSemantic?.narrative)) {
    if (input.descriptors.some(descriptor => descriptor.worldSemantic?.narrative?.resolverVersion !== 'narrative-neutral-closure-v1')) {
      throw new Error('[product-production-world-source] 叙事目录版本混合或不受支持')
    }
    const characters = new Set(input.descriptors.filter(descriptor => selectedKeys.has(descriptor.resourceKey)
      && descriptor.kind === 'character').map(descriptor => descriptor.resourceKey))
    const required = new Set(selectedKeys)
    for (const descriptor of input.descriptors) {
      const endpoints = descriptor.worldSemantic!.narrative!.relationEndpoints
      if (endpoints && endpoints.every(key => characters.has(key))) required.add(descriptor.resourceKey)
    }
    const pending = [...required]
    while (pending.length) {
      if (required.size > 500) throw new Error('[product-production-world-source] 叙事依赖闭包超过 500 项，必须调整选择')
      const descriptor = descriptorByKey.get(pending.pop()!)!
      for (const key of descriptor.worldSemantic!.narrative!.requiredResourceKeys) {
        if (!descriptorByKey.has(key)) throw new Error('[product-production-world-source] 必需叙事依赖不可读，不能静默缩小选择')
        if (!required.has(key)) { required.add(key); pending.push(key) }
      }
    }
    return [...required].sort().map(key => descriptorByKey.get(key)!)
  }
  const selectedCharacterKeys = new Set(input.descriptors
    .filter(descriptor => selectedKeys.has(descriptor.resourceKey)
      && descriptor.worldSemantic!.resourceKind === 'character')
    .map(descriptor => descriptor.resourceKey))
  const relationshipDependencies = input.descriptors.filter(descriptor => {
    if (descriptor.worldSemantic!.resourceKind !== 'character-relation') return false
    const from = descriptor.relations.find(relation => (
      relation.kind === 'depends-on' && relation.direction === 'outgoing'
    ))?.targetResourceKey
    const to = descriptor.relations.find(relation => (
      relation.kind === 'depends-on' && relation.direction === 'incoming'
    ))?.targetResourceKey
    return from != null && to != null
      && selectedCharacterKeys.has(from) && selectedCharacterKeys.has(to)
  })
  const selectedCodexCategoryKeys = new Set(input.descriptors
    .filter(descriptor => selectedKeys.has(descriptor.resourceKey)
      && descriptor.worldSemantic!.resourceKind === 'codex-entry')
    .flatMap(descriptor => descriptor.relations
      .filter(relation => relation.kind === 'same-entity' && relation.direction === 'outgoing')
      .map(relation => relation.targetResourceKey)))
  const codexCategoryDependencies = input.descriptors
    .filter(descriptor => selectedCodexCategoryKeys.has(descriptor.resourceKey))
  const requiredKeys = new Set([
    ...selectedKeys,
    ...relationshipDependencies.map(descriptor => descriptor.resourceKey),
    ...codexCategoryDependencies.map(descriptor => descriptor.resourceKey),
  ])
  return [...requiredKeys]
    .sort()
    .map(resourceKey => descriptorByKey.get(resourceKey)!)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function item(
  snapshot: WorldSemanticResourceSnapshotV1,
): ProductProductionWorldSourceItemV2 {
  return {
    resourceKey: snapshot.descriptor.resourceKey,
    name: snapshot.descriptor.title,
    description: snapshot.descriptor.shortSummary,
  }
}

function kind(
  resources: readonly WorldSemanticResourceSnapshotV1[],
  resourceKind: string,
): WorldSemanticResourceSnapshotV1[] {
  return resources.filter(resource => resource.descriptor.worldSemantic.resourceKind === resourceKind)
}

function descriptorOption(
  descriptor: Awaited<ReturnType<typeof openWorldSemanticResourceCatalogV1>>['resources'][number],
  kindLabel: string | null,
) {
  return {
    resourceKey: descriptor.resourceKey,
    label: descriptor.title,
    summary: descriptor.shortSummary,
    kind: kindLabel,
  }
}

/**
 * Metadata-first consultation index.  It never serializes the whole release
 * into a prompt. Only the few resource kinds whose classification depends on
 * semantic fields are opened, while ordinary options use descriptor metadata.
 */
export async function loadProductProductionConsultationSourceV2(input: {
  scope: WorkspaceScope
  worldReleaseId: number
  productType?: string
}): Promise<ProductProductionConsultationSourceV2> {
  const scope = await resolveScope({ scope: input.scope })
  const opening = { localReleaseRecordId: input.worldReleaseId, expectedProjectId: scope.projectId, expectedWorldId: scope.worldId }
  const opened = input.productType ? await openProductWorldResourceCatalogV2({ ...opening, productType: input.productType })
    : await openWorldSemanticResourceCatalogV1(opening)
  try {
    const narrative = opened.description.worldReference.version === 2
    const descriptors = opened.resources
    const byKind = (resourceKind: string) => descriptors
      .filter(item => narrative ? resourceKind === 'character-relation' ? item.worldSemantic!.resourceKind === 'relation'
        : item.kind === resourceKind : item.worldSemantic!.resourceKind === resourceKind)
    const characters = byKind('character')
    const locations = byKind('location')
    const narrativeStorySources = descriptors.filter(resource => (narrative ? ['event', 'assertion', 'disclosure'] : [
      'story-core', 'outline-node', 'detailed-outline', 'chapter', 'storyline-progress',
    ]).includes(resource.worldSemantic!.resourceKind))
    // A custom start may use a frozen world as its setting foundation even when
    // there is no story core, outline or chapter yet. Keep those resources in
    // the explicit author selection instead of relying on a hidden world-wide
    // fallback during production.
    const foundationSources = descriptors.filter(resource => (narrative ? ['rule'] : [
      'worldview', 'power-system', 'cultivation-system', 'geography', 'history', 'world-rules',
    ]).includes(resource.worldSemantic!.resourceKind))
    const storyArcs = byKind('story-arc')
    const historicalEvents = narrative ? [] : byKind('historical-event')
    const categoryDescriptors = descriptors.filter(resource => (
      resource.worldSemantic!.resourceKind === 'codex-category'
    ))
    const openedCategories = await Promise.all(categoryDescriptors.map(descriptor => (
      readWorldSemanticResourceV1({ scope: opened.scope, descriptor })
    )))
    const artifactCategoryKeys = new Set(openedCategories
      .filter(resource => text(resource.value.builtInKey) === 'artifact')
      .map(resource => resource.descriptor.resourceKey))
    const artifactKeys = new Set(byKind('codex-entry')
      .filter(resource => resource.relations.some(relation => (
        relation.kind === 'same-entity' && relation.direction === 'outgoing'
        && artifactCategoryKeys.has(relation.targetResourceKey)
      )))
      .map(resource => resource.resourceKey))
    const codexDescriptors = new Map(byKind('codex-entry').map(resource => [resource.resourceKey, resource]))
    const artifacts = [...artifactKeys].flatMap(key => {
      const descriptor = codexDescriptors.get(key)
      return descriptor ? [descriptorOption(descriptor, 'artifact')] : []
    })
    // Foundation-only worlds are valid sources too. Offer their immutable
    // semantic descriptors in the existing lore facet, never read live drafts.
    const loreEntries = descriptors.filter(resource => (
      resource.worldSemantic!.area === 'foundation'
      || ((narrative ? resource.kind : resource.worldSemantic!.resourceKind) === 'codex-entry'
        && !artifactKeys.has(resource.resourceKey))
    )).map(resource => descriptorOption(resource, 'lore'))
    const relationships = byKind('character-relation').flatMap(resource => {
      const fromCharacterResourceKey = resource.worldSemantic?.narrative?.relationEndpoints?.[0] ?? resource.relations.find(relation => (
        relation.kind === 'depends-on' && relation.direction === 'outgoing'
      ))?.targetResourceKey
      const toCharacterResourceKey = resource.worldSemantic?.narrative?.relationEndpoints?.[1] ?? resource.relations.find(relation => (
        relation.kind === 'depends-on' && relation.direction === 'incoming'
      ))?.targetResourceKey
      if (!fromCharacterResourceKey || !toCharacterResourceKey) return []
      return [{
        resourceKey: resource.resourceKey,
        fromCharacterResourceKey,
        toCharacterResourceKey,
      }]
    })
    const options: ProductProductionSourceOptionsV1 = {
      storySources: [
        ...narrativeStorySources.map(resource => descriptorOption(resource, 'story-source')),
        ...foundationSources.map(resource => descriptorOption(resource, 'world-foundation')),
      ],
      characters: characters.map(resource => descriptorOption(resource, 'character')),
      importantLocations: locations.map(resource => descriptorOption(resource, 'location')),
      artifacts,
      codexEntries: loreEntries,
      storyArcs: storyArcs.map(resource => descriptorOption(resource, 'story-arc')),
    }
    return {
      schema: 'storyforge.product-production-consultation-index',
      version: 2,
      worldReference: opened.description.worldReference,
      release: {
        version: opened.description.identity.releaseVersion,
        label: opened.description.identity.releaseLabel,
        contentHash: opened.description.identity.releaseHash,
      },
      opportunities: {
        storySources: narrativeStorySources.slice(0, 30)
          .map(resource => descriptorOption(resource, 'story-source')),
        characters: options.characters.slice(0, 30),
        storyArcs: options.storyArcs.slice(0, 30),
        historicalTimelineEvents: historicalEvents.slice(0, 30)
          .map(resource => descriptorOption(resource, 'historical-event')),
      },
      selectionOptions: options,
      selectionRelations: relationships,
      selectionCatalog: {
        storyResourceKeys: options.storySources.map(item => item.resourceKey),
        characterResourceKeys: options.characters.map(item => item.resourceKey),
        importantLocationResourceKeys: options.importantLocations.map(item => item.resourceKey),
        artifactResourceKeys: options.artifacts.map(item => item.resourceKey),
        codexEntryResourceKeys: options.codexEntries.map(item => item.resourceKey),
        storyArcResourceKeys: options.storyArcs.map(item => item.resourceKey),
      },
    }
  } finally { await closeProductWorldResourceCatalogV2(opened) }
}

export async function loadProductProductionWorldSourceCatalogV2(input: {
  scope: WorkspaceScope
  worldReleaseId: number
  /** Exact author-confirmed, product-owned selection. There is deliberately
   * no "read the whole release" fallback: diagnostics and tests must traverse
   * the same consultation -> adapter -> selection boundary as production. */
  selection: ProductWorldSourceSelection
  sourcePlan?: ProductSourcePlan
}): Promise<ProductProductionWorldSourceCatalogV2> {
  const scope = await resolveScope({ scope: input.scope })
  if (input.sourcePlan?.worldReference.version === 2) {
    const opened = await openProductWorldResourceCatalogV2({ localReleaseRecordId: input.worldReleaseId,
      expectedProjectId: scope.projectId, expectedWorldId: scope.worldId,
      productType: input.sourcePlan.productType, sourcePlan: input.sourcePlan })
    try {
      if (input.selection.worldReferenceHash !== opened.description.worldReference.referenceHash) throw new Error('[product-production-world-source] selection 与叙事世界引用不一致')
      const descriptors = resolveProductProductionWorldCompilationDescriptorsV2({ descriptors: opened.resources, selection: input.selection })
      const resources = await readProductWorldResourcesV2({ catalog: opened, descriptors })
      const byContextKind = (kind: string) => resources.filter(resource => resource.descriptor.kind === kind)
      const characters = byContextKind('character')
      const characterKeys = new Set(characters.map(resource => resource.descriptor.resourceKey))
      const relationships = resources.filter(resource => resource.descriptor.worldSemantic.resourceKind === 'relation').map(resource => {
        const endpoints = resource.descriptor.worldSemantic.narrative?.relationEndpoints
        const atom = resource.value.atom as NarrativePayloadsV1['relation']
        if (!endpoints || !atom || typeof atom.relationType !== 'string' || endpoints.some(key => !characterKeys.has(key))) {
          throw new Error('[product-production-world-source] 关系编译缺少冻结端点或完整原子')
        }
        return { resourceKey: resource.descriptor.resourceKey, fromCharacterResourceKey: endpoints[0], toCharacterResourceKey: endpoints[1],
          relationType: atom.relationType, label: resource.descriptor.title, description: resource.descriptor.shortSummary,
          isBidirectional: atom.direction === 'symmetric' }
      })
      return { schema: 'storyforge.product-production-world-source-catalog', version: 2,
        worldReference: opened.description.worldReference,
        world: { code: opened.description.identity.worldCode, name: opened.description.identity.worldName, workTitle: '' },
        release: { id: opened.scope.worldReleaseId, version: opened.description.identity.releaseVersion,
          label: opened.description.identity.releaseLabel, contentHash: opened.description.identity.releaseHash,
          createdAt: opened.description.identity.releasedAt },
        characters: characters.map(item), relationships, locations: byContextKind('location').map(item),
        storySources: resources.filter(resource => ['event', 'assertion', 'disclosure'].includes(resource.descriptor.worldSemantic.resourceKind)).map(item),
        // v4 has no category-as-artifact assertion. Do not invent one from a name.
        artifacts: [], loreEntries: byContextKind('codex-entry').map(item),
        storyArcs: byContextKind('story-arc').map(resource => ({ ...item(resource), type: 'thread' })), resources }
    } finally { await closeProductWorldResourceCatalogV2(opened) }
  }
  const opened = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: input.worldReleaseId,
    expectedProjectId: scope.projectId,
    expectedWorldId: scope.worldId,
  })
  if (input.selection.worldReferenceHash !== opened.description.worldReference.referenceHash) {
    throw new Error('[product-production-world-source] selection 与冻结 WorldReference 不一致')
  }
  const descriptors = resolveProductProductionWorldCompilationDescriptorsV2({
    descriptors: opened.resources,
    selection: input.selection,
  })
  const resources = await readWorldSemanticResourcesV1({
    scope: opened.scope,
    descriptors,
  })
  const characters = kind(resources, 'character').map(item)
  const locations = kind(resources, 'location').map(item)
  const storySources = resources.filter(resource => [
    'story-core', 'outline-node', 'detailed-outline', 'chapter', 'storyline-progress',
  ].includes(resource.descriptor.worldSemantic.resourceKind)).map(item)
  const characterByCoordinate = new Map(kind(resources, 'character').map(resource => [
    resource.descriptor.worldSemantic.resourceCoordinate,
    resource.descriptor.resourceKey,
  ]))
  const codex = kind(resources, 'codex-entry')
  const categoryKinds = new Map(kind(resources, 'codex-category').map(resource => [
    resource.descriptor.worldSemantic.resourceCoordinate,
    text(resource.value.builtInKey),
  ]))
  const artifacts = codex.filter(resource => {
    const category = resource.value._categoryExportId
    return (typeof category === 'number' || typeof category === 'string')
      && categoryKinds.get(String(category)) === 'artifact'
  }).map(item)
  const loreEntries = resources.filter(resource => (
    resource.descriptor.worldSemantic.area === 'foundation'
    || (resource.descriptor.worldSemantic.resourceKind === 'codex-entry'
      && !artifacts.some(artifact => artifact.resourceKey === resource.descriptor.resourceKey))
  )).map(item)
  const relationships = kind(resources, 'character-relation').flatMap(resource => {
    const from = resource.value._fromCharacterIndex
    const to = resource.value._toCharacterIndex
    const fromCharacterResourceKey = characterByCoordinate.get(String(from))
    const toCharacterResourceKey = characterByCoordinate.get(String(to))
    if (!fromCharacterResourceKey || !toCharacterResourceKey) return []
    return [{
      resourceKey: resource.descriptor.resourceKey,
      fromCharacterResourceKey,
      toCharacterResourceKey,
      relationType: text(resource.value.relationType) || 'other',
      label: text(resource.value.label),
      description: text(resource.value.description),
      isBidirectional: resource.value.isBidirectional === true,
    }]
  })
  const storyArcs = kind(resources, 'story-arc').map(resource => ({
    ...item(resource),
    type: text(resource.value.type),
  }))
  return {
    schema: 'storyforge.product-production-world-source-catalog',
    version: 2,
    worldReference: opened.description.worldReference,
    world: {
      code: opened.description.identity.worldCode,
      name: opened.description.identity.worldName,
      workTitle: opened.description.identity.workTitle,
    },
    release: {
      id: opened.description.worldReference.localReleaseRecordId,
      version: opened.description.identity.releaseVersion,
      label: opened.description.identity.releaseLabel,
      contentHash: opened.description.identity.releaseHash,
      createdAt: opened.description.identity.releasedAt,
    },
    storySources, characters,
    relationships,
    locations,
    artifacts,
    loreEntries,
    storyArcs,
    resources,
  }
}
