from pathlib import Path
import json,hashlib,datetime
base=Path('tests/acceptance/narrative-world');report_path=base/'impact-model-20261015-v2.json';report=json.loads(report_path.read_text())
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
run=Path(report['run']['path']);manifest_path=run/'manifest.json';assert sha(manifest_path)==report['run']['manifestFileSha256'];manifest=json.loads(manifest_path.read_text())
corpus_path=base/'corpus-v1.json';assert sha(corpus_path)==report['sourceHashes'][str(corpus_path)]
selection=[('ferry-names:e03',[('A','ferry-names:chapter-2')]),('clock-retelling:e03',[('B','clock-retelling:chapter-2')]),('theater-promise:e03',[('C','theater-promise:chapter-2')]),('two-calendars:e03',[('D','two-calendars:chapter-2'),('E','two-calendars:chapter-4')])]
lines=['# 修改影响：五处独立判断材料','', '这份材料用于审核工程测试中的“哪些后文值得复核”。下面是四组完整的合成测试记录，含叙事片段、人物卡和故事线；它们不是用户小说，也不用于评价文学质量。原始测试记录含直接陈述与测试设置，这是其本来的形式。', '', '请先按材料独立判断 A～E。这里没有展示原测试标签、既有模型建议或分数。五处来自已观察到的分歧，属于有针对性的复核，不能当作整套评测的独立随机抽样。', '', '每项请选择：**需要复核 / 未发现具体影响 / 资料不足**。有具体矛盾、依赖或认知/行动依据变化才建议复核；只是在后面、属于同一故事或同一角色出现，不足以单独决定。若有判断依据，可写一句理由或引用原句。', '', '“未发现具体影响”不等于证明绝对安全；这次判断不会自动改稿、改变锁定记录、改写旧分数或清除生产计划的待复核项。', '', '| 项目 | 你的判断 | 可选理由或引文 |', '|---|---|---|']
lines.extend('| '+label+' | 待填写 | |' for _,items in selection for label,_ in items)
lines.append('')
refs={str(report_path):sha(report_path),str(manifest_path):sha(manifest_path),str(corpus_path):sha(corpus_path)};key=[];rendered=[]
kind_labels={'chapter':'叙事片段','character':'人物卡','story-arc':'故事线'}
for case_id,items in selection:
 entry=next(x for x in manifest['cases'] if x['id']==case_id);request_path=run/'calls'/(entry['promptHash']+'.request.json');result_path=run/'calls'/(entry['promptHash']+'.result.json')
 for p in [request_path,result_path]:assert sha(p)==report['rawHashes'][str(p)];refs[str(p)]=sha(p)
 request=json.loads(request_path.read_text());data=json.loads(request['messages'][1]['content'])
 assert request['promptHash']==entry['promptHash'] and request['model']==report['model']
 sources={x['sourceId']:x for x in data['storyBefore']};mapping=entry['sourceMap']
 title=sources['S1']['title'].split('·')[0];labels=' / '.join(x[0] for x in items)
 lines.extend(['## '+labels+' · '+title,'','### 修改前的全部输入记录',''])
 for source in data['storyBefore']:
  lines.extend(['**'+source['sourceId']+' · '+source['title']+'（'+kind_labels.get(source['kind'],source['kind'])+'）**','',source['text'],'']);rendered.append(source['text'])
 edit=data['proposedEdit'];changed=sources[edit['sourceId']]
 assert changed['text'].count(edit['before'])==1
 assert changed['text'].replace(edit['before'],edit['after'])==edit['fullTextAfter']['text']
 lines.extend(['### 本次拟改','', '**只替换 '+edit['sourceId']+' 中这一句。**','', '修改前：'+edit['before'],'', '修改后：'+edit['after'],'','修改后的该段完整文本：','',edit['fullTextAfter']['text'],''])
 protected=data['protectedFact'];holder=sources[protected['holderSourceId']]['title']
 lines.extend(['### 原有作者约束（设置说明，不是叙事原文）','','人物卡 '+protected['holderSourceId']+' 的'+holder+'有一条已确认、已锁定的知识记录：'+protected['value'],'','上述草稿修改不会自动改变这条知识记录。仅以原记录及拟改内容作判断，不补写未提供的获知、动机或时间。',''])
 for label,target in items:
  sid=next(k for k,v in mapping.items() if v==target);target_record=sources[sid];d=next(x for x in report['goldDisagreements'] if x['id']==case_id and x['target']==target)
  assert d['targetOriginalFullText']==target_record['text']
  lines.extend(['### 判断 '+label+'：'+sid+' · '+target_record['title'],'',target_record['text'],'','仅针对这次改句，这一目标段属于“需要复核”“未发现具体影响”还是“资料不足”？',''])
  key.append({'label':label,'caseId':case_id,'target':target,'requestSourceId':sid,'promptHash':entry['promptHash'],'historicalClassification':d['classification'],'frozenGold':d['frozenGold'],'historicalModelRecommendation':d['modelRecommendation']})
body='\n'.join(lines)+'\n'
for text in rendered:assert text in body
assert len(key)==5 and len(rendered)==32
packet=base/'impact-disagreement-author-review-20261016-v1.md';packet.open('x').write(body)
key_path=base/'impact-disagreement-review-key-20261016-v1.json';key_path.open('x').write(json.dumps({'schema':'storyforge.impact-disagreement-review-key','version':1,'boundary':'Separate audit mapping; prior labels and model analysis intentionally omitted from the author packet. No adjudication or gold change.','cases':key},ensure_ascii=False,indent=2)+'\n')
receipt={'schema':'storyforge.impact-disagreement-review-packet','version':1,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'prepared-awaiting-independent-author-judgment','workPackage':'NW-2D','packet':str(packet),'packetSha256':sha(packet),'key':str(key_path),'keySha256':sha(key_path),'selection':'Four edit cases / five target disagreements selected after inspecting existing complete protocol-v2 results. Diagnostic adjudication only, not independent random-sample quality acceptance.','sourceHashes':refs,'completeOriginalInputRecords':32,'editCases':4,'judgmentsRequested':5,'originalQuotesPreserved':True,'modelOutputsShownInAuthorPacket':False,'frozenGoldShownInAuthorPacket':False,'actualNewModelCalls':0,'humanJudgmentsReceived':0,'priorScoresChanged':False,'productionFilesChanged':False,'accepted':False}
receipt_path=base/'impact-disagreement-review-packet-20261016-v1.json';receipt_path.open('x').write(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'packet':str(packet),'characters':len(body),'records':len(rendered),'judgments':len(key),'sourcesVerified':len(refs)},ensure_ascii=False))
