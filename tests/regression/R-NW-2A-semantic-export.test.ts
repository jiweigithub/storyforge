import { describe, expect, it } from 'vitest'
import { deriveRegisteredSemanticRowsV1 } from '../../src/lib/export/registry-export'
import { captureFrozenNarrativeSourcesV4 } from '../../src/lib/world-engine/narrative-release-v4'
import { WORLD_SEMANTIC_REGISTRY_V4 } from '../../src/lib/world-engine/semantic-registry-v4'
import { canonicalNarrativeJsonV1 } from '../../src/lib/world-engine/narrative-json'
import golden from '../acceptance/narrative-world/worldrelease-v4-content-golden.json'

function fixture(offset = 0) {
  const uid = (table: string, suffix: string) => `res:v1:${WORLD_SEMANTIC_REGISTRY_V4.tables.find(spec => spec.name === table)!.resourceIdentity!.resourceKind}:00000000-0000-4000-8000-${suffix.padStart(12, '0')}`
  const base = (table: string, id: number) => ({ id: id + offset, ragDocumentId: uid(table, String(id)), projectId: 7, worldId: 9 + offset })
  const rows = new Map<string, Record<string, unknown>[]>([
    ['characters', [{ ...base('characters', 31), name: '乙' }, { ...base('characters', 32), name: '甲' }]],
    ['outlineNodes', [{ ...base('outlineNodes', 44), parentId: null, title: '未命名章节', order: 0 }]],
    ['detailedOutlines', [{ ...base('detailedOutlines', 55), outlineNodeId: 44 + offset,
      appearingCharacterIds: JSON.stringify([31 + offset]), foreshadowIds: '[]',
      scenes: [{ summary: '场景正文\r\n𠮷', characterIds: [32 + offset, 31 + offset] }] }]],
    ['worldNodes', [{ ...base('worldNodes', 66), parentId: null, name: '门外',
      portalsJSON: JSON.stringify([{ name: '入口', targetWorldId: 67 + offset, x: 0, y: 0 }]) },
    { ...base('worldNodes', 67), parentId: 66 + offset, name: '门内' }]],
  ])
  return { rows, worldId: 9 + offset, workId: 10 + offset }
}
const capture = (records: Record<string, Record<string, unknown>[]>) => captureFrozenNarrativeSourcesV4({
  worldCode: golden.compiled.manifest.worldCode, semanticSnapshot: golden.compiled.manifest.semanticSnapshot as never,
  selectedTables: Object.keys(records).sort(), records,
})

describe('NW-2A · 注册表派生的限定语义导出', () => {
  it('同一内容换本地编号与行顺序，导出字节不变；嵌套引用按便携坐标闭合', () => {
    const original = fixture(), moved = fixture(1000)
    for (const rows of moved.rows.values()) rows.reverse()
    const a = deriveRegisteredSemanticRowsV1(original).records, b = deriveRegisteredSemanticRowsV1(moved).records
    expect(canonicalNarrativeJsonV1(a)).toBe(canonicalNarrativeJsonV1(b))
    expect(a.detailedOutlines[0]).toMatchObject({ _sceneCharacterIndexes: [[1, 0]], scenes: [{ characterIds: [] }] })
    expect(a.detailedOutlines[0]).not.toHaveProperty('appearingCharacterIds')
    expect(capture(a).rows.get('detailedOutlines')![0]).toMatchObject({ scenes: [{ characterIds: [2, 1] }] })
    expect(JSON.parse(capture(a).rows.get('worldNodes')![0].portalsJSON as string)[0].targetWorldId).toBe(2)
  })

  it('缺少必填/可选目标或 UID 不匹配都拒绝，不能通过丢行或清空引用完成封存', () => {
    for (const alter of [
      (data: ReturnType<typeof fixture>) => { data.rows.get('detailedOutlines')![0].outlineNodeId = null },
      (data: ReturnType<typeof fixture>) => { data.rows.get('characters')![0].importantLocationId = 999 },
      (data: ReturnType<typeof fixture>) => { data.rows.get('characters')![1].ragDocumentId = data.rows.get('characters')![0].ragDocumentId },
      (data: ReturnType<typeof fixture>) => { data.rows.set('productRuntimeEvents', []) },
    ]) {
      const data = fixture(); alter(data)
      expect(() => deriveRegisteredSemanticRowsV1(data)).toThrow()
    }
  })

  it('无效数组、未选入的场景角色和坏通道不能被旧宽松字段解析悄悄丢掉', () => {
    for (const alter of [
      (data: ReturnType<typeof fixture>) => { data.rows.get('detailedOutlines')![0].appearingCharacterIds = '[31,"bad"]' },
      (data: ReturnType<typeof fixture>) => { data.rows.get('detailedOutlines')![0].scenes = [{ characterIds: [999] }] },
      (data: ReturnType<typeof fixture>) => { data.rows.get('worldNodes')![0].portalsJSON = '[{}]' },
      (data: ReturnType<typeof fixture>) => { data.rows.get('worldNodes')![0].portalsJSON = 'broken' },
    ]) {
      const data = fixture(); alter(data)
      expect(() => deriveRegisteredSemanticRowsV1(data)).toThrow()
    }
  })

  it('纯解码也检查嵌套闭包，拒绝多带本地坐标、缺目标或非法场景 shadow', () => {
    const records = deriveRegisteredSemanticRowsV1(fixture()).records
    for (const alter of [
      (rows: typeof records) => { rows.detailedOutlines[0]._sceneCharacterIndexes = [[99]] },
      (rows: typeof records) => { rows.detailedOutlines[0].scenes = [{ characterIds: [31] }] },
      (rows: typeof records) => { rows.detailedOutlines[0]._outlineExportId = null },
      (rows: typeof records) => { rows.worldNodes[0].portalsJSON = '[{"name":"坏门","targetWorldId":99,"x":0,"y":0}]' },
    ]) {
      const changed = structuredClone(records); alter(changed)
      expect(() => capture(changed)).toThrow('release-reference')
    }
  })
})
