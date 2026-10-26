import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mapNarrativeDomainReferencesV1, parseNarrativeDomainFieldV1 as newParse, parseNarrativeDomainSourceRefV1 as newRef, NARRATIVE_DOMAIN_FIELDS_V1 } from '../../src/lib/narrative-domain/codec'
import { portableNarrativeDomainFieldJsonV1 as newPortable, portableNarrativeDomainFieldValueV1 } from '../../src/lib/narrative-domain/references'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 as newHash } from '../../src/lib/world-engine/narrative-domain-capture'
import { captureFrozenNarrativeSourcesV4 } from '../../src/lib/world-engine/narrative-release-v4'
import { buildNarrativeScaleInputV2 } from '../helpers/narrative-scale-v2-fixture'
import { db } from '../../src/lib/db/schema'
import { seedConfirmedNarrativeDomainV1 } from '../helpers/narrative-domain-fixture'
const uid = 'res:v1:character:00000000-0000-4000-8000-000000000001'
const good = () => ({ characterId: 1, sourceUid: uid })
const communication = () => {
  const shared = good()
  return { eventType: 'communication' as const, participants: [{ entity: shared, role: 'sender' }], locations: [],
    propositions: [], effects: [], before: [], observer: null,
    communication: { sender: shared, recipients: [shared], channel: '信件' } }
}
const containers = (value: unknown): object[] => value && typeof value === 'object'
  ? [value, ...Object.values(value).flatMap(containers)] : []
const rejects = (input: unknown) => {
  for (const parse of [newRef]) expect(() => parse(input)).toThrow()
}
describe('NW · domain decoding and portable hashes survive allocation changes', () => {
  it.each(['undefined','nan','negative-zero','unsafe','lone-surrogate','cycle','prototype','symbol','accessor','sparse','array-extra'])('rejects invalid JSON before decoding: %s', mutation => {
    const input: Record<string, unknown> = good()
    if (mutation === 'undefined') input.bad = undefined
    if (mutation === 'nan') input.bad = NaN
    if (mutation === 'negative-zero') input.bad = -0
    if (mutation === 'unsafe') input.bad = Number.MAX_SAFE_INTEGER + 1
    if (mutation === 'lone-surrogate') input.bad = '\ud800'
    if (mutation === 'cycle') input.bad = input
    if (mutation === 'prototype') input.bad = new Date()
    if (mutation === 'symbol') Object.defineProperty(input, Symbol('bad'), { value: true })
    if (mutation === 'accessor') Object.defineProperty(input, 'sourceUid', { enumerable: true, get() { throw Error('getter invoked') } })
    if (mutation === 'sparse') input.bad = new Array(2)
    if (mutation === 'array-extra') input.bad = Object.assign([1], { extra: 2 })
    rejects(input)
    if (mutation === 'accessor') for (const parse of [newRef]) {
      try { parse(input); throw Error('unexpected success') } catch (error) { expect(String(error)).not.toContain('getter invoked') }
    }
  })
  it('does not invoke hidden toJSON and never exposes the caller reference object', () => {
    const input = good()
    Object.defineProperty(input, 'toJSON', { value: () => { throw Error('hidden toJSON invoked') } })
    expect(newRef(input)).toEqual(good())
    const decoded = newRef(input); decoded.characterId = 200
    expect(input.characterId).toBe(1)
  })
  it('keeps scalar, field and authority decoding, including bad authority rejection', () => {
    for (const [field, value] of [
      ['narrativeModalityV1', 'intent'],
      ['narrativeVisibilityV1', { class: 'author-only', audienceKeys: [], policyVersion: '1' }],
      ['narrativeTimeV1', { occurred: null, valid: null, narratedAt: null, disclosedAt: [], acquiredAt: null }],
    ] as const) expect(newParse(field, value)).toEqual(value)
    for (const parse of [newParse]) expect(() => parse('narrativeAuthorityV1', { version: 1, contentHash: 'forged' })).toThrow()
  })
  it('maps nested references in an independent mutable copy, even from frozen shared input leaves', () => {
    const original = communication(), snapshot = JSON.stringify(original)
    const ownedByCaller = new Set(containers(original))
    for (const item of ownedByCaller) Object.freeze(item)
    const visited: object[] = []
    const mapped = mapNarrativeDomainReferencesV1('narrativeEventV1', original, source => {
      expect(ownedByCaller.has(source)).toBe(false)
      if ('characterId' in source) source.characterId = 7
      visited.push(source)
      return source
    })
    expect(visited).toHaveLength(3)
    expect(new Set(visited).size).toBe(3)
    expect(containers(mapped).some(item => ownedByCaller.has(item))).toBe(false)
    expect(mapped.participants[0].entity).toEqual({ ...good(), characterId: 7 })
    expect(mapped.communication!.recipients).toEqual([{ ...good(), characterId: 7 }])
    mapped.participants[0].role = 'changed'
    mapped.communication!.recipients.push(good())
    expect(JSON.stringify(original)).toBe(snapshot)
    expect(mapNarrativeDomainReferencesV1('narrativeEventV1', original, source => source)).toEqual(JSON.parse(snapshot))
  })
  it('finishes input validation before mapping and keeps input intact when the mapper throws', () => {
    const original = communication(), snapshot = JSON.stringify(original)
    let calls = 0, getterCalls = 0
    const invalid = communication()
    Object.defineProperty(invalid.communication.recipients[0], 'sourceUid', { enumerable: true, get() {
      getterCalls++; return uid
    } })
    expect(() => mapNarrativeDomainReferencesV1('narrativeEventV1', invalid, source => {
      calls++; return source
    })).toThrow('accessor')
    expect(calls).toBe(0); expect(getterCalls).toBe(0)
    expect(() => mapNarrativeDomainReferencesV1('narrativeEventV1', original, source => {
      if ('characterId' in source) source.characterId = 7
      if (++calls === 2) throw Error('mapping interrupted')
      return source
    })).toThrow('mapping interrupted')
    expect(calls).toBe(2)
    expect(JSON.stringify(original)).toBe(snapshot)
  })
  it('matches existing confirmed source hashes and canonical bytes on the independent v2 fixture', async () => {
    const { input } = await buildNarrativeScaleInputV2(20_000)
    const capture = captureFrozenNarrativeSourcesV4({ ...input, sourceWorkCode: input.sourceManifest.sourceWorkCode })
    let fields = 0, rows = 0
    const hashes: Record<string, string> = {}
    for (const [table, items] of capture.rows) for (const row of items) {
      if (!row.narrativeAuthorityV1) continue
      const snapshot = JSON.stringify(row)
      for (const field of NARRATIVE_DOMAIN_FIELDS_V1) {
        if (row[field] === undefined) continue
        const identityMapped = mapNarrativeDomainReferencesV1(field, row[field], source => source)
        const callerContainers = new Set(containers(row[field]))
        expect(identityMapped).toEqual(newParse(field, row[field]))
        expect(containers(identityMapped).some(item => callerContainers.has(item))).toBe(false)
        const current = newPortable(field, row[field])
        expect(portableNarrativeDomainFieldValueV1(field, row[field])).toEqual(JSON.parse(current))
        fields++
      }
      const observed = await newHash(capture, table, row)
      expect(observed).toBe(row.narrativeAuthorityV1.contentHash)
      expect(JSON.stringify(row)).toBe(snapshot)
      hashes[`${table}:${row.id}`] = observed; rows++
    }
    expect(rows).toBe(265); expect(fields).toBe(1275)
    // Frozen before the allocation change; independently checks the complete source-hash map.
    const ordered = Object.fromEntries(Object.keys(hashes).sort().map(key => [key, hashes[key]]))
    expect(createHash('sha256').update(JSON.stringify(ordered)).digest('hex')).toBe('888bc95098ff1502ae7a3f725286f64a69a10182047351417fde2ad5e0bbfe31')
  })
  it('preserves confirmed domain coverage and subrecord reorder identity without sorting ordered payloads', async () => {
    await db.delete(); await db.open()
    try {
      const fixture = await seedConfirmedNarrativeDomainV1()
      const capture = await captureNarrativeDomainV1(fixture.input)
      let compared = 0
      for (const [table, rows] of capture.rows) for (const row of rows) if (row.narrativeAuthorityV1) {
        expect(await newHash(capture, table, row)).toBe(row.narrativeAuthorityV1.contentHash); compared++
      }
      expect(compared).toBeGreaterThan(10)
      for (const [table, field] of [['foreshadows', 'narrativeDevelopmentsV1'], ['chapters', 'narrativeDisclosuresV1']] as const) {
        const row = capture.rows.get(table)!.find(item => item[field])!
        const original = JSON.stringify(row), changed = structuredClone(row)
        const first = changed[field]![0]!, second = structuredClone(first)
        second.semanticSubKey = 'sub:v1:00000000-0000-4000-8000-000000000999'
        changed[field] = [first, second] as never
        const current = await newHash(capture, table, changed)
        changed[field]!.reverse()
        expect(await newHash(capture, table, changed)).toBe(current)
        if (field === 'narrativeDisclosuresV1') {
          changed.narrativeDisclosuresV1![0]!.subjects.reverse()
          expect(await newHash(capture, table, changed)).not.toBe(current)
        }
        expect(JSON.stringify(row)).toBe(original)
      }

    } finally { db.close() }
  })

})
