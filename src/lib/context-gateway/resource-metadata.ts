import type { ContextResourceDescriptorV1, ContextResourceProviderV1, FrozenResourceScopeV1 } from '../registry/types'

/** Resolve exact descriptors through the scoped metadata protocol. A freshness
 * or publication check must not read body text or depend on a truncation budget.
 * The result is local to this check; no descriptor survives a later stale check. */
export async function lookupContextResourceMetadataV1(input: {
  provider: ContextResourceProviderV1
  scope: FrozenResourceScopeV1
  resourceKeys: readonly string[]
}): Promise<Map<string, ContextResourceDescriptorV1>> {
  const wanted = new Set(input.resourceKeys)
  const found = new Map<string, ContextResourceDescriptorV1>()
  if (!wanted.size) return found
  const fingerprint = await input.provider.fingerprint(input.scope)
  const cursors = new Set<string>()
  let cursor: string | undefined
  let pages = 0
  do {
    if (++pages > 20_000) throw new Error('[context-metadata:page-budget] 目录超限，拒绝把未读取项当作缺失')
    const page = await input.provider.listMetadata({ scope: input.scope, limit: 100, cursor })
    if (page.scopeFingerprint !== fingerprint) throw new Error('[context-metadata:scope] 目录作用域在检查中改变')
    for (const descriptor of page.items) {
      if (!wanted.has(descriptor.resourceKey)) continue
      if (found.has(descriptor.resourceKey)) throw new Error('[context-metadata:duplicate] 目录身份重复')
      found.set(descriptor.resourceKey, descriptor)
    }
    cursor = page.nextCursor ?? undefined
    if (cursor && cursors.has(cursor)) throw new Error('[context-metadata:cursor] 目录游标未前进')
    if (cursor) cursors.add(cursor)
  } while (cursor && found.size < wanted.size)
  await input.provider.assertAccessCurrent?.(input.scope)
  if (await input.provider.fingerprint(input.scope) !== fingerprint) {
    throw new Error('[context-metadata:scope] 检查完成前资源授权已改变')
  }
  return found
}
