import type { AgentToolJsonSchema, AgentToolJsonSchemaProperty } from './types'
import { NARRATIVE_KINDS_V1 } from '../types/narrative-ir'
import { NARRATIVE_INDEX_EDGE_KINDS_V1 } from '../types/narrative-index'

const key: AgentToolJsonSchemaProperty = { type: 'string', minLength: 1, maxLength: 4000 }
const keys: AgentToolJsonSchemaProperty = { type: 'array', items: key }
const point: AgentToolJsonSchemaProperty = { type: 'object', properties: {
  kind: { type: 'string', enum: ['tick', 'event-anchor'] }, timelineKey: key, value: key,
  eventKey: key, side: { type: 'string', enum: ['before', 'at', 'after'] },
}, required: ['kind'], additionalProperties: false }

/** The model can request filters, never an owner, view, grant, source plan or
 * read depth. The host supplies those from the bound Gateway session. The
 * strict WorldQuery codec also validates each discriminated time shape. */
export const WORLD_QUERY_TOOL_SCHEMA_V1: AgentToolJsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    mode: { type: 'string', enum: ['search', 'state-at', 'events', 'traverse'] },
    text: { type: 'string', minLength: 1, maxLength: 4000 },
    kinds: { type: 'array', items: { type: 'string', enum: NARRATIVE_KINDS_V1 } },
    entityKeys: keys, storyArcKeys: keys,
    time: { type: 'object', properties: {
      axis: { type: 'string', enum: ['occurred', 'valid', 'acquired', 'narrated', 'disclosed'] },
      mode: { type: 'string', enum: ['at', 'overlaps'] }, point,
      interval: { type: 'object', properties: { start: point, end: point,
        endMeaning: { type: 'string', enum: ['known', 'open', 'unknown'] } }, required: ['start', 'endMeaning'], additionalProperties: false },
      sequenceKey: key, throughUnitKey: key, audienceKey: key,
    }, required: ['axis'], additionalProperties: false },
    relationExpansion: { type: 'object', properties: {
      kinds: { type: 'array', items: { type: 'string', enum: NARRATIVE_INDEX_EDGE_KINDS_V1 } },
      maxHops: { type: 'integer', minimum: 0, maximum: 3 }, maxNodes: { type: 'integer', minimum: 1, maximum: 500 },
    }, required: ['kinds', 'maxHops', 'maxNodes'], additionalProperties: false },
    causalDepth: { type: 'integer', minimum: 0, maximum: 3 },
    limit: { type: 'integer', minimum: 1, maximum: 20 },
    maxTokens: { type: 'integer', minimum: 1024, maximum: 10000 },
    cursor: { type: 'string', minLength: 1, maxLength: 8000 },
  },
}
