import type {ChatAuthoringSettings} from '../../lib/character-interaction/authoring-contract'

/** Navigation over the existing draft/production flow; never authorizes a build. */
export default function WorkflowGuide({page, settings, worldSelected, hasProduction, hasRelease, busy, onNavigate}: {
  page: string
  settings: ChatAuthoringSettings
  worldSelected: boolean
  hasProduction: boolean
  hasRelease: boolean
  busy: boolean
  onNavigate: (page: string) => void
}) {
  if (settings.version !== 3 || settings.mode !== 'single' || ['play', 'history', 'memory-review', 'library'].includes(page)) return null
  const castCount = settings.characters.length + (settings.privateCharacters?.length ?? 0)
  const next = hasRelease
    ? {page: 'play', label: '开始对话', detail: '已发布的版本可以新建会话。对话页可查看画面、使用语音并继续存档。'}
    : hasProduction
      ? {page: 'production', label: '继续制作与检查', detail: '选择开场，确认实际图片，再检查和发布。遇到失败可在原制作记录中处理。'}
      : !settings.playerRole.trim() || !settings.openingSituation.trim()
        ? {page: 'vision', label: '填写玩家与情境', detail: '先写你扮演谁，以及角色正在面对的情境或矛盾。'}
        : !worldSelected
          ? {page: 'source', label: '选择世界版本', detail: '选择已冻结的世界作为来源，随后配置本次聊天的角色。'}
          : castCount !== 1 || !settings.sourceReview
            ? {page: 'cast', label: '确认角色与知情范围', detail: '选择或新建一名角色，确认谁知道哪些资料；也可以填写人物外观和场景画面。'}
            : {page: 'confirm', label: '确认方案并开始制作', detail: '可选择纯文字或带图片的制作。开始后选择开场、确认图片，再发布和游玩。'}
  return <section className="lf-paper space-y-2" aria-label="单角色体验指引">
    <h3>单角色故事 · 技术预览</h3>
    <p>设定情境 → 确认角色 → 制作开场与画面 → 发布并对话</p>
    <p>{next.detail}</p>
    <p className="text-sm text-text-muted">角色可主动行动；语音输入和朗读使用当前浏览器的设备能力。剧情效果仍待体验评估。</p>
    {page !== next.page && <button type="button" className="lf-action lf-action-primary" disabled={busy} onClick={() => onNavigate(next.page)}>{next.label}</button>}
  </section>
}
