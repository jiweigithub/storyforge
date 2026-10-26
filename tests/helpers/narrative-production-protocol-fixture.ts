/** Deterministic model-protocol material; never a real model or author-quality receipt. */
export function narrativeProductionProtocolFixtureV4(system: string, product: 'chat' | 'avg') {
  const task = system.match(/任务=([^。]+)。/)?.[1]
  const worldAnchor = system.match(/world:[a-f0-9]{64}/)?.[0]
  if (!task || (task === 'content.design' && !worldAnchor)) throw Error('NW v4 fixture requires the task identity and the design source anchor')
  const outputs: Record<string, unknown> = {
    'content.design': {
      schema: 'storyforge.product-design-artifact', version: 1, title: '渡口的约定',
      logline: '与守渡人商议修桥约定，再选择现在行动或继续等待。',
      playerGoal: '了解修桥约定并决定下一步。', coreLoop: ['阅读', '选择', '观察后果'],
      sourceAnchors: [worldAnchor], invariants: ['不改写冻结世界事实'], tone: ['清晰', '克制'],
      targetPlayMinutes: 20, targetEndingCount: 2,
    },
    'content.narrative': {
      schema: 'storyforge.product-narrative-artifact', version: 1, moduleKind: 'main', moduleTitle: '渡口的约定',
      entryNodeKey: 'opening',
      nodes: [
        { key: 'opening', kind: 'entry', title: '桥边', summary: '在桥边商议接下来的行动。', condition: {}, effects: [] },
        { key: 'ending.return', kind: 'ending', title: '回到渡口', summary: '先回到渡口整理工具。', condition: {}, effects: [] },
        { key: 'ending.wait', kind: 'ending', title: '留在桥边', summary: '留在桥边继续等待。', condition: {}, effects: [] },
      ],
      beats: [
        { beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '桥边的风停了。你可以决定下一步。', order: 0 },
        { beatKey: 'beat.return', nodeKey: 'ending.return', kind: 'narration', speakerKey: null, text: '你回到渡口整理工具。', order: 0 },
        { beatKey: 'beat.wait', nodeKey: 'ending.wait', kind: 'narration', speakerKey: null, text: '你留在桥边继续等待。', order: 0 },
      ],
      choices: [
        { choiceKey: 'choice.return', sourceNodeKey: 'opening', text: '回到渡口', description: '整理工具', unavailableReason: '',
          targetNodeKey: 'ending.return', displayCondition: {}, availableCondition: {}, effects: [], tags: [], order: 0 },
        { choiceKey: 'choice.wait', sourceNodeKey: 'opening', text: '留在桥边', description: '继续等待', unavailableReason: '',
          targetNodeKey: 'ending.wait', displayCondition: {}, availableCondition: {}, effects: [], tags: [], order: 1 },
      ],
    },
    'content.product-module': {
      schema: 'storyforge.product-module-artifact', version: 1, productType: product === 'chat' ? 'character-interaction' : 'avg',
      interfaceStyle: '清晰文字界面', interactionNotes: ['作者选择后再推进。'],
      presentationPolicy: { pacing: 'fast', transitionMs: 0, backgroundStrategy: 'none' },
    },
    'media.requirements': { schema: 'storyforge.product-media-requirements-artifact', version: 2, visual: [], audio: [] },
  }
  if (!Object.prototype.hasOwnProperty.call(outputs, task)) throw Error(`Unrecognized NW v4 fixture task: ${task}`)
  return { task, output: outputs[task] }
}
