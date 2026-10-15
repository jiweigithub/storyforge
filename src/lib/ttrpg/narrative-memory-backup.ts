/** Structural P8 backup boundary. Runtime recall must additionally verify the actual event/adoption proof. */
import { parseTtrpgNarrativeMemoryV1 } from './narrative-memory'

export function assertTtrpgNarrativeMemoryBackupV1(backup: Record<string, unknown>): void {
  const rows = backup.ttrpgNarrativeMemories
  const sessions = backup.productRuntimeSessions
  if (!Array.isArray(rows) || !Array.isArray(sessions)) throw new Error('[ttrpg-memory-backup] 缺少实例或记忆表')
  const byId = new Map(sessions.map(row => [row._exportId, row]))
  const allowed = new Set(['_exportId', '_worldGroupExportId', '_worldExportId', '_workExportId',
    '_productRuntimeSessionExportId', '_sourceSessionExportId',
    'revisionKey', 'observerKey', 'reliability', 'audience', 'knownBy', 'summary', 'fromEventSequence',
    'toEventSequence', 'derivedFromHash', 'stale', 'updatedAt'])
  const identities = new Set<string>()
  const exportIds = new Set<number>()
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Object.keys(row).some(key => !allowed.has(key))) throw new Error('[ttrpg-memory-backup] 记忆字段不是准确便携合同')
    const owner = byId.get(row._productRuntimeSessionExportId)
    if (!Number.isSafeInteger(row._exportId) || row._exportId < 0 || exportIds.has(row._exportId)
      || !owner || owner.kind !== 'ttrpg'
      || owner._worldExportId !== row._worldExportId || owner._workExportId !== row._workExportId
      || (owner._worldGroupExportId ?? null) !== (row._worldGroupExportId ?? null)) throw new Error('[ttrpg-memory-backup] 记忆 owner、作用域或身份不一致')
    exportIds.add(row._exportId)
    const source = row._sourceSessionExportId == null ? owner : byId.get(row._sourceSessionExportId)
    if (!source || source.kind !== 'ttrpg' || source._worldExportId !== owner._worldExportId
      || source._workExportId !== owner._workExportId || source.runtimeSourceHash !== owner.runtimeSourceHash) throw new Error('[ttrpg-memory-backup] 记忆来源实例越界')
    if (source !== owner) {
      let parent = owner
      const seen = new Set<unknown>()
      while (parent !== source && parent && !seen.has(parent._exportId)) {
        seen.add(parent._exportId); parent = byId.get(parent._parentSessionExportId)
      }
      if (parent !== source) throw new Error('[ttrpg-memory-backup] 来源不是保留的祖先实例')
    }
    const { _exportId, _worldGroupExportId, _worldExportId, _workExportId, _productRuntimeSessionExportId,
      _sourceSessionExportId, ...fields } = row
    const memory = parseTtrpgNarrativeMemoryV1({ ...fields, projectId: 1,
      worldGroupId: _worldGroupExportId == null ? null : _worldGroupExportId + 1,
      worldId: _worldExportId + 1, workId: _workExportId + 1, sessionId: _productRuntimeSessionExportId + 1,
      sourceSessionId: _sourceSessionExportId == null ? null : _sourceSessionExportId + 1 })
    if (!Number.isSafeInteger(source.runtimeHeadSequence) || memory.toEventSequence > source.runtimeHeadSequence) throw new Error('[ttrpg-memory-backup] 记忆引用未来事件')
    const identity = `${row._productRuntimeSessionExportId}:${memory.revisionKey}`
    if (identities.has(identity)) throw new Error('[ttrpg-memory-backup] 记忆版本重复')
    identities.add(identity)
  }
}
