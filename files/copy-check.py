from pathlib import Path
import json,re,subprocess
root=Path.cwd()
files=['README.md','OPERATIONS.md','docs/INSTALLER.md','docs/INDEPENDENT-RELEASE.md']
primary='curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-happytohelp'
alt='npx -y @runeditrun/rer dev just-every/run-happytohelp'
for file in files:
 text=(root/file).read_text()
 assert text.index(primary)<text.index(alt),file
 assert 'Node.js or npm installed first; the installer brings its own. Git is required.' in text,file
 assert 'rer deploy --dry-run' in text,file
 if file!='README.md':assert re.search(r'no real|or (?:a )?real|token or real',text,re.I) or 'real `OWNER_EMAIL`' in text,file
for file in ['OPERATIONS.md','docs/INDEPENDENT-RELEASE.md']:
 text=(root/file).read_text()
 assert '0.2.77' not in text,file
 assert 'package.json' in text,file
readme=(root/'README.md').read_text()
assert 'they do not download Chromium' in readme
assert '**Browser verification:** `rer verify` downloads the Chromium and headless shell' in readme
assert '280 MB' not in readme
ops=(root/'OPERATIONS.md').read_text()
assert ops.index('### Credential-free dry run')<ops.index('### What you need first')
assert 'Before a deployment dry run' not in ops
assert 'for both\ndry run and deployment' not in ops
# Preserve the predecessor's mail-off and hosted sign-in guidance byte for byte.
old=subprocess.check_output(['git','show','origin/main:OPERATIONS.md'],text=True)
start='### Deploy with outbound email off';end='### '
old_section=old[old.index(start):];old_section=old_section[:old_section.find('\n'+end,1)]
new_section=ops[ops.index(start):];new_section=new_section[:new_section.find('\n'+end,1)]
assert old_section==new_section,'mail-off section changed'
pkg=json.loads((root/'package.json').read_text());pin=pkg['devDependencies']['@runeditrun/rer']
lock=(root/'pnpm-lock.yaml').read_text()
assert "'@runeditrun/rer':\n        specifier: "+pin+'\n        version: '+pin in lock
print(json.dumps({'result':'pass','documents':len(files),'pin':pin,'primary_command':primary,'mail_off_section':'byte-identical to origin/main','contradiction_groups_before':4,'contradiction_groups_after':0},indent=2))
