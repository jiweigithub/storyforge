import { describe,expect,it } from 'vitest'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { productionCanonicalKeyFixture } from '../helpers/production-canonical-key-fixture'

describe('Production canonical JSON preserves its original Unicode byte contract',()=>{
  it('matches the byte count and SHA-256 captured before the allocation change for 2048 real-shaped Unicode objects',async()=>{
    const corpus=productionCanonicalKeyFixture(),value=canonicalProductProductionJsonV2(corpus)
    expect(new TextEncoder().encode(value).byteLength).toBe(2537503)
    expect(await hashProductProductionValueV2(corpus)).toBe('629b46d925b18a714ced2693b3298df278487f89aa21070047d367d9afdedb47')
  })

  it('sorts prefixes, BMP boundaries, astral characters and standalone surrogates by code point rather than UTF-16 units',()=>{
    const expected=['','\u0000','A','a','a\ud800','é','中','\ud7ff','\ud800','\udfff','\ue000','\uffff','\u{10000}','😀','\u{10ffff}']
    const value=Object.fromEntries([...expected].reverse().map(key=>[key,1]))
    expect(canonicalProductProductionJsonV2(value)).toBe(`{${expected.map(key=>`${JSON.stringify(key)}:1`).join(',')}}`)
  })

  it('normalizes keys and strings but still rejects duplicate keys after NFC',()=>{
    expect(canonicalProductProductionJsonV2({'e\u0301':'e\u0301'})).toBe('{"é":"é"}')
    expect(()=>canonicalProductProductionJsonV2({'é':1,'e\u0301':2})).toThrow(/重复对象 key/)
  })

  it('reflects subsequent object mutations and preserves null-prototype objects and negative zero',()=>{
    const value=Object.assign(Object.create(null),{z:-0,a:{text:'before'}})
    expect(canonicalProductProductionJsonV2(value)).toBe('{"a":{"text":"before"},"z":0}')
    value.a.text='after';value.b=true
    expect(canonicalProductProductionJsonV2(value)).toBe('{"a":{"text":"after"},"b":true,"z":0}')
  })

  it('keeps strict invalid-value and cyclic/sparse input rejection',()=>{
    const cyclic:Record<string,unknown>={};cyclic.self=cyclic
    for(const value of [NaN,Infinity,-Infinity,undefined,BigInt(1),Symbol('unsupported'),()=>0,new Date(0),{a:undefined},Array(1),cyclic]){
      expect(()=>canonicalProductProductionJsonV2(value)).toThrow()
    }
  })
})
