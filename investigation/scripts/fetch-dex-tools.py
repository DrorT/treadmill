import os
from pathlib import Path as InvestigationPath
os.chdir(InvestigationPath(__file__).resolve().parent.parent)
import json
import urllib.request
import zipfile
import sys
from pathlib import Path

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
target = Path('../tools/tool-deps')
target.mkdir(exist_ok=True)
for name in sys.argv[1:] or ['androguard', 'loguru', 'asn1crypto', 'colorama']:
    metadata = json.loads(opener.open(f'https://pypi.org/pypi/{name}/json', timeout=20).read())
    wheels = [f for f in metadata['urls'] if f['filename'].endswith('py3-none-any.whl') or f['filename'].endswith('py2.py3-none-any.whl') or ('win_amd64.whl' in f['filename'] and ('cp312-' in f['filename'] or '-abi3-' in f['filename'] and any(f'cp3{i}-' in f['filename'] for i in range(7,13))))]
    if not wheels:
        print(name, 'no pure Python wheel', flush=True)
        continue
    item = wheels[0]
    path = target / item['filename']
    path.write_bytes(opener.open(item['url'], timeout=30).read())
    with zipfile.ZipFile(path) as archive:
        archive.extractall(target)
    print(name, metadata['info']['version'], flush=True)
