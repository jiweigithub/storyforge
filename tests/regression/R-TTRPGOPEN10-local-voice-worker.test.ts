import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'

function node(script: string) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';import path from 'node:path';
import {assertProductImplementation,validateProductJob,verifyProductResult,productProfile,productProfileHash,stable,digest} from './scripts/ttrpg-local-tts/product-contract.mjs';
import {createProductVoiceJobs} from './scripts/ttrpg-local-tts/product-jobs.mjs';
import {syntheticJob,syntheticRuntime,fakeChild,syntheticResult,writeSyntheticResult} from './tests/helpers/local-voice-product-fixture.mjs';
${script}`], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }))
}
describe('R-TTRPGOPEN10 actual offline worker protocol and physical raw audio boundary', () => {
  it('pins the product implementation independently while old eval and reading keep no product/model permission', () => {
    expect(node(`assertProductImplementation();const input=syntheticJob();assert.deepEqual(validateProductJob(input),input);
const invalid=[{...input,outputDir:'/tmp/author'},{...input,jobKey:'other'}, {...input,execution:{...input.execution,profileHash:'0'.repeat(64)}}];
for(const bad of invalid)assert.throws(()=>validateProductJob(bad));
assert.equal(JSON.parse(readFileSync('scripts/ttrpg-local-tts/runtime-profile.json')).productInvocationAllowed,false);
assert.equal(JSON.parse(readFileSync('scripts/ttrpg-local-tts/reading-profile.json')).modelInvocationAllowed,false);
assert.equal(JSON.parse(readFileSync('scripts/ttrpg-local-tts/product-profile-v1.json')).version,1);
console.log(JSON.stringify({version:productProfile.version,pinned:productProfile.implementation.sources.length}));`)).toEqual({ version: 2, pinned: 9 })
  })
  it('complete segment planning runs before any model import and preserves all normalized UTF16 text under independent caps', () => {
    const script = `
import importlib.util,json,sys
s=importlib.util.spec_from_file_location('worker','scripts/ttrpg-local-tts/product-worker.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
p=json.load(open('scripts/ttrpg-local-tts/product-profile.json'))
for text in ['门口的灯还亮着.','中文.'*1000,'文'*4000]:
 rows=m.plan_segments(text,p);assert ''.join(r['text'] for r in rows)==text and len(rows)<=64 and all(r['readingLengthUtf16']<=200 for r in rows)
 assert sum(r['readingLengthUtf16'] for r in rows)==m.utf16(text)
for text in ['文'*4001,'.'*4000,'😀']:
 try:m.plan_segments(text,p);raise AssertionError('must reject')
 except ValueError:pass
assert not any(x in sys.modules for x in ['torch','transformers','melo'])
print(json.dumps({'planned':3,'modelLoaded':False}))`
    expect(JSON.parse(execFileSync('python3', ['-B', '-c', script], { encoding: 'utf8' }))).toEqual({ planned: 3, modelLoaded: false })
  })
  it('historical exact jobs remain inspectable and stoppable after a profile upgrade, but cannot acquire current execution permission', () => {
    expect(node(`import {mkdirSync} from 'node:fs';const runtime=syntheticRuntime(),input=syntheticJob();
input.execution.profile=JSON.parse(readFileSync('scripts/ttrpg-local-tts/product-profile-v1.json','utf8'));
input.execution.profileHash=digest(stable(input.execution.profile));input.inputArtifactHash=digest(stable(input.execution));input.jobKey='ttrpg.voice.1.'+input.inputArtifactHash;
const dir=path.join(runtime,'product-jobs-v2',digest(input.jobKey));mkdirSync(dir,{recursive:true});
writeFileSync(path.join(dir,'input.json'),stable(input));writeFileSync(path.join(dir,'job.json'),stable({jobKey:input.jobKey,inputArtifactHash:input.inputArtifactHash,status:'waiting-for-slot'}));
let calls=0;const jobs=createProductVoiceJobs(runtime,{spawnWorker(){calls++;return fakeChild()}});
assert.equal(jobs.get(input.jobKey).profileHash,input.execution.profileHash);assert.equal(jobs.get(input.jobKey).canStart,false);
assert.throws(()=>jobs.start(input.jobKey,input.inputArtifactHash));assert.equal(calls,0);
assert.equal(jobs.cancel(input.jobKey).status,'cancelled-before-start');assert.equal(jobs.get(input.jobKey).cancellationConfirmed,true);
console.log(JSON.stringify({calls,historicalStop:true,runtime}));`).historicalStop).toBe(true)
  })
  it('the orphan watchdog uses monotonic lease deadlines across clock rollback and cannot revive an expired original lease', () => {
    const script = `
import importlib.util,json
s=importlib.util.spec_from_file_location('worker','scripts/ttrpg-local-tts/product-worker.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
mono=[100.];wall=[1000.];m.time.monotonic=lambda:mono[0];m.time.time=lambda:wall[0]
lease=m.OriginalLease('job','hash','nonce',10000)
value={'jobKey':'job','inputArtifactHash':'hash','launchNonce':'nonce','sequence':1,'expiresAt':1010000}
assert lease.valid(value) and lease.deadline==110
mono[0]=105;wall[0]=900;assert lease.valid(value) and lease.deadline==110
mono[0]=111;wall[0]=899;assert not lease.valid(value)
value.update(sequence=2,expiresAt=1000000000);assert not lease.valid(value)
another=m.OriginalLease('job','hash','nonce',10000);mono[0]=120;wall[0]=1500;value.update(sequence=1,expiresAt=1510000)
assert another.valid(value);mono[0]=125;wall[0]=1490;value.update(sequence=2,expiresAt=1500000)
assert another.valid(value) and another.deadline==135
mono[0]=136;assert not another.valid(value)
print(json.dumps({'rollbackBounded':True,'expiredCannotRevive':True}))`
    expect(JSON.parse(execFileSync('python3', ['-B', '-c', script], { encoding: 'utf8' }))).toEqual({ rollbackBounded: true, expiredCannotRevive: true })
  })
  it('creating, polling, duplicate submission and a new service never launch a model; the one durable start is irreversible', () => {
    expect(node(`const runtime=syntheticRuntime(),input=syntheticJob();let calls=0,child,dir;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(d){calls++;dir=d;child=fakeChild();return child}});
assert.equal(jobs.create(input).status,'waiting-for-slot');assert.equal(jobs.get(input.jobKey).status,'waiting-for-slot');jobs.create(input);assert.equal(calls,0);
const reloaded=createProductVoiceJobs(runtime,{spawnWorker(){throw Error('reload must not start')}});assert.equal(reloaded.get(input.jobKey).status,'waiting-for-slot');
jobs.start(input.jobKey,input.inputArtifactHash);jobs.start(input.jobKey,input.inputArtifactHash);assert.equal(calls,1);
assert.equal(readFileSync(path.join(dir,'start.json'),'utf8').includes('start-authorized'),true);
writeSyntheticResult(dir,input);child.emit('close',0,null);const raw=jobs.raw(input.jobKey);
assert.equal(raw.workerExecutionKind,'injected-test-worker');assert.equal(raw.candidateAccepted,false);assert.equal(raw.adoptionAllowed,false);
jobs.start(input.jobKey,input.inputArtifactHash);assert.equal(calls,1);assert.equal(jobs.get(input.jobKey).status,'generated');
console.log(JSON.stringify({calls,runtime,rawOnly:true}));`).calls).toBe(1)
  })
  it('cancellation before start wins the same immutable claim and stays confirmed without any later inference', () => {
    expect(node(`const runtime=syntheticRuntime(),input=syntheticJob();let calls=0;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(){calls++;return fakeChild()}});jobs.create(input);
assert.equal(jobs.cancel(input.jobKey).cancellationConfirmed,true);assert.equal(jobs.get(input.jobKey).status,'cancelled-before-start');
jobs.start(input.jobKey,input.inputArtifactHash);assert.equal(calls,0);assert.equal(jobs.cancel(input.jobKey).cancellationConfirmed,true);
console.log(JSON.stringify({calls,runtime}));`).calls).toBe(0)
  })
  it('losing the physical slot while its actual eval owner is still writing the lock preserves that owner and releases only the unlaunched product claim', () => {
    expect(node(`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const runtime=fs.realpathSync(syntheticRuntime()),input=syntheticJob();let calls=0,intercepted=false;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(){calls++;return fakeChild()}});jobs.create(input);
const originalOpen=fs.openSync;fs.openSync=(file,...args)=>{const fd=originalOpen(file,...args);
if(file===path.join(runtime,'.product-voice-worker.lock')&&args[0]==='wx'){intercepted=true;writeFileSync(path.join(runtime,'.eval.lock'),'')}return fd};syncBuiltinESMExports();
try{assert.equal(jobs.start(input.jobKey,input.inputArtifactHash).status,'waiting-for-slot')}
finally{fs.openSync=originalOpen;syncBuiltinESMExports()}
assert.equal(intercepted,true);assert.equal(calls,0);assert.equal(readFileSync(path.join(runtime,'.eval.lock'),'utf8'),'');
assert.equal(existsSync(path.join(runtime,'.product-voice-worker.lock')),false);
console.log(JSON.stringify({foreignPartialLockRetained:true,calls,runtime}));`).foreignPartialLockRetained).toBe(true)
  })
  it('the actual fixed-evaluation launcher and product worker contend for the same exclusive physical slot in both directions', () => {
    expect(node(`import {execFileSync} from 'node:child_process';
const runtime=syntheticRuntime(),input=syntheticJob();let child;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(){child=fakeChild();return child}});jobs.create(input);jobs.start(input.jobKey,input.inputArtifactHash);
const slot=path.join(runtime,'.eval.lock');assert.equal(JSON.parse(readFileSync(slot,'utf8')).kind,'product-voice-physical-slot');
assert.throws(()=>execFileSync(process.execPath,['scripts/ttrpg-local-tts/evaluate.mjs','--runtime-dir',runtime,'--case','narration-zh'],{stdio:'pipe'}));
assert.equal(existsSync(path.join(runtime,'evaluations')),false);child.emit('close',null,'SIGTERM');assert.equal(existsSync(slot),false);
writeFileSync(slot,JSON.stringify({runId:'existing-evaluation',pid:process.pid}));
const second=syntheticJob(2);assert.equal(jobs.create(second).canStart,false);jobs.start(second.jobKey,second.inputArtifactHash);
assert.equal(jobs.get(second.jobKey).status,'waiting-for-slot');assert.equal(JSON.parse(readFileSync(slot,'utf8')).runId,'existing-evaluation');
console.log(JSON.stringify({physicalSlotShared:true,runtime}));`).physicalSlotShared).toBe(true)
  })
  it('a stop request is not confirmed until actual child close, and a late complete output is retained separately', () => {
    expect(node(`const runtime=syntheticRuntime(),input=syntheticJob();let child,dir;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(d){dir=d;child=fakeChild();return child}});jobs.create(input);jobs.start(input.jobKey,input.inputArtifactHash);
let state=jobs.cancel(input.jobKey);assert.equal(state.cancellationRequested,true);assert.equal(state.cancellationConfirmed,false);assert.deepEqual(child.signals,['SIGTERM']);
writeSyntheticResult(dir,input);child.emit('close',0,null);state=jobs.get(input.jobKey);assert.equal(state.status,'generated');assert.equal(state.cancellationConfirmed,false);
assert.equal(jobs.raw(input.jobKey).cancellationRequested,true);console.log(JSON.stringify({lateRetained:true,runtime}));`).lateRetained).toBe(true)
  })
  it('an unobserved launch remains unknown and cannot free capacity or authorize another start from a missing PID/file alone', () => {
    expect(node(`const runtime=syntheticRuntime(),input=syntheticJob();let child;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(){child=fakeChild();return child}});jobs.create(input);jobs.start(input.jobKey,input.inputArtifactHash);
const reload=createProductVoiceJobs(runtime,{spawnWorker(){throw Error('must not restart')}});assert.equal(reload.get(input.jobKey).status,'unknown');
const second=syntheticJob(2);assert.equal(reload.create(second).canStart,false);reload.start(input.jobKey,input.inputArtifactHash);assert.equal(reload.get(input.jobKey).status,'unknown');
child.emit('close',null,'SIGTERM');console.log(JSON.stringify({unknownPreserved:true,runtime}));`).unknownPreserved).toBe(true)
  })
  it('an expired original authorization lease requests stop but keeps physical capacity until the owned child actually closes', () => {
    expect(node(`const runtime=syntheticRuntime(),input=syntheticJob();let child,dir;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(d){dir=d;child=fakeChild();return child}});jobs.create(input);jobs.start(input.jobKey,input.inputArtifactHash);
jobs.renew(input.jobKey,input.inputArtifactHash);assert.equal(JSON.parse(readFileSync(path.join(dir,'lease.json'),'utf8')).sequence,2);
const actualNow=process.hrtime.bigint;process.hrtime.bigint=()=>actualNow()+11000000000n;
try{assert.throws(()=>jobs.renew(input.jobKey,input.inputArtifactHash));await new Promise(ok=>setTimeout(ok,600));assert.deepEqual(child.signals,['SIGTERM']);
const state=jobs.get(input.jobKey);assert.equal(state.cancellationRequested,true);assert.equal(state.cancellationConfirmed,false);
assert.equal(jobs.create(syntheticJob(2)).canStart,false);assert.throws(()=>jobs.renew(input.jobKey,input.inputArtifactHash));
child.emit('close',null,'SIGTERM');assert.equal(jobs.get(input.jobKey).cancellationConfirmed,true);
assert.equal(jobs.get(syntheticJob(2).jobKey).canStart,true);
}finally{process.hrtime.bigint=actualNow}
console.log(JSON.stringify({expiredStop:true,runtime}));`).expiredStop).toBe(true)
  })
  it('rejects forged physical PCM, word timing, partial reading coverage and fabricated usage before returning raw output', () => {
    expect(node(`const input=syntheticJob(),{bytes,result}=syntheticResult(input);verifyProductResult(result,bytes,input);
const patches=[r=>r.audio.samples++,r=>r.audio.durationMs++,r=>r.alignment.wordAlignmentProvided=true,r=>r.alignment.segments[0].readingLengthUtf16--,
r=>r.usage.speechCallsCompleted++,r=>r.metrics.rms=0,r=>r.candidateAccepted=true,r=>r.audio.sampleRate=24000];
for(const patch of patches){const bad=structuredClone(result);patch(bad);assert.throws(()=>verifyProductResult(bad,bytes,input))}
const bad=Buffer.from(bytes);bad[100]^=1;assert.throws(()=>verifyProductResult(result,bad,input));
console.log(JSON.stringify({rejected:patches.length+1}));`)).toEqual({ rejected: 9 })
  })
  it('the actual HTTP bridge denies remote/foreign-origin/ordinary form requests and never starts on create or GET', () => {
    expect(node(`import {createServer} from 'node:http';import {createProductVoiceBridge,allowedProductVoiceRequest,PREFIX} from './scripts/ttrpg-local-tts/product-bridge.mjs';
const runtime=syntheticRuntime(),input=syntheticJob();let calls=0;const bridge=createProductVoiceBridge(runtime,{spawnWorker(){calls++;return fakeChild()}});
const server=createServer((req,res)=>bridge.middleware(req,res,()=>{res.writeHead(404);res.end()}));await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
try{const origin='http://127.0.0.1:'+server.address().port;
assert.equal((await fetch(origin+PREFIX+'/profile')).status,403);
assert.equal((await fetch(origin+PREFIX+'/profile',{headers:{'X-StoryForge-Tts':'1',Origin:'https://foreign.test'}})).status,403);
const headers={'X-StoryForge-Tts':'1','Content-Type':'application/json'};
assert.equal((await fetch(origin+PREFIX+'/jobs',{method:'POST',headers,body:JSON.stringify(input)})).status,200);
const response=await fetch(origin+PREFIX+'/jobs/'+input.jobKey,{headers});assert.equal((await response.json()).status,'waiting-for-slot');assert.equal(calls,0);
}finally{bridge.close();await new Promise(ok=>server.close(ok))}
console.log(JSON.stringify({calls,runtime}));`).calls).toBe(0)
  })
})
