import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { projectNarrativeDomainsV1 } from '../../src/lib/world-engine/narrative-domain-projection'
import { verifyNarrativeIRBundleV1 } from '../../src/lib/world-engine/narrative-ir'
import { NARRATIVE_KINDS_V1 } from '../../src/lib/types/narrative-ir'
import { seedConfirmedNarrativeDomainV1 } from '../helpers/narrative-domain-fixture'
import corpus from '../acceptance/narrative-world/corpus-v1.json'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { narrativeDevelopmentStatementPointerV1, readNarrativeDomainEvidenceTextV1 } from '../../src/lib/world-engine/narrative-domain-evidence'
import { hashNarrativeBytesV1 } from '../../src/lib/world-engine/narrative-json'
import { compareNarrativeTimeV1 } from '../../src/lib/world-engine/narrative-time'
import { CANON_RESOURCE_PROVIDER_V1, canonRowResourceKeysV1 } from '../../src/lib/context-gateway/canon-provider'

describe('NW-1B · 作者领域数据到八类 IR', () => {
  beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000); await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.useRealTimers() })

  it('真实确认路径投影八种原子；误信、真相、作者计划和读者揭示保持独立', async () => {
    const source = await seedConfirmedNarrativeDomainV1()
    const projection = await projectNarrativeDomainsV1(source.input)
    const { bundle, coverage } = projection
    expect([...new Set(bundle.records.map(record => record.kind))].sort()).toEqual([...NARRATIVE_KINDS_V1].sort())
    expect(await verifyNarrativeIRBundleV1(bundle, projection.sources)).toEqual(bundle)
    const belief = bundle.records.find(record => record.kind === 'epistemic-event')!
    expect(belief.payload).toMatchObject({ attitude: 'believe', transition: 'acquire', assertedValue: { kind: 'text', value: corpus.families[0]!.seed.belief } })
    const truth = bundle.records.find(record => record.kind === 'assertion' && record.payload.predicateKey === 'knows')!
    expect(truth.payload).toMatchObject({ value: { kind: 'text', value: corpus.families[0]!.seed.truth } })
    const plan = bundle.records.find(record => record.kind === 'development')!
    expect(plan).toMatchObject({ modality: 'intent', visibility: { class: 'author-only' }, payload: { state: 'open' }, time: { occurred: null } })
    expect(bundle.records.find(record => record.kind === 'disclosure')!.payload).toMatchObject({ audienceKeys: ['reader'] })
    expect(new Set([...coverage.projectedSourceKeys, ...coverage.explicitlyUnsupportedSourceKeys])).toEqual(new Set(coverage.eligibleSelected))
    expect(coverage.projectedSourceKeys.some(key => coverage.explicitlyUnsupportedSourceKeys.includes(key))).toBe(false)
    expect(coverage.gaps.some(gap => gap.code === 'review-required')).toBe(true)
    expect(coverage.excluded.some(gap => gap.code === 'not-confirmed')).toBe(true)
    expect((await db.worldReleases.get(source.release.id!))!.manifestJson).toBe(source.release.manifestJson)
    expect((await projectNarrativeDomainsV1(source.input)).bundle.semanticRootHash).toBe(bundle.semanticRootHash)
  })

  it('superseded 保留历史有效区间；事件发生、角色获知和叙述顺序不混用', async () => {
    const source = await seedConfirmedNarrativeDomainV1()
    const { bundle } = await projectNarrativeDomainsV1(source.input)
    const historical = bundle.records.find(record => record.kind === 'assertion' && record.reviewState === 'historical')!
    const current = bundle.records.find(record => record.kind === 'assertion' && record.payload.supersedesRefs.length)!
    expect(historical.time).toMatchObject({ occurred: null, valid: { start: { value: '0' }, end: { value: '1' } }, acquiredAt: null })
    expect(current.payload).toMatchObject({ supersedesRefs: [{ semanticId: historical.semanticId, revisionHash: historical.revisionHash }] })
    expect(bundle.records.find(record => record.kind === 'event')!.time).toMatchObject({ occurred: { start: { value: '1' } }, acquiredAt: null })
    expect(bundle.records.find(record => record.kind === 'epistemic-event')!.time).toMatchObject({ occurred: null, acquiredAt: { value: '2' } })
  })

  it('删除/改动一项来源只阻断依赖闭包，不使旧确认或无关记录一起生效', async () => {
    const source = await seedConfirmedNarrativeDomainV1()
    const first = await projectNarrativeDomainsV1(source.input)
    const unaffected = first.bundle.records.find(record => record.kind === 'entity' && record.payload.entityType === 'world-group')!
    await db.characters.update(source.ids.a, { name: '改名后未复核' })
    const second = await projectNarrativeDomainsV1(source.input)
    expect(second.coverage.gaps.some(gap => gap.code === 'stale')).toBe(true)
    expect(second.coverage.gaps.some(gap => gap.code === 'dependency-gap')).toBe(true)
    expect(second.bundle.records.find(record => record.semanticId === unaffected.semanticId)!.revisionHash).toBe(unaffected.revisionHash)
    expect(second.bundle.records.some(record => record.kind === 'epistemic-event' || record.kind === 'event')).toBe(false)
    expect(second.sources.some(item => item.text === '改名后未复核')).toBe(false)
    expect((await db.worldReleases.get(source.release.id!))!.contentHash).toBe(source.release.contentHash)
  })

  it('planned 伏笔即使人工标注 resolved，也不能无证据变成已兑现', async () => {
    const source = await seedConfirmedNarrativeDomainV1()
    await source.confirm('foreshadows', source.foreshadow.id!, { narrativeDevelopmentsV1: [{
      ...source.development, state: 'resolved', narrativeModalityV1: 'established',
    }] })
    const { bundle, coverage } = await projectNarrativeDomainsV1(source.input)
    expect(bundle.records.some(record => record.kind === 'development')).toBe(false)
    expect(coverage.gaps.some(gap => gap.code === 'development-evidence')).toBe(true)
  })

  it('未选入的依赖不能暗中补读，正文修改后旧揭示需要重新确认', async () => {
    const source = await seedConfirmedNarrativeDomainV1()
    const full = await projectNarrativeDomainsV1(source.input)
    const actorName = (await db.characters.get(source.ids.a))!.name
    const entity = full.bundle.records.find(record => record.kind === 'entity' && record.payload.canonicalLabel === actorName)!
    const selectedSourceKeys = full.coverage.eligibleSelected.filter(key => key !== entity.provenance.sourceResourceKey)
    const partial = await projectNarrativeDomainsV1({ ...source.input, selectedSourceKeys })
    expect(partial.bundle.records.some(record => record.kind === 'event')).toBe(false)
    expect(partial.coverage.gaps.some(gap => gap.code === 'dependency-gap')).toBe(true)
    await db.chapters.update(source.ids.chapter, { content: '作者修改了揭示正文。' })
    const changed = await projectNarrativeDomainsV1(source.input)
    expect(changed.bundle.records.some(record => record.kind === 'disclosure')).toBe(false)
    expect(changed.coverage.gaps.some(gap => gap.code === 'stale')).toBe(true)
  })

  it('公开标签不能把私有来源、角色或下游揭示洗成公开内容', async () => {
    const source = await seedConfirmedNarrativeDomainV1()
    await source.confirm('characters', source.ids.a, { narrativeVisibilityV1: {
      class: 'author-only', audienceKeys: [], policyVersion: 'author-private-v1',
    } })
    const { bundle } = await projectNarrativeDomainsV1(source.input)
    for (const record of bundle.records.filter(record => ['event', 'relation', 'epistemic-event', 'disclosure'].includes(record.kind))) {
      expect(record.visibility.class).toBe('author-only')
    }
    expect(bundle.records.find(record => record.kind === 'rule')!.visibility.class).toBe('public')
  })

  it('历史年份/录入时间不会自行变成发生时间，缺失 event 注释保留明确缺口', async () => {
    const source = await seedConfirmedNarrativeDomainV1()
    const id = await db.historicalTimelineEvents.add(stampNewRecord(source.scope, 'historicalTimelineEvents', {
      projectId: source.scope.projectId, title: '记年有误的旧记录', description: '原文只说发生在很久以前', year: 100,
      date: '纪年不详', era: 'custom', isHistorical: false, order: 0, createdAt: 1_800_000_000_000, updatedAt: 1_800_000_000_000,
    } as never, { owner: 'world' })) as number
    await source.confirm('historicalTimelineEvents', id, { narrativeVisibilityV1: { class: 'public', audienceKeys: [], policyVersion: 'author-v1' } })
    const partial = await projectNarrativeDomainsV1(source.input)
    expect(partial.coverage.gaps.some(gap => gap.table === 'historicalTimelineEvents' && gap.code === 'event-metadata')).toBe(true)
    await source.confirm('historicalTimelineEvents', id, { narrativeEventV1: {
      eventType: 'action', participants: [], locations: [], propositions: [], effects: [], communication: null, observer: null, before: [],
    } })
    const projected = await projectNarrativeDomainsV1(source.input)
    const event = projected.bundle.records.find(record => record.provenance.sourceResourceKey.includes('res:v1:historical-event:'))!
    expect(event.kind).toBe('event')
    expect(event.time.occurred).toBeNull()
  })

  it('关系原因和认知来源不能指向未来计划事件；规范章序失效仅使揭示不可用', async () => {
    const source = await seedConfirmedNarrativeDomainV1()
    await source.confirm('storyTimelineEvents', source.event.id, { narrativeModalityV1: 'intent',
      narrativeVisibilityV1: { class: 'author-only', audienceKeys: [], policyVersion: 'author-v1' } })
    const result = await projectNarrativeDomainsV1(source.input)
    expect(result.bundle.records.some(record => record.kind === 'relation' || record.kind === 'epistemic-event')).toBe(false)
    expect(result.coverage.gaps.some(gap => gap.code === 'dependency-state')).toBe(true)
    expect(result.bundle.records.find(record => record.kind === 'event')!.modality).toBe('intent')
    await db.chapters.update(source.ids.chapter, { outlineNodeId: 99999 })
    const incomplete = await projectNarrativeDomainsV1(source.input)
    expect(incomplete.bundle.records.some(record => record.kind === 'disclosure')).toBe(false)
    expect(incomplete.bundle.records.some(record => record.kind === 'entity')).toBe(true)
  })

  it('原子指向的外部原文改变后，原子及其原文不会混入有效闭包', async () => {
    const source = await seedConfirmedNarrativeDomainV1()
    const evidence = await source.selfEvidence('chapters', source.ids.chapter, 'content')
    const chapter = (await db.chapters.get(source.ids.chapter))!
    await source.confirm('storyTimelineEvents', source.event.id, { narrativeEvidenceV1: [{ ...evidence,
      source: { chapterId: source.ids.chapter, sourceUid: chapter.ragDocumentId! },
    }] })
    const before = await projectNarrativeDomainsV1(source.input)
    await db.chapters.update(source.ids.chapter, { content: chapter.content.replace(/./u, '新') })
    const after = await projectNarrativeDomainsV1(source.input)
    expect(after.coverage.gaps.some(gap => gap.code === 'evidence-hash')).toBe(true)
    expect(after.bundle.records.some(record => record.kind === 'event')).toBe(false)
    expect(after.sources.some(item => item.sourceResourceKey.endsWith(chapter.ragDocumentId!))).toBe(false)
    expect(after.bundle.scope.revisionVectorHash).not.toBe(before.bundle.scope.revisionVectorHash)
  })

  it('发展原文使用持久子记录键；重排不换身份或 hash，未标注正文仍进入覆盖分母', async () => {
    const source = await seedConfirmedNarrativeDomainV1()
    const second = { ...source.development, semanticSubKey: 'sub:v1:00000000-0000-4000-8000-000000000003', statement: '另一个独立计划。' }
    await source.confirm('foreshadows', source.foreshadow.id!, { narrativeDevelopmentsV1: [source.development, second] })
    const first = await projectNarrativeDomainsV1(source.input)
    const records = first.bundle.records.filter(record => record.kind === 'development')
    expect(records).toHaveLength(2)
    for (const item of [source.development, second]) {
      const pointer = narrativeDevelopmentStatementPointerV1(item.semanticSubKey)
      const record = records.find(record => record.provenance.sourceField === pointer)!
      expect(first.sources.find(text => text.fieldPointer === pointer)?.text).toBe(item.statement)
      expect(record.provenance.sourceContentHash).toBe(await hashNarrativeBytesV1(item.statement))
    }
    await db.foreshadows.update(source.foreshadow.id!, { narrativeDevelopmentsV1: [second, source.development] })
    const reordered = await projectNarrativeDomainsV1(source.input)
    expect(reordered.bundle.semanticRootHash).toBe(first.bundle.semanticRootHash)
    expect(() => readNarrativeDomainEvidenceTextV1('foreshadows', { narrativeDevelopmentsV1: [second] }, '/narrativeDevelopmentsV1/0/statement'))
      .toThrow('子记录不存在')
    const unannotated = first.coverage.sourceSpans.find(span => span.fieldPointer === '/content'
      && first.coverage.explicitlyUnsupportedSourceKeys.includes(span.sourceKey))!
    expect(unannotated.byteLength).toBeGreaterThan(0)
    expect(unannotated.covered).toEqual([])
    expect(unannotated.uncovered).toEqual([{ start: 0, end: unannotated.byteLength }])
  })

  it('时制与事件锚点也是依赖：私有时制不能派生公开时间，未选择时制不得暗中补齐', async () => {
    const source = await seedConfirmedNarrativeDomainV1()
    await source.confirm('worldGroups', source.group.id, { narrativeVisibilityV1: {
      class: 'author-only', audienceKeys: [], policyVersion: 'secret-calendar-v1',
    } })
    const result = await projectNarrativeDomainsV1(source.input)
    const group = result.bundle.records.find(record => record.kind === 'entity' && record.payload.entityType === 'world-group')!
    const event = result.bundle.records.find(record => record.kind === 'event')!
    expect(event.dependencies).toContainEqual({ semanticId: group.semanticId, revisionHash: group.revisionHash, role: 'requires' })
    expect(event.visibility.class).toBe('author-only')
    const omitted = await projectNarrativeDomainsV1({ ...source.input,
      selectedSourceKeys: result.coverage.eligibleSelected.filter(key => key !== group.provenance.sourceResourceKey) })
    expect(omitted.bundle.records.some(record => record.kind === 'event')).toBe(false)
    expect(omitted.bundle.timeContext.timelines).toEqual([])

    const id = await db.storyTimelineEvents.add(stampNewRecord(source.scope, 'storyTimelineEvents', {
      projectId: source.scope.projectId, title: '后来发生', description: '明确发生在传递消息之后，未提供具体日期。',
      importance: 1, order: 1, createdAt: 1_800_000_000_000,
    } as never, { owner: 'work' })) as number
    await source.confirm('storyTimelineEvents', id, {
      narrativeVisibilityV1: { class: 'public', audienceKeys: [], policyVersion: 'author-v1' },
      narrativeEventV1: { eventType: 'action', participants: [], locations: [], propositions: [], effects: [], communication: null, observer: null, before: [] },
      narrativeTimeV1: { occurred: { start: { kind: 'event-anchor', event: source.eventRef, side: 'after' }, end: null, endMeaning: 'unknown' },
        valid: null, narratedAt: null, disclosedAt: [], acquiredAt: null },
    })
    const anchored = await projectNarrativeDomainsV1(source.input)
    const relative = anchored.bundle.records.find(record => record.kind === 'event' && record.time.occurred?.start.kind === 'event-anchor')!
    expect(relative.visibility.class).toBe('author-only')
    expect(relative.dependencies).toContainEqual(expect.objectContaining({ semanticId: event.semanticId, role: 'requires' }))
    expect(anchored.bundle.timeContext.anchors.find(anchor => anchor.eventKey === relative.semanticId)?.value).toBeNull()
    expect(anchored.bundle.timeContext.before).toContainEqual({ beforeEventKey: event.semanticId, afterEventKey: relative.semanticId })
  })

  it('公开摘要引用私有子记录原文时继承限制，外部原文策略变化也改变输入版本', async () => {
    const source = await seedConfirmedNarrativeDomainV1()
    const fieldPointer = narrativeDevelopmentStatementPointerV1(source.development.semanticSubKey)
    const text = source.development.statement, hash = await hashNarrativeBytesV1(text)
    await source.confirm('foreshadows', source.foreshadow.id!, { narrativeVisibilityV1: { class: 'public', audienceKeys: [], policyVersion: 'parent-v1' } })
    await source.confirm('characters', source.ids.b, { narrativeEvidenceV1: [{ evidenceKey: 'plan-text',
      source: { foreshadowId: source.foreshadow.id!, sourceUid: source.foreshadow.ragDocumentId! }, fieldPointer,
      sourceContentHash: hash, start: 0, end: new TextEncoder().encode(text).length,
      normalizationVersion: 'raw-utf8-v1', spanHash: hash, supportRole: 'context',
    }] })
    const full = await projectNarrativeDomainsV1(source.input)
    const selectedSourceKeys = full.coverage.eligibleSelected.filter(key => !key.endsWith(source.foreshadow.ragDocumentId!))
    const first = await projectNarrativeDomainsV1({ ...source.input, selectedSourceKeys })
    const actor = (await db.characters.get(source.ids.b))!
    expect(first.bundle.records.find(record => record.provenance.sourceResourceKey.endsWith(actor.ragDocumentId!))?.visibility.class).toBe('author-only')
    await source.confirm('foreshadows', source.foreshadow.id!, { narrativeDevelopmentsV1: [{ ...source.development,
      narrativeVisibilityV1: { class: 'restricted', audienceKeys: ['reader'], policyVersion: 'changed-policy-v1' },
    }] })
    const second = await projectNarrativeDomainsV1({ ...source.input, selectedSourceKeys })
    expect(second.bundle.records.find(record => record.provenance.sourceResourceKey.endsWith(actor.ragDocumentId!))?.visibility.class).toBe('restricted')
    expect(second.bundle.scope.revisionVectorHash).not.toBe(first.bundle.scope.revisionVectorHash)
  })

  it('地点、词条、故事线及进度沿注册源投影；所属子世界是显式依赖', async () => {
    const source = await seedConfirmedNarrativeDomainV1()
    const now = 1_800_000_000_000
    const locationId = await db.importantLocations.add(stampNewRecord(source.scope, 'importantLocations', {
      name: '原始驿站', description: '一个地点', type: 'town', parentId: null, order: 0, createdAt: now, updatedAt: now,
    } as never, { owner: 'world' })) as number
    const codexId = await db.codexEntries.add(stampNewRecord(source.scope, 'codexEntries', {
      name: '投递准则', content: '原始准则', categoryId: null, order: 0, worldGroupId: source.group.id, createdAt: now, updatedAt: now,
    } as never, { owner: 'world' })) as number
    const arc = (await db.storyArcs.where('projectId').equals(source.scope.projectId).toArray())[0]!
    const progressId = await db.storylineProgress.add(stampNewRecord(source.scope, 'storylineProgress', {
      arcId: arc.id!, currentStageId: null, progressNote: '', status: 'active', createdAt: now, updatedAt: now,
    } as never, { owner: 'work' })) as number
    const metadata = { narrativeVisibilityV1: { class: 'public' as const, audienceKeys: [], policyVersion: 'author-v1' } }
    await source.confirm('importantLocations', locationId, metadata)
    await source.confirm('codexEntries', codexId, metadata)
    await db.characters.update(source.ids.a, { homeWorldGroupId: source.group.id })
    await source.confirm('characters', source.ids.a, metadata)
    await source.confirm('storyArcs', arc.id!, { narrativeDevelopmentsV1: [{ ...source.development, developmentType: 'thread' }] })
    await source.confirm('storylineProgress', progressId, { narrativeDevelopmentsV1: [{ ...source.development,
      developmentType: 'goal', statement: '独立进度陈述，不依赖空的旧 progressNote。' }] })
    const result = await projectNarrativeDomainsV1(source.input)
    const location = result.bundle.records.find(record => record.kind === 'entity' && record.payload.entityType === 'location')!
    const codex = result.bundle.records.find(record => record.kind === 'entity' && record.payload.entityType === 'codex-entry')!
    const group = result.bundle.records.find(record => record.kind === 'entity' && record.payload.entityType === 'world-group')!
    expect(location.dependencies).toEqual([])
    expect(result.sourceGroups.find(item => item.semanticId === location.semanticId)?.worldGroupSourceUid).toBeNull()
    expect(codex.dependencies).toContainEqual({ semanticId: group.semanticId, revisionHash: group.revisionHash, role: 'requires' })
    expect(result.sourceGroups.find(item => item.semanticId === codex.semanticId)?.worldGroupSourceUid).toBe(source.group.row.ragDocumentId)
    expect(result.bundle.records.filter(record => record.kind === 'entity' && record.payload.entityType === 'character')
      .some(record => record.dependencies.some(dependency => dependency.semanticId === group.semanticId))).toBe(true)
    for (const kind of ['story-arc', 'storyline-progress']) expect(result.bundle.records.some(record =>
      record.kind === 'development' && record.provenance.sourceResourceKey.includes(`res:v1:${kind}:`))).toBe(true)
  })

  it('两个子世界只按有证据的显式方向映射时制，目标世界限制也被继承', async () => {
    const source = await seedConfirmedNarrativeDomainV1(), now = 1_800_000_000_000
    const secondId = await db.worldGroups.add(stampNewRecord(source.scope, 'worldGroups', {
      name: '潮汐世界', description: '潮汐纪年从十日开始', type: 'parallel', order: 1, createdAt: now, updatedAt: now,
    } as never, { owner: 'world' })) as number
    const second = (await db.worldGroups.get(secondId))!
    await source.confirm('worldGroups', secondId, { narrativeVisibilityV1: {
      class: 'author-only', audienceKeys: [], policyVersion: 'second-world-v1',
    }, narrativeChronologyV1: { timelines: [{ timelineKey: 'tide-days', calendar: '潮汐历', unit: 'day', epoch: '初潮' }], mappings: [] } })
    const proof = await source.selfEvidence('worldGroups', source.group.id, 'description', 'clock-link')
    await source.confirm('worldGroups', source.group.id, { narrativeEvidenceV1: [proof], narrativeChronologyV1: {
      timelines: [{ timelineKey: 'postal-days', calendar: '驿站历', unit: 'day', epoch: '建站日' }], mappings: [{
        mappingKey: 'post-to-tide', targetWorldGroup: { worldGroupId: secondId, sourceUid: second.ragDocumentId! },
        fromTimelineKey: 'postal-days', toTimelineKey: 'tide-days', fromStart: '0', fromEnd: '5',
        numerator: '1', denominator: '1', offset: '10', evidenceKeys: ['clock-link'],
      }],
    } })
    const result = await projectNarrativeDomainsV1(source.input)
    expect(result.bundle.timeContext.mappings).toHaveLength(1)
    const sourcePoint = { kind: 'tick' as const, timelineKey: 'postal-days', value: '1' }
    const targetPoint = { kind: 'tick' as const, timelineKey: 'tide-days', value: '11' }
    expect(compareNarrativeTimeV1(sourcePoint, targetPoint, result.bundle.timeContext)).toBe('equal')
    expect(compareNarrativeTimeV1(targetPoint, sourcePoint, result.bundle.timeContext)).toBe('incomparable-time')
    expect(result.bundle.records.find(record => record.kind === 'event')!.visibility.class).toBe('author-only')
    const external = await source.selfEvidence('chapters', source.ids.chapter, 'content', 'clock-link')
    await source.confirm('worldGroups', source.group.id, { narrativeEvidenceV1: [{ ...external,
      source: { chapterId: source.ids.chapter, sourceUid: source.chapter.ragDocumentId! },
    }] })
    await db.chapters.update(source.ids.chapter, { content: source.chapter.content + ' ' })
    const changed = await projectNarrativeDomainsV1(source.input)
    expect(changed.bundle.timeContext.mappings).toEqual([])
    expect(changed.coverage.gaps.some(gap => gap.table === 'worldGroups' && gap.code === 'evidence-hash')).toBe(true)
    expect(changed.bundle.records.some(record => record.kind === 'entity' && record.payload.entityType === 'character')).toBe(true)
  })

  it('另一 Work 的坏注释不使本 Work 不可读；本 Work 越界引用仍明确失效', async () => {
    const source = await seedConfirmedNarrativeDomainV1()
    const first = await projectNarrativeDomainsV1(source.input)
    await db.chapters.update(source.foreignChapterId, { narrativeDisclosuresV1: [{ semanticSubKey: 'invalid' }] } as never)
    expect((await projectNarrativeDomainsV1(source.input)).bundle.semanticRootHash).toBe(first.bundle.semanticRootHash)
    const foreign = (await db.chapters.get(source.foreignChapterId))!
    await expect(source.confirm('storyTimelineEvents', source.event.id, { narrativeTimeV1: {
      occurred: null, valid: null, acquiredAt: null, disclosedAt: [],
      narratedAt: { chapter: { chapterId: foreign.id!, sourceUid: foreign.ragDocumentId! }, spanStart: 0 },
    } })).rejects.toThrow('不在选定作用域')
    expect((await projectNarrativeDomainsV1(source.input)).bundle.semanticRootHash).toBe(first.bundle.semanticRootHash)
  })

  it('通用 causes 边也不能把未来计划变成已发生原因', async () => {
    const source = await seedConfirmedNarrativeDomainV1()
    await source.confirm('storyTimelineEvents', source.event.id, { narrativeModalityV1: 'intent',
      narrativeVisibilityV1: { class: 'author-only', audienceKeys: [], policyVersion: 'author-v1' } })
    await source.confirm('temporalFacts', source.ids.fact, {
      narrativeEvidenceV1: [await source.selfEvidence('temporalFacts', source.ids.fact, 'value')],
      narrativeDependenciesV1: [{ target: source.eventRef, role: 'causes', evidenceKeys: ['self'] }],
    })
    const projected = await projectNarrativeDomainsV1(source.input)
    expect(projected.coverage.gaps.some(gap => gap.table === 'temporalFacts' && gap.code === 'dependency-state')).toBe(true)
    expect(projected.bundle.records.some(record => record.kind === 'assertion' && record.payload.predicateKey === 'knows')).toBe(false)
  })

  it('既有通用 Canon 读取不因新增可写字段而旁路读取叙事注释或系统回执', async () => {
    const source = await seedConfirmedNarrativeDomainV1()
    await source.confirm('characters', source.ids.a, { narrativeAliasesV1: ['NW-PRIVATE-ANNOTATION'] })
    await source.confirm('foreshadows', source.foreshadow.id!, { narrativeDevelopmentsV1: [{
      ...source.development, statement: 'NW-PRIVATE-ANNOTATION',
    }] })
    const scope = { ...source.scope, worldGroupId: null }
    for (const [table, id] of [['characters', source.ids.a], ['foreshadows', source.foreshadow.id!]] as const) {
      const row = await db.table(table).get(id), keys = await canonRowResourceKeysV1(table, row)
      expect(Object.keys(keys.fields).some(field => field.startsWith('narrative'))).toBe(false)
      const read = await CANON_RESOURCE_PROVIDER_V1.read({ scope, resourceKey: keys.record!, depth: 'full', maxTokens: 10000 })
      expect(read.content).not.toContain('NW-PRIVATE-ANNOTATION')
      expect(read.sourceRefs.some(ref => ref.field.startsWith('narrative'))).toBe(false)
      await expect(CANON_RESOURCE_PROVIDER_V1.read({ scope, resourceKey: `${keys.record!}:field:narrativeAuthorityV1`, depth: 'full', maxTokens: 1000 }))
        .rejects.toThrow()
    }
  })
})
