from pathlib import Path
import zipfile,hashlib,json
r=Path(__file__).resolve().parents[1];m=json.loads((r/'manifest.json').read_text());files=['manifest.json','index.js','workbench.html','LICENSE','README.md','examples/map.yaml','examples/map.pgm']
out=r/'dist';out.mkdir(exist_ok=True);p=out/f"mapcanvas-{m['version']}.zip"
with zipfile.ZipFile(p,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for n in sorted(files):
  i=zipfile.ZipInfo(n,(2026,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;i.external_attr=0o100644<<16;z.writestr(i,(r/n).read_bytes())
h=hashlib.sha256(p.read_bytes()).hexdigest();(out/'SHA256SUMS.txt').write_text(h+'  '+p.name+'\n');print(json.dumps({'file':str(p),'sha256':h,'bytes':p.stat().st_size}))
