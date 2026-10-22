import { failSchema, readString } from './schema-utils'

/**
 * A resume payload is durable JSON, not an unbounded blob channel. The same
 * ceiling is enforced before persistence, import parsing, verification and
 * recovery so a checkpoint can never be accepted but later become unreadable.
 */
export const AGENT_RUN_MAXIMUM_RESUME_PAYLOAD_BYTES_V1 = 32 * 1024 * 1024

/** Contract snapshots use the same bounded durable JSON envelope as checkpoints. */
export const AGENT_RUN_MAXIMUM_CONTRACT_JSON_BYTES_V1 = 32 * 1024 * 1024

export function readAgentRunContractJsonV1(value: unknown, path: string): string {
  const result = readString(value, path, { max: AGENT_RUN_MAXIMUM_CONTRACT_JSON_BYTES_V1 })
  if (agentRunUtf8ByteLengthV1(result) > AGENT_RUN_MAXIMUM_CONTRACT_JSON_BYTES_V1) {
    failSchema('invalid_value', path, `契约 UTF-8 大小不得超过 ${AGENT_RUN_MAXIMUM_CONTRACT_JSON_BYTES_V1} 字节`)
  }
  return result
}

/** Exact UTF-8 byte count without allocating a second payload-sized buffer. */
export function agentRunUtf8ByteLengthV1(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}
