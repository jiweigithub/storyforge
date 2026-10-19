/** Product entry ownership, separate from data/AI registries. Aliases never create another executor. */
export const AUTHORING_FEATURE_ENTRIES = [
  { id: 'longform.text-replacement', product: 'longform', status: 'stable', owner: 'Work / World by registered field',
    canonicalModule: 'global-replace', aliases: [], implementation: 'src/components/editor/FindReplacePanel.tsx',
    migration: '旧全局替换地址复用正文、实体改名和登记字段事务；手稿不迁移。' },
  { id: 'longform.discussion', product: 'longform', status: 'stable', owner: 'Work',
    canonicalModule: 'agent', aliases: [], implementation: 'src/components/agent/ChatCopilotPanel.tsx',
    migration: '旧设定查询保留只读检索；未归属历史只可显式认领。自由试写无正式写权限，提取复用 Codex durable 候选。' },
  { id: 'longform.nodes', product: 'longform', status: 'preview', owner: 'Work',
    canonicalModule: 'visual-workflows', aliases: [], implementation: 'src/components/node-authoring/NodeAuthoringWorkspace.tsx',
    migration: '旧全局提示词链保留为实验资产，兼容步骤预览后复制，不覆盖原流程。' },
  { id: 'prompt.experiment', product: 'shared-authoring', status: 'experimental', owner: 'Global templates; session drafts',
    canonicalModule: 'prompts', aliases: [], implementation: 'src/components/settings/prompt/PromptWorkflowsPanel.tsx',
    migration: '运行默认关闭；不直接写 Canon，可导出草稿或经正式提取产生候选。' },
  { id: 'longform.places', product: 'longform', status: 'stable', owner: 'World',
    canonicalModule: 'locations', aliases: ['geography', 'world-map'], implementation: 'src/components/location/PlacesWorkspace.tsx',
    migration: '旧地址进入同一地点工作区对应视图。实体、层级和布局保留身份与原始资料；仅采用明确关联，不按同名合并。' },
] as const

export function canonicalAuthoringFeatureModule(module: string): string {
  return AUTHORING_FEATURE_ENTRIES.find(entry => (entry.aliases as readonly string[]).includes(module))?.canonicalModule ?? module
}
