import type {Character, FrozenChatSourceProjectionV1} from '../../src/lib/types'
import {chatProjectionResourcesV1, type ChatSourceProjectionDraftV1, type ChatSourceClassificationV1} from '../../src/lib/character-interaction/source-projection'

/** Evaluation author input, never an AI inference or a runtime repair. */
export interface M1RoleMaterialV1 {
  name: string
  goals: string[]
  privateFacts: string[]
  beliefs: string[]
  values: string[]
}

export function m1CharacterFieldsV1(role: M1RoleMaterialV1, publicFacts: readonly string[], identity: string): Pick<Character, 'name' | 'identity' | 'shortDescription' | 'background' | 'goals' | 'motivation' | 'personality'> {
  return {name: role.name, identity, shortDescription: publicFacts.join(''),
    background: role.privateFacts.join('；'), goals: role.goals.join('；'),
    motivation: role.beliefs.map(belief => `未经确认的角色猜测：${belief}`).join('；'),
    personality: role.values.join('；')}
}

/** Only the selected actor's declared fields are admitted. Other resources
 * remain author-only; a copied test-world resource cannot become public. */
export function m1ActorSourceClassificationsV1(projection: ChatSourceProjectionDraftV1, actorResourceKey: string): ChatSourceClassificationV1[] {
  return chatProjectionResourcesV1(projection).flatMap(resource => resource.fragments.map(fragment => {
    const pointer = fragment.pointer
    const purpose = ['/goals', '/motivation'].includes(pointer) ? 'motivation' : pointer === '/personality' ? 'voice' : ['/name', '/identity'].includes(pointer) ? 'identity' : 'knowledge'
    const selected = resource.resourceKey === actorResourceKey && fragment.valueJson !== '""'
    const isPublic = selected && ['/name', '/identity', '/shortDescription'].includes(pointer)
    const isPrivate = selected && ['/background', '/goals', '/motivation', '/personality'].includes(pointer)
    return {projectionHash: projection.projectionHash, fragmentKey: fragment.fragmentKey, purpose,
      visibility: isPublic ? 'public' : isPrivate ? 'participants' : 'author-only', audienceKeys: isPrivate ? [actorResourceKey] : []}
  }))
}

/** Pre-call admission for the registered material, after the real WorldRelease
 * and S2 compiler. Byte presence is insufficient: purpose and audience matter.
 * This does not judge generated openings or prove narrative quality. */
export function assertM1ActorSourceFidelityV1(input: {
  source: FrozenChatSourceProjectionV1
  actorResourceKey: string
  actorKey: string
  role: M1RoleMaterialV1
  publicFacts: readonly string[]
}): void {
  const {source, actorResourceKey, actorKey, role, publicFacts} = input
  const requireMaterial = (values: readonly string[], pointer: string, purpose: 'knowledge' | 'motivation', privateOnly: boolean) => {
    for (const value of values) {
      const matches = source.knowledge.filter(item => item.content.includes(value))
      if (matches.length !== 1 || matches[0].source.resourceKey !== actorResourceKey
        || matches[0].source.pointer !== pointer || matches[0].source.purpose !== purpose
        || !matches[0].audienceKeys.includes(actorKey)
        || (privateOnly ? matches[0].audienceKeys.some(key => key !== actorKey) : !matches[0].audienceKeys.includes('player'))) {
        throw new Error(`[m1-source-fidelity] ${pointer} 的原材料缺失、语义用途错误或知情范围不符；停止模型调用，不能用运行时补写修复来源`)
      }
    }
  }
  requireMaterial(role.privateFacts, '/background', 'knowledge', true)
  requireMaterial(role.goals, '/goals', 'motivation', true)
  requireMaterial(role.beliefs, '/motivation', 'motivation', true)
  requireMaterial(publicFacts, '/shortDescription', 'knowledge', false)
}
