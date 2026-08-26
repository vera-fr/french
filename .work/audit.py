import re, pathlib, posixpath
root = pathlib.Path('dist')
pages = set(root.glob('**/index.html'))
ext = {}
bad = []
checked = 0
for p in pages:
    base_dir = str(p.parent)
    s = open(p, encoding='utf-8').read()
    for h in re.findall(r'href="([^"]+)"', s):
        if h.startswith(('#', 'mailto:', 'javascript:')):
            continue
        if h.startswith(('http://', 'https://')):
            host = h.split('/')[2]
            ext[host] = ext.get(host, 0) + 1
            continue
        if not h.startswith('/'):
            h = '/' + posixpath.normpath(posixpath.join(base_dir.replace('/dist', ''), h))
        path = posixpath.normpath(h.split('#')[0].split('?')[0])
        d = root.joinpath(*[x for x in path.split('/') if x])
        if d.is_dir():
            if not (d / 'index.html').exists():
                bad.append((str(p), '-> ' + h))
        elif d.is_file():
            pass
        else:
            bad.append((str(p), '-> ' + h))
        checked += 1
print('internal links checked:', checked)
print('broken:', len(bad))
for b in bad[:20]:
    print('  ', b[0], '->', b[1])
print('external hosts:', ext)
