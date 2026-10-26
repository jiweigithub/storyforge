from pathlib import Path
import argparse,collections,hashlib,json
from urllib.parse import urlsplit
p=argparse.ArgumentParser();p.add_argument('profile');p.add_argument('--output',required=True);p.add_argument('--generation',required=True);args=p.parse_args()
source=Path(args.profile);raw=source.read_bytes();profile=json.loads(raw);nodes={row['id']:row for row in profile['nodes']};parents={}
assert len(nodes)==len(profile['nodes'])
for row in nodes.values():
 for child in row.get('children',[]):
  assert child in nodes and child not in parents
  parents[child]=row['id']
samples=profile['samples'];deltas=profile['timeDeltas'];assert samples and len(samples)==len(deltas)
self_time=collections.Counter();inclusive=collections.Counter();groups=collections.Counter();frames={};paths={}
for node_id,row in nodes.items():
 frame=row['callFrame'];url=frame.get('url','');path=urlsplit(url).path if '://' in url else url
 if '/storyforge/' in path:path=path.split('/storyforge/',1)[1]
 key=(path,frame.get('functionName',''),frame.get('lineNumber',-1)+1,frame.get('columnNumber',-1)+1)
 frames[node_id]=key
 trail=[];seen=set();current=node_id
 while current in nodes:
  assert current not in seen;seen.add(current);trail.append(current)
  if current not in parents:break
  current=parents[current]
 paths[node_id]=trail
for node_id,elapsed in zip(samples,deltas):
 assert node_id in nodes and isinstance(elapsed,(int,float)) and elapsed>=0
 key=frames[node_id];self_time[key]+=elapsed
 # A recursive function can occur more than once in one sampled stack. Count
 # its inclusive interval once, so per-function shares cannot exceed 100%.
 for ancestor in set(frames[n] for n in paths[node_id]):inclusive[ancestor]+=elapsed
 path,name,*_=key
 if name=='(garbage collector)':group='garbage-collection'
 elif name in ['(idle)','(program)','(root)']:group='runtime-'+name[1:-1]
 elif 'noble_hashes' in path or '/hashes/' in path:group='sha256-library'
 elif path.endswith('narrative-domain/json.ts'):group='strict-json-and-hash-sinks'
 elif path.endswith('narrative-index.ts'):group='index-construction'
 elif any(part in path for part in ['narrative-ir','narrative-identity','narrative-domain/integrity']):group='ir-identity-and-validation'
 elif 'narrative-domain-projection' in path:group='domain-projection'
 elif path.startswith('src/'):group='other-application'
 else:group='other-runtime-or-library'
 groups[group]+=elapsed
total=sum(deltas);duration=profile['endTime']-profile['startTime'];assert total>0
rows=lambda values:[{'source':key[0],'function':key[1],'generatedLine':key[2],'generatedColumn':key[3],'sampledMs':round(value/1000,3),'sharePercent':round(value/total*100,3)} for key,value in values.most_common(30)]
result={'schema':'storyforge.cpu-profile-hotspot-diagnostic','version':1,'sourceGeneration':args.generation,'profile':str(source),'profileSha256':hashlib.sha256(raw).hexdigest(),'samplingBoundary':'CDP sampled elapsed intervals, not exact per-function CPU timing. Inclusive stacks overlap and generated line numbers are not original TypeScript line numbers. Instrumented diagnostics do not establish uninstrumented acceptance.','sampleCount':len(samples),'nodeCount':len(nodes),'sampledMs':round(total/1000,3),'profileWallMs':round(duration/1000,3),'unattributedBoundaryMs':round((duration-total)/1000,3),'selfCategories':[{'category':k,'sampledMs':round(v/1000,3),'sharePercent':round(v/total*100,3)} for k,v in groups.most_common()],'topSelf':rows(self_time),'topInclusive':rows(inclusive),'accepted':False}
Path(args.output).open('x').write(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'generation':args.generation,'sampleCount':len(samples),'nodeCount':len(nodes),'sampledMs':result['sampledMs'],'topSelf':result['topSelf'][:5]},ensure_ascii=False))
