import { compileNarrativeReleaseIncrementalV1, type NarrativeIncrementalBaseV1 } from './narrative-incremental'
import { compileWorldReleaseContentV4 } from './narrative-release-v4'
import type { WorldReleaseSemanticContentV4 } from '../types/narrative-release'

// One dedicated worker per bounded task. No database mutations or model calls.
const endpoint = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage: (value: unknown) => void }
let started = false
endpoint.onmessage = event => {
  if (started) return
  started = true
  const request = event.data as { version: number; input: Omit<WorldReleaseSemanticContentV4, 'narrative'>; baseline?: NarrativeIncrementalBaseV1 }
  if (request?.version !== 1) { endpoint.postMessage({ status: 'failed', error: '未知编译 Worker 请求版本' }); return }
  endpoint.postMessage({ status: 'compiling' })
  void (request.baseline ? compileNarrativeReleaseIncrementalV1(request.input, request.baseline) : compileWorldReleaseContentV4(request.input)).then(
    result => endpoint.postMessage({ status: 'complete', result }),
    error => endpoint.postMessage({ status: 'failed', error: error instanceof Error ? error.message : '后台编译失败' }),
  )
}
