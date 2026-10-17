import { expect, test, type Page } from '@playwright/test'
import { confirmEngineeringVisualReview } from '../helpers/avg-visual-review-playwright'

async function adoptSource(page:Page,label:string){
  const card=page.getByRole('article',{name:`作者确认：${label}`,exact:true})
  await card.getByRole('button',{name:`保存候选：${label}`,exact:true}).click()
  await card.getByRole('checkbox',{name:'我已核对该候选内容及素材来源授权',exact:true}).check()
  await card.getByRole('button',{name:`确认采用：${label}`,exact:true}).click()
  await expect(card.getByText('已采用 v1',{exact:true})).toBeVisible()
}

async function prepare(page:Page){
  await page.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','e2e'))
  await page.goto('./avg/library')
  const origin=new URL(page.url()).origin
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin===origin||['blob:','data:'].includes(url.protocol))await route.continue();else await route.abort('blockedbyclient')})
  // Seed only an author-owned saved workspace and frozen world. Production,
  // Brief/start/Plan/Run, original responses and adoption are the actual UI.
  const source=await page.evaluate(async()=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [drafts,editor,presets,worlds,config]=await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'),load('/storyforge/src/lib/avg/editor-service.ts'),
      load('/storyforge/src/lib/avg/authoring-presets.ts'),load('/storyforge/src/lib/world-engine/mist-harbor-preset.ts'),load('/storyforge/src/stores/ai-config.ts')])
    const owner=await drafts.createAvgDraftV1('专业视觉工作台工程验证'),world=await worlds.createMistHarborWorld()
    const selected=await drafts.selectAvgWorldV1(owner.scope,0,world.worldReleaseId),workspace=presets.createAvgAuthoringPresetV1('linear')
    await editor.saveAvgAuthorWorkspaceV1(owner.scope,selected.revision,workspace)
    config.useAIConfigStore.getState().setConfig({provider:'agnes',apiKey:'test-only-intercepted-no-network',model:'agnes-2.5-flash',baseUrl:'https://visual.fixture.invalid/v1'})
    const canvas=document.createElement('canvas');canvas.width=576;canvas.height=324
    const context=canvas.getContext('2d')!;context.fillStyle='#24364b';context.fillRect(0,0,576,324);context.fillStyle='#e4c284';context.fillRect(80,40,100,140)
    return {scope:owner.scope,png:canvas.toDataURL('image/png').split(',')[1],titles:workspace.systemPlan.scenes.map((s:any)=>s.title),text:workspace.scripts[0].lines[0].text}
  })
  const models:any[]=[],images:any[]=[]
  await page.route('https://visual.fixture.invalid/v1/chat/completions',async route=>{
    const body=route.request().postDataJSON();models.push(body)
    const content=body.messages.find((m:any)=>m.role==='user').content as string
    const packet=JSON.parse(content.slice(content.indexOf('{'),content.lastIndexOf('}')+1))
    expect(packet.schema).toBe('storyforge.avg.visual-planning-inputs')
    expect(content).not.toContain(source.text);expect(content).not.toContain('data:image/')
    const direction=body.messages.find((m:any)=>m.role==='system').content.includes('storyforge.avg.visual-bible')
    const output=direction?{schema:'storyforge.avg.visual-bible',version:1,style:{medium:'二维插画',rendering:'清晰轮廓',palette:['暖灰'],lighting:'左上柔光',composition:'保留下方对白区'},
      subjects:packet.subjects.map((s:any)=>({subjectKey:s.subjectKey,subjectKind:s.subjectKind,identityInvariants:['保持门窗位置'],allowedChanges:['允许光照变化'],forbiddenDepictions:['新增剧情秘密']}))}
      :{schema:'storyforge.avg.media-brief',version:1,subjectKey:packet.subjects[0].subjectKey,subjectKind:'environment',designIntent:'已确认地点的背景工程方案',
        outputs:packet.requirements.map((r:any)=>({requirementKey:r.requirementKey,prompt:'左上柔光，窗框位置稳定，下方留白',negativePrompt:'水印',invariants:['保持门窗布局'],forbiddenDepictions:['新增人物'],referenceKeys:r.requiredReferenceKeys}))}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify(output)},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:200}})})
  })
  await page.route('https://visual.fixture.invalid/v1/images/generations',async route=>{
    const body=route.request().postDataJSON();images.push(body)
    expect(body.extra_body.image).toEqual([`data:image/png;base64,${source.png}`])
    expect(body.prompt).toContain('作者修订：保留下方完整对白区')
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{b64_json:source.png}]})})
  })
  await page.goto(`./avg/production?project=${source.scope.projectId}&work=${source.scope.workId}`)
  await page.getByRole('button',{name:'素材',exact:true}).click()
  const media=page.getByRole('region',{name:'图片生产（实验）',exact:true})
  await media.getByText('导入仅供生成使用的参考图',{exact:true}).click()
  await media.getByLabel('参考图文件',{exact:true}).setInputFiles({name:'原创专业参考.png',mimeType:'image/png',buffer:Buffer.from(source.png,'base64')})
  await media.getByLabel('参考图来源与授权',{exact:true}).fill('本测试原创工程像素，仅验证来源与实际传输，不签艺术或商业质量')
  await media.getByRole('button',{name:'导入为参考，不加入演出',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'参考图已解码'})).toBeVisible()
  const panel=page.getByRole('region',{name:'专业视觉策划（实验）',exact:true})
  await panel.getByLabel('必须呈现的场景细节（每行一项）',{exact:true}).fill('明确窗户、书桌与门的位置；保留下方对白区')
  await panel.getByLabel('本次风格参考',{exact:true}).selectOption({label:'原创专业参考.png'})
  await panel.getByLabel('参考允许改变的内容',{exact:true}).fill('只参考配色，允许重新设计布局细节')
  await expect(panel.getByRole('button',{name:'准备专业视觉制作方案',exact:true})).toBeDisabled()
  await panel.getByRole('checkbox',{name:'我有权向本次图片供应商发送该参考',exact:true}).check()
  await panel.getByRole('checkbox',{name:'我有权用该参考进行本次衍生创作',exact:true}).check()
  await panel.getByRole('button',{name:'准备专业视觉制作方案',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'专业视觉方案已准备'})).toBeVisible()
  expect(models).toHaveLength(0);expect(images).toHaveLength(0)
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  await panel.getByRole('button',{name:'修改尚未开始的专业用途',exact:true}).click()
  await expect(panel.getByLabel('本次风格参考',{exact:true})).not.toHaveValue('')
  await panel.getByLabel('必须呈现的场景细节（每行一项）',{exact:true}).fill('作者再次确认门窗与书桌的位置，并保留下方完整对白区')
  await expect(panel.getByRole('button',{name:'准备专业视觉制作方案',exact:true})).toBeDisabled()
  await panel.getByRole('checkbox',{name:'我有权向本次图片供应商发送该参考',exact:true}).check()
  await panel.getByRole('checkbox',{name:'我有权用该参考进行本次衍生创作',exact:true}).check()
  await panel.getByRole('button',{name:'准备专业视觉制作方案',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'专业视觉方案已准备'})).toBeVisible()
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await adoptSource(page,'系统规则');for(const title of source.titles)await adoptSource(page,`场景：${title}`)
  await page.getByRole('button',{name:'素材',exact:true}).click()
  await panel.getByRole('button',{name:'执行已确认的专业方案与图片任务',exact:true}).click()
  await expect(panel.getByRole('article',{name:'专业方案：视觉基准',exact:true})).toBeVisible({timeout:60_000})
  return {source,models,images,panel}
}

test('professional visual workbench preserves author edits, transmits approved reference bytes and restores a real frozen native Preview',async({page},info)=>{
  test.setTimeout(240_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1'||process.env.VITE_STORYFORGE_AVG_VISUAL_PLANNING!=='1','Both default-off visual experiments must be explicit')
  const {source,models,images,panel}=await prepare(page)
  let direction=panel.getByRole('article',{name:'专业方案：视觉基准',exact:true})
  await direction.getByLabel('构图与留白',{exact:true}).fill('作者修订：保留下方完整对白区')
  await direction.getByRole('button',{name:'保存待确认：视觉基准',exact:true}).click()
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  direction=panel.getByRole('article',{name:'专业方案：视觉基准',exact:true})
  await expect(direction.getByLabel('构图与留白',{exact:true})).toHaveValue('作者修订：保留下方完整对白区')
  expect(models).toHaveLength(1);expect(images).toHaveLength(0)
  await direction.getByRole('checkbox',{name:'我已核对本方案内容及允许参考',exact:true}).check()
  await direction.getByRole('button',{name:'确认采用：视觉基准',exact:true}).click()
  await panel.getByRole('button',{name:'执行已确认的专业方案与图片任务',exact:true}).click()
  const subject=panel.getByRole('article',{name:`专业方案：场景方案：${source.titles[0]}`,exact:true})
  await expect(subject).toBeVisible({timeout:60_000})
  await subject.getByLabel('生成画面要求',{exact:true}).fill('作者修订：保留下方完整对白区；保持已批准的门窗布局')
  await subject.getByRole('button',{name:`保存待确认：场景方案：${source.titles[0]}`,exact:true}).click()
  await subject.getByRole('checkbox',{name:'我已核对本方案内容及允许参考',exact:true}).check()
  await subject.getByRole('button',{name:`确认采用：场景方案：${source.titles[0]}`,exact:true}).click()
  await panel.getByRole('button',{name:'执行已确认的专业方案与图片任务',exact:true}).click()
  const card=page.getByRole('article',{name:`图片候选：${source.titles[0]}背景`,exact:true})
  await expect(card).toBeVisible({timeout:60_000});expect(models).toHaveLength(2);expect(images).toHaveLength(1)
  await confirmEngineeringVisualReview(card,`${source.titles[0]}背景`)
  await card.getByRole('button',{name:`保存选图候选：${source.titles[0]}背景`,exact:true}).click()
  await card.getByRole('checkbox',{name:'我已查看这张图片并核对用途、来源与使用权',exact:true}).check()
  await card.getByRole('button',{name:`确认选用：${source.titles[0]}背景`,exact:true}).click()
  await page.getByRole('button',{name:'将已选图片配置到演出草稿',exact:true}).click()
  await page.evaluate(async()=>{const load=new Function('p','return import(p)') as (p:string)=>Promise<any>;const {useAIConfigStore}=await load('/storyforge/src/stores/ai-config.ts');useAIConfigStore.getState().setConfig({apiKey:''})})
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click();await adoptSource(page,'演出与媒资')
  await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible({timeout:60_000})
  await page.getByRole('button',{name:'试玩此预览',exact:true}).click()
  const originalUrl=page.url()
  await expect.poll(()=>page.locator('.avg-stage img').evaluateAll((imgs:HTMLImageElement[])=>imgs.some(i=>i.complete&&i.naturalWidth===576))).toBe(true)
  await page.reload();await expect(page.locator('.avg-dialogue p')).toContainText(source.text)
  const restored=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [schema,backup,service,proof]=await Promise.all([load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/export/json-export.ts'),load('/storyforge/src/lib/product-production/service.ts'),load('/storyforge/src/lib/product-production/artifact-store.ts')])
    const projectId=await backup.importProjectJSON(await backup.exportProjectJSON(scope.projectId)),build=await schema.db.productBuilds.where('projectId').equals(projectId).first()
    const importedScope={projectId,worldId:build.worldId,workId:build.workId}
    await service.recoverImportedProductProductionProofsV1({scope:importedScope,productionId:build.productionId})
    await proof.verifyProductBuildTerminalArtifactSetV1({scope:importedScope,productionId:build.productionId,buildId:build.id,expectedControlEpoch:build.controlEpoch,expectedPlanHash:build.planHash})
    const session=await service.startProductProductionPreviewV1({scope:importedScope,productionId:build.productionId,expectedBuildId:build.id,expectedPreviewHash:build.previewHash})
    return {scope:importedScope,sessionId:session.sessionId}
  },source.scope)
  const url=new URL(originalUrl);url.searchParams.set('project',String(restored.scope.projectId));url.searchParams.set('work',String(restored.scope.workId));url.searchParams.set('session',String(restored.sessionId))
  await page.goto(url.toString());await expect.poll(()=>page.locator('.avg-stage img').evaluateAll((imgs:HTMLImageElement[])=>imgs.some(i=>i.complete&&i.naturalWidth===576))).toBe(true)
  await page.screenshot({path:info.outputPath('avg-v4-professional-restored-preview.png')})
  await page.evaluate(async workId=>{const load=new Function('p','return import(p)') as (p:string)=>Promise<any>;await(await load('/storyforge/src/lib/workspace/lifecycle.ts')).deleteWork(workId)},restored.scope.workId)
  await page.goto(originalUrl);await expect.poll(()=>page.locator('.avg-stage img').evaluateAll((imgs:HTMLImageElement[])=>imgs.some(i=>i.complete&&i.naturalWidth===576))).toBe(true)
  expect(models).toHaveLength(2);expect(images).toHaveLength(1)
})

test('author refuses an exact professional proposal and refresh retains its reason and original evidence without another request',async({page})=>{
  test.setTimeout(120_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1'||process.env.VITE_STORYFORGE_AVG_VISUAL_PLANNING!=='1','Both default-off visual experiments must be explicit')
  const {source,models,images,panel}=await prepare(page),direction=panel.getByRole('article',{name:'专业方案：视觉基准',exact:true})
  await direction.getByLabel('退回依据',{exact:true}).fill('作者拒绝：构图方向不合适，停止本批，保留原始方案与未知费用')
  await direction.getByRole('button',{name:'退回此方案并停止本批',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'已记录退回依据并停止本批'})).toBeVisible()
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  await expect(panel.getByRole('article',{name:'专业方案：视觉基准',exact:true})).toBeVisible()
  const state=await page.evaluate(async scope=>{const load=new Function('p','return import(p)') as (p:string)=>Promise<any>;const {db}=await load('/storyforge/src/lib/db/schema.ts');const build=await db.productBuilds.where('workId').equals(scope.workId).first();return {status:build.status,failure:build.failureJson,artifacts:await db.agentRunArtifacts.where('projectId').equals(scope.projectId).count()}},source.scope)
  expect(state.status).toBe('cancelled');expect(state.failure).toContain('作者拒绝');expect(state.artifacts).toBeGreaterThan(0)
  expect(models).toHaveLength(1);expect(images).toHaveLength(0)
})

test('professional family form preserves five exact targets and reference permissions through refresh and starts the real Plan without dispatch',async({page},info)=>{
  test.setTimeout(120_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1'||process.env.VITE_STORYFORGE_AVG_VISUAL_PLANNING!=='1','Both default-off visual experiments must be explicit')
  await page.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','e2e'))
  await page.goto('./avg/library')
  const origin=new URL(page.url()).origin,calls:string[]=[]
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin===origin||['blob:','data:'].includes(url.protocol))await route.continue();else{if(url.hostname==='visual.fixture.invalid')calls.push(url.pathname);await route.abort('blockedbyclient')}})
  const source=await page.evaluate(async()=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [drafts,editor,presets,worlds,config]=await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'),load('/storyforge/src/lib/avg/editor-service.ts'),load('/storyforge/src/lib/avg/authoring-presets.ts'),load('/storyforge/src/lib/world-engine/mist-harbor-preset.ts'),load('/storyforge/src/stores/ai-config.ts')])
    const owner=await drafts.createAvgDraftV1('专业家族用途原生工程验证'),world=await worlds.createMistHarborWorld(),selected=await drafts.selectAvgWorldV1(owner.scope,0,world.worldReleaseId)
    await editor.saveAvgAuthorWorkspaceV1(owner.scope,selected.revision,presets.createAvgAuthoringPresetV1('evidence'))
    config.useAIConfigStore.getState().setConfig({provider:'agnes',apiKey:'test-only-intercepted-no-network',model:'agnes-2.5-flash',baseUrl:'https://visual.fixture.invalid/v1'})
    const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const context=canvas.getContext('2d')!;context.fillStyle='#26384e';context.fillRect(0,0,32,32)
    return {scope:owner.scope,png:canvas.toDataURL('image/png').split(',')[1]}
  })
  await page.goto(`./avg/production?project=${source.scope.projectId}&work=${source.scope.workId}`)
  await page.getByRole('button',{name:'素材',exact:true}).click()
  const media=page.getByRole('region',{name:'图片生产（实验）',exact:true})
  await media.getByText('导入仅供生成使用的参考图',{exact:true}).click()
  for(const name of ['家族风格参考.png','人物身份参考.png']){
    await media.getByLabel('参考图文件',{exact:true}).setInputFiles({name,mimeType:'image/png',buffer:Buffer.from(source.png,'base64')})
    await media.getByLabel('参考图来源与授权',{exact:true}).fill('本测试原创工程参考，只验许可和传输协议，不签艺术质量')
    await media.getByRole('button',{name:'导入为参考，不加入演出',exact:true}).click()
    await expect(page.getByRole('status').filter({hasText:'参考图已解码'})).toBeVisible()
  }
  const panel=page.getByRole('region',{name:'专业视觉策划（实验）',exact:true})
  await panel.getByLabel('必须呈现的场景细节（每行一项）',{exact:true}).fill('保持已有门窗与对白区')
  for(const name of ['新增人物姿态','新增人物表情','新增物件图标与详情图'])await panel.getByRole('button',{name,exact:true}).click()
  await expect(panel.getByRole('article',{name:/^专业用途 /})).toHaveCount(5)
  for(let i=2;i<=5;i++)await panel.getByRole('article',{name:`专业用途 ${i}`,exact:true}).getByLabel('必须保持或呈现的细节（每行一项）',{exact:true}).fill('保持公开造型\n明确本图的姿态或物件用途')
  const pose=panel.getByRole('article',{name:'专业用途 2',exact:true}),expression=panel.getByRole('article',{name:'专业用途 3',exact:true})
  await pose.getByLabel('图像宽度',{exact:true}).fill('640');await expect(expression.getByLabel('图像宽度',{exact:true})).toHaveValue('640')
  await panel.getByLabel('本次风格参考',{exact:true}).selectOption({label:'家族风格参考.png'})
  await panel.getByLabel('参考允许改变的内容',{exact:true}).fill('只参考配色，允许重新布局')
  await pose.getByLabel('已导入的家族基准',{exact:true}).selectOption({label:'人物身份参考.png'})
  await pose.getByLabel('家族基准允许变化',{exact:true}).fill('保持同一人物，只改变姿态和表情')
  await expect(expression.getByLabel('已导入的家族基准',{exact:true})).toHaveValue(await pose.getByLabel('已导入的家族基准',{exact:true}).inputValue())
  const prepareButton=panel.getByRole('button',{name:'准备专业视觉制作方案',exact:true})
  await expect(prepareButton).toBeDisabled()
  for(const name of ['我有权向本次图片供应商发送该参考','我有权用该参考进行本次衍生创作'])await panel.getByRole('checkbox',{name,exact:true}).check()
  await prepareButton.click();await expect(page.getByRole('status').filter({hasText:'专业视觉方案已准备'})).toBeVisible()
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  await panel.getByRole('button',{name:'修改尚未开始的专业用途',exact:true}).click()
  await expect(panel.getByRole('article',{name:/^专业用途 /})).toHaveCount(5)
  await expect(prepareButton).toBeDisabled()
  await expect(pose.getByLabel('图像宽度',{exact:true})).toHaveValue('640')
  await pose.getByLabel('图像宽度',{exact:true}).fill('704')
  await expect(expression.getByLabel('图像宽度',{exact:true})).toHaveValue('704')
  await panel.getByRole('button',{name:'撤销未保存的专业用途',exact:true}).click()
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  const state=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [service,contracts]=await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/product-production/contracts.ts')])
    const view=await service.readAvgAssemblyWorkspaceV1(scope),details=view.details,brief=contracts.parseProductProductionBriefV3(details.brief.briefJson),plan=JSON.parse(details.build.planJson)
    return {scope:brief.avgVisualPlanning.scope,modelTasks:plan.tasks.filter((t:any)=>t.executionMode==='model').length,imageTasks:plan.tasks.filter((t:any)=>t.taskKey.startsWith('avg.media.generate.')).length,usage:view.visualProgress.budget.usage,assets:JSON.parse(view.draft.editorJson).presentation.stage.assets}
  },source.scope)
  expect(state.scope.templates.map((t:any)=>t.subjectKind)).toEqual(['environment','character','character','prop','prop'])
  expect(state.scope.templates[1].parameters.width).toBe(640);expect(state.scope.templates[2].parameters.width).toBe(640)
  expect(state.scope.referenceCatalog.map((r:any)=>r.reference.purpose).sort()).toEqual(['identity','style'])
  expect(state.modelTasks).toBe(4);expect(state.imageTasks).toBe(5);expect(state.usage).toMatchObject({modelCalls:0,mediaCalls:0});expect(state.assets).toEqual([]);expect(calls).toEqual([])
  await page.getByRole('button',{name:'素材',exact:true}).click()
  await page.screenshot({path:info.outputPath('avg-v4-professional-family-scope.png'),fullPage:true})
})
