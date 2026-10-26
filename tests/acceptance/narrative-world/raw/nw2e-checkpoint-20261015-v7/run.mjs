import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import * as original from '/Users/qinyingying/.codex/worktrees/narrative-world-design/storyforge/src/lib/narrative-domain/json.ts'
import * as wasm from './json-wasm-probe.ts'
const root = '/Users/qinyingying/.codex/worktrees/narrative-world-design/storyforge/'
const goldenPath = 'tests/acceptance/narrative-world/worldrelease-v4-content-golden.json'
const golden = JSON.parse(readFileSync(root+goldenPath, 'utf8')).compiled
const raw = '雨后🪷铜铃归途，保留原文与 Unicode。'.repeat(50_000)
const cases = [
 { name: 'canonical-golden-manifest', method: 'hashNarrativeValueV1', input: golden.manifest, repetitions: 30 },
 { name: 'canonical-golden-index', method: 'hashNarrativeValueV1', input: golden.index, repetitions: 30 },
 { name: 'raw-large-unicode-text', method: 'hashNarrativeBytesV1', input: raw, repetitions: 6 },
]
const methods={original,wasm}
const all=[]
for (const item of cases) {
 const expected = await original[item.method](item.input)
 assert.equal(await wasm[item.method](item.input),expected)
 if(item.method==='hashNarrativeBytesV1') assert.equal(expected,createHash('sha256').update(item.input).digest('hex'))
 const run = async name => { const start=performance.now();for(let i=0;i<item.repetitions;i++) assert.equal(await methods[name][item.method](item.input), expected);return performance.now()-start }
 await run('original');await run('wasm');const rounds=[]
 for(let round=0;round<8;round++){const order=round%2?['wasm','original']:['original','wasm'],ms={};for(const name of order)ms[name]=await run(name);rounds.push({round,order,ms,ratio:ms.wasm/ms.original})}
 const ratios=rounds.map(x=>x.ratio).sort((a,b)=>a-b)
 all.push({name:item.name,repetitions:item.repetitions,canonicalUtf8Bytes:new TextEncoder().encode(item.method==='hashNarrativeBytesV1'?item.input:original.canonicalNarrativeJsonV1(item.input)).length,expectedHash:expected,equalHashes:true,medianRatio:(ratios[3]+ratios[4])/2,rounds})
}
const report={schema:'storyforge.narrative-hash-backend-probe',version:1,createdAt:new Date().toISOString(),node:process.version,package:JSON.parse(readFileSync('/tmp/nw2e-hash-wasm-package-metadata-r1.json','utf8')),sourceHashes:Object.fromEntries(['src/lib/narrative-domain/json.ts',goldenPath].map(p=>[p,createHash('sha256').update(readFileSync(root+p)).digest('hex')])),probeSourceHashes:Object.fromEntries(['run.mjs','json-wasm-probe.ts'].map(p=>[p,createHash('sha256').update(readFileSync(new URL(p,import.meta.url))).digest('hex')])),results:all,productionChanged:false,accepted:false,boundary:'Isolated Node digest-backend prototype; one reused initialized WASM instance, alternating rounds. Existing strict canonical traversal remains unchanged. Not browser, full-system, memory, cold-initialization, dependency-security or human acceptance. Background full CI is active.'}
writeFileSync(new URL('report.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify(all.map(({name,equalHashes,medianRatio,canonicalUtf8Bytes})=>({name,equalHashes,medianRatio,canonicalUtf8Bytes}))))
