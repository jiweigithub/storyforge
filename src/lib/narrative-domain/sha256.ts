import { sha256 } from '@noble/hashes/sha2.js'
import { createSHA256, type IHasher } from 'hash-wasm'

const MAX_STATES = 4
const HEX_BYTES = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'))
const available: IHasher[] = []
let initialization: Promise<'wasm' | 'javascript'> | undefined
let backend: 'wasm' | 'javascript' = 'javascript'
let state: 'not-requested' | 'ready' | 'unavailable' = 'not-requested'

/** Explicitly initialized inside the release operation, after caller-owned
 * input is captured. Importing the codec or preparing a fixture does no WASM
 * work. Failed initialization keeps the existing JavaScript SHA-256, once per
 * process, without retrying during individual record hashes. */
export function initializeNarrativeSha256V1(): Promise<'wasm' | 'javascript'> {
  return initialization ??= (async () => {
    const results = await Promise.allSettled(Array.from({ length: MAX_STATES },
      () => Promise.resolve().then(createSHA256)))
    if (results.some(result => result.status === 'rejected')) { state = 'unavailable'; return 'javascript' }
    for (const result of results) if (result.status === 'fulfilled') available.push(result.value)
    backend = 'wasm'; state = 'ready'
    return backend
  })()
}

/** Operational diagnostic only; never part of a content/index identity. */
export function narrativeSha256StatusV1() { return { backend, initialization: state } }

/** Each live sink owns a separate state. Synchronous nested callers beyond
 * the bounded pool use the original implementation; no state is shared or
 * snapshotted. Only byte views reach WASM, retaining the codec's UTF-8 budget. */
export function createNarrativeSha256V1() {
  const accelerated = available.pop()
  const original = accelerated ? undefined : sha256.create()
  let released = false, finished = false
  const assertOpen = () => {
    if (released || finished) throw Error('[narrative-sha256] Hash state is already finished or released')
  }
  return {
    update(bytes: Uint8Array): void {
      assertOpen()
      if (accelerated) accelerated.update(bytes)
      else original!.update(bytes)
    },
    digest(): Uint8Array {
      assertOpen(); finished = true
      return accelerated ? accelerated.digest('binary') : original!.digest()
    },
    digestHex(): string {
      assertOpen(); finished = true
      if (accelerated) return accelerated.digest('hex')
      let result = ''
      for (const byte of original!.digest()) result += HEX_BYTES[byte]
      return result
    },
    destroy(): void {
      if (released) return
      released = true
      if (accelerated) {
        // Reset even after a failed traversal, before another sink can borrow
        // this instance. A broken instance is discarded, never reused.
        try { accelerated.init(); available.push(accelerated) } catch { /* The original operation's error remains visible. */ }
      } else original!.destroy()
    },
  }
}
