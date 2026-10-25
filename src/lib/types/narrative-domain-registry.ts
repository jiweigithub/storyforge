import type { TableSpec } from '../registry/types'
import type { FactPredicateSpec } from './temporal-fact'

/** Serializable interpretation rules. Historical releases use their captured
 * wire contract; live authoring still derives these rules from the registry. */
export type NarrativeDomainTableContractV1 = Pick<TableSpec,
  'name' | 'worldSemantic' | 'resourceIdentity' | 'domainOwner' | 'worldScoped' | 'worldGroupField'
  | 'homeWorldScoped' | 'exportRemap' | 'exportRefRemap' | 'exportIdField' | 'tree' | 'selfIdPaths'>

export interface NarrativeDomainRegistryV1 {
  version: 1
  tables: readonly NarrativeDomainTableContractV1[]
  evidenceFields: Readonly<Record<string, readonly string[]>>
  predicates: readonly FactPredicateSpec[]
}
