import { useLayoutEffect,useRef,useState } from 'react'
import type { TtrpgOpenVoiceAuditionV1 } from '../../lib/ttrpg/open-voice-audition'

/** A private draft preview, not an accepted E16 track or word alignment. */
export default function TtrpgOpenVoiceAuditionPlayer(props: { audition: TtrpgOpenVoiceAuditionV1; url: string; register: (stop: (()=>void)|null)=>void; onFailure: ()=>void }) {
  const node=useRef<HTMLAudioElement|null>(null),[active,setActive]=useState(-1)
  const {timeline,readingText,originalText}=props.audition
  const {url,register}=props
  useLayoutEffect(()=>{
    const element=node.current
    if(!element)return
    element.src=url;element.muted=false
    const stop=()=>{element.muted=true;element.pause();element.removeAttribute('src');element.load()}
    register(stop)
    return()=>{stop();register(null)}
  },[url,register])
  const sample=(element:HTMLAudioElement)=>{
    const position=element.currentTime*timeline.sampleRate
    setActive(timeline.segments.findIndex(row=>position>=row.sampleOffset&&position<row.sampleOffset+row.sampleCount))
  }
  const segment=active>=0?timeline.segments[active]:undefined
  const seek=(index:number)=>{
    const element=node.current,row=timeline.segments[index]
    if(!element||!row||!Number.isFinite(element.duration))return
    element.currentTime=Math.min(element.duration,row.sampleOffset/timeline.sampleRate);sample(element)
  }
  return <section data-testid="ttrpg-voice-audition">
    <h4>本次候选试听</h4><p>仅供本人核对，尚未加入本局音轨。</p>
    <p className="sf-open-audio-caption" aria-label="试听原文">{originalText}</p>
    <p className="sf-open-audio-caption" aria-label="试听读法">{segment?<>{readingText.slice(0,segment.readingOffsetUtf16)}<mark>{readingText.slice(segment.readingOffsetUtf16,segment.readingOffsetUtf16+segment.readingLengthUtf16)}</mark>{readingText.slice(segment.readingOffsetUtf16+segment.readingLengthUtf16)}</>:readingText}</p>
    <p>高亮按实际朗读片段定位，不代表逐字时间。</p>
    <audio ref={node} controls preload="metadata" src={props.url} aria-label="候选配音试听" onTimeUpdate={e=>sample(e.currentTarget)} onSeeked={e=>sample(e.currentTarget)}
      onLoadedMetadata={e=>{const el=e.currentTarget,expected=timeline.samples/timeline.sampleRate;if(!Number.isFinite(el.duration)||el.duration<=0||Math.abs(el.duration-expected)>.02){el.pause();props.onFailure()}}}
      onError={props.onFailure}/>
    <div className="sf-open-audio-actions"><button disabled={active<=0} onClick={()=>seek(active-1)}>上一段读法</button><button disabled={active<0} onClick={()=>seek(active)}>本段开头</button><button disabled={active+1>=timeline.segments.length} onClick={()=>seek(active+1)}>下一段读法</button></div>
  </section>
}
