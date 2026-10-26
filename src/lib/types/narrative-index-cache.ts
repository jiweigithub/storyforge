/** Disposable local acceleration. This is never Canon, a portable package or
 * an AI write target. Removing it cannot remove a release or its consumers. */
export interface WorldNarrativeIndexCacheV1 {
  id?: number
  projectId: number
  worldId: number
  releaseId: number
  releaseUid: string
  contentHash: string
  inputRootHash: string
  recipeVersion: string
  indexHash: string
  indexJson: string
  byteLength: number
  createdAt: number
  lastAccessedAt: number
}
