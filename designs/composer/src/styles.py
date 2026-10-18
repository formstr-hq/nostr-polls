"""
Style-direction exploration: the same composer screens in three visual languages.

    python3 designs/composer/src/styles.py

Output: designs/composer/styles/*.png
"""
import os
import build as B

FONT = os.path.abspath(os.path.join(B.HERE, '../../../src/fonts/ShantellSans.ttf'))
OUT = os.path.join(B.OUT, 'styles')
os.makedirs(OUT, exist_ok=True)

STYLE_CSS = r"""
@font-face{font-family:"Shantell Sans";src:url("file://%FONT%") format("truetype");font-weight:300 800}
.screen{isolation:isolate}
.screen::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none}

/* =========================================================== GLASS */
.st-glass .screen{background:#f1ece3}
.st-glass .screen::before{background:
  radial-gradient(60% 40% at 12% 12%, rgba(218,165,32,.75), transparent 70%),
  radial-gradient(55% 36% at 100% 45%, rgba(214,110,30,.50), transparent 70%),
  radial-gradient(70% 40% at 25% 98%, rgba(255,176,96,.55), transparent 70%),
  radial-gradient(40% 30% at 85% 85%, rgba(250,209,63,.45), transparent 70%)}
.st-glass{--glass:rgba(255,255,255,.46);--glass2:rgba(255,255,255,.64);--gb:rgba(255,255,255,.75);--gh:rgba(255,255,255,.9);--gs:rgba(90,60,10,.12)}
.st-glass.dark{--glass:rgba(255,255,255,.07);--glass2:rgba(30,28,24,.72);--gb:rgba(255,255,255,.14);--gh:rgba(255,255,255,.14);--gs:rgba(0,0,0,.5)}
.st-glass.dark .screen{background:#000}
.st-glass.dark .screen::before{background:
  radial-gradient(55% 35% at 10% 8%, rgba(250,209,63,.32), transparent 70%),
  radial-gradient(45% 30% at 100% 42%, rgba(240,169,59,.24), transparent 70%),
  radial-gradient(70% 38% at 25% 100%, rgba(240,120,40,.22), transparent 70%)}
.st-glass :is(.seg,.tools,.card,.opt,.chip,.tcard,.mentionpop,.field,.choice,.tile,.addopt){
  background:var(--glass);backdrop-filter:blur(22px) saturate(170%);-webkit-backdrop-filter:blur(22px) saturate(170%);
  border:1px solid var(--gb);box-shadow:0 8px 28px var(--gs),inset 0 1px 0 var(--gh)}
.st-glass .chip.secc,.st-glass .chip.warn{background:var(--glass)}
.st-glass .chip.on,.st-glass .tile.on{background:var(--pri);color:var(--onpri)}
.st-glass .choice.on{background:var(--pri-tint2);border-color:var(--gb)}
.st-glass .opt.focus{border:1px solid var(--pri);box-shadow:0 0 0 4px var(--pri-tint),0 8px 28px var(--gs),inset 0 1px 0 var(--gh)}
.st-glass .opt.err{border-color:var(--err)}
.st-glass .sheet{background:var(--glass2);backdrop-filter:blur(30px) saturate(180%);border-top:1px solid var(--gb)}
.st-glass .scrim{background:rgba(40,25,0,.22)}
.st-glass.dark .scrim{background:rgba(0,0,0,.45)}
.st-glass .card .srow+.srow{border-top-color:var(--gb)}
.st-glass .kbd{background:rgba(255,255,255,.38);backdrop-filter:blur(24px)}
.st-glass.dark .kbd{background:rgba(255,255,255,.06)}
.st-glass .key{background:rgba(255,255,255,.75)}
.st-glass.dark .key{background:rgba(255,255,255,.12)}
.st-glass .tool.pv{background:rgba(29,27,22,.82);backdrop-filter:blur(10px)}
.st-glass.dark .tool.pv{background:rgba(255,255,255,.85)}
.st-glass .lic{background:rgba(255,255,255,.5)!important}
.st-glass.dark .lic{background:rgba(255,255,255,.08)!important}

/* =========================================================== NEUMORPHIC */
.st-neu{--nb:#ebe5da;--nd:#cbc2b1;--nl:#ffffff}
.st-neu.dark{--nb:#1e1d1b;--nd:#111010;--nl:#2c2a27}
.st-neu .screen{background:var(--nb)}
.st-neu :is(.seg,.tools,.card,.chip,.tcard,.mentionpop,.choice,.tile,.tool.pv){
  background:var(--nb);border:none;box-shadow:6px 6px 14px var(--nd),-6px -6px 14px var(--nl)}
.st-neu .chip{box-shadow:3px 3px 7px var(--nd),-3px -3px 7px var(--nl)}
.st-neu :is(.opt,.field,.addopt){background:var(--nb);border:none;box-shadow:inset 4px 4px 9px var(--nd),inset -4px -4px 9px var(--nl)}
.st-neu .opt.focus{box-shadow:inset 4px 4px 9px var(--nd),inset -4px -4px 9px var(--nl),0 0 0 2px var(--pri)}
.st-neu .opt.err{box-shadow:inset 4px 4px 9px var(--nd),inset -4px -4px 9px var(--nl),0 0 0 2px var(--err)}
.st-neu .seg div.on,.st-neu .tile.on,.st-neu .chip.on{background:var(--pri);box-shadow:inset 2px 2px 5px rgba(0,0,0,.18),inset -2px -2px 5px rgba(255,255,255,.35)}
.st-neu .choice.on{box-shadow:inset 5px 5px 11px var(--nd),inset -5px -5px 11px var(--nl);background:var(--nb)}
.st-neu .tool.pv{color:var(--text)}
.st-neu .btn.fill{box-shadow:5px 5px 12px var(--nd),-5px -5px 12px var(--nl)}
.st-neu .btn.fill.dis{background:var(--nb);color:var(--text3)}
.st-neu .btn.out{border:none;box-shadow:5px 5px 12px var(--nd),-5px -5px 12px var(--nl)}
.st-neu .sheet{background:var(--nb);box-shadow:0 -12px 30px rgba(0,0,0,.18)}
.st-neu .card .srow+.srow{border-top:1px solid rgba(0,0,0,.05)}
.st-neu .lic{background:var(--nb)!important;box-shadow:inset 2px 2px 5px var(--nd),inset -2px -2px 5px var(--nl)}
.st-neu .kbd{background:var(--nb)}
.st-neu .key{background:var(--nb);box-shadow:3px 3px 6px var(--nd),-3px -3px 6px var(--nl)}
.st-neu .key.ent{background:var(--pri)}
.st-neu .thumb{box-shadow:5px 5px 12px var(--nd),-5px -5px 12px var(--nl)}

/* =========================================================== SUNLIT CANDY (ours) */
.st-candy{--lip:rgba(150,90,10,.16);--glow:rgba(218,165,32,.30);--surf:rgba(255,255,255,.88);--hl:rgba(255,255,255,1)}
.st-candy.dark{--lip:rgba(0,0,0,.9);--glow:rgba(250,209,63,.16);--surf:rgba(26,23,18,.88);--hl:rgba(255,255,255,.10)}
.st-candy .screen{background:linear-gradient(180deg,#fff3d6 0%,#f8efe2 38%,#f5f1ea 100%)}
.st-candy .screen::before{background:
  radial-gradient(42% 26% at 92% 4%, rgba(250,209,63,.75), transparent 70%),
  radial-gradient(60% 30% at 0% 100%, rgba(245,150,70,.22), transparent 70%)}
.st-candy.dark .screen{background:#000}
.st-candy.dark .screen::before{background:
  radial-gradient(48% 26% at 92% 2%, rgba(250,209,63,.30), transparent 70%),
  radial-gradient(60% 30% at 0% 100%, rgba(240,140,50,.14), transparent 70%)}
.st-candy :is(.q,.sheet h2,.who b,.tcard b,.post .tx){font-family:"Shantell Sans",sans-serif}
.st-candy .q{font-size:22px;font-weight:700}
.st-candy .sheet h2{font-size:23px}
.st-candy :is(.seg,.tools,.card,.tcard,.mentionpop,.field,.choice){
  background:var(--surf);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.7);
  box-shadow:0 2px 0 var(--lip),0 14px 30px -12px var(--glow),inset 0 1px 0 var(--hl)}
.st-candy.dark :is(.seg,.tools,.card,.tcard,.mentionpop,.field,.choice){border-color:rgba(255,255,255,.08)}
.st-candy :is(.opt,.addopt,.chip,.tile){background:var(--surf);border:1.5px solid rgba(150,100,20,.14);box-shadow:0 3px 0 var(--lip),inset 0 1px 0 var(--hl)}
.st-candy.dark :is(.opt,.addopt,.chip,.tile){border-color:rgba(255,255,255,.10)}
.st-candy .addopt{border-style:dashed}
.st-candy .opt.focus{border:2px solid var(--pri);box-shadow:0 3px 0 #b88a12,0 0 0 5px var(--pri-tint)}
.st-candy .opt.err{border-color:var(--err);box-shadow:0 3px 0 rgba(198,40,40,.35)}
.st-candy :is(.btn.fill,.seg div.on,.chip.on,.tile.on,.key.ent,.tool.pv.on){
  background:linear-gradient(180deg,#ffd862 0%,#e7ad1f 100%);color:#2a1d00;border-color:transparent;
  box-shadow:0 3px 0 #a87a0f,0 10px 18px -8px rgba(218,165,32,.8),inset 0 1px 0 rgba(255,255,255,.65)}
.st-candy.dark :is(.btn.fill,.seg div.on,.chip.on,.tile.on,.key.ent,.tool.pv.on){
  background:linear-gradient(180deg,#ffe58a 0%,#f5c632 100%);box-shadow:0 3px 0 #9c7a12,0 10px 22px -8px rgba(250,209,63,.55),inset 0 1px 0 rgba(255,255,255,.6)}
.st-candy .btn.fill.dis{background:rgba(0,0,0,.06);color:var(--text3);box-shadow:none}
.st-candy.dark .btn.fill.dis{background:rgba(255,255,255,.08)}
.st-candy .btn.out{background:var(--surf);border:1.5px solid rgba(150,100,20,.14);box-shadow:0 3px 0 var(--lip)}
.st-candy .btn.tonal{box-shadow:0 3px 0 var(--lip)}
.st-candy .choice.on{border:2px solid var(--pri);background:linear-gradient(180deg,rgba(255,236,170,.9),rgba(255,248,225,.9))}
.st-candy.dark .choice.on{background:linear-gradient(180deg,rgba(250,209,63,.20),rgba(250,209,63,.08))}
.st-candy .tool{width:42px;height:42px}
.st-candy .tools .tool:nth-child(1){color:#c2410c}.st-candy .tools .tool:nth-child(2){color:#d97706}
.st-candy .tools .tool:nth-child(3){color:#b45309}.st-candy .tools .tool:nth-child(4){color:#a16207}
.st-candy .tool.pv{background:#2a1d00;color:#ffd862;box-shadow:0 3px 0 #000,0 12px 22px -8px rgba(0,0,0,.5)}
.st-candy.dark .tool.pv{background:#fff3d6;color:#2a1d00;box-shadow:0 3px 0 #9c8a66}
.st-candy .sheet{background:linear-gradient(180deg,#fffaf0,#fff5e3);border-radius:34px 34px 0 0}
.st-candy.dark .sheet{background:linear-gradient(180deg,#1d1912,#120f0a)}
.st-candy .scrim{background:rgba(60,35,0,.28)}
.st-candy .lic{background:linear-gradient(180deg,#fff0c2,#ffe08a)!important;color:#7a5200;box-shadow:inset 0 1px 0 #fff}
.st-candy.dark .lic{background:rgba(250,209,63,.14)!important;color:var(--pri);box-shadow:none}
.st-candy .kbd{background:rgba(236,226,208,.85)}
.st-candy.dark .kbd{background:#141210}
.st-candy .key{box-shadow:0 2px 0 rgba(120,80,20,.22)}
.st-candy .mention{background:linear-gradient(180deg,#ffe9b0,#ffd97a);color:#7a3d00;box-shadow:0 2px 0 rgba(168,122,15,.35)}
.st-candy.dark .mention{background:rgba(250,209,63,.18);color:var(--pri);box-shadow:none}
.st-candy .thumb{box-shadow:0 3px 0 var(--lip),0 14px 26px -12px rgba(120,70,0,.5)}
.st-candy .av{box-shadow:0 0 0 3px #fff,0 3px 0 3px var(--lip)}
.st-candy.dark .av{box-shadow:0 0 0 3px #1a1712}
.st-candy .badge{box-shadow:0 0 0 2px #fff3d6}
"""

STYLES = [
    ('glass', 'Glass', 'Frosted panels floating over a soft glow made from the preset colors.',
     ['Feels modern and airy. Works on OLED black (the glow carries the color).',
      'Common on iOS and in crypto apps, so it differentiates less than it looks.',
      'backdrop-filter costs GPU on low-end Android WebViews. Needs a solid fallback.']),
    ('neu', 'Neumorphic', 'Surfaces pushed out of / pressed into one warm clay color.',
     ['Very tactile and calm.',
      'Low contrast: inputs and buttons are hard to tell apart, and it fails accessibility in places.',
      'Can\'t do OLED black (needs a mid-tone background for the shadows), so dark mode becomes grey.']),
    ('candy', 'Sunlit Candy — our own', 'Warm sunlight from the preset color, glossy pressable buttons with a little bottom lip (like real ballot buttons), and our Shantell Sans for questions and headings.',
     ['Distinctly Pollerama: playful, warm and hand-made. Nothing else on Nostr looks like this.',
      'High contrast, cheap to render (gradients and box-shadows, minimal blur).',
      'Keeps OLED black in dark mode. The glow and lips come from the preset, so all 8 themes get their own mood.']),
]

def phone(inner, style, dark=False):
    d = B.device(inner, dark)
    return d.replace('<div class="device', f'<div class="device st-{style}', 1)

def strip(h):
    import re
    return re.sub(r' data-(pin|side|dx|dy)="[^"]*"', '', h)

SCREENS = [
    ('Note · light', lambda: B.n_filled(pins=False), False),
    ('Poll + sheet · light', lambda: strip(B.p_type()), False),
    ('Note · dark', lambda: B.n_filled(pins=False), True),
    ('Poll + sheet · dark', lambda: strip(B.p_type()), True),
]

def css():
    return B.CSS + STYLE_CSS.replace('%FONT%', FONT)

def page(body):
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{css()}</style></head><body>{body}</body></html>'

SC = .74
def cell(inner, style, dark):
    w, h = int(414*SC), int(868*SC)
    return f'<div style="width:{w}px;height:{h}px"><div style="transform:scale({SC});transform-origin:top left;width:414px">{phone(inner, style, dark)}</div></div>'

def row(style, title, lede, notes, label_cols=True):
    cells = ''.join(f'<div style="display:flex;flex-direction:column;gap:12px;align-items:center">{cell(fn(), style, d)}<b style="font-size:14px;color:#4d493f">{t}</b></div>' for t, fn, d in SCREENS)
    li = ''.join(f'<li style="margin-bottom:8px">{n}</li>' for n in notes)
    return f'''<div style="display:flex;gap:40px;align-items:flex-start">
      <div style="width:330px;flex:none;padding-top:10px"><div class="legend"><div class="kicker">Direction</div><h1 style="font-size:28px">{title}</h1>
      <p class="lede" style="margin-bottom:14px">{lede}</p><ul style="padding-left:18px;font-size:14px;line-height:1.5;color:#55514a">{li}</ul></div></div>
      <div style="display:flex;gap:22px">{cells}</div></div>'''

def board_all():
    rows = ''.join(row(*s) for s in STYLES)
    body = f'''<div style="padding:50px 56px;width:1800px;display:flex;flex-direction:column;gap:56px">
      <div class="legend"><div class="kicker">Pollerama · composer</div><h1>Three style directions</h1>
      <p class="lede" style="max-width:1100px">Same layout and features, three visual languages, each in light and dark. Golden preset. We start with the composer, and the winner then rolls out screen by screen.</p></div>{rows}</div>'''
    B.render_to(os.path.join(OUT, '00-style-directions.png'), page(body), 1800, 2430)

def hero(style, title):
    cells = ''.join(cell(fn(), style, d) for t, fn, d in SCREENS)
    body = f'<div style="padding:44px 50px;width:1420px"><div class="legend" style="margin-bottom:24px"><div class="kicker">Style direction</div><h1>{title}</h1></div><div style="display:flex;gap:26px">{cells}</div></div>'
    B.render_to(os.path.join(OUT, f'{style}.png'), page(body), 1420, 860)

if __name__ == '__main__':
    board_all()
    for s, t, *_ in STYLES:
        hero(s, t)
