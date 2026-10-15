/** Product rules selected only for the new frozen producer/reviewer versions. */
export const CHAT_COMMITMENT_ACTION_RULES_V1 = [
  '先核对自身 goals 中的 commitments 和 sharedCommitments 中共同知晓的约定。resolution=null 表示尚未处理；在相关时机依据已知条件实际履行、说明具体阻碍或明确撤回，不反复重说承诺代替行动，不因为用户离开应用就认定迟到或失约。约定不会替玩家决定参与、情感或同意。',
  'commitmentEffects 默认 []，最多四项。只有本次对玩家明确作出的、可辨认履行条件的自身约定才用 {kind:"promise",terms:"逐字条款",evidenceExcerpt:"本次原话"}，terms 必须完整出现在摘录中；系统生成身份、听众和事件。普通意向、邀请、客套、推测和条件未定的提议不登记；不要为了填字段强造承诺。仅绑定自己的当前 active/paused 目标，同一目标只可有一个未处理承诺。',
  '实际履行旧承诺时用 {kind:"fulfill",commitmentKey:"原标识",evidenceExcerpt:"本次实际行为或交付的逐字证据"}；只有 kind=complete 且 waitingForPlayer=false 可履行。必须满足原条款，不用“已经办好”空话、下一步计划、一次尝试或玩家尚未做出的选择代替结果。明确撤回用 kind:"withdraw" 及原标识、撤回原话；不能因拒绝邀请或离线自动撤回或惩罚。',
  '改约必须同时明确 withdraw 原约并 promise 新条款，两份记录都保留；这只改变角色自己的承担，不表示玩家接受新安排。处置须包含原约全部听众，目标结束前必须履行或明确撤回未处理承诺。不要用完成整个 goal 代替处理具体约定；也不必为一次履约结束仍有其它事项的目标。所有摘录只来自本次 text。',
]

export const CHAT_COMMITMENT_REVIEW_RULES_V1 = [
  '承诺专审：先读本次正文，再核对 commitmentEffects 与自身目标中的原 commitments。明确的新约定、实际履行或明确撤回若漏记，在 consequences 判失败；普通计划、客套、邀约或条件未定的提议不得硬登记成承诺。不能只凭类型、摘录相符或摘要里写着“答应”就通过。',
  '对每个 commitmentEffects 的原数组索引给出 commitmentChecks={effectIndex,passed,reason}。promise 要有完整、明确、可履行的自身条款，适合当前目标和动机，不能替玩家或别人承担；fulfill 要逐项对照原 terms 与本次已完成行为/交付，确认范围、时点和必要条件，不接受自称完成却无实际依据、只完成部分、语义偷换、意向、尝试或等待选择。withdraw 必须实际明确撤回原约，不能因玩家拒绝、休息或离线推断失约。',
  '改约须明确处置旧约并形成新约，分别审查两项，不能抹去原历史、默认玩家接受或自动改变关系。等待玩家回答另一件事不妨碍已经明确作出的无条件声明/撤回，但不得把待玩家同意的条件约定记成已成立；履约仍不可等待玩家。公开条款及摘录不得夹带角色私有动机或未知秘密。任一项不通过时整条候选不采用。',
]
