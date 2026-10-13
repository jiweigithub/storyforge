import type {ChatNarrativeSetupV1} from '../../lib/character-interaction/narrative-setup'
import type {ChatNarrativePermissionsV1} from '../../lib/types/chat-narrative'

export default function NarrativeSetup({value, onChange}: {value: ChatNarrativeSetupV1; onChange: (value: ChatNarrativeSetupV1) => void}) {
  const permissions = value.permissions
  const change = (patch: Partial<ChatNarrativeSetupV1>) => onChange({...value, ...patch})
  const permit = (patch: Partial<ChatNarrativePermissionsV1>) => change({permissions: {...permissions, ...patch}})
  const triggers: Array<[ChatNarrativePermissionsV1['triggers'][number], string]> = [
    ['scene-start', '进入场景时'], ['player-response', '我说话以后'], ['continue', '我点击继续时'], ['return', '我返回聊天时'], ['player-seed', '我提出新情景时'],
  ]
  const kinds: Array<[ChatNarrativePermissionsV1['allowedNewFactKinds'][number], string]> = [
    ['observation', '观察到的新细节'], ['object', '新物件'], ['place', '新地点'], ['temporary-character', '临时登场人物'],
  ]
  return <section className="col-span-full" data-testid="chat-narrative-setup">
    <h4>故事如何开始和推进</h4>
    <p>你提出情景后，先比较并选定初始局面，再由角色依据自身目标持续行动。玩家身份指故事中的虚构角色。</p>
    <div className="avg-form">
      <label>玩家虚构角色的称呼<input value={value.personaName} maxLength={200} onChange={e => change({personaName: e.target.value})}/></label>
      <label>地点（可留空）<input value={value.location} maxLength={1000} onChange={e => change({location: e.target.value})}/></label>
      <label>时间（可留空）<input value={value.timeLabel} maxLength={1000} onChange={e => change({timeLabel: e.target.value})}/></label>
      <label>供比较的开场数<select value={value.openingCount} onChange={e => change({openingCount: Number(e.target.value)})}>{[3, 4, 5].map(n => <option key={n} value={n}>{n} 个</option>)}</select></label>
      <label>互动节奏<select value={permissions.mode} onChange={e => permit({mode: e.target.value as ChatNarrativePermissionsV1['mode']})}><option value="story">故事：围绕未完成的事推进</option><option value="companionship">陪伴：允许平静相处，不强求冲突</option></select></label>
      <label>情境强度<select value={permissions.intensity} onChange={e => permit({intensity: e.target.value as ChatNarrativePermissionsV1['intensity']})}><option value="everyday">日常</option><option value="tension">有张力</option><option value="danger">有危险</option></select></label>
      <fieldset><legend>允许角色主动行动的时机</legend>{triggers.map(([key, label]) => <label key={key}><input type="checkbox" checked={permissions.triggers.includes(key)} onChange={e => permit({triggers: e.target.checked ? [...permissions.triggers, key] : permissions.triggers.filter(t => t !== key)})}/>{label}</label>)}</fieldset>
      <fieldset><legend>允许引入的内容</legend>{kinds.map(([key, label]) => <label key={key}><input type="checkbox" checked={permissions.allowedNewFactKinds.includes(key)} onChange={e => permit({allowedNewFactKinds: e.target.checked ? [...permissions.allowedNewFactKinds, key] : permissions.allowedNewFactKinds.filter(t => t !== key)})}/>{label}</label>)}</fieldset>
      <label>同时推进的事项上限<input type="number" min={1} max={8} value={permissions.maxActiveThreads} onChange={e => permit({maxActiveThreads: Number(e.target.value)})}/></label>
      <label>每次触发的角色行动上限<input type="number" min={1} max={3} value={permissions.maxActionsPerTrigger} onChange={e => permit({maxActionsPerTrigger: Number(e.target.value)})}/></label>
      <label>每次行动可新增的事实数<input type="number" min={0} max={5} value={permissions.maxNewFactsPerAction} onChange={e => permit({maxNewFactsPerAction: Number(e.target.value)})}/></label>
      <label>每次行动文字上限<input type="number" min={100} max={8000} value={permissions.maxActionCharacters} onChange={e => permit({maxActionCharacters: Number(e.target.value)})}/></label>
    </div>
  </section>
}
