import type { NarrativeDomainFieldsV1 } from './narrative-domain'

/**
 * RAG-1 · 可见资料与检索管理。
 *
 * 资料正文仍以各业务表为 Canon；这里只在源记录上保存稳定资料 ID 与作者的检索策略。
 * ragDocumentId 随项目 JSON 往返，节点图引用它而不是 Dexie 自增主键，避免导入后失联。
 */
export interface RagFieldPolicy {
  enabled?: boolean
  /** 相同节点预算下的相对优先级。 */
  weight?: number
  /** 单字段最多进入一次上下文的 token 数。 */
  tokenCap?: number
  /** 长期作者意图；selector 必须在普通权重之前处理。 */
  priority?: 'normal' | 'pinned' | 'must-read'
}

export interface RagDocumentPolicy extends RagFieldPolicy {
  fields?: Record<string, RagFieldPolicy>
}

export interface RagDocumentMetadata {
  ragDocumentId?: string
  ragPolicy?: RagDocumentPolicy
  /** Retrieval policy evolves independently from Canon content revisions. */
  ragPolicyRevision?: number
  ragPolicyHash?: string
}

/** Trusted authoring selection of one already selected source record. */
export interface RagAnnotationTargetSelectionV1 {
  table: string
  sourceUid: string
}

/** Editable target state, separately labelled from original story fields.
 * References use portable UIDs; this is not a confirmation or new evidence. */
export interface RagAnnotationTargetStateV1 extends RagAnnotationTargetSelectionV1 {
  version: 1
  annotations: Partial<Pick<NarrativeDomainFieldsV1, 'narrativeDevelopmentsV1' | 'narrativeDisclosuresV1'>>
}

export type RagVectorState = 'none' | 'keyword' | 'partial' | 'ready'

export interface RagLibraryEntry {
  key: string
  documentId: string
  tableName: string
  recordId: number
  sourceKey: string
  sourceLabel: string
  title: string
  fieldKey: string
  fieldLabel: string
  content: string
  updatedAt: number
  tokenEstimate: number
  documentEnabled: boolean
  documentWeight: number
  documentTokenCap: number
  enabled: boolean
  weight: number
  tokenCap: number
  priority: 'normal' | 'pinned' | 'must-read'
  chunkCount: number
  vectorState: RagVectorState
}

export interface RagSelectionTrace {
  included: string[]
  omitted: string[]
  trimmed: string[]
}

export interface RagSelectionTraceCollector extends RagSelectionTrace {
  clear(): void
}

export function createRagSelectionTrace(): RagSelectionTraceCollector {
  return {
    included: [],
    omitted: [],
    trimmed: [],
    clear() {
      this.included.length = 0
      this.omitted.length = 0
      this.trimmed.length = 0
    },
  }
}
