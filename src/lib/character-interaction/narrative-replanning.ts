/** New instructions clarify existing, deterministic goal and situation APIs.
 * Never retrofit them into a saved producer, review, or expression-only repair. */
export function supportsChatReplanningPromptV1(version: string | undefined): boolean {
  return ['chat-narrative-action-v36', 'chat-narrative-options-v26'].includes(version ?? '')
}
export function supportsChatReplanningReviewV1(version: string | undefined): boolean {
  return ['chat-narrative-action-review-v29', 'chat-narrative-options-review-v23', 'chat-narrative-action-review-v30', 'chat-narrative-options-review-v24'].includes(version ?? '')
}

export const CHAT_REPLANNING_ACTION_RULES_V1 = [
  '原目标未完成时，先区分目标、已经试过的办法、实际所得与尚未知的条件，再选本轮行动。一次局部检查无结果，只排除实际看清的范围；一种办法受阻，不等于整个目标都无法继续。结合人物愿望与最近几轮，考虑不同证据来源、沟通或核实可接触条件，不无限细分同类检查，也不把谨慎反复说成进展。',
  '已有事实足以做自己的下一步，就直接做；真正缺少局部可行动条件时，可沿原目标和原剧情线提出有依据的 situationRequest，核实可用办法或可接触对象。请求可以保留“是否”的不确定性，不要求先知道答案才请求背景；但不得预定新人物在场、愿意回答、掌握线索、玩家参与或成功。不能从幕后答案倒推调查位置，不能把新事实、时间变化或许可写进请求当作既成事实。',
  '若原目标只是自己暂缓、没有 playerPause，而本轮依据支持换一种办法，可保留原 goalKey，用 goalStatus=active 和实际表达一起恢复；需要局部情境时可在同条行动附上 situationRequest。无需新建相同目标或填 resumeGoal。原阻碍没有因此消失：新办法须独立于仍存在的阻碍，原事实、检查结果、承诺和玩家选择全部保留。',
  '有 playerPause 时严格沿原 resumeGoal 授权恢复；明确休息、停止或尚待玩家决定的事项不能借重规划绕过。玩家不亲自参与不自动暂停角色自己的任务。continue/return 只给本轮选择机会，不表示玩家同意、时间流逝或外部条件改善。',
  '确有当前依据表明暂无可行办法，或人物有充分理由选择停止时，可以暂停或放弃，不要求每轮找出线索或达成目标。说明具体受阻范围与仍未完成的部分；需要等待的条件只能来自已有依据，不能虚构。对比最近几轮：若只是重述相同顾虑和未知范围，没有新的理由、信息、选择或后果，不把它包装成有意义推进，也不凭空制造危机来填空。',
]
export const CHAT_REPLANNING_REVIEW_RULES_V1 = [
  'meaningful-direction 须对照原目标、已经提交的观察/调查结果、现有打算和最近几轮表达，判断本次是在推进原事项、合理改变办法、回应玩家，还是只是重复。字段合法和未越界不足以证明有意义；连续重述同一顾虑、等待或未知范围而无新理由/信息/选择/后果，不能只因语气自然判通过。玩家明确要求休息、玩家暂停未解除、当前确有完整阻碍或自然的日常对话仍可合理回应，不要求虚构进展。',
  '暂停审查要区分一种办法受阻与原目标整体暂不可行：局部无结果不能证明所有范围都查完，出门受阻不能自动否定不依赖出门的办法。核对角色动机、当前可知条件与已获准的局部情境请求路径；仍有有依据且不重复的替代方向却无理由退回同一等待时，在 meaningful-direction 说明。没有事实支持的“替代办法”也不能强行要求执行，更不能依据审查者可见的隐情替角色规划或保证一定找到线索。',
  '没有 playerPause 的原目标可在同条行动中 goalStatus=active，再按已有权限请求有限情境；这是原责任换办法，不是新目标或事实。continuity/consequences 核对恢复表达与字段一致，旧阻碍、事实、约定及玩家边界仍在；含 playerPause 时继续严格核对真实解除依据。情境请求只核实尚未知的局部条件，不预定对象、答案或结果；审查理由应结合本次具体证据，不能用“允许暂停”概括替代连续性判断。',
]
