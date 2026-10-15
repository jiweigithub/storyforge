import { describe, expect, it, vi } from 'vitest'
import { isShowcaseAssetRequest, scopedStorage } from '../../src/lib/showcase/policy'

describe('website experience boundaries', () => {
  it('isolates storage reads, enumeration, removal and clearing', () => {
    const raw = window.sessionStorage
    raw.clear()
    raw.setItem('secret', 'original')
    const demo = scopedStorage(raw, 'test-demo:')
    expect(demo.getItem('secret')).toBeNull()
    demo.setItem('secret', 'demo')
    expect(demo.length).toBe(1)
    expect(demo.key(0)).toBe('secret')
    expect(demo.key(1)).toBeNull()
    expect(raw.getItem('secret')).toBe('original')
    demo.removeItem('secret')
    expect(raw.getItem('secret')).toBe('original')
    demo.setItem('draft', 'text')
    demo.clear()
    expect(raw.getItem('secret')).toBe('original')
    expect(demo.length).toBe(0)
    raw.clear()
  })
  it('allows packaged asset reads, never external URLs, traversal, bridges or writes', () => {
    const origin = 'https://storyforge-lab.com'
    expect(isShowcaseAssetRequest('/storyforge/prototypes/town/release.json', 'GET', origin)).toBe(true)
    for (const path of ['https://other.test/storyforge/games/a.json', '/v1/test.json', '/storyforge/local-codex/v1/status', '/storyforge/assets/../../v1/test.json', 'https://user:password@storyforge-lab.com/storyforge/assets/a.json']) {
      expect(isShowcaseAssetRequest(path, 'GET', origin)).toBe(false)
    }
    expect(isShowcaseAssetRequest('/storyforge/games/catalog.json', 'POST', origin)).toBe(false)
  })
  it.each(['showcase', 'adventure-player'])('refuses configuration and explicit AI credentials in %s', async mode => {
    const meta = document.createElement('meta')
    meta.name = 'storyforge-game'; meta.content = 'a'.repeat(64); document.head.append(meta)
    const notice = mode === 'showcase' ? '官网体验版' : '独立游戏播放器'
    vi.stubEnv('MODE', mode)
    vi.resetModules()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      const { useAIConfigStore } = await import('../../src/stores/ai-config')
      const state = useAIConfigStore.getState()
      state.setConfig({ apiKey: 'must-not-persist', baseUrl: 'http://localhost:9/v1' })
      expect(useAIConfigStore.getState().config.apiKey).toBe('')
      expect((await state.testConnection()).ok).toBe(false)
      const { chat, streamChat, chatWithImagesV1 } = await import('../../src/lib/ai/client')
      const config = { ...state.config, apiKey: 'explicit-bypass-attempt' }
      await expect(chat([], config)).rejects.toThrow(notice)
      await expect(streamChat([], config).next()).rejects.toThrow(notice)
      await expect(chatWithImagesV1([], [], config)).rejects.toThrow(notice)
      const { codexRequest } = await import('../../src/lib/ai/codex-transport')
      await expect(codexRequest('/status')).rejects.toThrow(notice)
      const { embedTexts, isEmbeddingReady } = await import('../../src/lib/ai/adapters/embedding-adapter')
      const embedding = { ...state.embedding, enabled: true }
      expect(isEmbeddingReady(embedding)).toBe(false)
      await expect(embedTexts(['private'], embedding)).rejects.toThrow(notice)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      meta.remove()
      fetchSpy.mockRestore()
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})
