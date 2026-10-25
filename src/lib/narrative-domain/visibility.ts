import type { VisibilityV1 } from '../types/narrative-ir'
import { canonicalNarrativeJsonV1, compareUnicodeCodePointsV1 } from './json'

/** Effective disclosure may only become more restrictive through evidence or
 * dependency closure. Explicit author-only and unclassified inputs never
 * become public merely because a summary/projection calls itself public. */
export function intersectNarrativeVisibilityV1(own: VisibilityV1, inherited: readonly VisibilityV1[]): VisibilityV1 {
  const policies = [own, ...inherited]
  const result = (kind: VisibilityV1['class'], audienceKeys: string[] = []): VisibilityV1 => {
    if (own.class === kind && canonicalNarrativeJsonV1([...own.audienceKeys].sort(compareUnicodeCodePointsV1)) === canonicalNarrativeJsonV1(audienceKeys)) return own
    return { class: kind, audienceKeys, policyVersion: 'narrative-inherited-v1' }
  }
  if (policies.some(policy => policy.class === 'author-only')) return result('author-only')
  if (policies.some(policy => policy.class === 'unclassified')) return result('unclassified')
  const restricted = policies.filter(policy => policy.class === 'restricted')
  if (!restricted.length) return result('public')
  const audiences = [...new Set(restricted[0].audienceKeys)].filter(key => restricted.every(policy => policy.audienceKeys.includes(key)))
    .sort(compareUnicodeCodePointsV1)
  return audiences.length ? result('restricted', audiences) : result('author-only')
}
