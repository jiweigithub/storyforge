import type { AIConfig, ProviderCapabilityRequirementV1 } from '../types'
import { useAIConfigStore } from '../../stores/ai-config'
import { resolveRequestConfig } from '../ai/client'
import { resolveConfiguredAgnesImageCapabilityV1, configuredAgnesImageEndpointHashV1 } from '../product-production/media-transport'
import { hashProductProductionValueV2 } from '../product-production/hash'

export async function avgImageRouteBindingHashV2(input: { requirementKey: string; adapterId: string; baseCapabilityHash: string; endpointRouteHash: string }) {
  return hashProductProductionValueV2({ schema: 'storyforge.avg.image-route-binding', version: 2, ...input })
}

/** Captures one private config snapshot. Only non-secret identity hashes leave
 * this resolver; no HTTP/model request or credential persistence occurs here. */
export async function resolveAvgImageExecutionCapabilityV2(input: {
  projectId: number; requirement: ProviderCapabilityRequirementV1; config?: AIConfig
}) {
  const config = structuredClone(input.config ?? resolveRequestConfig(useAIConfigStore.getState().config, {
    category: 'product-production', projectId: input.projectId,
  }).config)
  const resolved = await resolveConfiguredAgnesImageCapabilityV1({ ...input, config })
  const endpointRouteHash = await configuredAgnesImageEndpointHashV1({ projectId: input.projectId, config })
  const binding = { ...resolved.binding, bindingHash: await avgImageRouteBindingHashV2({ requirementKey: input.requirement.requirementKey,
    adapterId: resolved.binding.adapterId, baseCapabilityHash: resolved.binding.bindingHash, endpointRouteHash }) }
  return { resolved, binding, endpointRouteHash }
}
