/** Actual React controls and isolated DB/Run commands. HTTP/PCM are synthetic;
 * these are not real speech, native playback or human listening evidence. */
import { act,createElement,StrictMode } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { db } from '../../src/lib/db/schema'
import TtrpgOpenVoiceStudio from '../../src/components/ttrpg/TtrpgOpenVoiceStudio'
import * as api from '../../src/lib/ttrpg/open-audio-service'
import { setupAudioRuntimeV1 } from '../helpers/open-audio-runtime'
import { setupLocalVoiceExecutionV1 } from '../helpers/open-local-voice'
import { setupVoiceCandidateFixtureV1 } from '../helpers/open-voice-candidate'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import profile from '../../scripts/ttrpg-local-tts/product-profile.json'
import readingProfile from '../../scripts/ttrpg-local-tts/reading-profile.json'

globalThis.IS_REACT_ACT_ENVIRONMENT=true
const response=(body:unknown)=>new Response(typeof body==='string'?body:JSON.stringify(body),{headers:{'Content-Type':'application/json'}})
function raw(packet:unknown){return execFileSync(process.execPath,['--input-type=module','-e',`
import{readFileSync}from'node:fs';import{syntheticResult}from'./tests/helpers/local-voice-product-fixture.mjs';const packet=JSON.parse(readFileSync(0,'utf8')),{bytes,result}=syntheticResult(packet);
console.log(JSON.stringify({schema:'storyforge.ttrpg-local-tts-product-raw-response',version:1,result,workerExecutionKind:'pinned-offline-worker',completionEvidence:'observed-child-close',cancellationRequested:false,audio:{encoding:'base64',data:bytes.toString('base64')},candidateAccepted:false,adoptionAllowed:false}));
`],{input:JSON.stringify(packet),encoding:'utf8'})}
describe('R-TTRPGOPEN10 normal original voice controls and local audition lifecycle',{timeout:120000},()=>{
  let host:HTMLDivElement,root:Root,props:Parameters<typeof TtrpgOpenVoiceStudio>[0],release:(()=>void)|null
  let createDescriptor:PropertyDescriptor|undefined,revokeDescriptor:PropertyDescriptor|undefined
  beforeEach(async()=>{await db.delete();await db.open();host=document.createElement('div');document.body.append(host);root=createRoot(host);release=null
    createDescriptor=Object.getOwnPropertyDescriptor(URL,'createObjectURL');revokeDescriptor=Object.getOwnPropertyDescriptor(URL,'revokeObjectURL')
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=>`blob:voice-ui-${crypto.randomUUID()}`)})
    Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()})
    vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>undefined);vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>undefined)
    vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue()
  })
  afterEach(async()=>{await act(async()=>{release?.();release=null;root.unmount()});host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()
    if(createDescriptor)Object.defineProperty(URL,'createObjectURL',createDescriptor);else Reflect.deleteProperty(URL,'createObjectURL')
    if(revokeDescriptor)Object.defineProperty(URL,'revokeObjectURL',revokeDescriptor);else Reflect.deleteProperty(URL,'revokeObjectURL');db.close()})
  const render=()=>root.render(createElement(StrictMode,null,createElement(TtrpgOpenVoiceStudio,props)))
  async function until(check:()=>boolean){for(let n=0;n<3000;n++){await act(async()=>{await new Promise(done=>setTimeout(done,5))});if(check())return}throw Error('Voice UI did not settle: '+host.textContent)}
  const button=(text:string)=>[...host.querySelectorAll('button')].find(el=>el.textContent===text)!
  async function click(text:string){await act(async()=>button(text).click())}
  async function select(label:string,value:string){await act(async()=>{const el=host.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement;el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))})}
  async function setup(input:api.TtrpgOpenAudioDeskInputV1,enabled=false){const view=await api.readTtrpgOpenAudioDeskV1(input)
    let changes=0
    const registerStop=vi.fn(),onChanged=vi.fn(async()=>{props={...props,view:await api.readTtrpgOpenAudioDeskV1(input),sequence:(await readProductRuntimeState(input.sessionId)).lastSequence};render();changes++})
    props={input,view,enabled,busy:false,sequence:view.sequence,registerStop,onChanged};await act(async()=>render());await until(()=>!!host.textContent?.includes('本轮已预留'))
    return {changes:()=>changes}
  }
  async function network(running=false){let packet:{jobKey:string;inputArtifactHash:string;execution:{profileHash:string}}|null=null,starts=0,previews=0,creates=0,cancelled=false
    const profileHash=await hashCanonicalValue(profile)
    const status=(state:string)=>({...packet!,profileHash,execution:undefined,status:state,canStart:state==='waiting-for-slot',cancellationRequested:cancelled,cancellationConfirmed:state==='cancelled-confirmed',hasResultFile:state==='generated',automaticRetryAllowed:false})
    const fetcher=vi.fn(async(url:string,init:RequestInit={})=>{
      if(url.endsWith('/reading-preview')){previews++;const value=JSON.parse(init.body as string);expect(value.decision).toBe('preview-this-original-voice-reading');const text=value.input.text,normalized=text.replaceAll('。','.')
        return response({schema:'storyforge.ttrpg-local-tts-reading-preview',version:1,profileHash:await hashCanonicalValue(readingProfile),normalizerSha256:readingProfile.normalizerSha256,status:'ready-for-reading-review',sourceText:text,sourceTextSha256:await sha256Text(text),overrides:[],readingText:text,normalizedText:normalized,normalizedTextSha256:await sha256Text(normalized),issues:[],issueCount:0,issueOffsetsReferTo:'readingText-utf16',modelCalled:false,generationAllowed:false,adoptionAllowed:false,network:'disabled'})}
      if(url.endsWith('/profile'))return response({kind:'local-offline-speech-v1',profileHash,profile})
      if(url.endsWith('/jobs')){creates++;packet=JSON.parse(init.body as string);return response(status('waiting-for-slot'))}
      if(url.endsWith('/start')){starts++;return response(status(running?'running':'generated'))}
      if(url.endsWith('/cancel')){cancelled=true;const value=status('cancelled-confirmed');delete value.execution;return response(value)}
      if(url.endsWith('/raw'))return response(raw(packet))
      const value=status(cancelled?'cancelled-confirmed':running?'running':'generated');delete value.execution;return response(value)
    });vi.stubGlobal('fetch',fetcher);return {fetcher,counts:()=>({starts,previews,creates,cancelled})}
  }
  async function chooseOriginal(key:string){await select('原配音记录',key);await until(()=>!!button('准备原本机任务')||!!button('核对原音频候选'))}
  async function retainedCandidate(){const f=await setupVoiceCandidateFixtureV1();await api.prepareTtrpgOpenVoiceCandidateV1(f.review);await setup(f.owner,true);await chooseOriginal(f.input.requestKey)
    await click('核对原音频候选');await until(()=>!!button('准备这条候选试听')&&!button('准备这条候选试听').disabled);return f}
  it('uses source → reading confirmation → one original request → retained candidate → explicit local manual audition; refresh never regenerates or adopts',async()=>{
    const f=await setupAudioRuntimeV1(true,'门口的灯。'),before=await readProductRuntimeState(f.owner.sessionId),net=await network();await setup(f.owner)
    expect(net.counts()).toEqual({starts:0,previews:0,creates:0,cancelled:false});expect(URL.createObjectURL).not.toHaveBeenCalled()
    await select('配音原文',JSON.stringify(f.narrationSourceRef));await click('预览本机读法');await until(()=>!!host.querySelector('[aria-label="确认原文读法与范围"]'))
    expect((host.querySelector('[aria-label="配音完整原文"]') as HTMLTextAreaElement).value).toBe(f.text);expect(button('确认并生成本机配音').disabled).toBe(true)
    await act(async()=>(host.querySelector('[aria-label="确认原文读法与范围"]') as HTMLInputElement).click());await click('确认并生成本机配音')
    await until(()=>!!host.querySelector('[data-testid="ttrpg-voice-candidate"]')&&!button('停止本次生成'))
    expect(net.counts()).toMatchObject({starts:1,previews:1,creates:1});expect(button('准备这条候选试听').disabled).toBe(true)
    props={...props,enabled:true};await act(async()=>render());await click('准备这条候选试听');await until(()=>!!host.querySelector('audio'))
    const element=host.querySelector('audio')!;expect(element.autoplay).toBe(false);expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    expect(element.getAttribute('src')).toBe(vi.mocked(URL.createObjectURL).mock.results[0].value);expect(element.muted).toBe(false)
    Object.defineProperty(element,'duration',{configurable:true,value:.1});await act(async()=>{element.dispatchEvent(new Event('loadedmetadata'));element.currentTime=.05;element.dispatchEvent(new Event('timeupdate'))})
    expect(host.querySelector('[aria-label="试听原文"]')!.textContent).toBe(f.text)
    expect(host.querySelector('[aria-label="本次配音原文范围"]')!.textContent).toBe(f.text)
    expect(host.querySelector('[aria-label="试听读法"] mark')!.textContent).toBe('门口的灯.')
    await act(async()=>{element.currentTime=.1;element.dispatchEvent(new Event('timeupdate'))})
    expect(host.querySelector('[aria-label="试听读法"] mark')).toBeNull();expect(button('上一段读法').disabled).toBe(false)
    await click('上一段读法');expect(element.currentTime).toBe(0);expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    await act(async()=>{await element.play()});expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    const calls=net.fetcher.mock.calls.length;await click('读取配音记录');await until(()=>!button('读取配音记录').disabled);expect(net.fetcher.mock.calls.length).toBe(calls)
    await act(async()=>window.dispatchEvent(new Event('pagehide')));expect(element.getAttribute('src')).toBeNull();expect(element.muted).toBe(true);expect(host.querySelector('audio')).toBeNull();expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    await click('准备这条候选试听');await until(()=>!!host.querySelector('audio'));const next=host.querySelector('audio')!;expect(next.getAttribute('src')).toMatch(/^blob:voice-ui-/);expect(next.muted).toBe(false)
    props={...props,enabled:false};await act(async()=>render());expect(next.getAttribute('src')).toBeNull();expect(host.querySelector('audio')).toBeNull()
    props={...props,enabled:true};await act(async()=>render());expect(host.querySelector('audio')).toBeNull();expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    const after=await readProductRuntimeState(f.owner.sessionId);expect(after.entities).toEqual(before.entities);expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(await db.productMediaAssets.count()).toBe(0);expect(after.ttrpg!.openRun!.audioReceipts??[]).toHaveLength(0);expect(after.ttrpg!.openRun!.voiceRequests).toHaveLength(1)
    expect((await db.agentRunEvents.toArray()).filter(e=>e.type==='model.requested')).toHaveLength(1)
  })
  it('keeps stop responsive during generation of a prepared original and preserves one dispatch and its original consumed budget',async()=>{
    const f=await setupLocalVoiceExecutionV1(),net=await network(true),screen=await setup(f.owner);await chooseOriginal(f.input.requestKey)
    await click('准备原本机任务');await until(()=>!!button('生成原已确认片段')&&!button('生成原已确认片段').disabled)
    await click('生成原已确认片段');await until(()=>net.counts().starts===1&&!!button('停止本次生成'))
    expect(button('停止本次生成').disabled).toBe(false);await click('停止本次生成');await until(()=>!!host.textContent?.includes('原任务已确认停止。'))
    await until(()=>!button('停止本次生成')&&screen.changes()>0);expect(net.counts()).toMatchObject({starts:1,creates:1,cancelled:true})
    expect((await api.readTtrpgOpenVoiceRequestDeskV1(f.owner)).budget?.requests).toBe(1)
    expect((await db.agentRunEvents.toArray()).filter(e=>e.type==='model.requested')).toHaveLength(1)
    expect(host.querySelector('audio')).toBeNull();expect(await db.productMediaAssets.count()).toBe(0)
  })
  it('drops a delayed audition after mute and re-enable instead of reviving it in the same component',async()=>{
    const f=await retainedCandidate(),actual=api.prepareTtrpgOpenVoiceAuditionV1;let entered=false,returned=false
    vi.spyOn(api,'prepareTtrpgOpenVoiceAuditionV1').mockImplementationOnce(async input=>{const result=await actual(input);entered=true;await new Promise<void>(done=>{release=done});returned=true;return result})
    await click('准备这条候选试听');await until(()=>entered)
    props={...props,enabled:false};await act(async()=>render());props={...props,enabled:true};await act(async()=>render())
    await act(async()=>{release?.();release=null});await until(()=>returned&&!button('准备这条候选试听').disabled)
    expect(URL.createObjectURL).not.toHaveBeenCalled();expect(host.querySelector('audio')).toBeNull();expect(f.fetcher).not.toHaveBeenCalled();expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('immediately removes an actual preview URL when the original candidate evidence is deleted',async()=>{
    const f=await retainedCandidate();await click('准备这条候选试听');await until(()=>!!host.querySelector('audio'));const element=host.querySelector('audio')!
    await act(async()=>{await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([f.owner.scope.projectId,'raw-response',(await api.readTtrpgOpenVoiceCandidateV1(f.input))!.candidate.artifact.evidence.rawResponseArtifactHash]).delete()})
    await until(()=>host.querySelector('audio')===null);expect(element.getAttribute('src')).toBeNull();expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled()
  })
})
