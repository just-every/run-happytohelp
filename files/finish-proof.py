from pathlib import Path
import sys,json,re,hashlib,datetime,subprocess
root=Path(__file__).resolve().parent
source=(root/'proof-20-durable.raw.tap').read_text()
safe=re.sub(r'(?im)^.*(?:cookie:|authorization:).*$','    [synthetic session header redacted]',source)
(root/'packet/proof-20.tap').write_text(safe)
passes=len(re.findall(r'^ok \d+ - a lead compares',safe,re.M))
failures=len(re.findall(r'^not ok ',safe,re.M))
rc=int(sys.argv[1])
head=subprocess.check_output(['git','-C',str(root/'repo'),'rev-parse','HEAD'],text=True).strip()
record={'head':head,'exit':rc,'passes':passes,'failures':failures,'required_consecutive_passes':20,'valid':rc==0 and passes==20 and failures==0 and bool(re.search(r'^# fail 0$',safe,re.M)),'finished_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cpu_rate':6,'network_latency_ms':250,'registered_journey':True,'includes_missing_provider_path':True,'tap_sha256':hashlib.sha256(safe.encode()).hexdigest(),'transport':'detached own session with cloud_run subreaper'}
new=root/'packet/proof-20-receipt.json.new';new.write_text(json.dumps(record,indent=2)+'\n');new.replace(root/'packet/proof-20-receipt.json')
