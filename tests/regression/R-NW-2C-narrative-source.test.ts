import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedNarrativeRelationReleaseV4 } from '../helpers/narrative-release-fixture'
import { openProductPreparationWorldQueryV1, bindWorldQueryResourcesV1, describeWorldQueryAccessV1,
  closeWorldQueryAccessV1, openAuthorWorldQueryAccessV1 } from '../../src/lib/context-gateway/world-query-client'
import { resolveProductProductionWorldCompilationDescriptorsV2 } from '../../src/lib/product-production/world-source'
import { WORLD_RELEASE_RESOURCE_KINDS_V1 } from '../../src/lib/context-gateway/world-release-provider-contract'
import { createChatDraftV1, selectChatWorldV1, readChatDraftV1 } from '../../src/lib/character-interaction/draft-service'
import { createAvgDraftV1, selectAvgWorldV1, readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { listLocalWorldReferenceChoicesV1, cacheWorldReferenceForProductV1 } from '../../src/lib/world-engine/reference-cache'
import { createWorldReference } from '../../src/lib/world-engine/world-reference-v2'

describe('NW-2C · v4 neutral product source closure', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('the two product selectors cache verified immutable v4 bytes without copying the live world or widening legacy selectors', async () => {
    const seeded = await seedNarrativeRelationReleaseV4({ explicitEntityEvidence: true })
    expect(await listLocalWorldReferenceChoicesV1()).toHaveLength(0)
    const sourceRef = await createWorldReference(seeded.release.id!)
    for (const productType of ['character-interaction', 'avg'] as const) {
      const consumer = productType === 'avg' ? await createAvgDraftV1('叙事 AVG') : await createChatDraftV1('叙事聊天')
      const choices = await listLocalWorldReferenceChoicesV1({ narrativeProductType: productType })
      expect(choices.find(item => item.id === seeded.release.id)?.narrative).toBe(true)
      await expect(cacheWorldReferenceForProductV1(consumer.scope, seeded.release.id!)).rejects.toThrow()
      const select = productType === 'avg' ? selectAvgWorldV1 : selectChatWorldV1
      const draft = await (productType === 'avg' ? readAvgDraftV1 : readChatDraftV1)(consumer.scope)
      const row = await select(consumer.scope, draft.revision, seeded.release.id!)
      const frozen = (await db.worldReleases.get(row.worldReleaseId!))!
      expect(frozen.manifestJson).toBe(seeded.release.manifestJson)
      expect(frozen.projectId).toBe(consumer.scope.projectId)
      expect(await db.characters.where('projectId').equals(consumer.scope.projectId).count()).toBe(0)
      expect(await createWorldReference(frozen.id!)).toEqual({ ...sourceRef, localReleaseRecordId: frozen.id })
      const access = await openProductPreparationWorldQueryV1({ scope: consumer.scope,
        localReleaseRecordId: frozen.id!, productType })
      expect((await (await bindWorldQueryResourcesV1(access)).listMetadata({ scope: access.scope, limit: 100 })).items).toHaveLength(3)
      await closeWorldQueryAccessV1(access)
    }
  })

  it('two selected characters include their declared relation, and the same closure retains every exact original under narrowing', async () => {
    const fixture = await seedNarrativeRelationReleaseV4({ explicitEntityEvidence: true })
    const access = await openProductPreparationWorldQueryV1({ scope: fixture.scope,
      localReleaseRecordId: fixture.release.id!, productType: 'character-interaction' })
    expect(access).toMatchObject({ purpose: 'product-preparation', sourcePlanHash: null,
      capabilities: { coverage: null, timeChoices: null } })
    expect((await describeWorldQueryAccessV1(access)).identity.releaseHash).toBe(fixture.release.contentHash)
    const provider = await bindWorldQueryResourcesV1(access)
    const descriptors = (await provider.listMetadata({ scope: access.scope, limit: 100 })).items
    const characters = descriptors.filter(item => item.kind === 'character')
    const closure = resolveProductProductionWorldCompilationDescriptorsV2({ descriptors,
      selection: { resourceKeys: characters.map(item => item.resourceKey) } })
    expect(closure).toHaveLength(3)
    const relation = closure.find(item => item.worldSemantic?.resourceKind === 'relation')!
    expect(relation.sourceRefs).toHaveLength(3)
    expect(relation.worldSemantic?.narrative?.requiredResourceKeys).toEqual(characters.map(item => item.resourceKey).sort())
    await expect(provider.readOriginal!({ scope: access.scope, resourceKey: relation.resourceKey,
      sourceRef: relation.sourceRefs[0], maxTokens: 100000 })).rejects.toThrow('产品定向目录')
    const author = await openAuthorWorldQueryAccessV1({ scope: fixture.scope, localReleaseRecordId: fixture.release.id!,
      view: 'canon', perspective: { kind: 'author' }, knowledgeThrough: null, disclosedThrough: null })
    const narrowed = await bindWorldQueryResourcesV1(author, { allowedResourceKeys: closure.map(item => item.resourceKey),
      allowedKinds: WORLD_RELEASE_RESOURCE_KINDS_V1, maxTokens: 100000 })
    for (const descriptor of closure) {
      const bytes = await Promise.all(descriptor.sourceRefs.map(sourceRef => narrowed.readOriginal!({ scope: access.scope,
        resourceKey: descriptor.resourceKey, sourceRef, maxTokens: 100000 })))
      expect(bytes.every(read => read.descriptor.contentHash === descriptor.contentHash)).toBe(true)
      expect(bytes.reduce((sum, read) => sum + read.tokenCount, 0)).toBeLessThanOrEqual(descriptor.tokenEstimate.original!)
    }
    await closeWorldQueryAccessV1(access)
    await expect(describeWorldQueryAccessV1(access)).rejects.toThrow('access-unavailable')
  })

  it('a selected relation cannot lose a required entity or silently mix a legacy resolver', async () => {
    const fixture = await seedNarrativeRelationReleaseV4({ explicitEntityEvidence: true })
    const access = await openProductPreparationWorldQueryV1({ scope: fixture.scope,
      localReleaseRecordId: fixture.release.id!, productType: 'avg' })
    const provider = await bindWorldQueryResourcesV1(access)
    const descriptors = (await provider.listMetadata({ scope: access.scope, limit: 100 })).items
    const relation = descriptors.find(item => item.worldSemantic?.resourceKind === 'relation')!
    const selection = { resourceKeys: [relation.resourceKey] }
    expect(resolveProductProductionWorldCompilationDescriptorsV2({ descriptors, selection })).toHaveLength(3)
    expect(() => resolveProductProductionWorldCompilationDescriptorsV2({ descriptors: [relation], selection })).toThrow('必需叙事依赖不可读')
    const mixed = structuredClone(descriptors)
    delete mixed[0].worldSemantic!.narrative
    expect(() => resolveProductProductionWorldCompilationDescriptorsV2({ descriptors: mixed, selection })).toThrow('版本混合')
    await expect(openProductPreparationWorldQueryV1({ scope: { ...fixture.scope, productRuntimeSessionId: 1 },
      localReleaseRecordId: fixture.release.id!, productType: 'avg' })).rejects.toThrow('运行期')
  })
})
