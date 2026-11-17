from pathlib import Path
import json,re,datetime
root=Path(__file__).resolve().parent
raw=root/'proof-20-durable.raw.tap'
text=raw.read_text() if raw.exists() else ''
text=re.sub(r'(?im)^.*(?:cookie:|authorization:).*$','    [synthetic session header redacted]',text)
(root/'packet/proof-20.tap').write_text(text)
passes=len(re.findall(r'^ok \d+ - a lead compares',text,re.M))
failures=len(re.findall(r'^not ok ',text,re.M))
result={'passes':passes,'failures':failures,'required_consecutive_passes':20,'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(root/'packet/proof-progress.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
if failures:
 print(text[text.index('not ok '):][-4500:])
