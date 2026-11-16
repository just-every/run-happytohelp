import json, subprocess
from pathlib import Path
import yaml
root=Path('/workspace/run-happytohelp')
baseline=json.loads((Path.home()/'rer-consolidation/work/hh-rer-0219-adopt-1/packet/baseline.json').read_text())
old=yaml.safe_load(subprocess.check_output(['git','show',baseline['head']+':.github/workflows/verify.yml'],cwd=root))
new=yaml.safe_load((root/'.github/workflows/verify.yml').read_text())
oldjobs,newjobs=old.pop('jobs'),new.pop('jobs')
assert old==new,'Workflow triggers or global settings changed'
assert set(newjobs)==set(oldjobs)|{'contract-docs'}
expected_checks=['node src/site/base/contract-docs.mjs check','node scripts/contract-docs.mjs check']
removed=[]
for step in oldjobs['build']['steps'][:]:
 if step.get('run') in expected_checks:
  removed.append(step['run'])
  oldjobs['build']['steps'].remove(step)
assert removed==expected_checks
assert oldjobs['build']==newjobs['build'],'Build has unrelated changes'
for job in oldjobs:
 if job not in ('build','verify'):
  assert oldjobs[job]==newjobs[job],f'Unrelated job changed: {job}'
job=newjobs['contract-docs']
assert 'needs' not in job and 'if' not in job
assert [s['run'] for s in job['steps'] if s.get('run') in expected_checks]==expected_checks
assert any(s.get('run')=='pnpm install --frozen-lockfile' for s in job['steps'])
assert job['steps'][0]['with']['fetch-depth']==0
for name in ('build','checks','size-check','slow'):
 deps=newjobs[name].get('needs',[])
 assert 'contract-docs' not in ([deps] if isinstance(deps,str) else deps)
verify=newjobs['verify']
assert 'contract-docs' in verify['needs'] and verify['if']=='${{ always() }}'
step=next(s for s in verify['steps'] if s.get('name')=='Require the plan and every selected check')
assert step['env']['CONTRACT_DOCS']=='${{ needs.contract-docs.result }}'
assert 'test "$CONTRACT_DOCS" = success' in step['run']
for result in ('success','failure','skipped','cancelled'):
 run=subprocess.run(['bash','-c','test "$CONTRACT_DOCS" = success'],env={'CONTRACT_DOCS':result})
 assert (run.returncode==0)==(result=='success')
# Remove only the new gate and compare all remaining aggregate behavior.
verify['needs'].remove('contract-docs')
del step['env']['CONTRACT_DOCS']
step['run']=step['run'].replace('test "$CONTRACT_DOCS" = success\n          ','').replace('test "$CONTRACT_DOCS" = success\n','')
# YAML literal block parsing strips indentation uniformly.
assert verify==oldjobs['verify'],'Aggregate changed beyond the required contract job gate'
print('PASS: both generator commands and full-history inputs preserved; contract-docs is independent; build and all shard/proof jobs unchanged; aggregate rejects failure/skipped/cancelled.')
print('Graph proof: contract-docs failure has no dependency path to build or checks; a selected full-tier shard still runs when only the generated-view check fails. Existing light/reuse selection is retained; this is structural evidence, not a synthetic GitHub run with clause edits.')
