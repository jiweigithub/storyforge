import { describe, expect, it } from 'vitest'
import { parseNarrativeDomainFieldV1, parseNarrativeDomainSourceRefV1 } from '../../src/lib/narrative-domain/codec'
import { portableNarrativeDomainFieldJsonV1, remapNarrativeDomainFieldV1, replaceNarrativeDomainReferenceV1 } from '../../src/lib/narrative-domain/references'
import type { NarrativeDomainEventV1, NarrativeDomainDevelopmentV1 } from '../../src/lib/types/narrative-domain'

const uid = (kind: string, suffix: number) => `res:v1:${kind}:00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`
const character = { characterId: 31, sourceUid: uid('character', 1) }
const location = { locationId: 72, sourceUid: uid('location', 2) }
const fact = { kind: 'assertion' as const, source: { factId: 93, sourceUid: uid('temporal-fact', 3) }, subKey: 'root' }
const event = (): NarrativeDomainEventV1 => ({
  eventType: 'communication', participants: [{ entity: character, role: 'sender' }], locations: [location],
  propositions: [fact], effects: [], communication: { sender: character, recipients: [character], channel: '谣言' },
  observer: null, before: [],
})
const sub = (index: number): NarrativeDomainDevelopmentV1 => ({
  semanticSubKey: `sub:v1:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  statement: '决定在未来归还信件。', developmentType: 'commitment', owners: [character], members: [fact],
  state: 'open', transitions: [], resolutionEvidenceKeys: [], narrativeModalityV1: 'intent',
  narrativeVisibilityV1: { class: 'author-only', audienceKeys: [], policyVersion: '1' },
})

describe('NW-1B · 领域注释的严格合同与分类型引用', () => {
  it('一次便携往返同时重映射角色、地点、命题及嵌套通信来源，保留原注释', () => {
    const original = event()
    const exported = remapNarrativeDomainFieldV1('narrativeEventV1', original, 'export', new Map([
      ['characters', new Map([[31, 0]])], ['importantLocations', new Map([[72, 4]])], ['temporalFacts', new Map([[93, 2]])],
    ])) as NarrativeDomainEventV1
    expect(exported.participants[0]!.entity).toEqual({ ...character, characterId: 0 })
    expect(exported.locations[0]).toEqual({ ...location, locationId: 4 })
    expect(exported.propositions[0]!.source).toEqual({ ...fact.source, factId: 2 })
    const restored = remapNarrativeDomainFieldV1('narrativeEventV1', exported, 'import', new Map([
      ['characters', new Map([[0, 131]])], ['importantLocations', new Map([[4, 172]])], ['temporalFacts', new Map([[2, 193]])],
    ])) as NarrativeDomainEventV1
    expect(restored.communication!.sender).toEqual({ ...character, characterId: 131 })
    expect(restored.communication!.recipients).toEqual([{ ...character, characterId: 131 }])
    expect(portableNarrativeDomainFieldJsonV1('narrativeEventV1', restored)).toBe(portableNarrativeDomainFieldJsonV1('narrativeEventV1', original))
    expect(original).toEqual(event())
  })

  it('导出已删除来源保留 UID 墓碑；导入未映射非空坐标拒绝，不能照搬旧 ID', () => {
    const exported = remapNarrativeDomainFieldV1('narrativeEventV1', event(), 'export', new Map()) as NarrativeDomainEventV1
    expect(exported.propositions[0]!.source).toEqual({ factId: null, sourceUid: fact.source.sourceUid })
    expect(remapNarrativeDomainFieldV1('narrativeEventV1', exported, 'import', new Map())).toEqual(exported)
    expect(() => remapNarrativeDomainFieldV1('narrativeEventV1', event(), 'import', new Map())).toThrow('便携坐标无法解析')
  })

  it('显式合并同时改 FK/UID 并使旧确认内容 hash 输入变化，删除则保留失效证据', () => {
    const original = event()
    const merged = replaceNarrativeDomainReferenceV1({ field: 'narrativeEventV1', value: original,
      table: 'characters', fromId: 31, fromUid: character.sourceUid, replacement: { id: 45, sourceUid: uid('character', 4) } })
    expect(merged.changed).toBe(true)
    expect(portableNarrativeDomainFieldJsonV1('narrativeEventV1', merged.value)).not.toBe(portableNarrativeDomainFieldJsonV1('narrativeEventV1', original))
    const removed = replaceNarrativeDomainReferenceV1({ field: 'narrativeEventV1', value: original,
      table: 'characters', fromId: 31, fromUid: character.sourceUid, replacement: null })
    expect((removed.value as NarrativeDomainEventV1).communication!.sender).toEqual({ characterId: null, sourceUid: character.sourceUid })
    expect(() => replaceNarrativeDomainReferenceV1({ field: 'narrativeEventV1', value: original,
      table: 'characters', fromId: 31, fromUid: uid('character', 9), replacement: null })).toThrow('FK 与保留的 UID 不一致')
  })

  it.each([
    { characterId: 1, sourceUid: uid('location', 1) },
    { characterId: 1, locationId: 2, sourceUid: uid('character', 1) },
    { type: 'character', id: 1, sourceUid: uid('character', 1) },
    { characterId: 0, sourceUid: uid('character', 1) },
    { characterId: Number.MAX_SAFE_INTEGER + 1, sourceUid: uid('character', 1) },
    { characterId: 1, sourceUid: uid('character', 1), authority: 'author-confirmed' },
  ])('拒绝未登记、歧义、不安全或伪装授权的来源引用：%j', invalid => {
    expect(() => parseNarrativeDomainSourceRefV1(invalid)).toThrow()
  })

  it('同一子记录重排仍保留 UID，重复 UID 和数组序号身份都拒绝', () => {
    const items = [sub(1), sub(2)]
    const parsed = parseNarrativeDomainFieldV1('narrativeDevelopmentsV1', items.reverse())
    expect(parsed.map(item => item.semanticSubKey)).toEqual([sub(2).semanticSubKey, sub(1).semanticSubKey])
    expect(() => parseNarrativeDomainFieldV1('narrativeDevelopmentsV1', [sub(1), sub(1)])).toThrow('重复身份')
    expect(() => parseNarrativeDomainFieldV1('narrativeDevelopmentsV1', [{ ...sub(1), semanticSubKey: '0' }])).toThrow('子记录 UID')
  })

  it('拒绝把物理角色当命题、缺修订目标的纠正和混入任意 JSON 的事件', () => {
    expect(() => parseNarrativeDomainFieldV1('narrativeEventV1', { ...event(), propositions: [{ ...fact, source: character }] })).toThrow('FK 目标不支持')
    expect(() => parseNarrativeDomainFieldV1('narrativeEpistemicV1', { attitude: 'know', transition: 'revise',
      assertedValue: { kind: 'text', value: '真相' }, sourceEvent: null, revises: null })).toThrow('修订结构不闭合')
    expect(() => parseNarrativeDomainFieldV1('narrativeEventV1', { ...event(), custom: { sourceUid: character.sourceUid, characterId: 31 } })).toThrow('额外字段')
  })

  it('未知时间、开放区间、已知终点不能互换；原有四轴独立保存', () => {
    const unknown = { kind: 'unknown', label: '某年春天' }
    const time = { occurred: { start: unknown, end: null, endMeaning: 'unknown' }, valid: null,
      narratedAt: { chapter: { chapterId: 21, sourceUid: uid('chapter', 9) }, spanStart: 3 }, disclosedAt: [], acquiredAt: unknown }
    expect(parseNarrativeDomainFieldV1('narrativeTimeV1', time)).toEqual(time)
    expect(() => parseNarrativeDomainFieldV1('narrativeTimeV1', { ...time, occurred: { ...time.occurred, endMeaning: 'known' } })).toThrow('终点含义不一致')
    expect(() => parseNarrativeDomainFieldV1('narrativeTimeV1', { ...time, occurred: { ...time.occurred, end: unknown, endMeaning: 'open' } })).toThrow('终点含义不一致')
  })
})
