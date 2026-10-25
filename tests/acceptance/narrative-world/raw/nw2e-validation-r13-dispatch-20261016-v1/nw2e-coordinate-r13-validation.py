from pathlib import Path
import datetime,hashlib,json,subprocess,sys
root=Path('/Users/qinyingying/.codex/worktrees/nw2e-verification-r13/storyforge');runner=Path('/tmp/nw2e-run-frozen-r13.py')
scripts={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [runner]}
terminal=Path('/tmp/nw2e-r13-pipeline-terminal.json');assert not terminal.exists()
record={'schema':'storyforge.validation-pipeline-terminal','version':1,'generation':'r13','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'stages':[],'scriptHashes':scripts,'accepted':False,'modelCalls':0}
code=2
try:
 for mode in ['query-e2e','ci','e2e']:
  for path,expected in scripts.items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==expected,'Validation runner changed'
  log=Path('/tmp/nw2e-r13-'+mode+'.log');command=['python3',str(runner),mode]
  print('Requesting shared slot for current r13 '+mode,flush=True)
  stage={'mode':mode,'requestedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'log':str(log)};record['stages'].append(stage)
  with log.open('x') as stream:code=subprocess.call(['python3','/tmp/storyforge-serial-ci-20261013.py','--',*command],cwd=root,stdout=stream,stderr=subprocess.STDOUT)
  stage.update(wrapperExitCode=code,endedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
  result_path=Path('/tmp/nw2e-r13-'+mode+'-terminal.json');stage['terminalWritten']=result_path.exists()
  if code or not result_path.exists():
   code=code or 2;print('Stage failed before verified success; later stages are not dispatched.',flush=True);break
  result=json.loads(result_path.read_text());assert result['exitCode']==0 and result['sourceUnchanged'] is True,'Runner did not confirm success'
  stage['verifiedSuccess']=True
except BaseException as error:
 record['error']=type(error).__name__+': '+str(error);code=2
finally:
 record.update(exitCode=code,endedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
 terminal.open('x').write(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
print('r13 pipeline terminal exit='+str(code)+'; scientific and author acceptance are separate.',flush=True)
sys.exit(code)
