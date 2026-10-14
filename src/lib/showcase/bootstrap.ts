import { isShowcaseAssetRequest, scopedStorage, SHOWCASE_NOTICE, SHOWCASE_STORAGE_PREFIX } from './policy'

/** Runs before importing any stores, router or application module. */
export function installShowcaseBoundary(options: {
  storagePrefix?: string
  notice?: string
  allowRequest?: (url: string, method: string) => boolean
} = {}): void {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(window, key, { configurable: true, value: scopedStorage(window[key], options.storagePrefix ?? SHOWCASE_STORAGE_PREFIX) })
  }
  const reject = (): never => { throw new Error(options.notice ?? SHOWCASE_NOTICE) }
  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(new URL(String(input), location.href), init)
    const method = (init?.method ?? request.method).toUpperCase()
    if (!(options.allowRequest?.(request.url, method) ?? isShowcaseAssetRequest(request.url, method, location.origin))) reject()
    return originalFetch(input, { ...init, credentials: 'omit', redirect: 'error' })
  }
  // No alternate transport may reach a model, localhost bridge, or an upload service.
  window.XMLHttpRequest = class extends XMLHttpRequest { open(): never { return reject() } }
  window.WebSocket = class extends WebSocket { constructor() { reject(); super('') } }
  window.EventSource = class extends EventSource { constructor() { reject(); super('') } }
  navigator.sendBeacon = () => false
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => reject()
}
