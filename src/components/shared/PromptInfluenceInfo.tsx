import type { ChatMessage } from '../../lib/types'
import type { AgentContextEvidence } from '../../lib/agent/context-policy'
import type { PromptExecutionEvidenceV1 } from '../../lib/agent/prompt-execution'
import { CONTINUITY_CORE_START, CONTINUITY_CORE_END } from '../../lib/ai/chapter-memory/continuity-envelope'
import { SIMPLIFIED_CHINESE_OUTPUT_CONSTRAINT } from '../../lib/ai/adapters/prompt-guards'

type ContextSources = Pick<AgentContextEvidence, 'included' | 'omitted' | 'trimmed' | 'sourceEvidence'>
const SOURCES = [
  ['creativeRules', '作品创作规则', '作者的写作偏好'],
  ['worldRules', '真实与幻想', '世界事实的取舍'],
  ['userStyleProfile', '我的文风', '已启用的学习画像'],
  ['references', '引用手法', '本次选用的参考资料'],
] as const

/** Displays the supplied run/preview evidence; never reads whichever template happens to be active now. */
export default function PromptInfluenceInfo({ context, prompt, messages }: { context?: ContextSources; prompt?: PromptExecutionEvidenceV1; messages?: ChatMessage[] }) {
  const text = messages?.map(message => message.content).join('\n') ?? ''
  const state = (key: string) => {
    if (!context) return '未提供本次证据'
    if (context.trimmed.includes(key)) return '因预算移除'
    const source = context.sourceEvidence?.find(item => item.key === key)
    if (source) return { full: '全文纳入', compressed: '压缩纳入', truncated: '截断纳入', none: '未纳入' }[source.delivery]
    return context.included.includes(key) ? '已纳入（旧证据）' : '本次未纳入'
  }
  return <details className="rounded border border-border/60 p-2 text-xs" aria-label="提示词与文风来源">
    <summary className="cursor-pointer text-text-secondary">提示词与文风来源、覆盖关系</summary>
    <div className="mt-2 space-y-2 text-text-muted">
      {prompt && <p>本次冻结模板：{prompt.templateName}（{prompt.templateScope === 'user' ? '用户模板' : '系统模板'}，{prompt.moduleKey}）。温度：{prompt.effectiveTemperature ?? '按配置'}；输出上限：{prompt.effectiveMaxTokens ?? '按配置'}。</p>}
      <p>本次参数覆盖同名模板默认值；临时 System / User 模板覆盖只作用于对应消息。作品创作规则、世界事实和文风画像分别保留职责，是否进入本次上下文以以下记录为准。</p>
      {context && <table className="w-full text-left"><thead><tr><th>来源</th><th>用途</th><th>本次状态</th></tr></thead><tbody>{SOURCES.map(([key, label, purpose]) => <tr key={key}><td className="py-1 pr-2">{label}</td><td className="pr-2">{purpose}</td><td>{state(key)}</td></tr>)}</tbody></table>}
      {messages && <><p>最终消息：{messages.map(message => message.role).join(' → ')}。下方可以逐条核对；编辑只影响本次请求。</p>{text.includes('本轮作者明确指定的篇幅、文风、章节收尾和禁止事项优先于模板默认值') && <p>本次包含：作者明确指定的写法、篇幅和收尾优先于模板默认，仍须遵守作品信息边界。</p>}{text.includes(CONTINUITY_CORE_START) && text.includes(CONTINUITY_CORE_END) && <p>本次包含：章节连续性保护块，约束已发生事实和续写位置。</p>}{text.includes(SIMPLIFIED_CHINESE_OUTPUT_CONSTRAINT) && <p>本次包含：简体中文输出约束。</p>}</>}
      <p>提示词只能引导模型。作用域、版本与作者确认由系统校验；讨论、实验草稿和未采纳候选不会自动成为作品事实。</p>
    </div>
  </details>
}
