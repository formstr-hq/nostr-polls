"""Extracts SVG path data from @mui/icons-material so mockups use the app's real icon set."""
import os, re
ROOT = os.path.join(os.path.dirname(__file__), '../../../node_modules/@mui/icons-material/esm')
_cache = {}
def paths(name):
    if name not in _cache:
        src = open(os.path.join(ROOT, name + '.js')).read()
        _cache[name] = re.findall(r'd: "([^"]+)"', src)
    return _cache[name]
def ic(name, size=24, color='currentColor', cls=''):
    p = ''.join(f'<path d="{d}"/>' for d in paths(name))
    return f'<svg class="ic {cls}" width="{size}" height="{size}" viewBox="0 0 24 24" fill="{color}">{p}</svg>'
