import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedNarrativeReleaseV4 } from '../helpers/narrative-release-fixture'
import { openAuthorWorldQueryAccessV1, bindWorldQueryResourcesV1, closeWorldQueryAccessV1 } from '../../src/lib/context-gateway/world-query-client'
import { createContextGatewayToolSessionV1 } from '../../src/lib/context-gateway/tool-session'
import { CONTEXT_GATEWAY_READ_TOOLS_V1 } from '../../src/lib/agent/context-gateway-tools'
import { WORLD_RELEASE_RESOURCE_KINDS_V1 } from '../../src/lib/context-gateway/world-release-provider-contract'
import { executeContextGatewayV1 } from '../../src/lib/context-gateway/execution'
import { AGENT_SKILL_BY_ID } from '../../src/lib/agent/skill-registry'
import { createAgentRunV1, appendAgentRunEventV1 } from '../../src/lib/agent/run/event-store'
import { createContextManifestV1, createContextManifestV2FromV1, verifyContextManifestIntegrityV3 } from '../../src/lib/agent/run/context-manifest'
import { recordContextGatewayPreflightEvidenceV1, finalizeContextGatewayAttemptEvidenceV1,
  inspectContextGatewayManifestFreshnessV1, verifyContextGatewayCandidateEvidenceV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { AGENT_TOOL_SCHEMA_HASH_V1 } from '../../src/lib/agent/execution-binding'
import { getAgentToolSchemaSnapshotV1 } from '../../src/lib/agent/tool-registry'
import type { ContextAccessPolicyV1 } from '../../src/lib/registry/types'
import type { AgentRunEventPayloadMapV1, AgentRunEventTypeV1 } from '../../src/lib/types/agent-run'

const policy: ContextAccessPolicyV1 = { version: 'context-access-policy-v1', policyId: 'nw2b-tool-test',
  mandatorySourceKeys: ['worldRelease'], allowedSourceKeys: ['worldRelease'], allowedResourceKinds: [...WORLD_RELEASE_RESOURCE_KINDS_V1],
  allowedDepths: ['index', 'summary', 'focused', 'full', 'original'], selectorPolicyId: 'nw2b-tool-test',
  maxReadCalls: 16, maxRetrievedTokens: 100000, allowOriginalRead: true, candidateAccess: 'forbidden' }

async function setup() {
  const fixture = await seedNarrativeReleaseV4()
  const access = await openAuthorWorldQueryAccessV1({ scope: fixture.scope, localReleaseRecordId: fixture.release.id!,
    view: 'canon', perspective: { kind: 'author' }, knowledgeThrough: null, disclosedThrough: null })
  const provider = await bindWorldQueryResourcesV1(access)
  const descriptor = (await provider.listMetadata({ scope: access.scope, limit: 20 })).items[0]
  return { ...fixture, access, provider, descriptor }
}

describe('NW-2B · typed Gateway query and durable actual-read evidence', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('registered metadata queries cannot self-grant author access or count as original reads', async () => {
    const { access, descriptor } = await setup()
    const session = await createContextGatewayToolSessionV1({ scope: access.scope, policy, worldQueryAccess: access })
    const context = { projectId: access.scope.projectId, contextGatewaySession: session }
    const tool = CONTEXT_GATEWAY_READ_TOOLS_V1.find(item => item.name === 'query_world_release')!
    const result = await tool.execute(context, { text: '守渡人', limit: 1 })
    expect(result.ok, result.error).toBe(true)
    const payload = JSON.parse(result.content)
    expect(payload.result.items[0]).toMatchObject({ atom: null, supportingAtoms: [], depth: 'metadata' })
    expect(payload.result.items[0].evidence.every((item: { text: unknown }) => item.text === null)).toBe(true)
    expect(payload.descriptors[0].resourceKey).toBe(descriptor.resourceKey)
    expect(payload.descriptors[0].authorSource).toEqual(payload.result.items[0].authorSource)
    expect(payload.descriptors[0].authorSource.title).toBe('守渡人')
    expect(result.meta.gateway).toMatchObject({ operation: 'search', sourceRefCapabilities: [], sourceRefEvidence: [] })
    expect(session.capabilities.size).toBe(0)
    for (const extra of [{ perspective: { kind: 'author' } }, { evidenceDepth: 'original' }, { sourcePlanHash: null }]) {
      expect((await tool.execute(context, { ...extra })).ok).toBe(false)
    }
    const narrowed = await createContextGatewayToolSessionV1({ scope: access.scope, policy, worldQueryAccess: access, allowedResourceKeys: [] })
    const hidden = await tool.execute({ ...context, contextGatewaySession: narrowed }, { text: '守渡人' })
    expect(hidden.ok, hidden.error).toBe(true)
    expect(hidden.content).not.toContain(descriptor.resourceKey)
    expect(JSON.parse(hidden.content).result.items).toEqual([])
    expect((await tool.execute({ projectId: access.scope.projectId }, {})).ok).toBe(false)
  })

  it('persists actual original bytes in the existing durable Manifest and reopens the same frozen evidence', async () => {
    const fixture = await setup(), { scope, access, descriptor } = fixture
    const execution = await executeContextGatewayV1({ skill: AGENT_SKILL_BY_ID.get('product-production.consult.v1')!,
      scope, resourceScope: access.scope, worldQueryAccess: access, additionalReadsEnabled: false,
      excludedResourceKinds: AGENT_SKILL_BY_ID.get('product-production.consult.v1')!.contextGateway!.allowedResourceKinds
        .filter(kind => !WORLD_RELEASE_RESOURCE_KINDS_V1.includes(kind)),
      mandatoryResourceKeys: [descriptor.resourceKey], mandatoryOriginalResourceKeys: [descriptor.resourceKey],
      budgetTokens: 10000, query: '守渡人' })
    expect(execution.contextPacket.content).toContain('守渡人')
    expect(execution.contextPacket.content).toContain('authorSource')
    const worldBlocks = execution.sourceBlocks?.filter(block => block.sourceKey === 'worldRelease')
    expect(worldBlocks).toHaveLength(1)
    expect(worldBlocks![0].content).toContain('authorSource')
    expect(worldBlocks![0].content).toContain('守渡人')
    expect(execution.sourceBlocks!.reduce((sum, block) => sum + block.tokenCount, 0))
      .toBe(execution.contextPacket.tokenCount)
    const evidence = JSON.parse(execution.sourceSnapshots.find(row => row.resourceKey === descriptor.resourceKey)!.content)
    expect(evidence.authorSource.title).toBe('守渡人')
    expect(evidence.spans.map((span: { text: string }) => span.text)).toEqual(['守渡人'])
    const decisions = [...execution.retrievalTrace.mandatory, ...execution.retrievalTrace.autoSelected, ...execution.retrievalTrace.agentReads]
    expect(decisions.find(item => item.resourceKey === descriptor.resourceKey)?.depth).toBe('original')
    let snapshot = await createAgentRunV1({ scope, contract: {
      version: 1, objective: 'NW-2B 确定性冻结原文读取证据', workflowKind: 'direct-generation', runtimeBindingHash: 'a'.repeat(64),
      scope: { projectId: scope.projectId, worldGroupId: null }, permissions: { contextSourceKeys: ['worldRelease'], writeTargets: [] },
      budget: { maxModelCalls: 1, maxToolCalls: 16, maxInputTokens: 10000, maxOutputTokens: 1000, maxAttemptsPerStep: 1 },
      acceptance: [{ id: 'read', kind: 'output-present', required: true }],
      verificationPlan: [{ id: 'terminal', kind: 'terminal', verifier: 'nw2b-fixture-v1', criterionIds: ['read'] }],
      failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
    } })
    const append = async <T extends AgentRunEventTypeV1>(type: T, payload: AgentRunEventPayloadMapV1[T]) => {
      snapshot = await appendAgentRunEventV1({ scope, runId: snapshot.run.id, type, payload, expectedLastSequence: snapshot.projection.lastSequence })
    }
    await append('step.scheduled', { stepId: 'read' })
    await append('step.started', { stepId: 'read', attempt: 1 })
    const v1 = await createContextManifestV1({ version: 1, runId: snapshot.run.id, stepId: 'read', attempt: 1,
      scope: { projectId: scope.projectId, worldGroupId: null }, inputBudget: 10000, totalInputTokens: execution.contextPacket.tokenCount,
      sources: [{ key: 'worldRelease', status: 'included', contentHash: execution.contextPacket.contentHash, tokens: execution.contextPacket.tokenCount }] })
    const baseManifest = await createContextManifestV2FromV1({ manifest: v1, scope })
    const preflight = await recordContextGatewayPreflightEvidenceV1({ scope, runId: snapshot.run.id, stepId: 'read', attempt: 1,
      contextPacket: execution.contextPacket, selector: execution.selector, renderedRequest: { kind: 'deterministic-read-fixture' },
      sourceSnapshots: execution.sourceSnapshots, toolTranscript: execution.toolTranscript, expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = preflight.snapshot
    await append('tool.called', { stepId: 'read', attempt: 1, toolName: 'nw2b-fixture', callHash: preflight.evidence.promptHash })
    const response = { receipt: execution.contextPacket.packetHash }, candidateHash = await hashCanonicalValue(response)
    await append('tool.returned', { stepId: 'read', attempt: 1, toolName: 'nw2b-fixture', resultHash: candidateHash })
    const finalized = await finalizeContextGatewayAttemptEvidenceV1({ scope, runId: snapshot.run.id, stepId: 'read', attempt: 1,
      baseManifest, preflight: preflight.evidence, selector: execution.selector, sufficiency: execution.sufficiency,
      retrievalTrace: execution.retrievalTrace, gatewayVersionHash: execution.contextPacket.gatewayVersionHash,
      policyHash: execution.session.policyHash, rawResponse: response, candidateHash,
      executionBoundary: { kind: 'tool', toolName: 'nw2b-fixture' }, expectedLastSequence: snapshot.projection.lastSequence })
    expect(await verifyContextManifestIntegrityV3(finalized.manifest)).toBe(true)
    expect((await inspectContextGatewayManifestFreshnessV1({ manifest: finalized.manifest, session: execution.session })).status).toBe('fresh')
    snapshot = finalized.snapshot
    await append('candidate.persisted', { stepId: 'read', attempt: 1, candidateHash, requiresConfirmation: true })
    db.close(); await db.open()
    await verifyContextGatewayCandidateEvidenceV1({ scope, runId: snapshot.run.id, stepId: 'read', attempt: 1, candidateHash })
    await db.characters.update(fixture.actorId, { name: '最新草稿不替换封存证据' })
    expect((await inspectContextGatewayManifestFreshnessV1({ manifest: finalized.manifest, session: execution.session })).status).toBe('fresh')
    await closeWorldQueryAccessV1(access)
    expect((await inspectContextGatewayManifestFreshnessV1({ manifest: finalized.manifest, session: execution.session })).status).toBe('stale')
  })

  it('keeps source metadata outside the exact quote in the registered model read tools', async () => {
    const { access, descriptor } = await setup()
    const session = await createContextGatewayToolSessionV1({ scope: access.scope, policy, worldQueryAccess: access })
    const context = { projectId: access.scope.projectId, contextGatewaySession: session }
    const resource = CONTEXT_GATEWAY_READ_TOOLS_V1.find(item => item.name === 'read_context_resource')!
    const original = CONTEXT_GATEWAY_READ_TOOLS_V1.find(item => item.name === 'read_original_evidence')!
    const read = await resource.execute(context, { resourceKey: descriptor.resourceKey, depth: 'full', maxTokens: 10000 })
    expect(read.ok, read.error).toBe(true)
    const material = JSON.parse(read.content)
    expect(material.descriptor.authorSource.title).toBe('守渡人')
    const quote = await original.execute(context, { sourceRef: material.sourceRefCapabilities[0], maxTokens: 10000 })
    expect(quote.ok, quote.error).toBe(true)
    const evidence = JSON.parse(quote.content)
    expect(evidence.authorSource).toEqual(material.descriptor.authorSource)
    expect(evidence.content).toBe('守渡人')
    expect(evidence.contentHash).toBe(descriptor.sourceRefs[0].contentHash)
    await closeWorldQueryAccessV1(access)
    expect((await original.execute(context, { sourceRef: material.sourceRefCapabilities[0], maxTokens: 10000 })).ok).toBe(false)
  })

  it('pins the changed registered tool schema hash instead of claiming the old tool version', async () => {
    expect(await hashCanonicalValue(getAgentToolSchemaSnapshotV1())).toBe(AGENT_TOOL_SCHEMA_HASH_V1)
  })
})
