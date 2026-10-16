import {vi} from 'vitest'
import * as runtime from '../../src/lib/character-interaction/runtime'
import * as coordinator from '../../src/lib/character-interaction/coordinator-selection'
import * as manifests from '../../src/lib/agent/run/context-manifest'
import {chatRetrievalVersionForReader, type ChatRetrievalVersion} from '../../src/lib/character-interaction/context-selection'

/** Produce the actual old bytes and identity, not a new packet relabeled old. */
export function useHistoricalChatReaderFixture(reader: string, situationVersion?: ChatRetrievalVersion) {
  const create = manifests.createContextManifestFromAssemblyV1
  vi.spyOn(manifests, 'createContextManifestFromAssemblyV1').mockImplementation(input => create({...input,
    readerVersion: input.readerVersion === (situationVersion ? 'chat-situation-runtime-view-v15' : 'chat-narrative-runtime-view-v13') ? reader : input.readerVersion}))
  if (situationVersion) {
    const select = coordinator.selectChatCoordinatorContextV1
    vi.spyOn(coordinator, 'projectChatCoordinatorContextV1').mockImplementation((state, candidate = {text: ''}) => ({text: select(state, {...candidate, retrievalVersion: situationVersion}), selection: undefined}))
    vi.spyOn(coordinator, 'selectChatCoordinatorContextV1').mockImplementation((state, candidate = {text: ''}) => select(state, {...candidate, retrievalVersion: situationVersion}))
  } else {
    const build = runtime.buildInteractionContextWindow, retrievalVersion = chatRetrievalVersionForReader(reader)!
    vi.spyOn(runtime, 'buildInteractionContextWindow').mockImplementation((state, actor, options = {}) => build(state, actor, {...options, retrievalVersion}))
  }
}
