/** New contracts alone describe typed replies. Historical prompt bytes stay intact. */
export function supportsChatSpokenInquiryReviewV1(version: string | undefined): boolean {
  return ['chat-narrative-action-review-v30', 'chat-narrative-action-review-v31', 'chat-narrative-action-review-v32', 'chat-narrative-action-review-v33', 'chat-narrative-action-review-v34', 'chat-narrative-action-review-v35', 'chat-narrative-options-review-v24', 'chat-narrative-options-review-v25', 'chat-narrative-options-review-v26'].includes(version ?? '')
}

export const CHAT_SPOKEN_INQUIRY_REVIEW_RULES_V1 = [
  '区分已经说出的询问与已经完成的物理观察。speak 的真实问话会随行动原子保存为角色消息，普通 situationRequest 的 sourceEventSequence 由系统绑定该消息；newFacts=[] 正是这种纯语言行为的合法形式，不要求另记“问过”的调查事实，也不因此判 consequences 或 meaningful-direction 失败。不能用 speak 掩盖正文实际完成的移动、翻动、检查、得到答复或发现；物理后果、披露及其它真实变化仍须按各自合同核对。',
  '向非玩家对象发问且不需玩家决定时，speak + waitingForPlayer=false 可以成立；实际请求玩家许可仍须交还选择。问话不证明有人在场、听到、愿意作答或已经回答。公开呼唤不能凭空建立答复者，普通情境请求不应冒充 observation-result；后续 inquiryResult 仍须已有在场人物、实际问题、答复听众和冻结发现证据。合法问话仍须有意义且不泄密，不能因形式合法而放过重复追问、预写他人回答或替玩家决定。',
]

export function chatInquiryGenerationRulesV1(version: string | undefined): string[] {
  if (!['chat-situation-construction-v8', 'chat-situation-construction-v9', 'chat-situation-construction-v10', 'chat-situation-construction-v11', 'chat-situation-construction-v12'].includes(version ?? '')) return []
  return [
    '新合同可在上述 JSON 中另加 inquiryResult，但只有 permissions.allowInquiryResults=true 且 continued-thread 正在承接一条已实际提出的问题时使用。不要把提问当答案，不能靠 newFacts 绕过询问的知情检查。',
    'inquiryResult={actorKey,questionSequence,questionExcerpt,respondentFactKey,respondentExcerpt,respondentName,statementFactKey,answerKind,answerText,audienceKeys,evidenceFactKeys,discoveries:[{factKey,answerExcerpt,reason}]}。questionSequence 必须等于 pendingSituation.sourceEventSequence，questionExcerpt 精确摘录该角色已发生的消息；必须是真正向对象提出的问题，不能是准备问、想象或未来安排。',
    'respondentFactKey 引用问题提出前已知、证明该场景人物在场且可以交谈的事实；respondentExcerpt 摘录此事实并含 respondentName。不能把事物、传说、旧信件或“也许有人”当成现场人物；不能代替玩家或其他可调度主角色回应，不能捏造知情能力。answerText 是此人本次实际说出的有限回答，answerKind 为 statement、uncertain 或 declined。',
    'answerText 须直接承接问题，在既定事实与该人物真实可知范围内提供具体回应。输入没有预写答案不等于人物失忆；未写定的普通细节只可在 observation 授权内补足。拒答、不确定和误导性陈述均可成立但须有具体情境依据，不以重复问题或无依据澄清充当进展。记录只证明说过，不自动把陈述内容当成真相。',
    'audienceKeys 是实际听见答复者，必须含提问者并限于原问题听众；私下答复可不含 player，此时玩家页面不会显示原话。公开答复须含 player，不能正文让玩家听到却把状态写成未知。evidenceFactKeys 必须含人物依据及调查前提，且全部来自 pendingSituation.evidenceFactKeys，保证它们在实际提问时已作为依据。statementFactKey 是本次唯一说法记录身份，由系统根据实际答复生成事实正文，不能提前复用旧身份。',
    'discoveries 仅列本次回答能完整证明、并满足原始 discovery 条件的既定事实单位；每项 answerExcerpt 必须摘录 answerText 中具体证据，reason 对照完整原文、人物知情依据、条件和前提。人物说一句并不当然证明为真；只有冻结原文及条件支持时才能确认。不能凭位置解锁经手者/用途，不能新造发现规则或用说法绕过秘密权限。听众会同时获知经确认的这一项事实；不满足条件时保留为未核实说法，不能夹带秘密。declined 的 discoveries 必须为空。',
    '有 inquiryResult 时保持 title/location/timeLabel，newFacts/newGoals/newThreads/possibilities 和顶层 discoveries 均为空或省略；系统原子记录真实答复、说法及逐项知情变化，之后由角色自行承接。不要在答复中预写玩家/主角色行动、替其接受任务或完成后续调查。',
  ]
}
export function chatInquiryReviewRulesV1(): string[] {
  return [
    '本候选包含 inquiryResult。除原五项检查，必须提供 inquiryReview={checks:[{check,passed,reason}],discoveries:[{factKey,passed,reason}]}；checks 恰含 actual-question、grounded-respondent、bounded-answer、actual-audience、meaningful-result，discoveries 恰好覆盖候选的每项事实发现。任一项不确定或不通过都拒绝整项答复，不得遗漏困难的检查。',
    'actual-question：逐字比对 questionSequence/excerpt 和 pendingSituation，必须是已经对该对象问出的问题，不是意向、转述假设或后来取消的尝试。grounded-respondent：人物依据确实证明答复者在当前现场可交谈，名字、身份一致，有依据的知情范围未被扩写；拒绝冒充玩家或任何可调度主角色、把物品或记录当成人物。',
    'bounded-answer：只是该场景人物实际回应，未执行未来行动或替玩家/主角色决定；具体普通回应可在冻结 observation 权限内生成，但不能改写真相、凭空编造永久阻碍或知识来源。陈述只是说法，谎言/猜测/不知道不能变成已证事实，未授权秘密连作为暗示或谎话也不能泄露。',
    'actual-audience：回答声量、私下/公开叙述与 audienceKeys 完全一致；只有实际听到者可看见原话并获得确认事实。meaningful-result：回应原问题的具体内容，说明已确认部分或有情境依据的未知/拒答，为角色继续推演提供真实变化，不能编造歧义让角色重复问同一问题。',
    '对每个 discovery 单独复核：冻结原文是否支持此人物知道该事，当前实际回答与证据是否满足完整 discovery.condition，answerExcerpt 是否足以证明整项事实而非相邻半项。只满足地点不能解锁经手者/用途；答复说过并不证明说法为真。没有足够来源与条件证据必须 passed=false。发现通过才允许实际听众获知；其它未知单位继续隐藏。',
    '本次严格输出 JSON {"checks":[原五项],"inquiryReview":{"checks":[上述五项独立询问检查],"discoveries":[每项事实发现检查]}}，不输出 reviewedProposalJson 或其它字段。',
  ]
}
