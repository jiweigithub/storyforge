import { avgHash, avgKey, avgNumber, avgRecord } from './protocol-validation'
import { parseAvgRetainedRawProofV1, type AvgRetainedRawProofV1 } from './media-recovery-contract'

/** Portable origin, never a host-local Build/Run/Blob locator. Outbound and
 * derivative consent still belong to each later reference request. */
export interface AvgGeneratedReferenceSourceV1 {
  schema: 'storyforge.avg.generated-reference-source'
  version: 1
  productionKey: string
  requirementKey: string
  raw: AvgRetainedRawProofV1
  choice: { artifactKey: string; version: number; contentHash: string; authorReceiptHash: string }
}

export function parseAvgGeneratedReferenceSourceV1(value: unknown): AvgGeneratedReferenceSourceV1 {
  const r = avgRecord(value, ['schema','version','productionKey','requirementKey','raw','choice'], 'generated reference source')
  if (r.schema !== 'storyforge.avg.generated-reference-source' || r.version !== 1) throw new Error('[avg-media] 生成参考来源版本无效')
  const requirementKey = avgKey(r.requirementKey, 'reference.requirementKey'), raw = parseAvgRetainedRawProofV1(r.raw)
  const c = avgRecord(r.choice, ['artifactKey','version','contentHash','authorReceiptHash'], 'generated reference choice')
  if (raw.artifactKey !== `avg.media.raw.${requirementKey}` || raw.taskKey !== `avg.media.generate.${requirementKey}`
    || c.artifactKey !== `avg.media.choice.${requirementKey}`) throw new Error('[avg-media] 生成参考的原图与作者选择不属于同一需求')
  return { schema:r.schema,version:1,productionKey:avgKey(r.productionKey,'reference.productionKey'),requirementKey,raw,
    choice:{artifactKey:c.artifactKey,version:avgNumber(c.version,'reference.choice.version',1,1e9),
      contentHash:avgHash(c.contentHash,'reference.choice.contentHash'),authorReceiptHash:avgHash(c.authorReceiptHash,'reference.choice.authorReceiptHash')} }
}
