"""Summarize CDP sampled allocations. Totals include GC and are not retained RSS."""
from pathlib import Path
from collections import defaultdict
import hashlib,json,sys

def summarize(path):
    payload=json.loads(path.read_text())
    profile=payload.get('profile',payload)
    files=defaultdict(float);functions=defaultdict(float);inclusive=defaultdict(float)
    stacks=[];node_count=0
    def label(frame):
        url=frame.get('url','').split('?')[0]
        if '/storyforge/' in url:url=url.split('/storyforge/',1)[1]
        return (url or '(runtime)',frame.get('functionName') or '(anonymous)',frame.get('lineNumber',-1)+1)
    def walk(node,ancestors):
        nonlocal node_count
        node_count+=1
        frame=label(node['callFrame']); amount=node.get('selfSize',0)
        files[frame[0]]+=amount;functions[frame]+=amount
        chain=ancestors+[frame]
        if amount:
            for key in set(chain):inclusive[key]+=amount
            stacks.append({'sampledBytes':amount,'frames':chain[-12:]})
        for child in node.get('children',[]):walk(child,chain)
    walk(profile['head'],[])
    ordered=lambda d:[{'key':key,'sampledBytes':size} for key,size in sorted(d.items(),key=lambda row:-row[1])[:35]]
    return {'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'nodeCount':node_count,'sampleCount':len(profile.get('samples',[])),
            'sampledAllocationBytes':sum(files.values()),'files':ordered(files),
            'functionsSelf':ordered(functions),'functionsInclusive':ordered(inclusive),
            'largestStacks':sorted(stacks,key=lambda row:-row['sampledBytes'])[:25]}
if __name__=='__main__':
    paths=[Path(p) for p in sys.argv[2:]]
    assert paths and all(p.is_file() for p in paths)
    result={'schema':'storyforge.heap-allocation-diagnostic','version':1,
            'interpretation':'CDP sampled allocation totals including collected objects. Inclusive function totals overlap; do not sum them. Not retained heap, RSS, timing, or acceptance evidence.',
            'profiles':[summarize(p) for p in paths]}
    with Path(sys.argv[1]).open('x') as f:json.dump(result,f,ensure_ascii=False,indent=2);f.write('\n')
    for p in result['profiles']:
        print(json.dumps({'path':p['path'],'sampledAllocationBytes':p['sampledAllocationBytes'],'topFiles':p['files'][:8]},ensure_ascii=False))
