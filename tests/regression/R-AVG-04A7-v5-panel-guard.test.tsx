import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { act } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { db } from '../../src/lib/db/schema'
import VisualPlanningPanel from '../../src/components/avg/VisualPlanningPanel'
import { avgV5FormalFixture } from '../helpers/avg-v5-formal-fixture'
import { readAvgAssemblyWorkspaceV1 } from '../../src/lib/avg/assembly-service'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let mounted:Root|undefined
beforeEach(async()=>{await db.delete();await db.open();vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')})
afterEach(async()=>{if(mounted)await act(async()=>mounted!.unmount());mounted=undefined;document.body.innerHTML='';vi.restoreAllMocks();vi.unstubAllEnvs();db.close()})
describe('AVG old workbench guard for explicit new-format metadata',()=>{
  it('preserves a V5 preparation record without showing an old form or an old production action',async()=>{
    const {owner,author,brief}=await avgV5FormalFixture(),view=await readAvgAssemblyWorkspaceV1(owner.scope)
    // UI-only metadata overlay: no V5 Brief/Build/Run or receipt is written.
    const projected={...view,details:{...view.details!,brief:{...view.details!.brief!,briefJson:JSON.stringify(brief),briefHash:await hashProductProductionValueV2(brief)}}}
    const container=document.createElement('div');document.body.appendChild(container);mounted=createRoot(container)
    const prepare=vi.fn(),generate=vi.fn(),action=vi.fn(),pending=vi.fn()
    await act(async()=>mounted!.render(<VisualPlanningPanel scope={owner.scope} view={projected} workspace={author.source} disabled={false}
      visible={true} activeBuild={false} sourcesReady={true} declaration="工程验证" generating={false} onAction={action} onPrepare={prepare}
      onGenerate={generate} onCancel={vi.fn()} onReload={vi.fn()} onNotice={vi.fn()} onPending={pending}/>))
    expect(container.textContent).toContain('此制作方案需要新版媒资工作台')
    expect(container.querySelectorAll('form,button,input,textarea,select')).toHaveLength(0)
    expect(prepare).not.toHaveBeenCalled();expect(generate).not.toHaveBeenCalled();expect(action).not.toHaveBeenCalled()
  })
})
