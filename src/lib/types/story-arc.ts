import type { NarrativeDomainMetadataV1, NarrativeDomainFieldsV1 } from './narrative-domain'
/**
 * 全局故事线 — Phase B
 * 给全书一条从开篇到结局的主线剧情锚点
 */

/** 故事线类型 */
export type StoryArcType = 'main' | 'sub'
export type StoryArcOrigin = 'manual' | 'ai' | 'import'
export type StoryArcStatus = 'active' | 'deprecated'

/** 故事阶段 */
export interface StoryStage {
  id: string              // nanoid
  title: string           // "起：初入江湖"
  description: string     // 这个阶段发生什么
  startVolume?: number    // 对应卷起始
  endVolume?: number      // 对应卷结束
  keyEvents: string[]     // 关键事件
  turningPoint?: string   // 转折点
}

/** 故事线 */
type StoryArcNarrativeFieldsV1 = NarrativeDomainMetadataV1 & Pick<NarrativeDomainFieldsV1, 'narrativeDevelopmentsV1'>

export interface StoryArc extends StoryArcNarrativeFieldsV1 {
  id?: number
  projectId: number
  /** 多世界作用域；null 表示单世界/默认主世界。 */
  worldGroupId?: number | null
  name: string            // "主线" / "感情线" / "复仇线"
  type: StoryArcType
  /** JSON 序列化的 StoryStage[] */
  stages: string
  description?: string    // 故事线整体描述
  /** STORY-1: this record is a one-way executable projection, never the story intent itself. */
  origin?: StoryArcOrigin
  status?: StoryArcStatus
  sourceStoryCoreId?: number
  sourceStoryCoreRevision?: number
  sourceStoryCoreHash?: string
  lastAlignedHash?: string
  producerRunId?: number
  producerCandidateHash?: string
  createdAt: number
  updatedAt: number
}

// ── 工具函数 ──

export function parseStages(stagesJson: string): StoryStage[] {
  try {
    const parsed = JSON.parse(stagesJson)
    if (Array.isArray(parsed)) return parsed
    return []
  } catch {
    return []
  }
}

export function stringifyStages(stages: StoryStage[]): string {
  return JSON.stringify(stages)
}
