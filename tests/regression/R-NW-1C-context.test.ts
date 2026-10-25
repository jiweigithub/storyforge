import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readNarrativeCanonContextV1 } from '../../src/lib/world-engine/narrative-domain-context'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { readAuthoringCanonBinding } from '../../src/lib/node-authoring/bindings'
import { AUTHORING_NODE_BY_ID } from '../../src/lib/node-authoring/catalog'
import { seedConfirmedNarrativeDomainV1 } from '../helpers/narrative-domain-fixture'
import corpus from '../acceptance/narrative-world/corpus-v1.json'

describe('NW-1C · 节点和分步骤读取同一作者确认投影', () => {
  beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000); await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.useRealTimers() })

  it('两种现有入口实际读到相同注释，保留真相、误信、意图和历史区别', async () => {
    const fixture = await seedConfirmedNarrativeDomainV1()
    const template = AUTHORING_NODE_BY_ID.get('source.world-rules')!
    const input = { projectId: fixture.scope.projectId, scope: fixture.scope, worldGroupId: fixture.group.id }
    const stepwise = await assembleContext({ ...input, sourceKeys: ['canonAssertions'], inputBudgetTokens: 12_000 })
    const node = await readAuthoringCanonBinding({ ...input, contextBudget: 12_000, node: {
      id: 'shared-canon', templateId: template.id, templateVersion: 1, title: template.label,
      x: 0, y: 0, inputs: template.inputs, outputs: template.outputs, config: { sourceKeys: ['canonAssertions'] },
    } })
    expect(node.content).toBe(stepwise.text)
    expect(stepwise.sourceEvidence?.find(item => item.key === 'canonAssertions')?.delivery).toBe('full')
    expect(stepwise.text).toContain(corpus.families[0].seed.truth)
    expect(stepwise.text).toContain(corpus.families[0].seed.belief)
    expect(stepwise.text).toContain(corpus.families[0].seed.plannedText)
    expect(stepwise.text).toContain('角色信念，不代表客观事实')
    expect(stepwise.text).toContain('作者意图，尚未兑现')
    expect(stepwise.text).toContain('历史状态')
    expect(stepwise.text).not.toContain('candidate-adoption')
  })

  it('来源改动后读取拒绝沿用旧确认，依赖闭包也不继续泄露旧误信', async () => {
    const fixture = await seedConfirmedNarrativeDomainV1()
    const input = { scope: fixture.scope, worldGroupId: fixture.group.id }
    expect(await readNarrativeCanonContextV1(input)).toContain(corpus.families[0].seed.belief)
    await db.characters.update(fixture.ids.a, { name: '修改后尚未确认的角色' })
    const result = await readNarrativeCanonContextV1(input)
    expect(result).toContain('stale')
    expect(result).toContain('dependency-gap')
    expect(result).not.toContain(corpus.families[0].seed.belief)
    expect(result).not.toContain('修改后尚未确认的角色')
  })

  it('角色运行入口不能复用作者草稿源来读取秘密或未来意图', async () => {
    const fixture = await seedConfirmedNarrativeDomainV1()
    await expect(assembleContext({ projectId: fixture.scope.projectId, scope: fixture.scope,
      worldGroupId: fixture.group.id, sourceKeys: ['canonAssertions'], productRuntimeSessionId: 987654,
    })).rejects.toThrow('产品运行只能读取冻结世界')
  })
})
