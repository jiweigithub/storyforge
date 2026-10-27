import {useState, type ReactNode} from 'react'
import type {ChatImageView, ChatMediaView} from './useChatMedia'

export function ChatImage({image, className, fallback = null}: {image?: ChatImageView | null; className?: string; fallback?: ReactNode}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  return image && failedUrl !== image.url ? <img src={image.url} alt={image.alt} className={className} loading="lazy" onError={() => setFailedUrl(image.url)} /> : fallback
}

export default function ChatMedia({media, open, panelId, onToggle}: {media: ChatMediaView; open: boolean; panelId: string; onToggle: () => void}) {
  if (!media.background && !media.portraits.length && !media.missing && !media.runtime) return null
  return <button type="button" className="chat-media-toggle" data-testid="chat-media-details" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>{media.runtime?.running ? '画面生成中…' : '查看画面'}</button>
}

export function ChatMediaGallery({media, id}: {media: ChatMediaView; id: string}) {
  return <div id={id} className="chat-media-gallery" aria-label="当前人物与场景">
      {media.runtime && <div className="col-span-full space-y-2" aria-live="polite">
        <p>{media.runtime.running ? '正在根据已发生的剧情生成图片，可继续聊天。' : media.runtime.paused ? '随剧情配图已暂停。' : '画面随已发生的剧情更新。'} 已请求 {media.runtime.count} / 60 张。</p>
        {media.runtime.issue && <p role="status">{media.runtime.issue}</p>}
        <button className="lf-action" type="button" onClick={media.runtime.toggle}>{media.runtime.paused ? '启用随剧情配图' : '暂停随剧情配图'}</button>{' '}
        <button className="lf-action" type="button" disabled={media.runtime.running} onClick={media.runtime.update}>补齐当前画面</button>
        {media.runtime.retry && <><span> </span><button className="lf-action" type="button" disabled={media.runtime.running} onClick={media.runtime.retry}>重做失败画面</button><p>这是新的图片请求；每个画面最多尝试 3 次，原失败记录保留。结果未确认的请求不会重发。</p></>}
      </div>}
      {media.background && <ChatImage image={media.background} className="chat-scene-picture" />}
      <div className="chat-portraits">{media.portraits.map(person => <figure key={person.participantKey}>
        <ChatImage image={person} className="chat-portrait" /><figcaption>{person.name}</figcaption>
      </figure>)}</div>
      {media.illustration && <figure className="col-span-full"><ChatImage image={media.illustration} className="chat-scene-picture"/><figcaption>{media.illustration.alt}</figcaption></figure>}
      {media.missing > 0 && <p>部分图片暂不可用，仍可继续文字聊天。</p>}
    </div>
}
