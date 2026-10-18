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
  processing?: Omit<AvgRetainedRawProofV1,'schema'> & {schema:'storyforge.avg.processed-image-proof'}
  choice: { artifactKey: string; version: number; contentHash: string; authorReceiptHash: string }
}

export function parseAvgGeneratedReferenceSourceV1(value: unknown): AvgGeneratedReferenceSourceV1 {
  const hasProcessing=!!value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'processing')
  const r = avgRecord(value, ['schema','version','productionKey','requirementKey','raw','choice',...(hasProcessing?['processing']:[])], 'generated reference source')
  if (r.schema !== 'storyforge.avg.generated-reference-source' || r.version !== 1) throw new Error('[avg-media] 生成参考来源版本无效')
  const requirementKey = avgKey(r.requirementKey, 'reference.requirementKey'), raw = parseAvgRetainedRawProofV1(r.raw)
  const c = avgRecord(r.choice, ['artifactKey','version','contentHash','authorReceiptHash'], 'generated reference choice')
  let processing:AvgGeneratedReferenceSourceV1['processing']
  if(hasProcessing){
    const p=avgRecord(r.processing,['schema','version','buildNumber','briefHash','planHash','controlEpoch','taskKey','artifactKey','artifactVersion','contentHash','inputHash','producerReceiptHash','candidateHash','proofHash'],'processed image proof')
    if(p.schema!=='storyforge.avg.processed-image-proof'||p.version!==1||p.buildNumber!==raw.buildNumber||p.briefHash!==raw.briefHash||p.planHash!==raw.planHash||p.controlEpoch!==raw.controlEpoch
      ||p.taskKey!==`avg.media.process.${requirementKey}`||p.artifactKey!==`avg.media.processed.${requirementKey}`)throw new Error('[avg-process] 加工来源不属于准确原图版本和需求')
    processing={schema:'storyforge.avg.processed-image-proof',version:1,buildNumber:raw.buildNumber,briefHash:raw.briefHash,planHash:raw.planHash,controlEpoch:raw.controlEpoch,
      taskKey:p.taskKey,artifactKey:p.artifactKey,artifactVersion:avgNumber(p.artifactVersion,'processed.artifactVersion',1,1e9),contentHash:avgHash(p.contentHash,'processed.contentHash'),
      inputHash:avgHash(p.inputHash,'processed.inputHash'),producerReceiptHash:avgHash(p.producerReceiptHash,'processed.producerReceiptHash'),candidateHash:avgHash(p.candidateHash,'processed.candidateHash'),proofHash:avgHash(p.proofHash,'processed.proofHash')}
  }
  if (raw.artifactKey !== `avg.media.raw.${requirementKey}` || raw.taskKey !== `avg.media.generate.${requirementKey}`
    || c.artifactKey !== `avg.media.choice.${requirementKey}`) throw new Error('[avg-media] 生成参考的原图与作者选择不属于同一需求')
  return { schema:r.schema,version:1,productionKey:avgKey(r.productionKey,'reference.productionKey'),requirementKey,raw,...(processing?{processing}:{}),
    choice:{artifactKey:c.artifactKey,version:avgNumber(c.version,'reference.choice.version',1,1e9),
      contentHash:avgHash(c.contentHash,'reference.choice.contentHash'),authorReceiptHash:avgHash(c.authorReceiptHash,'reference.choice.authorReceiptHash')} }
}

/** V4 originals use a distinct tagged source. V1 reference requests keep
 * their own parser; this source first serves explicit local stage retention. */
export interface AvgGeneratedReferenceSourceV2 {
  schema:'storyforge.avg.generated-reference-source';version:2
  productionKey:string;requirementKey:string
  raw:{schema:'storyforge.avg.visual-image-producer-proof';version:4;buildNumber:number;briefHash:string;planHash:string;controlEpoch:number;
    taskKey:string;artifactKey:string;artifactVersion:number;contentHash:string;inputHash:string;producerReceiptHash:string;
    candidateHash:string;responseEvidenceHash:string;proofHash:string}
  compilation:{artifactKey:'avg.media.compiled-visual-requirements';version:number;contentHash:string}
  choice:{artifactKey:string;version:number;contentHash:string;authorReceiptHash:string}
  review:{artifactKey:string;version:number;contentHash:string;authorReceiptHash:string}
  processing?:never
}
export type AvgGeneratedImageSource=AvgGeneratedReferenceSourceV1|AvgGeneratedReferenceSourceV2

export function parseAvgGeneratedReferenceSourceV2(value:unknown):AvgGeneratedReferenceSourceV2 {
  const r=avgRecord(value,['schema','version','productionKey','requirementKey','raw','compilation','choice','review'],'V4 image source')
  if(r.schema!=='storyforge.avg.generated-reference-source'||r.version!==2)throw new Error('[avg-visual-history] 图片来源版本无效')
  const requirementKey=avgKey(r.requirementKey,'source.requirementKey')
  const p=avgRecord(r.raw,['schema','version','buildNumber','briefHash','planHash','controlEpoch','taskKey','artifactKey','artifactVersion','contentHash','inputHash','producerReceiptHash','candidateHash','responseEvidenceHash','proofHash'],'V4 image producer')
  if(p.schema!=='storyforge.avg.visual-image-producer-proof'||p.version!==4||p.taskKey!==`avg.media.generate.${requirementKey}`||p.artifactKey!==`avg.media.raw.${requirementKey}`)throw new Error('[avg-visual-history] 来源不是准确 V4 图片 producer')
  const raw:AvgGeneratedReferenceSourceV2['raw']={schema:p.schema,version:4,buildNumber:avgNumber(p.buildNumber,'source.buildNumber',1,1e9),
    briefHash:avgHash(p.briefHash,'source.briefHash'),planHash:avgHash(p.planHash,'source.planHash'),controlEpoch:avgNumber(p.controlEpoch,'source.controlEpoch',0,1e9),
    taskKey:p.taskKey,artifactKey:p.artifactKey,artifactVersion:avgNumber(p.artifactVersion,'source.artifactVersion',1,1e9),
    contentHash:avgHash(p.contentHash,'source.contentHash'),inputHash:avgHash(p.inputHash,'source.inputHash'),producerReceiptHash:avgHash(p.producerReceiptHash,'source.producerReceiptHash'),
    candidateHash:avgHash(p.candidateHash,'source.candidateHash'),responseEvidenceHash:avgHash(p.responseEvidenceHash,'source.responseEvidenceHash'),proofHash:avgHash(p.proofHash,'source.proofHash')}
  const c=avgRecord(r.compilation,['artifactKey','version','contentHash'],'V4 image compilation')
  if(c.artifactKey!=='avg.media.compiled-visual-requirements')throw new Error('[avg-visual-history] 原编译来源不匹配')
  const author=(value:unknown,key:string)=>{
    const a=avgRecord(value,['artifactKey','version','contentHash','authorReceiptHash'],'V4 image author source')
    if(a.artifactKey!==key)throw new Error('[avg-visual-history] 原作者来源不匹配')
    return {artifactKey:key,version:avgNumber(a.version,'source.authorVersion',1,1e9),contentHash:avgHash(a.contentHash,'source.authorContentHash'),authorReceiptHash:avgHash(a.authorReceiptHash,'source.authorReceiptHash')}
  }
  return {schema:r.schema,version:2,productionKey:avgKey(r.productionKey,'source.productionKey'),requirementKey,raw,
    compilation:{artifactKey:c.artifactKey,version:avgNumber(c.version,'source.compilationVersion',1,1e9),contentHash:avgHash(c.contentHash,'source.compilationHash')},
    choice:author(r.choice,`avg.media.choice.${requirementKey}`),review:author(r.review,`avg.review.visual.${requirementKey}`)}
}

export function parseAvgGeneratedImageSource(value:unknown):AvgGeneratedImageSource {
  return value&&typeof value==='object'&&'version'in value&&value.version===2
    ?parseAvgGeneratedReferenceSourceV2(value):parseAvgGeneratedReferenceSourceV1(value)
}
