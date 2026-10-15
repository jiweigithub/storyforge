import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AIConfigPanel from '../../src/components/settings/AIConfigPanel'
import EmbeddingConfigCard from '../../src/components/settings/EmbeddingConfigCard'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { useAIConfigStore } from '../../src/stores/ai-config'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const initial = useAIConfigStore.getState()
beforeEach(() => {
  vi.stubEnv('DEV', false)
  useAIConfigStore.setState({
    config: { ...initial.config, provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: '' },
    embedding: { ...initial.embedding, enabled: true, baseUrl: 'https://api.openai.com/v1', apiKey: '' },
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); useAIConfigStore.setState(initial)
})
async function mount(Component: typeof AIConfigPanel) {
  await act(async () => root.render(createElement(DialogProvider, null, createElement(Component))))
}
function buttons() { return Array.from(host.querySelectorAll('button')) }
async function click(text: string) {
  const button = buttons().find(item => item.textContent?.includes(text))!
  expect(button).toBeDefined()
  await act(async () => button.click())
}

describe('Feedback #101: development proxy controls in production', () => {
  it('does not offer an unavailable proxy and keeps a configured endpoint unchanged', async () => {
    await mount(AIConfigPanel)
    expect(buttons().filter(button => button.textContent?.includes('切换到本地代理'))).toHaveLength(0)
    expect(host.textContent).toContain('线上部署不自带本地代理')
    expect(useAIConfigStore.getState().config.baseUrl).toBe('https://api.deepseek.com/v1')
  })
  it('preserves an existing self-hosted proxy and lets the author explicitly restore direct access', async () => {
    useAIConfigStore.setState({ config: { ...useAIConfigStore.getState().config, baseUrl: '/deepseek-proxy/v1' } })
    await mount(AIConfigPanel)
    expect(useAIConfigStore.getState().config.baseUrl).toBe('/deepseek-proxy/v1')
    await click('恢复直连')
    expect(useAIConfigStore.getState().config.baseUrl).toBe('https://api.deepseek.com/v1')
  })
  it.each([
    ['硅基流动', 'https://api.siliconflow.cn/v1'],
    ['通义 · v3', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
    ['智谱', 'https://open.bigmodel.cn/api/paas/v4'],
  ])('uses the direct address for the %s embedding preset on deployed builds', async (label, url) => {
    await mount(EmbeddingConfigCard)
    await click(label)
    expect(useAIConfigStore.getState().embedding.baseUrl).toBe(url)
    expect(buttons().some(button => button.textContent?.includes('切换到本地代理'))).toBe(false)
  })
  it('keeps development proxy switching and embedding presets available', async () => {
    vi.stubEnv('DEV', true)
    await mount(AIConfigPanel)
    await click('切换到本地代理')
    expect(useAIConfigStore.getState().config.baseUrl).toBe('/deepseek-proxy/v1')
    await click('硅基流动')
    expect(useAIConfigStore.getState().embedding.baseUrl).toBe('/siliconflow-proxy/v1')
    await click('切换到直连')
    expect(useAIConfigStore.getState().embedding.baseUrl).toBe('https://api.siliconflow.cn/v1')
  })
  it('offers local proxies in the production-built portable package on localhost', async () => {
    vi.stubEnv('MODE', 'portable')
    await mount(AIConfigPanel)
    await click('切换到本地代理')
    expect(useAIConfigStore.getState().config.baseUrl).toBe('/deepseek-proxy/v1')
    await click('硅基流动')
    expect(useAIConfigStore.getState().embedding.baseUrl).toBe('/siliconflow-proxy/v1')
  })
  it('keeps proxy controls unavailable when a portable build is hosted publicly', async () => {
    vi.stubEnv('MODE', 'portable')
    vi.stubGlobal('location', { hostname: 'storyforge-lab.com' })
    await mount(AIConfigPanel)
    expect(buttons().filter(button => button.textContent?.includes('切换到本地代理'))).toHaveLength(0)
    expect(host.textContent).toContain('线上部署不自带本地代理')
  })
  it('keeps saved embedding proxies intact until the author chooses direct access', async () => {
    useAIConfigStore.setState({ embedding: { ...useAIConfigStore.getState().embedding, baseUrl: '/glm-proxy/api/paas/v4' } })
    await mount(EmbeddingConfigCard)
    expect(useAIConfigStore.getState().embedding.baseUrl).toBe('/glm-proxy/api/paas/v4')
    await click('切换到直连')
    expect(useAIConfigStore.getState().embedding.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4')
  })
})
