import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { previewTextReplacementV1, commitTextReplacementV1, undoTextReplacementV1 } from '../../src/lib/editor/registered-text-replacement'
import { executeFindReplace } from '../../src/lib/editor/find-replace-operation'
import { adopt } from '../../src/lib/registry/adopt'

beforeEach(async () => { await db.delete(); await db.open() })
async function fixture() {
  const { scope } = await seedCurrentWorkspace('替换隔离测试')
  const categoryId = await db.codexCategories.add(stampNewRecord(scope, 'codexCategories', { projectId: scope.projectId, name: '地点', key: 'location', icon: 'X', fieldSchema: '[{"key":"a","label":"甲","type":"text"},{"key":"b","label":"乙","type":"longtext"}]' , order: 0, createdAt: 1, updatedAt: 1 }) as never)
  const entryId = await db.codexEntries.add(stampNewRecord(scope, 'codexEntries', { projectId: scope.projectId, categoryId, name: '旧城', summary: '旧印记', description: '旧地图', fields: '{"a":"旧","b":"旧"}', tags: '[]', createdAt: 1, updatedAt: 1 }) as never)
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', { projectId: scope.projectId, parentId: null, type: 'chapter', title: '第一章', summary: '', order: 0, createdAt: 1, updatedAt: 1 }) as never)
  const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', { projectId: scope.projectId, outlineNodeId, title: '标题', content: '<p>apple 旧</p>', summary: '', wordCount: 6, status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1 }) as never)
  const request = { projectId: scope.projectId, worldGroupId: null, query: '旧', replacement: '新', targets: ['codexEntries', 'chapters'] }
  return { scope, entryId, chapterId, request }
}

describe('统一文字替换 · 事务与作用域', () => {
  it('同一词条多字段聚合保存，实体身份保留，正文标签完整，撤销恢复', async () => {
    const { entryId, chapterId, request } = await fixture()
    const preview = await previewTextReplacementV1(request)
    expect(preview.changes.find(item => item.id === entryId && item.target === 'codexEntries')?.after.fields).toBe('{"a":"新","b":"新"}')
    expect(preview.protectedNames).toHaveLength(1)
    const receipt = await commitTextReplacementV1(preview, async () => 1)
    expect(await db.codexEntries.get(entryId)).toMatchObject({ name: '旧城', summary: '新印记', description: '新地图', fields: '{"a":"新","b":"新"}' })
    expect((await db.chapters.get(chapterId))?.content).toBe('<p>apple 新</p>')
    await undoTextReplacementV1(receipt)
    expect((await db.codexEntries.get(entryId))?.fields).toBe('{"a":"旧","b":"旧"}')
    expect((await db.chapters.get(chapterId))?.content).toBe('<p>apple 旧</p>')
  })
  it('HTML 标签和属性不进入替换，大小写选项与字面替换一致', async () => {
    const { chapterId, request } = await fixture()
    await db.chapters.update(chapterId, { content: '<p title="apple">Apple apple</p>' })
    const preview = await previewTextReplacementV1({ ...request, query: 'p', replacement: 'q', targets: ['chapters'], caseSensitive: true })
    await commitTextReplacementV1(preview, async () => 1)
    expect((await db.chapters.get(chapterId))?.content).toBe('<p title="apple">Aqqle aqqle</p>')
  })
  it('快照失败不写入，快照期间发生编辑则整批拒绝', async () => {
    const { chapterId, entryId, request } = await fixture()
    const preview = await previewTextReplacementV1(request)
    await expect(commitTextReplacementV1(preview, async () => { throw new Error('磁盘失败') })).rejects.toThrow('磁盘失败')
    await expect(commitTextReplacementV1(preview, async () => { await db.chapters.update(chapterId, { content: '<p>作者新稿</p>' }); return 2 })).rejects.toThrow('资料已变化')
    expect((await db.codexEntries.get(entryId))?.summary).toBe('旧印记')
    expect((await db.chapters.get(chapterId))?.content).toBe('<p>作者新稿</p>')
  })
  it('任一保存失败回滚前面已保存的词条', async () => {
    const { chapterId, entryId, request } = await fixture()
    const preview = await previewTextReplacementV1(request)
    const fail = vi.spyOn(db.chapters, 'update').mockRejectedValueOnce(new Error('quota'))
    try { await expect(commitTextReplacementV1(preview, async () => 2)).rejects.toThrow() } finally { fail.mockRestore() }
    expect((await db.codexEntries.get(entryId))?.summary).toBe('旧印记')
    expect((await db.chapters.get(chapterId))?.content).toBe('<p>apple 旧</p>')
  })
  it('撤销拒绝覆盖后续手稿；无关字段编辑不被撤销', async () => {
    const { entryId, chapterId, request } = await fixture()
    const receipt = await commitTextReplacementV1(await previewTextReplacementV1(request), async () => 1)
    await db.chapters.update(chapterId, { content: '作者后续编辑' })
    await expect(undoTextReplacementV1(receipt)).rejects.toThrow('已被编辑')
    expect((await db.codexEntries.get(entryId))?.summary).toBe('新印记')
  })
  it('只读取当前作品，不接纳别的作品正文为替换目标', async () => {
    const a = await fixture(); const b = await fixture()
    const preview = await previewTextReplacementV1(a.request)
    expect(preview.changes.some(item => item.target === 'chapters' && item.id === b.chapterId)).toBe(false)
    const foreign = (await db.chapters.get(b.chapterId))!
    await expect(executeFindReplace({ mode: 'book', projectId: a.scope.projectId, chapters: [foreign], targets: [{ id: b.chapterId, outlineNodeId: foreign.outlineNodeId, title: foreign.title, content: foreign.content }], options: { query: '旧', replacement: '新' }, createSnapshot: async () => 1, label: '跨作品' })).rejects.toThrow('正文已变化')
  })
  it('无效结构化数据不写入，世界组之外的记录不参与预览', async () => {
    const { entryId, request } = await fixture()
    await db.codexEntries.update(entryId, { fields: '{bad', worldGroupId: 99 })
    expect((await previewTextReplacementV1(request)).changes.every(item => item.target !== 'codexEntries')).toBe(true)
    await expect(previewTextReplacementV1({ ...request, worldGroupId: 99 })).rejects.toThrow('无法解析')
  })
})

it('力量层级保留逐行文本和 JSON 两种旧格式，替换不改 JSON 身份键', async () => {
  const { scope, request } = await fixture()
  const id = await db.powerSystems.add(stampNewRecord(scope, 'powerSystems', { projectId: scope.projectId, name: '体系', description: '', rules: '', levels: '旧境\n新境', createdAt: 1, updatedAt: 1 }) as never)
  await commitTextReplacementV1(await previewTextReplacementV1({ ...request, targets: ['powerSystems'] }), async () => 1)
  expect((await db.powerSystems.get(id))?.levels).toBe('新境\n新境')
  await db.powerSystems.update(id, { levels: '[{"id":"旧","name":"旧境","description":"旧描述"}]' })
  await commitTextReplacementV1(await previewTextReplacementV1({ ...request, targets: ['powerSystems'] }), async () => 2)
  expect(JSON.parse((await db.powerSystems.get(id))!.levels)).toEqual([{ id: '旧', name: '新境', description: '新描述' }])
})

it('清空字段及首尾空白原样保存，撤销恢复作者原始文本', async () => {
  const { entryId, request } = await fixture()
  await db.codexEntries.update(entryId, { summary: '旧', description: ' 旧\n', fields: '{}' })
  const receipt = await commitTextReplacementV1(await previewTextReplacementV1({ ...request, replacement: '', targets: ['codexEntries'] }), async () => 1)
  expect(await db.codexEntries.get(entryId)).toMatchObject({ summary: '', description: ' \n' })
  await undoTextReplacementV1(receipt)
  expect(await db.codexEntries.get(entryId)).toMatchObject({ summary: '旧', description: ' 旧\n' })
})

it('登记单例按原 ID 保存所有字段，世界切换隔离，空白保留且可恢复', async () => {
  const { scope, request } = await fixture()
  const now = 1
  const worldId = await db.worldviews.add(stampNewRecord(scope, 'worldviews', { projectId: scope.projectId, worldOrigin: ' 旧 ', divineDesign: { divineRank: '旧', divineNames: '旧', divineRules: '旧' }, createdAt: now, updatedAt: now }) as never)
  const storyId = await db.storyCores.add(stampNewRecord(scope, 'storyCores', { projectId: scope.projectId, logline: '旧', theme: '旧', createdAt: now, updatedAt: now }) as never)
  const rulesId = await db.worldRulesProfiles.add(stampNewRecord(scope, 'worldRulesProfiles', { projectId: scope.projectId, entries: { custom: { historicalAnchors: '旧', fictionalAdaptations: '旧', priority: 'historical' } }, globalNote: '旧', createdAt: now, updatedAt: now }) as never)
  const otherId = await db.worldviews.add(stampNewRecord(scope, 'worldviews', { projectId: scope.projectId, worldGroupId: 999, worldOrigin: '旧', createdAt: now, updatedAt: now }) as never)
  const receipt = await commitTextReplacementV1(await previewTextReplacementV1({ ...request, targets: ['worldviews', 'storyCores', 'worldRulesProfiles'] }), async () => 1)
  expect((await db.worldviews.get(worldId))?.worldOrigin).toBe(' 新 ')
  expect((await db.worldviews.get(worldId))?.divineDesign).toEqual({ divineRank: '新', divineNames: '新', divineRules: '新' })
  expect((await db.storyCores.get(storyId))?.theme).toBe('新')
  expect((await db.worldRulesProfiles.get(rulesId))?.entries.custom).toEqual({ historicalAnchors: '新', fictionalAdaptations: '新', priority: 'historical' })
  expect((await db.worldviews.get(otherId))?.worldOrigin).toBe('旧')
  await undoTextReplacementV1(receipt)
  expect((await db.worldviews.get(worldId))?.worldOrigin).toBe(' 旧 ')
  expect((await db.storyCores.get(storyId))?.theme).toBe('旧')
})

it('精确作者编辑不能修改未登记字段或新增记录，AI 写入仍校验 JSON', async () => {
  const { scope, entryId } = await fixture()
  const base = { projectId: scope.projectId, scope, target: 'codexEntries', recordId: entryId, mode: 'replace' as const, preserveAuthorText: true }
  await expect(adopt({ ...base, data: { categoryId: 999 } })).rejects.toThrow('仅限已登记字段')
  await expect(adopt({ ...base, recordId: undefined, mode: 'add', data: { summary: ' 新增 ' } })).rejects.toThrow('仅限已登记字段')
  const id = await db.powerSystems.add(stampNewRecord(scope, 'powerSystems', { projectId: scope.projectId, name: '体系', levels: '旧境', createdAt: 1, updatedAt: 1 }) as never)
  const invalid = await adopt({ projectId: scope.projectId, scope, target: 'powerSystems', recordId: id, mode: 'replace', data: { levels: '非 JSON' } })
  expect(invalid.typeErrors).toHaveLength(1)
  expect((await db.powerSystems.get(id))?.levels).toBe('旧境')
  const valid = await adopt({ projectId: scope.projectId, scope, target: 'powerSystems', recordId: id, mode: 'replace', data: { levels: [{ name: '新境' }] } })
  expect(valid.written).toHaveLength(1)
  expect(JSON.parse((await db.powerSystems.get(id))!.levels)).toEqual([{ name: '新境' }])
})

it('撤销保留无关编辑，世界归属变化后拒绝写回', async () => {
  const { scope, entryId, request } = await fixture()
  const receipt = await commitTextReplacementV1(await previewTextReplacementV1({ ...request, targets: ['codexEntries'] }), async () => 1)
  await db.codexEntries.update(entryId, { tags: '["作者新增标签"]' })
  await undoTextReplacementV1(receipt)
  expect(await db.codexEntries.get(entryId)).toMatchObject({ summary: '旧印记', tags: '["作者新增标签"]' })
  const next = await commitTextReplacementV1(await previewTextReplacementV1({ ...request, targets: ['codexEntries'] }), async () => 2)
  await db.codexEntries.update(entryId, { worldGroupId: 42 })
  await expect(undoTextReplacementV1(next)).rejects.toThrow('世界归属已变化')
  expect((await db.codexEntries.get(entryId))?.worldId).toBe(scope.worldId)
})

it('自定义词条只替换文本字段；枚举、数字、引用与未登记字段保持不变，分类变化阻断旧预览', async () => {
  const { entryId, request } = await fixture()
  const entry = (await db.codexEntries.get(entryId))!
  const fieldSchema = JSON.stringify([{ key: 'a', label: '甲', type: 'text' }, { key: 'ref', type: 'ref' }, { key: 'level', type: 'select' }, { key: 'count', type: 'number' }])
  await db.codexCategories.update(entry.categoryId, { fieldSchema })
  await db.codexEntries.update(entryId, { fields: JSON.stringify({ a: '旧文字', ref: '旧', level: '旧', count: '旧', unregistered: '旧' }) })
  const preview = await previewTextReplacementV1({ ...request, targets: ['codexEntries'] })
  const receipt = await commitTextReplacementV1(preview, async () => 1)
  expect(JSON.parse((await db.codexEntries.get(entryId))!.fields)).toEqual({ a: '新文字', ref: '旧', level: '旧', count: '旧', unregistered: '旧' })
  await db.codexCategories.update(entry.categoryId, { fieldSchema: '[]' })
  await expect(undoTextReplacementV1(receipt)).rejects.toThrow('字段定义已变化')
})

it('替换后词条转入另一分类时，撤销不得按旧分类文本定义修改新分类字段', async () => {
  const { scope, entryId, request } = await fixture()
  const receipt = await commitTextReplacementV1(await previewTextReplacementV1(request), async () => 1)
  const categoryId = await db.codexCategories.add(stampNewRecord(scope, 'codexCategories', { projectId: scope.projectId, name: '引用分类', key: 'references', icon: 'X', fieldSchema: '[{"key":"a","type":"ref"},{"key":"b","type":"select"}]', order: 1, createdAt: 1, updatedAt: 1 }) as never)
  await db.codexEntries.update(entryId, { categoryId })
  await expect(undoTextReplacementV1(receipt)).rejects.toThrow('分类或字段定义已变化')
  expect(await db.codexEntries.get(entryId)).toMatchObject({ categoryId, summary: '新印记', fields: '{"a":"新","b":"新"}' })
})
