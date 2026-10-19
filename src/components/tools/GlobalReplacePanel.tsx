import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useChapterStore } from '../../stores/chapter'
import { useOutlineStore } from '../../stores/outline'
import { useCharacterStore } from '../../stores/character'
import { useWorldGroupStore } from '../../stores/world-group'
import FindReplacePanel from '../editor/FindReplacePanel'
import type { Project } from '../../lib/types'

/** Compatibility route: both entry points use the same editor and write service. */
export default function GlobalReplacePanel({ project }: { project: Project }) {
  const navigate = useNavigate()
  const chapters = useChapterStore(state => state.chapters)
  const nodes = useOutlineStore(state => state.nodes)
  const activeGroupId = useWorldGroupStore(state => state.activeGroupId)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setReady(false); setError('')
    void Promise.all([useChapterStore.getState().loadAll(project.id!), useOutlineStore.getState().loadAll(project.id!), useCharacterStore.getState().loadAll(project.id!)])
      .then(() => { if (active) setReady(true) })
      .catch(reason => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [project.id, project.activeWorkId, project.activeWorldId])
  if (error) return <p role="alert">资料加载失败：{error}</p>
  if (!ready) return <p role="status">正在读取当前作品…</p>
  return <FindReplacePanel key={`${project.id}:${project.activeWorkId}:${project.activeWorldId}:${activeGroupId}`} projectId={project.id!} chapters={chapters} outlineNodes={nodes}
    initialScope="book" worldGroupId={project.enableMultiWorld ? activeGroupId : null} selectedOutlineNodeId={null}
    onSelectOutlineNode={id => { navigate(`/workspace/${project.id}?module=chapters-list&chapter=${id}`) }} />
}
