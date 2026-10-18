import { vi } from 'vitest'
import type { FrozenRuntimeMediaAssetV2, WorkspaceScope } from '../../src/lib/types'
import type { MediaProviderTransportV1, ProductMediaRequestV1 } from '../../src/lib/product-production/media-adapters'
import { exportProjectJSON } from '../../src/lib/export/json-export'
import { createAvgDraftReferenceAdapterV2 } from '../../src/lib/avg/editor-service'
import { readAvgAdoptedGeneratedImageV2 } from '../../src/lib/avg/media-generated-reference'
import type { AvgGeneratedImageSource } from '../../src/lib/avg/media-generated-reference-contract'
import { freezeAvgImageRequestV2, parseAvgMediaReferencesV2 } from '../../src/lib/avg/media-reference-contract-v2'

/** Controlled transport only. It receives real Work-owned source bytes from
 * the public resolver; no provider/account is contacted or Run fabricated. */
export async function avgVersionedReferenceTransportFixture(input:{scope:WorkspaceScope;asset:FrozenRuntimeMediaAssetV2;source:AvgGeneratedImageSource}){
  const {scope,asset,source}=input,image=await readAvgAdoptedGeneratedImageV2({scope,source})
  const reference=parseAvgMediaReferencesV2([{schema:'storyforge.avg.media-reference',version:2,assetKey:asset.assetKey,assetVersion:asset.version,
    contentHash:asset.contentHash,mimeType:asset.mimeType,byteSize:asset.byteSize,purpose:'style',allowedChange:'工程传输校准，仅保留配色和质感。',
    dataClass:'avg-authorized-reference',license:asset.license,providerInputAllowed:true,derivativeUseAllowed:true,crop:null,mask:null,generatedSource:source,
    contentPolicy:{permittedFeatures:['配色和质感'],excludedFeatures:['具体布局','道具和剧情信息']} }])[0]!
  const request:ProductMediaRequestV1={schema:'storyforge.product-media-request',version:1,requestId:'avg.reference.v2.controlled',
    adapterId:'agnes.image-2.5-flash.v1',mediaClass:'image',mediaKind:'background',requirementKey:'avg.media.image',artifactKey:'avg.media.raw.controlled',
    prompt:'原创工程画面',negativePrompt:'文字、水印',count:1,width:576,height:324,durationMs:null,inputHash:'a'.repeat(64),qualityProfile:'prototype',
    environment:'test',allowedDataClasses:[reference.dataClass],rightsPolicyVersion:'controlled-reference.v2'}
  const frozen=await freezeAvgImageRequestV2({request,references:[reference],resolutionTier:'1K',targetFamily:image.family})
  const adapter=await createAvgDraftReferenceAdapterV2({scope,frozen})
  let binary='';for(const b of new Uint8Array(image.data))binary+=String.fromCharCode(b)
  const dispatch=vi.fn<MediaProviderTransportV1['request']>(async()=>({status:200,contentType:'application/json',body:null,
    json:{data:[{b64_json:btoa(binary)}]},providerRequestId:'controlled-reference-v2',usage:null,costUsd:null}))
  const before=await exportProjectJSON(scope.projectId)
  const [candidate]=await adapter.generate({...request,inputHash:frozen.inputHash},{executionLocation:'browser-direct',request:dispatch},new AbortController().signal)
  await adapter.parseAndVerify(candidate)
  const after=await exportProjectJSON(scope.projectId)
  return {reference,frozen,candidate,dispatch,projectUnchanged:JSON.stringify({...before,exportedAt:0})===JSON.stringify({...after,exportedAt:0})}
}
