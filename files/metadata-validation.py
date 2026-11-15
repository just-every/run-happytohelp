import datetime, hashlib,json,re,subprocess
from pathlib import Path
root=Path.cwd()
packet=Path.home()/'rer-consolidation/work/sd-hh-combined-next-release/packet'
def git(*a):return subprocess.check_output(['git',*a],text=True).strip()
latest=next(r for r in json.loads((packet/'version-probe.json').read_text()) if not r['draft'] and not r['prerelease'])
tag=latest['tag_name']; baseline=git('rev-parse',tag+'^{commit}')
r=json.loads(Path('RELEASE.json').read_text());pkg=json.loads(Path('package.json').read_text());seed=json.loads(Path('seed.json').read_text())
assert r['version']==pkg['version']==seed['version']
assert 'v'+r['previousVersion']==tag
refs=git('ls-remote','--tags','origin').splitlines()
assert not any(line.split('\t')[1] in ['refs/tags/v'+r['version'],'refs/tags/v'+r['version']+'^{}'] for line in refs)
prior=tuple(map(int,r['previousVersion'].split('.'))); version=tuple(map(int,r['version'].split('.')))
assert version==(*prior[:2],prior[2]+1)
old=json.loads(git('show',tag+':package.json')); old.pop('version');other=dict(pkg);other.pop('version');assert old==other,'Dependencies or scripts changed'
for name in ['d44ec03a','6c972773','1e2aaf87','2a852373']:
 subprocess.run(['git','merge-base','--is-ancestor',name,'origin/main'],check=True)
def inventory(rev):
 rows={}
 for line in git('ls-tree','-r',rev).splitlines():
  meta,path=line.split('\t',1)
  if re.fullmatch(r'(?:migrations|src/modules/[^/]+/migrations)/\d+_[^/]+\.sql',path):
   rows[path]=meta.split()[2]
 return rows
before=inventory(tag); after=inventory('HEAD');assert before==after,'Migration names or bytes changed'
assert not r['migrations'] and not r['pendingMigrations']
section=Path('CHANGELOG.md').read_text().split('## '+r['version']+' — '+r['date']+'\n\n',1)[1].split('\n## ',1)[0].strip()
assert section==r['publicReleaseNotes'].strip(),'Release notes differ from matching CHANGELOG section'
old_changelog=git('show',tag+':CHANGELOG.md')
new=Path('CHANGELOG.md').read_text();assert new[new.index('## '+r['previousVersion']):].strip()==old_changelog[old_changelog.index('## '+r['previousVersion']):].strip(),'Historical changelog rewritten'
allowed={'package.json','package-lock.json','pnpm-lock.yaml','CHANGELOG.md','RELEASE.json','RELEASE.md','seed.json','sources.lock.json'}
changed=set(filter(None,git('diff','--name-only','origin/main').splitlines()));assert changed<=allowed,changed-allowed
for name in ['CONTRACT.md','ACCEPTANCE.md','docs/CLAIMS.md']:
 assert not git('diff','origin/main','--',name)
text=Path('CONTRACT.md').read_text()
parsed=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {parseContract} from './src/site/base/seed-contract.mjs';import fs from 'node:fs';console.log(JSON.stringify(parseContract(fs.readFileSync('CONTRACT.md','utf8'))))"],text=True))
status_counts={status:sum(c['status']==status for c in parsed['clauses']) for status in ['done','partial','missing']}
receipt=dict(timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),check='release-metadata-and-migration-integrity',status='PASS',baseline_tag=tag,baseline_commit=baseline,qualified_main=git('rev-parse','origin/main'),version_before=r['previousVersion'],version_after=r['version'],rer_before=old['devDependencies']['@runeditrun/rer'],rer_after=pkg['devDependencies']['@runeditrun/rer'],migration_count_before=len(before),migration_count_after=len(after),migration_added=[],migration_removed=[],migration_modified=[],highest_migration=max(Path(n).name for n in after),missing_326=not any(Path(n).name.startswith('326_') for n in after),migration_inventory=after,files_changed=sorted(changed),clause_status_changes=[],contract_status_counts=status_counts,clause_count=len(parsed['clauses']),notes_match_changelog=True,historical_changelog_retained=True,dependencies_unchanged=True,required_commits_are_ancestors=True)
(packet/'metadata-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({k:v for k,v in receipt.items() if k!='migration_inventory'},indent=2))
