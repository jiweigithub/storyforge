from pathlib import Path
import hashlib,json,subprocess,os,shutil,datetime
source=Path('/Users/qinyingying/.codex/worktrees/nw2e-retrieval-repair/storyforge')
target=Path('/Users/qinyingying/.codex/worktrees/nw2e-verification-r13/storyforge')
base='16b006fd4994aba08801ca69ff2d489fe2b48ede'
def git(root,*args,env=None):return subprocess.check_output(['git',*args],cwd=root,env=env)
def changed(root):
 return sorted(set(p for p in (git(root,'diff','--name-only','-z','HEAD')+git(root,'ls-files','--others','--exclude-standard','-z')).decode().split('\0') if p))
assert git(source,'rev-parse','HEAD').decode().strip()==base
assert git(target,'rev-parse','HEAD').decode().strip()==base
assert not git(source,'diff','--cached','--name-only')
assert not changed(target),'New validation worktree is not clean'
paths=changed(source); hashes={p:hashlib.sha256((source/p).read_bytes()).hexdigest() for p in paths}
total=sum((source/p).stat().st_size for p in paths)
assert shutil.disk_usage(target).free>total+5*1024**3,'Insufficient disk for freeze and validation'
for p in paths:
 assert not Path(p).is_absolute() and '..' not in Path(p).parts
 dest=target/p;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source/p,dest)
 assert hashlib.sha256(dest.read_bytes()).hexdigest()==hashes[p],p
assert paths==changed(target)
assert all(hashlib.sha256((source/p).read_bytes()).hexdigest()==h for p,h in hashes.items())
index=Path('/tmp/nw2e-r13-freeze.index');assert not index.exists()
pathlist=Path('/tmp/nw2e-r13-freeze-paths');pathlist.open('xb').write(b'\0'.join(p.encode() for p in paths)+b'\0')
env=dict(os.environ,GIT_INDEX_FILE=str(index))
subprocess.run(['git','read-tree','HEAD'],cwd=target,env=env,check=True)
subprocess.run(['git','--literal-pathspecs','add','--pathspec-from-file='+str(pathlist),'--pathspec-file-nul'],cwd=target,env=env,check=True,stdout=subprocess.DEVNULL)
subprocess.run(['git','diff','--cached','--check'],cwd=target,env=env,check=True)
tree=git(target,'write-tree',env=env).decode().strip()
assert not git(target,'diff','--cached','--name-only')
assert not git(source,'diff','--cached','--name-only')
node_modules=target/'node_modules';assert not node_modules.exists()
node_modules.symlink_to((source/'node_modules').resolve(),target_is_directory=True)
manifest={'schema':'storyforge.frozen-validation-files','version':1,'generation':'r13','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'baseCommit':base,'tree':tree,'source':str(source),'root':str(target),'engineeringVersion':31,'productionVersion':31,'baselineVersion':41,'files':hashes,'fileCount':len(paths),'totalBytes':total}
p=Path('/tmp/nw2e-frozen-files-r13.json');p.open('x').write(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'files':len(paths),'bytes':total,'tree':tree,'manifestSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'realIndexEmpty':True}),flush=True)
