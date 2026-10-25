import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { confirmNarrativeDomainAnnotationsV1 } from '../../src/lib/world-engine/narrative-domain-authoring'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'

export async function seedNarrativeReleaseV4() {
  const created = await createWorkspace({ name: '索引缓存隔离测试', genres: [], status: 'drafting', description: '',
    targetWordCount: 1000, enableMultiWorld: false }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const { scope } = created, now = Date.now()
  const actorId = await db.characters.add(stampNewRecord(scope, 'characters', { name: '守渡人', shortDescription: '铜铃在手',
    roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', background: '', personality: '', createdAt: now, updatedAt: now }, { owner: 'world' }))
  const capture = await captureNarrativeDomainV1({ scope, owner: { kind: 'world', worldCode: created.world.code, sourceWorkCode: null } })
  const actor = capture.rows.get('characters')!.find(row => row.id === actorId)!
  await confirmNarrativeDomainAnnotationsV1({ scope, table: 'characters', recordId: actorId,
    expectedSourceHash: await hashNarrativeDomainSourceV1(capture, 'characters', actor),
    annotations: { narrativeVisibilityV1: { class: 'public', audienceKeys: [], policyVersion: 'cache-test-v1' } } })
  const input = { scope, formatVersion: 4 as const, selectedTables: ['characters'], label: '缓存原件' }
  const revision = await createWorldRevision(input), release = await publishWorldRevision(revision.id!)
  return { ...created, actorId, revision, release, input, request: { projectId: scope.projectId, worldId: scope.worldId, releaseId: release.id! } }
}

/** A small declared relation with three independent, exact evidence sources.
 * The corpus's same-name and historical-state adversaries remain separate. */
export async function seedNarrativeRelationReleaseV4(options: { explicitEntityEvidence?: boolean } = {}) {
  const seeded = await seedNarrativeReleaseV4(), { scope } = seeded, now = Date.now()
  const secondActorId = await db.characters.add(stampNewRecord(scope, 'characters', { name: '修桥人', shortDescription: '在桥边等候',
    roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral', background: '', personality: '', createdAt: now, updatedAt: now }, { owner: 'world' }))
  const description = '守渡人与修桥人约定共同修好木桥。'
  const relationId = await db.characterRelations.add(stampNewRecord(scope, 'characterRelations', {
    fromCharacterId: seeded.actorId, toCharacterId: secondActorId, relationType: 'ally', label: '修桥同盟', description,
    isBidirectional: true, createdAt: now, updatedAt: now,
  }, { owner: 'world' }))
  const owner = { kind: 'world' as const, worldCode: seeded.world.code, sourceWorkCode: null }
  const visibility = { class: 'public' as const, audienceKeys: [], policyVersion: 'relation-fixture-v1' }
  const annotations: Array<readonly ['characters' | 'characterRelations', number]> = [
    ...(options.explicitEntityEvidence ? [['characters', seeded.actorId] as const] : []),
    ['characters', secondActorId], ['characterRelations', relationId],
  ]
  for (const [table, recordId] of annotations) {
    const capture = await captureNarrativeDomainV1({ scope, owner })
    const row = capture.rows.get(table)!.find(item => item.id === recordId)!
    const sourceHash = await sha256Text(description)
    const name = String(row.name ?? ''), nameHash = await sha256Text(name)
    await confirmNarrativeDomainAnnotationsV1({ scope, table, recordId,
      expectedSourceHash: await hashNarrativeDomainSourceV1(capture, table, row),
      annotations: { narrativeVisibilityV1: visibility, ...(table === 'characterRelations' ? {
        narrativeRelationV1: { causeEvent: null }, narrativeEvidenceV1: [{ evidenceKey: 'relation-description', source: { self: true as const },
          fieldPointer: '/description', sourceContentHash: sourceHash, start: 0, end: new TextEncoder().encode(description).length,
          normalizationVersion: 'raw-utf8-v1' as const, spanHash: sourceHash, supportRole: 'supports' as const }],
      } : options.explicitEntityEvidence ? {
        narrativeEvidenceV1: [{ evidenceKey: 'public-name', source: { self: true as const }, fieldPointer: '/name',
          sourceContentHash: nameHash, start: 0, end: new TextEncoder().encode(name).length,
          normalizationVersion: 'raw-utf8-v1' as const, spanHash: nameHash, supportRole: 'supports' as const }],
      } : {}) } })
  }
  const revision = await createWorldRevision({ scope, formatVersion: 4, selectedTables: ['characters', 'characterRelations'], label: '多段关系原文' })
  const release = await publishWorldRevision(revision.id!)
  return { ...seeded, secondActorId, relationId, revision, release }
}
