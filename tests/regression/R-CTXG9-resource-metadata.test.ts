import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lookupContextResourceMetadataV1 } from '../../src/lib/context-gateway/resource-metadata'
import { describeWorldSemanticResourceV1, openWorldSemanticResourceCatalogV1 } from '../../src/lib/context-gateway/world-release-client'
import { inspectContextGatewayManifestFreshnessV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { createContextGatewayToolSessionV1 } from '../../src/lib/context-gateway/tool-session'
import { WORLD_RELEASE_RESOURCE_PROVIDER_V1 } from '../../src/lib/context-gateway/world-release-provider'
import { WORLD_RELEASE_RESOURCE_KINDS_V1 } from '../../src/lib/context-gateway/world-release-provider-contract'
import type { ContextResourceDescriptorV1, ContextResourceProviderV1, ResourcePageV1 } from '../../src/lib/registry/types'
import { db } from '../../src/lib/db/schema'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

const scope = { projectId: 1 }
function descriptor(key: string) { return { resourceKey: key } as ContextResourceDescriptorV1 }
function provider(pages: ResourcePageV1[]) {
  return {
    fingerprint: vi.fn(async () => 'frozen'),
    listMetadata: vi.fn(async ({ cursor }) => structuredClone(pages[cursor ? Number(cursor) : 0])),
    read: vi.fn(async () => { throw Error('body read forbidden') }),
    readOriginal: vi.fn(async () => { throw Error('original read forbidden') }),
    assertAccessCurrent: vi.fn(async () => {}),
  } as unknown as ContextResourceProviderV1
}
function page(keys: string[], nextCursor: string | null = null): ResourcePageV1 {
  return { version: 1, items: keys.map(descriptor), nextCursor, scopeFingerprint: 'frozen' }
}

describe('NW · metadata checks are independent of body-read budgets', () => {
  it('finds exact identities across pages and returns only requested descriptors without reading content', async () => {
    const source = provider([page(['near:1', 'exact:1'], '1'), page(['exact:10', 'exact:2'])])
    const result = await lookupContextResourceMetadataV1({ provider: source, scope, resourceKeys: ['exact:1', 'exact:2', 'missing:1'] })
    expect([...result.keys()]).toEqual(['exact:1', 'exact:2'])
    expect(source.listMetadata).toHaveBeenCalledTimes(2)
    expect(source.read).not.toHaveBeenCalled(); expect(source.readOriginal).not.toHaveBeenCalled()
  })

  it('rejects repeating cursors instead of hanging or reporting missing records', async () => {
    const source = provider([page([], '1'), page([], '1')])
    await expect(lookupContextResourceMetadataV1({ provider: source, scope, resourceKeys: ['missing'] })).rejects.toThrow('context-metadata:cursor')
  })

  it('rejects duplicate exact identities on separate pages', async () => {
    const source = provider([page(['a'], '1'), page(['a'])])
    await expect(lookupContextResourceMetadataV1({ provider: source, scope, resourceKeys: ['a', 'missing'] })).rejects.toThrow('context-metadata:duplicate')
  })

  it('rejects a page from a different scope', async () => {
    const source = provider([{ ...page(['a']), scopeFingerprint: 'other' }])
    await expect(lookupContextResourceMetadataV1({ provider: source, scope, resourceKeys: ['a'] })).rejects.toThrow('context-metadata:scope')
  })

  it('rejects revocation after metadata loading', async () => {
    const source = provider([page(['a'])])
    vi.mocked(source.assertAccessCurrent!).mockRejectedValue(Error('revoked'))
    await expect(lookupContextResourceMetadataV1({ provider: source, scope, resourceKeys: ['a'] })).rejects.toThrow('revoked')
  })

  it('rejects a fingerprint change before returning descriptors', async () => {
    const source = provider([page(['a'])])
    vi.mocked(source.fingerprint).mockResolvedValueOnce('frozen').mockResolvedValueOnce('changed')
    await expect(lookupContextResourceMetadataV1({ provider: source, scope, resourceKeys: ['a'] })).rejects.toThrow('context-metadata:scope')
  })
})

describe('NW · frozen legacy resource descriptors and candidate freshness', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('describes and rechecks a legacy resource even when a one-token content read is refused', async () => {
    const fixture = await seedCurrentProductWorld('元数据预算隔离')
    const catalog = await openWorldSemanticResourceCatalogV1({ localReleaseRecordId: fixture.release.id!, expectedProjectId: fixture.scope.projectId })
    const selected = catalog.resources.find(item => item.worldSemantic?.resourceKind === 'character')!
    await expect(WORLD_RELEASE_RESOURCE_PROVIDER_V1.read({ scope: catalog.scope, resourceKey: selected.resourceKey, depth: 'index', maxTokens: 1 }))
      .rejects.toThrow('world-release-provider:budget')
    const read = vi.spyOn(WORLD_RELEASE_RESOURCE_PROVIDER_V1, 'read')
    const before = await db.worldReleases.get(fixture.release.id!)
    expect(await describeWorldSemanticResourceV1({ scope: catalog.scope, resourceKey: selected.resourceKey })).toEqual(selected)
    const session = await createContextGatewayToolSessionV1({ scope: catalog.scope, policy: {
      version: 'context-access-policy-v1', policyId: 'metadata-check', mandatorySourceKeys: ['worldRelease'], allowedSourceKeys: ['worldRelease'],
      allowedResourceKinds: [...WORLD_RELEASE_RESOURCE_KINDS_V1], allowedDepths: ['index', 'summary', 'focused', 'full', 'original'],
      selectorPolicyId: 'metadata-check', maxReadCalls: 16, maxRetrievedTokens: 100000, allowOriginalRead: true, candidateAccess: 'forbidden',
    } })
    const manifest = { manifestHash: 'a'.repeat(64), gateway: { scopeFingerprint: session.scopeFingerprint, policyHash: session.policyHash,
      retrievalTrace: { mandatory: [{ resourceKey: selected.resourceKey, sourceKey: 'worldRelease', contentHash: selected.contentHash,
        revision: selected.contentRevision, policyHash: selected.policyHash, policyRevision: selected.policyRevision, sourceRefs: selected.sourceRefs }],
      autoSelected: [], agentReads: [] } } } as Parameters<typeof inspectContextGatewayManifestFreshnessV1>[0]['manifest']
    expect((await inspectContextGatewayManifestFreshnessV1({ manifest, session })).resources[0].status).toBe('fresh')
    expect(read).not.toHaveBeenCalled()
    expect(await db.worldReleases.get(fixture.release.id!)).toEqual(before)
    await expect(describeWorldSemanticResourceV1({ scope: catalog.scope, resourceKey: 'world-release:character:missing' })).rejects.toThrow('不可用')
    const foreignScope = { ...catalog.scope, projectId: catalog.scope.projectId + 1 }
    await expect(describeWorldSemanticResourceV1({ scope: foreignScope, resourceKey: selected.resourceKey })).rejects.toThrow()
    await db.worldReleases.delete(fixture.release.id!)
    expect((await inspectContextGatewayManifestFreshnessV1({ manifest, session })).status).toBe('stale')
  })
})
