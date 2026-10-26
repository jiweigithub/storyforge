import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedNarrativeReleaseV4 } from '../helpers/narrative-release-fixture'
import { seedConfirmedNarrativeDomainV1 } from '../helpers/narrative-domain-fixture'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { verifyWorldReleaseRecordV1 } from '../../src/lib/world-engine/release-codec'
import { listWorldReferenceCatalogV1 } from '../../src/lib/world-engine/world-reference'
import { CONTEXT_SOURCES } from '../../src/lib/registry/context-sources'
import { openAuthorWorldQueryAccessV1, openProductPreparationWorldQueryV1, authorWorldQueryV1, queryWorldReleaseV1, bindWorldQueryResourcesV1, closeWorldQueryAccessV1 } from '../../src/lib/context-gateway/world-query-client'
import { createContextGatewayToolSessionV1 } from '../../src/lib/context-gateway/tool-session'
import { CONTEXT_GATEWAY_READ_TOOLS_V1 } from '../../src/lib/agent/context-gateway-tools'
import { WORLD_RELEASE_RESOURCE_KINDS_V1 } from '../../src/lib/context-gateway/world-release-provider-contract'
import { assertContextResourceDescriptorV1 } from '../../src/lib/context-gateway/contracts'
import { portableWorldReferenceV2, validatePortableWorldReferenceV2 } from '../../src/lib/world-engine/world-reference-v2'
import { createCachedContextResourceProviderV1 } from '../../src/lib/context-gateway/provider-cache'
import type { ContextAccessPolicyV1 } from '../../src/lib/registry/types'
import type { WorldQueryAccessV1 } from '../../src/lib/types/world-query'

describe('NW-2B · registered v4 provider and Gateway capability', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.useRealTimers() })
  async function setup() {
    const source = await seedNarrativeReleaseV4()
    const input = { scope: source.scope, localReleaseRecordId: source.release.id!, view: 'canon' as const,
      perspective: { kind: 'author' as const }, knowledgeThrough: null, disclosedThrough: null }
    const access = await openAuthorWorldQueryAccessV1(input), provider = await bindWorldQueryResourcesV1(access)
    const first = await provider.listMetadata({ scope: access.scope, limit: 20 })
    return { ...source, input, access, provider, first, item: first.items[0] }
  }

  it('verifies a real release, returns truthful support/coverage and exact original field bytes', async () => {
    const { access, provider, item } = await setup()
    expect(access.capabilities).toMatchObject({ embeddingsRequired: false, simulation: false, coverage: { projectedAtoms: 1 } })
    assertContextResourceDescriptorV1({ descriptor: item, source: CONTEXT_SOURCES.find(source => source.key === 'worldRelease')! })
    const read = await provider.read({ scope: access.scope, resourceKey: item.resourceKey, depth: 'full', maxTokens: 10000 })
    expect(read.content).toContain('守渡人')
    const original = await provider.readOriginal({ scope: access.scope, resourceKey: item.resourceKey, sourceRef: read.sourceRefs[0], maxTokens: 1000 })
    expect(original.content).toBe('守渡人')
    const result = await queryWorldReleaseV1(access, { ...authorWorldQueryV1(access), text: '守渡人' })
    expect(result.items).toHaveLength(1)
    const portable = await portableWorldReferenceV2(access.reference)
    expect(portable.referenceHash).toBe(access.reference.referenceHash)
    expect(portable.localReleaseRecordId).toBe(0)
    expect(await validatePortableWorldReferenceV2(portable)).toEqual(portable)
  })

  for (const view of ['development', 'author-plan'] as const) it(`${view} registered provider reads shared original bytes without exposing the other view`, async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000)
    const fixture = await seedConfirmedNarrativeDomainV1()
    const arc = (await db.storyArcs.where('projectId').equals(fixture.scope.projectId).toArray())[0]
    const proof = await fixture.selfEvidence('chapters', fixture.ids.chapter, 'content', 'shared-story')
    const pending = { ...fixture.development, owners: [], members: [], transitions: [],
      developmentType: 'commitment' as const, state: 'blocked' as const }
    const fulfilled = { ...pending, semanticSubKey: 'sub:v1:00000000-0000-4000-8000-000000000003',
      statement: '测试用已兑现承诺', state: 'fulfilled' as const, narrativeModalityV1: 'established' as const,
      resolutionEvidenceKeys: ['shared-story'] }
    await fixture.confirm('storyArcs', arc.id!, { narrativeDevelopmentsV1: [pending, fulfilled],
      narrativeEvidenceV1: [{ ...proof, source: { chapterId: fixture.ids.chapter, sourceUid: fixture.chapter.ragDocumentId! } }] })
    const revision = await createWorldRevision({ scope: fixture.scope, formatVersion: 4, includeWorkSources: true, label: '共用原文的 provider 回归' })
    const release = await publishWorldRevision(revision.id!)
    const input = { scope: fixture.scope, localReleaseRecordId: release.id!,
      perspective: { kind: 'author' as const }, knowledgeThrough: null, disclosedThrough: null }
    const access = await openAuthorWorldQueryAccessV1({ ...input, view })
    const provider = await bindWorldQueryResourcesV1(access)
    const rows = (await provider.listMetadata({ scope: access.scope, limit: 100 })).items
    const item = rows.find(row => row.worldSemantic?.resourceKind === 'development'
      && row.title === (view === 'development' ? '承诺 · 已兑现' : '承诺 · 受阻'))!
    expect(item).toBeDefined()
    const otherAccess = await openAuthorWorldQueryAccessV1({ ...input, view: view === 'development' ? 'author-plan' : 'development' })
    const otherProvider = await bindWorldQueryResourcesV1(otherAccess)
    const other = (await otherProvider.listMetadata({ scope: otherAccess.scope, limit: 100 })).items
      .find(row => row.worldSemantic?.resourceKind === 'development'
        && row.title === (view === 'development' ? '承诺 · 受阻' : '承诺 · 已兑现'))!
    expect(rows.map(row => row.resourceKey)).not.toContain(other.resourceKey)
    expect(item.worldSemantic!.narrative!.requiredResourceKeys).not.toContain(other.resourceKey)
    expect(JSON.stringify(item)).not.toContain(other.worldSemantic!.resourceCoordinate)
    const originals = await Promise.all(item.sourceRefs.map(sourceRef => provider.readOriginal({ scope: access.scope,
      resourceKey: item.resourceKey, sourceRef, maxTokens: 10000 })))
    expect(originals.map(original => original.content)).toContain(fixture.chapter.content)
    const full = await provider.read({ scope: access.scope, resourceKey: item.resourceKey, depth: 'full', maxTokens: 10000 })
    expect(full.content).not.toContain(other.worldSemantic!.resourceCoordinate)
    await expect(provider.read({ scope: access.scope, resourceKey: other.resourceKey, depth: 'full', maxTokens: 10000 }))
      .rejects.toThrow('access-unavailable')
    // An explicit allow-list is still an authorization boundary. Keeping only
    // the hit cannot authorize other consumers of the same source bytes.
    const narrowed = await bindWorldQueryResourcesV1(access, { allowedResourceKeys: [item.resourceKey],
      allowedKinds: WORLD_RELEASE_RESOURCE_KINDS_V1, maxTokens: 10000 })
    await expect(narrowed.readOriginal({ scope: access.scope, resourceKey: item.resourceKey,
      sourceRef: item.sourceRefs[0], maxTokens: 10000 })).rejects.toThrow()
    const production = await openProductPreparationWorldQueryV1({ scope: fixture.scope,
      localReleaseRecordId: release.id!, productType: 'avg' })
    const productProvider = await bindWorldQueryResourcesV1(production)
    await expect(productProvider.readOriginal({ scope: production.scope, resourceKey: item.resourceKey,
      sourceRef: item.sourceRefs[0], maxTokens: 10000 })).rejects.toThrow()
    expect((await db.worldReleases.get(release.id!))!.manifestJson).toBe(release.manifestJson)
  })

  it('copied or closed capabilities and foreign scopes are rejected even if metadata/hash fields match', async () => {
    const { access, provider, item } = await setup()
    await expect(bindWorldQueryResourcesV1(structuredClone(access))).rejects.toThrow('access-unavailable')
    await expect(provider.read({ scope: { ...access.scope, projectId: access.scope.projectId + 999 }, resourceKey: item.resourceKey, depth: 'full', maxTokens: 10000 })).rejects.toThrow('access-unavailable')
    await closeWorldQueryAccessV1(access)
    await expect(provider.listMetadata({ scope: access.scope, limit: 20 })).rejects.toThrow('access-unavailable')
  })

  it('never treats a client requested author perspective or runtime session as author authorization', async () => {
    const { input, access, item } = await setup()
    const character = await openAuthorWorldQueryAccessV1({ ...input, view: 'character',
      perspective: { kind: 'character', characterKey: item.worldSemantic!.resourceCoordinate }, knowledgeThrough: { kind: 'unknown', label: null } })
    expect(character.capabilities.coverage).toBeNull()
    await expect(queryWorldReleaseV1(character, authorWorldQueryV1(access))).rejects.toThrow('access-unavailable')
    await expect(openAuthorWorldQueryAccessV1({ ...input, scope: { ...input.scope, productRuntimeSessionId: 1 } })).rejects.toThrow('运行期')
    await expect(openAuthorWorldQueryAccessV1({ ...input, view: 'character', perspective: { kind: 'character', characterKey: 'invented' },
      knowledgeThrough: { kind: 'unknown', label: null } })).rejects.toThrow('access-unavailable')
  })

  it('existing Gateway tools read bound resources, issue original capabilities, and reject privilege arguments', async () => {
    const { access, item } = await setup()
    const policy: ContextAccessPolicyV1 = { version: 'context-access-policy-v1', policyId: 'nw2b-test',
      mandatorySourceKeys: ['worldRelease'], allowedSourceKeys: ['worldRelease'], allowedResourceKinds: [...WORLD_RELEASE_RESOURCE_KINDS_V1],
      allowedDepths: ['index', 'summary', 'focused', 'full', 'original'], selectorPolicyId: 'nw2b-test',
      maxReadCalls: 8, maxRetrievedTokens: 100000, allowOriginalRead: true, candidateAccess: 'forbidden' }
    const session = await createContextGatewayToolSessionV1({ scope: access.scope, policy, worldQueryAccess: access })
    expect(session.scopeFingerprint).toBe(access.scopeFingerprint)
    const context = { projectId: access.scope.projectId, contextGatewaySession: session }
    const readTool = CONTEXT_GATEWAY_READ_TOOLS_V1.find(tool => tool.name === 'read_context_resource')!
    const read = await readTool.execute(context, { resourceKey: item.resourceKey, depth: 'full', maxTokens: 10000 })
    expect(read.ok, read.error).toBe(true)
    const originalTool = CONTEXT_GATEWAY_READ_TOOLS_V1.find(tool => tool.name === 'read_original_evidence')!
    const original = await originalTool.execute(context, { sourceRef: read.meta.gateway!.sourceRefCapabilities[0], maxTokens: 1000 })
    expect(original.ok, original.error).toBe(true)
    expect(original.content).toContain('守渡人')
    const forged = await readTool.execute(context, { resourceKey: item.resourceKey, depth: 'full', maxTokens: 10000, perspective: 'author' })
    expect(forged.ok).toBe(false)
    expect(session.usage.readCalls).toBe(2)
    expect(original.meta.gateway?.operation).toBe('original')
  })

  it('cached author results cannot replace a narrowed character projection', async () => {
    const { input, access, provider, item } = await setup()
    const cachedAuthor = createCachedContextResourceProviderV1(provider)
    const authorPage = await cachedAuthor.listMetadata({ scope: access.scope, limit: 20 })
    const character = await openAuthorWorldQueryAccessV1({ ...input, view: 'character',
      perspective: { kind: 'character', characterKey: item.worldSemantic!.resourceCoordinate }, knowledgeThrough: { kind: 'unknown', label: null } })
    const cachedCharacter = createCachedContextResourceProviderV1(await bindWorldQueryResourcesV1(character))
    const characterPage = await cachedCharacter.listMetadata({ scope: character.scope, limit: 20 })
    expect(characterPage.scopeFingerprint).not.toBe(authorPage.scopeFingerprint)
    expect(characterPage.items[0].policyHash).not.toBe(authorPage.items[0].policyHash)
    expect(characterPage.items[0].availableDepths).not.toContain('original')
    expect(authorPage.items[0].availableDepths).toContain('original')
    await closeWorldQueryAccessV1(access)
    await expect(cachedAuthor.listMetadata({ scope: access.scope, limit: 20 })).rejects.toThrow('access-unavailable')
  })

  it('tampered or deleted frozen bytes invalidate an existing grant; no current-draft fallback is used', async () => {
    const { access, provider, release, item } = await setup()
    await db.worldReleases.update(release.id!, { manifestJson: `${release.manifestJson} ` })
    await expect(provider.read({ scope: access.scope, resourceKey: item.resourceKey, depth: 'full', maxTokens: 10000 })).rejects.toThrow('stale')
    await expect(queryWorldReleaseV1(access, authorWorldQueryV1(access))).rejects.toThrow('stale')
  })

  it('legacy time requests are explicitly unsupported and a frozen request cannot increase its budget', async () => {
    const { access, provider } = await setup()
    await expect(provider.searchMetadata({ scope: access.scope, query: '守渡', limit: 20, timeRange: { start: '1' } })).rejects.toThrow('unsupported')
    await expect(queryWorldReleaseV1(access, { ...authorWorldQueryV1(access), budget: { maxTokens: 100001, maxRecords: 1, maxEvidenceBytes: 0 } })).rejects.toThrow('range')
    const fake: WorldQueryAccessV1 = { ...access, perspective: { kind: 'author' } }
    await expect(queryWorldReleaseV1(fake, authorWorldQueryV1(fake))).rejects.toThrow('access-unavailable')
  })

  it('a real v4 seal preserves the Work-owned belief/proposition closure before character queries', async () => {
    // The immutable corpus uses creation dates in 2027; confirmation must not
    // precede creation. The other domain fixture tests use this same clock.
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000)
    const fixture = await seedConfirmedNarrativeDomainV1()
    const revision = await createWorldRevision({ scope: fixture.scope, formatVersion: 4, includeWorkSources: true, label: '完整领域夹具' })
    const release = await publishWorldRevision(revision.id!)
    const verified = await verifyWorldReleaseRecordV1(release)
    if (verified.version !== 4) throw Error('fixture requires v4')
    const belief = verified.manifest.narrative.bundle.records.find(record => record.kind === 'epistemic-event')
    expect(belief, JSON.stringify(verified.manifest.narrative.coverage.gaps)).toBeDefined()
    const legacy = await listWorldReferenceCatalogV1(fixture.scope)
    expect(legacy.map(item => item.reference.localReleaseRecordId)).toContain(fixture.release.id)
    expect(legacy.map(item => item.reference.localReleaseRecordId)).not.toContain(release.id)
    const access = await openAuthorWorldQueryAccessV1({ scope: fixture.scope, localReleaseRecordId: release.id!,
      view: 'canon', perspective: { kind: 'author' }, knowledgeThrough: null, disclosedThrough: null })
    const provider = await bindWorldQueryResourcesV1(access)
    const relation = (await provider.listMetadata({ scope: access.scope, limit: 100 })).items.find(item => item.worldSemantic?.resourceKind === 'relation')!
    expect(relation).toBeDefined()
    const narrowed = await bindWorldQueryResourcesV1(access, { allowedResourceKeys: [relation.resourceKey],
      allowedKinds: WORLD_RELEASE_RESOURCE_KINDS_V1, maxTokens: 10000 })
    expect((await narrowed.listMetadata({ scope: access.scope, limit: 100 })).items).toEqual([])
    await expect(narrowed.read({ scope: access.scope, resourceKey: relation.resourceKey, depth: 'full', maxTokens: 10000 })).rejects.toThrow('access-unavailable')
  })

  it('keeps native SHA-256 resource identities and dependency keys across reopened author views', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000)
    const fixture = await seedConfirmedNarrativeDomainV1()
    const revision = await createWorldRevision({ scope: fixture.scope, formatVersion: 4, includeWorkSources: true, label: '资源身份兼容' })
    const release = await publishWorldRevision(revision.id!)
    const verified = await verifyWorldReleaseRecordV1(release)
    if (verified.version !== 4) throw Error('fixture requires v4')
    const nativeKeys = new Map(verified.manifest.narrative.bundle.records.map(record => [record.semanticId,
      `world-narrative:${createHash('sha256').update(`${release.releaseUid}\n${record.semanticId}`, 'utf8').digest('hex')}`]))
    const nativeSet = new Set(nativeKeys.values())
    let observed = 0
    for (const view of ['canon', 'development', 'author-plan'] as const) {
      const input = { scope: fixture.scope, localReleaseRecordId: release.id!, view,
        perspective: { kind: 'author' as const }, knowledgeThrough: null, disclosedThrough: null }
      const first = await openAuthorWorldQueryAccessV1(input)
      const provider = await bindWorldQueryResourcesV1(first)
      const items = (await provider.listMetadata({ scope: first.scope, limit: 100 })).items
      for (const item of items) {
        expect(item.resourceKey).toBe(nativeKeys.get(item.worldSemantic!.resourceCoordinate))
        for (const dependency of item.worldSemantic!.narrative!.requiredResourceKeys) expect(nativeSet.has(dependency)).toBe(true)
      }
      closeWorldQueryAccessV1(first)
      const second = await openAuthorWorldQueryAccessV1(input)
      const reopened = await bindWorldQueryResourcesV1(second)
      expect((await reopened.listMetadata({ scope: second.scope, limit: 100 })).items.map(item => item.resourceKey))
        .toEqual(items.map(item => item.resourceKey))
      closeWorldQueryAccessV1(second)
      observed += items.length
    }
    expect(observed).toBeGreaterThan(1)
  })
})
