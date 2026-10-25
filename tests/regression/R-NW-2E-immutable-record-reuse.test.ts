import { describe, expect, it } from 'vitest'
import { narrativeIRFixture } from '../helpers/narrative-ir-fixture'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import {
  parseNarrativeRecordV1, parseNarrativeIRBundleV1,
} from '../../src/lib/world-engine/narrative-ir-codec'
import { compileImmutableNarrativeIRV1, compileNarrativeIRBundleV1 } from '../../src/lib/world-engine/narrative-ir'
import { canonicalNarrativeJsonV1, freezeNarrativeJsonV1 } from '../../src/lib/world-engine/narrative-json'
import type { NarrativeIRBundleV1 } from '../../src/lib/types/narrative-ir'

const inputOf = (bundle: NarrativeIRBundleV1) => {
  const { schema: _schema, irVersion: _version, semanticRootHash: _hash, ...input } = bundle
  return input
}
const freezeRecords = (bundle: NarrativeIRBundleV1) => ({
  ...bundle, records: bundle.records.map(record => freezeNarrativeJsonV1(parseNarrativeRecordV1(record))),
})

describe('NW-2E · frozen records preserve decoder and compiler trust boundaries', () => {
  it('keeps eight-kind bytes, caller mutability and detached ordinary decoding', async () => {
    const fixture = await narrativeIRFixture(), original = canonicalNarrativeJsonV1(fixture.bundle)
    const captured = freezeRecords(fixture.bundle)
    const immutable = await compileImmutableNarrativeIRV1(inputOf(captured), fixture.sources)
    const ordinary = parseNarrativeIRBundleV1(captured)
    expect(new Set(immutable.bundle.records.map(record => record.kind)).size).toBe(8)
    expect(canonicalNarrativeJsonV1(immutable.bundle)).toBe(canonicalNarrativeJsonV1(ordinary))
    for (const record of immutable.bundle.records) {
      expect(Object.isFrozen(record.payload)).toBe(true)
      expect(Object.isFrozen(record.time)).toBe(true)
    }
    expect(ordinary.records[0]).not.toBe(captured.records[0])
    ordinary.records[0].confidence = 0.25
    expect(immutable.bundle.records[0].confidence).toBeNull()
    expect(captured.records[0].confidence).toBeNull()
    expect(Object.isFrozen(fixture.bundle.records[0])).toBe(false)
    expect(canonicalNarrativeJsonV1(fixture.bundle)).toBe(original)
  })

  it('does not grant validation through clone, spread or a frozen flag', async () => {
    const fixture = await narrativeIRFixture(), captured = freezeRecords(fixture.bundle)
    const clone = structuredClone(captured)
    const decoded = parseNarrativeIRBundleV1(clone)
    expect(decoded.records[0]).not.toBe(clone.records[0])
    const bad = structuredClone(captured.records[0])
    bad.confidence = 2
    Object.freeze(bad)
    expect(() => parseNarrativeIRBundleV1({ ...captured, records: [bad] })).toThrow('confidence')
    const spread = { ...captured.records[0], confidence: 2 }
    expect(() => parseNarrativeIRBundleV1({ ...captured, records: [spread] })).toThrow('confidence')
  })

  it('rejects accessors without invoking them, including under a frozen root', async () => {
    const fixture = await narrativeIRFixture(), record = structuredClone(fixture.bundle.records[0])
    let invoked = false
    Object.defineProperty(record, 'confidence', { enumerable: true, get() { invoked = true; return null } })
    Object.freeze(record)
    expect(() => parseNarrativeRecordV1(record)).toThrow('accessor')
    expect(() => parseNarrativeIRBundleV1({ ...fixture.bundle, records: [record] })).toThrow('accessor')
    expect(invoked).toBe(false)
  })

  it('rechecks current identity classification and newly duplicated registry entries', async () => {
    const fixture = await narrativeIRFixture(), captured = freezeRecords(fixture.bundle)
    const spec = PROJECT_TABLES.find(item => item.name === 'characters')!, identity = spec.resourceIdentity!
    const previous = identity.narrativeEntityType
    try {
      identity.narrativeEntityType = 'location'
      expect(() => parseNarrativeIRBundleV1(captured)).toThrow('entity-kind')
    } finally { identity.narrativeEntityType = previous }
    const duplicate = { ...spec, name: 'nw-test-duplicate-identity' }
    PROJECT_TABLES.push(duplicate)
    try {
      expect(() => parseNarrativeIRBundleV1(captured)).toThrow('resource-kind')
    } finally { PROJECT_TABLES.splice(PROJECT_TABLES.indexOf(duplicate), 1) }
    expect(parseNarrativeIRBundleV1(captured)).toEqual(fixture.bundle)
  })

  it('rechecks nested reference resource kinds and bundle scope after capture', async () => {
    const fixture = await narrativeIRFixture(), captured = freezeRecords(fixture.bundle)
    const event = captured.records.find(record => record.kind === 'event')!
    const identity = PROJECT_TABLES.find(item => item.name === 'characters')!.resourceIdentity!
    const previous = identity.resourceKind
    try {
      identity.resourceKind = 'nw-test-unregistered-character'
      expect(() => parseNarrativeIRBundleV1({ ...captured, records: [event] })).toThrow('resource-kind')
    } finally { identity.resourceKind = previous }
    expect(() => parseNarrativeIRBundleV1({
      ...captured, scope: { ...captured.scope, branchKey: 'another-branch' },
    })).toThrow('scope')
  })

  it('retains all record hashes, reference binding and source-evidence checks', async () => {
    const fixture = await narrativeIRFixture(), captured = freezeRecords(fixture.bundle)
    const immutable = await compileImmutableNarrativeIRV1(inputOf(captured), fixture.sources)
    const ordinary = await compileNarrativeIRBundleV1(inputOf(captured), fixture.sources)
    expect(canonicalNarrativeJsonV1(immutable.bundle)).toBe(canonicalNarrativeJsonV1(ordinary))
    const stale = freezeNarrativeJsonV1(parseNarrativeRecordV1({ ...captured.records[0], revisionHash: 'f'.repeat(64) }))
    await expect(compileImmutableNarrativeIRV1({
      ...inputOf(captured), records: [stale, ...captured.records.slice(1)],
    }, fixture.sources)).rejects.toThrow('stale-reference')
    const changedSources = structuredClone(fixture.sources)
    changedSources[0].text += ' changed'
    await expect(compileImmutableNarrativeIRV1(inputOf(captured), changedSources)).rejects.toThrow('evidence-hash')
  })
})
