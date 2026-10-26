import {DEFAULT_CHAT_VISUAL_INTENT_V2, type ChatVisualIntent} from '../../lib/character-interaction/visual-intent'

export default function VisualIntent({value, characters, disabled, onChange}: {
  value?: ChatVisualIntent
  characters: Array<{characterKey: string; name: string}>
  disabled: boolean
  onChange: (value: ChatVisualIntent | undefined) => void
}) {
  const current = value ?? DEFAULT_CHAT_VISUAL_INTENT_V2
  const known = new Set(characters.map(character => character.characterKey))
  const changeCharacter = (characterKey: string, description: string) => {
    const existing = current.characters.find(row => row.characterKey === characterKey)
    onChange({...current, characters: !description.trim() ? current.characters.filter(row => row.characterKey !== characterKey)
      : existing ? current.characters.map(row => row.characterKey === characterKey ? {...row, description} : row)
        : [...current.characters, {characterKey, description}]})
  }
  return <details className="col-span-full space-y-3" aria-label="公开画面描述">
    <summary>角色与场景美术设计</summary>
    <p>制作时先依据世界公开设定、确认角色和选定故事情境设计人物与场景，再生成真实图片。下面的外观描述是可选补充，无需从零写图片提示词。</p>
    {current.version === 1 ? <button type="button" className="lf-action" disabled={disabled} onClick={() => onChange({...DEFAULT_CHAT_VISUAL_INTENT_V2, characters: current.characters, openingBackground: current.openingBackground})}>改为依据世界与故事设计</button> : <>
      <label className="block">统一画风<textarea className="w-full" aria-label="统一画风" disabled={disabled} maxLength={2000} value={current.style} onChange={event => onChange({...current, style: event.target.value})}/></label>
      <label className="flex gap-2"><input type="checkbox" disabled={disabled} checked={current.runtimeImages} onChange={event => onChange({...current, runtimeImages: event.target.checked})}/>随已发生的剧情生成场景、表情与插图（每个存档最多 60 张，可在游玩时暂停）</label>
      {!value && <button type="button" className="lf-action" disabled={disabled} onClick={() => onChange(structuredClone(DEFAULT_CHAT_VISUAL_INTENT_V2))}>启用世界与故事配图</button>}
    </> }
    <p>这里保存画面草稿，不会调用图片服务。可在制作页明确选择图片目标；生成后还需检查原图并确认用途。</p>
    {characters.map(character => <label key={character.characterKey} className="block">{character.name} · 公开外观
      <textarea className="w-full" disabled={disabled} maxLength={4000} aria-label={`${character.name} · 公开外观`}
        placeholder="可选：希望保留的外貌或服装；留空由已确认角色资料设计"
        value={current.characters.find(row => row.characterKey === character.characterKey)?.description ?? ''}
        onChange={event => changeCharacter(character.characterKey, event.target.value)}/>
    </label>)}
    {current.characters.filter(row => !known.has(row.characterKey)).map(row => <div key={row.characterKey} className="rounded border border-warning p-2">
      <p role="status">此人物已不在当前聊天中。描述仍保留，制作前需要重新选择人物或移除。</p>
      <p>{row.description}</p>
      <button type="button" className="lf-action" disabled={disabled} onClick={() => changeCharacter(row.characterKey, '')}>移除旧人物画面描述</button>
    </div>)}
    <label className="block">开场背景
      <textarea className="w-full" disabled={disabled} maxLength={4000} aria-label="开场背景画面描述"
        placeholder="可选：场景构图偏好；地点、时间和天气来自选定故事情境"
        value={current.openingBackground} onChange={event => onChange({...current, openingBackground: event.target.value})}/>
    </label>
    {value && <button type="button" className="lf-action" disabled={disabled} onClick={() => onChange(undefined)}>移除画面草稿</button>}
  </details>
}
