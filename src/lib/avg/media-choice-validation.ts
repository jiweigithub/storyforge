import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductProductionBriefV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { assertAvgRawImageArtifactV1 } from './media-raw-contract'
import { parseAvgAuthorMediaChoiceV1, type AvgAuthorMediaChoiceV1 } from './media-production-contract'
import { inspectAvgImageBytesV1 } from './image-decoder'

export interface AvgMediaChoiceValidationV1 {
  schema: 'storyforge.avg.media-choice-validation'
  version: 1
  choiceHash: string
  rawReceiptHash: string
  width: number
  height: number
  hasAlpha: boolean
}

/** Exact producer evidence, original pixels and actual browser decoding are
 * rechecked before candidate staging, adoption and stage compilation. */
export async function readAvgChosenMediaSourceV2(input: { scope: WorkspaceScope; buildId: number; brief: ProductProductionBriefV3; choice: AvgAuthorMediaChoiceV1 }) {
  const choice = parseAvgAuthorMediaChoiceV1(input.choice)
  const row = await verifyAcceptedProductBuildArtifactV1({ scope: input.scope, buildId: input.buildId, ...choice.raw })
  const raw = await assertAvgRawImageArtifactV1(input.brief, row), r = raw.payload.requirement
  if (choice.requirementKey !== r.requirementKey || choice.requirementRevision !== r.revision
    || choice.referenceOnly !== (r.consumer.domain === 'reference') || canonicalProductProductionJsonV2(choice.asset) !== canonicalProductProductionJsonV2(raw.asset)) {
    throw new Error('[avg-media] 作者选择与准确的原图、需求修订或用途不一致')
  }
  if (raw.asset.width! < r.width || raw.asset.height! < r.height
    || Math.abs(raw.asset.width! / raw.asset.height! / (r.width / r.height) - 1) > 0.02) {
    throw new Error('[avg-media] 原图未达到冻结的最小尺寸或画幅；保留候选待返修')
  }
  const blob = row.blobObjectId === null ? null : await db.mediaBlobObjects.get(row.blobObjectId)
  if (!blob || !await assertRecordInScope(input.scope, 'mediaBlobObjects', blob, { owner: 'work' }) || blob.contentHash !== raw.asset.contentHash
    || blob.byteSize !== raw.asset.byteSize || blob.mimeType !== raw.asset.mimeType) throw new Error('[avg-media] 作者选择缺少同作品的准确原图字节')
  const inspect = async () => {
    const bytes = await readVerifiedMediaBlobObjectData(blob)
    return inspectAvgImageBytesV1({ data: bytes, ...raw.asset, requireAlpha: r.alpha === 'required' })
  }
  const measured = Dexie.currentTransaction ? await Dexie.waitFor(Dexie.ignoreTransaction(inspect), 20_000) : await inspect()
  const validation: AvgMediaChoiceValidationV1 = { schema: 'storyforge.avg.media-choice-validation', version: 1, choiceHash: await hashProductProductionValueV2(choice),
    rawReceiptHash: row.producerReceiptHash!, ...measured }
  return { validation, raw: row, asset: raw.asset }
}

export async function validateAvgMediaChoiceV1(input: Parameters<typeof readAvgChosenMediaSourceV2>[0]): Promise<AvgMediaChoiceValidationV1> {
  return (await readAvgChosenMediaSourceV2(input)).validation
}
