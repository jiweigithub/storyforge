import captured from './semantic-registry-v4.json'
import type { NarrativeDomainRegistryV1 } from '../types/narrative-domain-registry'

/** Historical wire rules captured for semanticContract=4. New current domains
 * never modify this snapshot. A changed interpretation needs a new version. */
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
export const WORLD_SEMANTIC_REGISTRY_V4 = freeze(captured as NarrativeDomainRegistryV1)
export const WORLD_SEMANTIC_REGISTRY_VERSION_V4 = 'world-semantic-v4' as const
