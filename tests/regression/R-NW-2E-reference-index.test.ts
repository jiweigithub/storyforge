import { describe, expect, it } from 'vitest'
import type { NarrativeDomainCaptureV1, NarrativeDomainRowV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { WORLD_SEMANTIC_REGISTRY_V4 } from '../../src/lib/world-engine/semantic-registry-v4'
import { resolveNarrativeDomainReferenceV1 as resolve } from '../../src/lib/world-engine/narrative-domain-evidence'
import golden from '../acceptance/narrative-world/worldrelease-v4-content-golden.json'

const uid = (n: number) => `res:v1:character:00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const reference = (n = 1) => ({ characterId: n, sourceUid: uid(n) })
function fixture(): NarrativeDomainCaptureV1 {
  const rows: NarrativeDomainRowV1[] = [1, 2].map(id => ({ id, ragDocumentId: uid(id), name: '同名人物' }))
  return { rows: new Map([['characters', rows]]), peers: new Map([['characters', rows]]),
    registry: structuredClone(WORLD_SEMANTIC_REGISTRY_V4), scope: { projectId: 1, worldId: 1, workId: 1 },
    owner: { kind: 'world', worldCode: golden.compiled.manifest.worldCode, sourceWorkCode: null },
    worldCode: golden.compiled.manifest.worldCode, workCode: String(golden.compiled.manifest.semanticSnapshot.works[0].code) }
}
function freezeRows(rows: NarrativeDomainRowV1[]): NarrativeDomainRowV1[] {
  for (const row of rows) Object.freeze(row)
  Object.freeze(rows)
  return rows
}

describe('NW-2E · immutable identity lookup keeps source and collision boundaries', () => {
  it('resolves same-name rows by exact ID and UID and preserves tombstone/case rejection', () => {
    const capture = fixture(), rows = freezeRows(capture.rows.get('characters')!)
    for (let pass = 0; pass < 3; pass++) {
      expect(resolve(capture, reference()).row).toBe(rows[0])
      expect(resolve(capture, reference(2)).row).toBe(rows[1])
      expect(() => resolve(capture, { characterId: 1, sourceUid: uid(2) })).toThrow('source-missing')
      expect(() => resolve(capture, { characterId: null, sourceUid: uid(1) })).toThrow('source-missing')
      expect(() => resolve(capture, { characterId: 1, sourceUid: uid(1).toUpperCase() })).toThrow('source-missing')
    }
  })

  it('includes an unselected peer in another Work and detects case-insensitive UID collisions', () => {
    const capture = fixture(), rows = freezeRows(capture.rows.get('characters')!)
    expect(resolve(capture, reference()).row).toBe(rows[0])
    capture.peers.set('characters', freezeRows([...rows, { id: 3, workId: 9, ragDocumentId: uid(1).toUpperCase() }]))
    expect(() => resolve(capture, reference())).toThrow('duplicate-uid')
    capture.peers.set('characters', freezeRows([rows[1]]))
    expect(() => resolve(capture, reference())).toThrow('duplicate-uid')
    capture.peers.set('characters', rows)
    expect(resolve(capture, reference()).row).toBe(rows[0])
  })

  it('never reuses cached selection after replacing the current array', () => {
    const capture = fixture(), rows = freezeRows(capture.rows.get('characters')!)
    expect(resolve(capture, reference()).row).toBe(rows[0])
    capture.rows.set('characters', freezeRows([rows[1]]))
    expect(() => resolve(capture, reference())).toThrow('source-missing')
    capture.rows.set('characters', freezeRows([{ id: 1, ragDocumentId: uid(2) }]))
    expect(() => resolve(capture, reference())).toThrow('source-missing')
  })

  it('keeps mutable captures live, including a frozen array with a mutable row', () => {
    const capture = fixture(), rows = capture.rows.get('characters')!
    expect(resolve(capture, reference()).row).toBe(rows[0])
    Object.freeze(rows)
    rows[1].ragDocumentId = uid(1)
    expect(() => resolve(capture, reference())).toThrow('duplicate-uid')
    rows[1].ragDocumentId = uid(2)
    rows[0].id = 3
    expect(() => resolve(capture, reference())).toThrow('source-missing')
    rows[0].id = 1
    expect(resolve(capture, reference()).row).toBe(rows[0])
  })

  it('does not treat frozen accessors as immutable scalar identities', () => {
    const capture = fixture(), rows = capture.rows.get('characters')!
    let current = uid(2)
    Object.defineProperty(rows[1], 'ragDocumentId', { enumerable: true, get: () => current })
    freezeRows(rows)
    expect(resolve(capture, reference()).row).toBe(rows[0])
    current = uid(1)
    expect(() => resolve(capture, reference())).toThrow('duplicate-uid')
  })

  it('keys lookup by the current registry identity field and keeps first-ID semantics', () => {
    const capture = fixture(), rows = capture.rows.get('characters')!
    rows[0].alternateUid = uid(2); rows[1].alternateUid = uid(1)
    freezeRows(rows)
    expect(resolve(capture, reference()).row).toBe(rows[0])
    // Simulate a changed runtime contract; current production types restrict
    // this field to ragDocumentId, but stale cached metadata must not win.
    const identity = capture.registry.tables.find(table => table.name === 'characters')!.resourceIdentity!
    ;(identity as { field: string }).field = 'alternateUid'
    expect(() => resolve(capture, reference())).toThrow('source-missing')
    expect(resolve(capture, { characterId: 2, sourceUid: uid(1) }).row).toBe(rows[1])
    const duplicate = fixture()
    duplicate.rows.set('characters', freezeRows([{ id: 1, ragDocumentId: uid(2) }, { id: 1, ragDocumentId: uid(1) }]))
    expect(() => resolve(duplicate, reference())).toThrow('source-missing')
  })
})
