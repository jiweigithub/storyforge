import { db } from '../db/schema'
import { FIELD_REGISTRY } from '../registry/field-registry'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import { transactionTablesFor } from '../registry/lifecycle'
import { adopt } from '../registry/adopt'
import { assertRecordInScope, readOwnedRows, resolveScope } from '../workspace/scope'
import type { WorkspaceScope } from '../types'
import type { FieldSpec } from '../registry/types'
import type { CodexCategory, CodexFieldDef } from '../types/codex'
import { canonicalStringify } from '../agent/run/hash'
import { replaceChapterContent, replacePlainTextV1, type FindReplaceOptions } from './find-replace'

type RecordData = Record<string, unknown>
export const TEXT_REPLACEMENT_TARGETS = [...new Set(FIELD_REGISTRY.filter(field => field.textReplacement).map(field => field.target))]
export interface TextReplacementRequestV1 extends FindReplaceOptions {
  projectId: number
  worldGroupId: number | null
  replacement: string
  targets: string[]
}
export interface AuthorTextChangeV1 {
  target: string; id: number; label: string; before: RecordData; after: RecordData
  baseline: string; fields: string[]; count: number
  categoryBaseline?: { id: number; fieldSchema: string }
}
export interface TextReplacementPreviewV1 {
  request: TextReplacementRequestV1; scope: WorkspaceScope; changes: AuthorTextChangeV1[]; protectedNames: string[]
}
export interface AuthorTextEditReceiptV1 {
  scope: WorkspaceScope; worldGroupId: number | null; snapshotId: number; changes: AuthorTextChangeV1[]
}

function replaceField(value: unknown, spec: FieldSpec, options: FindReplaceOptions & { replacement: string }, textKeys: string[] = []) {
  const capability = spec.textReplacement!
  if (capability.codec === 'derived-number') return { value, count: 0 }
  if (capability.codec === 'html') {
    if (typeof value !== 'string') return { value, count: 0 }
    const result = replaceChapterContent(value, options)
    return { value: result.count ? result.html : value, count: result.count, wordCount: result.wordCount }
  }
  const jsonCodec = capability.codec === 'json' || capability.codec === 'codex-text-fields' || (capability.codec === 'text-or-json' && ['[', '{'].includes(String(value ?? '').trimStart()[0]))
  if (capability.codec === 'text' || (capability.codec === 'text-or-json' && !jsonCodec)) {
    if (typeof value !== 'string') return { value, count: 0 }
    const result = replacePlainTextV1(value, options)
    return { value: result.text, count: result.count }
  }
  if (value == null || value === '') return { value, count: 0 }
  let root: unknown
  try { root = jsonCodec ? JSON.parse(String(value)) : structuredClone(value) }
  catch { throw new Error(`${spec.labels?.[0] ?? spec.field} 的结构化内容无法解析，请先修复该字段。`) }
  let count = 0
  function visit(current: unknown, path: string[]) {
    if (!current || typeof current !== 'object') return
    const [head, ...rest] = path
    const record = current as RecordData
    const keys = head === '*' ? Object.keys(record) : [head]
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue
      if (rest.length) visit(record[key], rest)
      else if (typeof record[key] === 'string') {
        const result = replacePlainTextV1(record[key], options)
        record[key] = result.text; count += result.count
      }
    }
  }
  if (capability.codec === 'codex-text-fields') {
    // Schema keys are literal, including dots; references, numbers and enums
    // are not prose and must never be changed by a text replacement.
    if (root && typeof root === 'object' && !Array.isArray(root)) {
      const record = root as RecordData
      for (const key of textKeys) {
        if (!Object.prototype.hasOwnProperty.call(record, key) || typeof record[key] !== 'string') continue
        const result = replacePlainTextV1(record[key], options)
        record[key] = result.text; count += result.count
      }
    }
  } else for (const path of capability.paths ?? []) visit(root, path.split('.'))
  return { value: count ? (jsonCodec ? JSON.stringify(root) : root) : value, count }
}

export async function previewTextReplacementV1(request: TextReplacementRequestV1): Promise<TextReplacementPreviewV1> {
  if (!request.query.trim()) throw new Error('请输入查找内容。')
  if (!request.targets.length || request.targets.some(target => !TEXT_REPLACEMENT_TARGETS.includes(target))) throw new Error('替换范围未登记。')
  const scope = await resolveScope({ projectId: request.projectId })
  const changes: AuthorTextChangeV1[] = []
  const protectedNames: string[] = []
  const categories = request.targets.includes('codexEntries') ? await readOwnedRows<CodexCategory>(scope, 'codexCategories') : []
  for (const target of new Set(request.targets)) {
    const specs = FIELD_REGISTRY.filter(spec => spec.target === target && spec.textReplacement)
    const rows = await readOwnedRows<RecordData>(scope, target)
    for (const row of rows) {
      const table = REGISTRY_BY_NAME.get(target)!
      if (table.worldScoped && (row[table.worldGroupField ?? 'worldGroupId'] ?? null) !== request.worldGroupId) continue
      if (table.homeWorldScoped && row.homeWorldGroupId != null && row.homeWorldGroupId !== request.worldGroupId) continue
      const before: RecordData = {}; const after: RecordData = {}; const fields: string[] = []
      const category = categories.find(item => item.id === row.categoryId)
      let textKeys: string[] = []
      if (target === 'codexEntries') {
        if (!category) throw new Error('词条分类已缺失，请先核对资料；没有修改任何内容。')
        let schema: unknown
        try { schema = JSON.parse(category.fieldSchema) } catch { throw new Error('词条字段定义无法解析，请先修复分类。') }
        if (!Array.isArray(schema) || schema.some(field => !field || typeof field.key !== 'string' || typeof field.type !== 'string')) throw new Error('词条字段定义无效，请先修复分类。')
        textKeys = (schema as CodexFieldDef[]).filter(field => field.type === 'text' || field.type === 'longtext').map(field => field.key)
      }
      let count = 0
      for (const spec of specs) {
        const result = replaceField(row[spec.field], spec, request, textKeys)
        if (!result.count || canonicalStringify(result.value) === canonicalStringify(row[spec.field])) continue
        if (spec.textReplacement?.identity) {
          protectedNames.push(`${String(row.name)}：名称请通过“实体改名”同步引用`)
          continue
        }
        before[spec.field] = row[spec.field]; after[spec.field] = result.value
        fields.push(spec.labels?.[0] ?? spec.field); count += result.count
        if (result.wordCount != null) { before.wordCount = row.wordCount; after.wordCount = result.wordCount }
      }
      if (count) changes.push({ target, id: Number(row.id), label: String(row.name ?? row.title ?? specs[0]?.labels?.[0] ?? target), before, after, baseline: canonicalStringify(row), fields, count,
        ...(category && Object.prototype.hasOwnProperty.call(after, 'fields') ? { categoryBaseline: { id: category.id!, fieldSchema: category.fieldSchema } } : {}) })
    }
  }
  return { request: structuredClone(request), scope, changes, protectedNames: [...new Set(protectedNames)] }
}

async function writeChanges(scope: WorkspaceScope, worldGroupId: number | null, changes: AuthorTextChangeV1[], direction: 'before' | 'after') {
  for (const change of changes) {
    if (change.categoryBaseline) {
      const category = await db.codexCategories.get(change.categoryBaseline.id)
      const entry = await db.codexEntries.get(change.id)
      if (!category || entry?.categoryId !== category.id || !await assertRecordInScope(scope, 'codexCategories', category) || category.fieldSchema !== change.categoryBaseline.fieldSchema) throw new Error('词条分类或字段定义已变化，请重新预览；没有写入任何修改。')
    }
    const result = await adopt({ projectId: scope.projectId, scope, worldGroupId, target: change.target, recordId: change.id, mode: 'replace', preserveAuthorText: true, data: change[direction] })
    if (result.written.length !== 1 || result.skipped.length || result.unknown.length || result.typeErrors.length || result.fkErrors.length) throw new Error(`未能保存 ${change.label}，本次修改已撤回。`)
    const row = await REGISTRY_BY_NAME.get(change.target)!.table.get(change.id)
    for (const field of Object.keys(change[direction])) {
      if (canonicalStringify(row?.[field]) !== canonicalStringify(change[direction][field])) throw new Error(`保存回读不一致：${change.label}，已撤回本次修改。`)
    }
  }
}

/** Shared author-edit transaction for chapter and registered setting replacement. */
export async function commitAuthorTextChangesV1(args: {
  scope: WorkspaceScope; worldGroupId: number | null; changes: AuthorTextChangeV1[]
  createSnapshot: (id: number, label: string, type: 'manual') => Promise<number>; label: string
}): Promise<AuthorTextEditReceiptV1> {
  if (!args.changes.length) throw new Error('没有可替换的内容。')
  const snapshotId = await args.createSnapshot(args.scope.projectId, args.label, 'manual')
  return db.transaction('rw', transactionTablesFor('importProject'), async () => {
    const currentScope = await resolveScope({ projectId: args.scope.projectId })
    if (canonicalStringify(currentScope) !== canonicalStringify(args.scope)) throw new Error('作品已切换，请重新预览。')
    for (const change of args.changes) {
      const row = await REGISTRY_BY_NAME.get(change.target)!.table.get(change.id)
      if (!row || !await assertRecordInScope(args.scope, change.target, row)
        || canonicalStringify(row) !== change.baseline) throw new Error('资料已变化，请重新预览；没有写入任何修改。')
    }
    await writeChanges(args.scope, args.worldGroupId, args.changes, 'after')
    return { scope: args.scope, worldGroupId: args.worldGroupId, snapshotId, changes: args.changes }
  })
}

export async function commitTextReplacementV1(preview: TextReplacementPreviewV1, createSnapshot: (id: number, label: string, type: 'manual') => Promise<number>): Promise<AuthorTextEditReceiptV1> {
  return commitAuthorTextChangesV1({ scope: preview.scope, worldGroupId: preview.request.worldGroupId,
    changes: preview.changes, createSnapshot, label: `批量替换「${preview.request.query}」前` })
}

export async function undoTextReplacementV1(receipt: AuthorTextEditReceiptV1): Promise<void> {
  await db.transaction('rw', transactionTablesFor('importProject'), async () => {
    const scope = await resolveScope({ projectId: receipt.scope.projectId })
    if (canonicalStringify(scope) !== canonicalStringify(receipt.scope)) throw new Error('当前作品已切换，请返回原作品后撤销。')
    for (const change of receipt.changes) {
      const row = await REGISTRY_BY_NAME.get(change.target)!.table.get(change.id)
      if (!row || !await assertRecordInScope(scope, change.target, row)) throw new Error('记录已删除或已移出当前作品，请通过快照恢复。')
      const baseline = JSON.parse(change.baseline) as RecordData
      if ((row.worldGroupId ?? null) !== (baseline.worldGroupId ?? null) || (row.homeWorldGroupId ?? null) !== (baseline.homeWorldGroupId ?? null)) throw new Error('记录的世界归属已变化，请通过快照核对恢复。')
      for (const field of Object.keys(change.after)) {
        if (canonicalStringify(row[field]) !== canonicalStringify(change.after[field])) throw new Error('替换后内容已被编辑，已阻止覆盖新内容；请通过快照恢复。')
      }
    }
    await writeChanges(scope, receipt.worldGroupId, receipt.changes, 'before')
  })
}
