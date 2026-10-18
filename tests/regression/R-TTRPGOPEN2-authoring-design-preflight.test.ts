import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { ChatMessage } from '../../src/lib/types'
import { createSavedOpenDesignFixtureV1 } from '../helpers/ttrpg-open-design'
import { openCampaignFixture } from '../helpers/ttrpg-open-content'
import { generateTtrpgOpenAuthoringDesignCandidateV1, composeTtrpgOpenAuthoringDesignV1,
  prepareTtrpgOpenAuthoringDesignSourceV1, ttrpgOpenDesignNeedsInitialFactsV1, parseTtrpgOpenAuthoringDesignRequestV1 } from '../../src/lib/ttrpg/open-authoring-design'
import { resolveProductSourceReadBoundaryV1 } from '../../src/lib/product/source-contracts'
import { listWorldSemanticResourceDescriptorsV1, readWorldSemanticResourcesV1 } from '../../src/lib/context-gateway/world-release-client'

const sections = ['situationTemplates', 'openingSituationKeys', 'effectPlanTemplates', 'pressure']
describe('R-TTRPGOPEN2 initial design fact dependency and pre-dispatch capacity', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
  async function rows() { return JSON.stringify(await Promise.all([db.ttrpgAuthoringDrafts.toArray(), db.worldReleases.toArray(), db.works.toArray()])) }
  it('rejects a genuinely empty situation request without fact proposals before any Run, event, model call or author write', async () => {
    const f = await createSavedOpenDesignFixtureV1(), before = await rows(), runAI = vi.fn(async () => '')
    await expect(generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, request: { ...f.request, sections }, runAI })).rejects.toThrow('同时选择“新增世界事实”')
    expect(runAI).not.toHaveBeenCalled(); expect(await db.agentRuns.count()).toBe(0); expect(await db.agentRunEvents.count()).toBe(0)
    expect(await rows()).toBe(before)
  })
  it('does not manufacture an initial-fact dependency for an existing designed draft or a draft already containing source facts', async () => {
    const f = await createSavedOpenDesignFixtureV1(), base = structuredClone(f.settings.openAuthoring)
    expect(ttrpgOpenDesignNeedsInitialFactsV1(base)).toBe(true)
    const campaign = openCampaignFixture()
    base.situationTemplates = campaign.situationTemplates
    expect(ttrpgOpenDesignNeedsInitialFactsV1(base)).toBe(false)
    base.situationTemplates = []; base.factPolicy = [{ fact: campaign.frozenWorldPredicateIndex.entries[0], authorConfirmed: false }]
    expect(ttrpgOpenDesignNeedsInitialFactsV1(base)).toBe(false)
    // A named basis does not confirm it or grant any runtime authority.
    expect(base.factPolicy[0].authorConfirmed).toBe(false)
  })
  it('uses the original client capacity calculation and rejects a known small window before transport or an unknown Run exists', async () => {
    const f = await createSavedOpenDesignFixtureV1(), before = await rows(), transport = vi.fn()
    vi.stubGlobal('fetch', transport)
    await expect(generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, aiConfig: {
      provider: 'codex', model: 'gpt-6.1-sol', apiKey: '', baseUrl: '/storyforge/local-codex/v1', temperature: 0.7,
      maxTokens: 0, contextWindow: 16000,
    } })).rejects.toThrow('输入预算不足以容纳完整设计请求')
    expect(transport).not.toHaveBeenCalled(); expect(await db.agentRuns.count()).toBe(0); expect(await db.agentRunEvents.count()).toBe(0)
    expect(await rows()).toBe(before)
  })
  it('keeps all five requested sections and exact delivered source keys, returning only unconfirmed facts before explicit adoption', async () => {
    const f = await createSavedOpenDesignFixtureV1(), before = await rows()
    const prepared = await prepareTtrpgOpenAuthoringDesignSourceV1(f)
    const boundary = await resolveProductSourceReadBoundaryV1(prepared.source.sourcePlan)
    const descriptors = await listWorldSemanticResourceDescriptorsV1(boundary.sourceScope)
    const resources = await readWorldSemanticResourcesV1({ scope: boundary.sourceScope, descriptors })
    const request = { ...f.request, sections: [...sections, 'factProposals'] }
    const runAI = vi.fn(async (messages: ChatMessage[]) => {
      const keys = JSON.parse(messages[1].content.match(/【实际读取资源闭集】([^\n]+)/)![1]) as string[]
      const resource = resources.find(item => item.descriptor.resourceKey === keys[0])!
      const fieldPath = Object.keys(resource.value).find(key => /^[A-Za-z][A-Za-z0-9_-]*$/.test(key))!
      const campaign = openCampaignFixture(), fact = { ...campaign.frozenWorldPredicateIndex.entries[0],
        sourceResourceRefs: [keys[0]], sourceFieldRefs: [{ resourceKey: keys[0], fieldPath, contentHash: resource.descriptor.contentHash }] }
      const map = (value: unknown): unknown => typeof value === 'string' ? value === 'world.harbor' ? keys[0] : value
        : Array.isArray(value) ? value.map(map) : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, map(child)])) : value
      return JSON.stringify({ schema: 'storyforge.ttrpg-open-authoring-design-proposals', version: 1,
        proposals: [0, 1, 2].map(index => ({ proposalKey: `full.${index}`, title: `不同压力方向${index}`, pitch: '完整五分区工程输入',
          patch: map({ situationTemplates: campaign.situationTemplates, openingSituationKeys: campaign.openingSituationKeys,
            effectPlanTemplates: campaign.effectPlanTemplates,
            pressure: { clocks: campaign.clocks.map(clock => ({ ...clock, maximum: 12 + index * 2 })), fronts: campaign.fronts }, factProposals: [fact] }) })) })
    })
    const candidate = await generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, request, runAI })
    expect(candidate.artifact.status).toBe('ready'); expect(candidate.proposals!.proposals).toHaveLength(3); expect(runAI).toHaveBeenCalledOnce()
    const context = { request: parseTtrpgOpenAuthoringDesignRequestV1(request), base: f.settings.openAuthoring,
      readWorldResourceKeys: JSON.parse(runAI.mock.calls[0][0][1].content.match(/【实际读取资源闭集】([^\n]+)/)![1]) }
    const value = composeTtrpgOpenAuthoringDesignV1(candidate.proposals, Object.fromEntries(request.sections.map(key => [key, 'full.1'])), context)
    expect(value.factPolicy).toHaveLength(1); expect(value.factPolicy[0].authorConfirmed).toBe(false)
    expect(value.situationTemplates[0].driverBeliefs[0].factRef).toBe(value.factPolicy[0].fact.factKey)
    expect(value.companionPolicy).toEqual(f.settings.openAuthoring.companionPolicy)
    expect(value.runtimePolicy).toEqual(f.settings.openAuthoring.runtimePolicy)
    expect(await rows()).toBe(before); expect(await db.productProductions.count()).toBe(0); expect(await db.productBuilds.count()).toBe(0)
    const system = runAI.mock.calls[0][0][0].content
    expect(system).toContain('至少一条 factRef 必须非 null'); expect(system).toContain('不能用 world resource')
  })
})
