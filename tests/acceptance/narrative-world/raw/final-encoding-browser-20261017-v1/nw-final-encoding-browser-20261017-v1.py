from pathlib import Path
import datetime, hashlib, json, os, shutil, signal, socket, subprocess, sys
root = Path('/Users/qinyingying/.codex/worktrees/nw-mainline-refresh-20261016/storyforge')
prefix = Path('/tmp/nw-final-encoding-browser-20261017-v1')
pin_path = Path(str(prefix) + '-sources.json')
pin = json.loads(pin_path.read_text())
terminal = Path(str(prefix) + '-terminal.json')
assert not terminal.exists()
def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def verify():
    assert Path.cwd() == root
    assert digest(Path(__file__)) == pin['runnerSha256']
    for ref, key in [('HEAD','head'),('MERGE_HEAD','mergeHead')]:
        assert subprocess.check_output(['git','rev-parse',ref],text=True).strip() == pin[key]
    changed = [p for p,h in pin['files'].items() if not (root/p).is_file() or digest(root/p)!=h]
    assert not changed, 'Pinned sources changed: '+json.dumps(changed)
def stop(signum, frame): raise SystemExit(128+signum)
signal.signal(signal.SIGTERM,stop); signal.signal(signal.SIGINT,stop)
record={'schema':'storyforge.narrative-final-encoding-browser-validation','version':1,
        'startedAt':utc(),'root':str(root),'head':pin['head'],'mergeHead':pin['mergeHead'],
        'pinSha256':digest(pin_path),'sourceFiles':len(pin['files']),'phases':[],
        'sourceUnchanged':False,'fullCI':False,'fullE2E':False,'accepted':False,'actualModelCalls':0}
code=2
try:
    verify()
    env=dict(os.environ,CI='1',PLAYWRIGHT_FROZEN_WORKSPACE='1',PLAYWRIGHT_HTML_OUTPUT_DIR=str(prefix)+'-html')
    for key in list(env):
        if key.startswith('NW_SCALE_') or key in ['NW_BASELINE_REPORT','NW_IR_REPORT','NW_DOMAIN_REPORT']:
            env.pop(key,None)
    playwright=['node','node_modules/@playwright/test/cli.js','test']
    stages=[('native',playwright+['tests/e2e/narrative-query.spec.ts','tests/e2e/narrative-source-plan.spec.ts']),
            ('profile',playwright+['tests/e2e/narrative-scale.spec.ts'])]
    code=0
    for name,command in stages:
        verify()
        free=shutil.disk_usage(root).free/2**30
        assert free>=5, 'Less than5GiB free'
        phase_env=dict(env)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));phase_env['PLAYWRIGHT_PORT']=str(sock.getsockname()[1])
        if name=='profile':
            phase_env.update(NW_SCALE_BROWSER_MODE='diagnostic',NW_SCALE_PROFILE='compiler-v2',
                NW_SCALE_BROWSER_SIZES='1000000',NW_SCALE_BROWSER_REPORT=str(prefix)+'-profile.json',
                NW_SCALE_BROWSER_VECTORS='tests/acceptance/narrative-world/scale-vectors-20261015-v2.json',
                NW_SCALE_BROWSER_SOURCES=str(prefix)+'-scale-sources.json')
        command+=['--reporter=line','--retries=0','--output='+str(prefix)+'-'+name+'-test-results']
        log=Path(str(prefix)+'-'+name+'.log')
        item={'name':name,'command':command,'startedAt':utc(),'log':str(log),'freeGiB':free}
        record['phases'].append(item)
        print(json.dumps({'starting':name,'at':item['startedAt'],'log':str(log)}),flush=True)
        processes=Path(str(prefix)+'-'+name+'-processes-before.txt')
        processes.write_text(subprocess.check_output(['ps','-axo','pid,ppid,etime,command'],text=True))
        with log.open('x') as output:
            result=subprocess.call(command,env=phase_env,stdout=output,stderr=subprocess.STDOUT)
        item.update(exitCode=result,endedAt=utc(),logSha256=digest(log))
        if result:code=1
        verify()
        if name=='profile' and result==0:
            report=Path(str(prefix)+'-profile.json'); measured=json.loads(report.read_text())
            assert not measured['cpuProfiling'] and not measured['heapProfiling'] and not measured['accepted']
            record.update(diagnosticCompleted=True,diagnosticReport=str(report),diagnosticSha256=digest(report))
        print(json.dumps({'completed':name,'exitCode':result}),flush=True)
except BaseException as error:
    record['error']=type(error).__name__+': '+str(error)
    code=error.code if isinstance(error,SystemExit) and isinstance(error.code,int) else (code or 2)
finally:
    try:verify();record['sourceUnchanged']=True
    except BaseException as error:record['sourceCheckError']=str(error);code=2
    record.update(exitCode=code,endedAt=utc())
    with terminal.open('x') as output:json.dump(record,output,ensure_ascii=False,indent=2);output.write('\n')
    print(json.dumps({'exitCode':code,'terminal':str(terminal),'sourceUnchanged':record['sourceUnchanged']}),flush=True)
sys.exit(code)
