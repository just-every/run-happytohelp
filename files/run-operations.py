"""Run the copied project's declared build operations and retain actual exit receipts.
This equivalent rehearsal runner is task evidence; the Mac hh-rehearsal-2 fixture was unavailable.
"""
import json,os,subprocess,sys,time
from pathlib import Path
repo=Path(sys.argv[1]).resolve()
packet=Path(sys.argv[2]).resolve()
operations=json.loads((repo/'rer-project.json').read_text())['operations']
results=[]
for operation in ['setup','build','verify','artifact']:
 command=operations[operation]
 start=time.monotonic()
 with (packet/f'managed-{operation}.log').open('w') as log:
  result=subprocess.run(['python3','/tmp/rer-reap.py','bash','-c',command],cwd=repo,env=os.environ,stdout=log,stderr=subprocess.STDOUT,timeout=900)
 row={'operation':operation,'command':command,'exit':result.returncode,'seconds':round(time.monotonic()-start,3)}
 results.append(row)
 (packet/'managed-operations.json').write_text(json.dumps(results,indent=2)+'\n')
 print(json.dumps(row),flush=True)
raise SystemExit(0 if len(results)==4 and all(row['exit']==0 for row in results) else 1)
