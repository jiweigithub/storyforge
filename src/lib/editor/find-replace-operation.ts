import type { Chapter } from '../types'
import { db } from '../db/schema'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { canonicalStringify } from '../agent/run/hash'
import { commitAuthorTextChangesV1, undoTextReplacementV1, type AuthorTextEditReceiptV1, type AuthorTextChangeV1 } from './registered-text-replacement'
import {
  findChapterMatches,
  replaceChapterContent,
  type ChapterSearchTarget,
  type FindReplaceOptions,
} from './find-replace'

export type ReplaceMode = 'one' | 'chapter' | 'book'

export interface FindReplaceUndoPatch {
  label: string
  receipt: AuthorTextEditReceiptV1
  chapters: Array<{
    id: number
    content: string
    wordCount: number
  }>
}

interface ExecuteReplaceArgs {
  mode: ReplaceMode
  targets: ChapterSearchTarget[]
  chapters: Chapter[]
  options: FindReplaceOptions & { replacement: string }
  projectId: number
  selected?: { chapterId: number; occurrenceIndex: number } | null
  createSnapshot: (projectId: number, label: string, type: 'auto' | 'manual') => Promise<number>
  label: string
}

export interface ExecuteReplaceResult {
  replaced: number
  affectedChapters: number
  snapshotId: number
  undoPatch: FindReplaceUndoPatch
}

export function countPlannedReplacements(
  targets: ChapterSearchTarget[],
  options: FindReplaceOptions,
  mode: ReplaceMode,
): { count: number; affectedChapters: number } {
  const previews = targets
    .map(target => findChapterMatches(target, options))
    .filter(preview => preview && preview.count > 0)

  if (mode === 'one') {
    return previews.length ? { count: 1, affectedChapters: 1 } : { count: 0, affectedChapters: 0 }
  }

  return {
    count: previews.reduce((sum, preview) => sum + (preview?.count ?? 0), 0),
    affectedChapters: previews.length,
  }
}

export async function executeFindReplace(args: ExecuteReplaceArgs): Promise<ExecuteReplaceResult> {
  const targetsWithMatches = args.targets
    .filter(target => (findChapterMatches(target, args.options)?.count ?? 0) > 0)
  if (!targetsWithMatches.length) {
    throw new Error('没有可替换的命中')
  }

  const scope = await resolveScope({ projectId: args.projectId })
  const changes: AuthorTextChangeV1[] = []
  let replaced = 0
  let affectedChapters = 0
  for (const target of targetsWithMatches) {
    const onlyOccurrenceIndex = args.mode === 'one' && args.selected?.chapterId === target.id
      ? args.selected.occurrenceIndex
      : args.mode === 'one'
        ? 0
        : undefined
    const result = replaceChapterContent(target.content, args.options, args.mode === 'one' ? { onlyOccurrenceIndex } : undefined)
    if (!result.count) continue
    replaced += result.count
    affectedChapters += 1
    const chapter = await db.chapters.get(target.id)
    if (!chapter || !await assertRecordInScope(scope, 'chapters', chapter) || chapter.content !== target.content) {
      throw new Error('正文已变化，请刷新查找结果后重试。')
    }
    changes.push({ target: 'chapters', id: target.id, label: target.title,
      before: { content: chapter.content, wordCount: chapter.wordCount },
      after: { content: result.html, wordCount: result.wordCount },
      baseline: canonicalStringify(chapter), fields: ['正文'], count: result.count })
    if (args.mode === 'one') break
  }

  const receipt = await commitAuthorTextChangesV1({ scope, worldGroupId: null, changes,
    createSnapshot: args.createSnapshot, label: args.label })
  const undoPatch: FindReplaceUndoPatch = { label: `${args.label} · 快照 #${receipt.snapshotId}`, receipt,
    chapters: changes.map(change => ({ id: change.id, content: String(change.before.content), wordCount: Number(change.before.wordCount) })) }
  return { replaced, affectedChapters, snapshotId: receipt.snapshotId, undoPatch }
}

export async function undoFindReplace(undoPatch: FindReplaceUndoPatch): Promise<number> {
  await undoTextReplacementV1(undoPatch.receipt)
  return undoPatch.chapters.length
}
