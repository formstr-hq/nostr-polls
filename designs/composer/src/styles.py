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


/* =========================================================== BALLOT */
.st-ballot{--sl:#ffffff;--inkb:#141414;--oninkb:#ffffff;--perf:rgba(0,0,0,.18)}
.st-ballot.dark{--sl:#121212;--inkb:#f2f2f2;--oninkb:#111111;--perf:rgba(255,255,255,.2)}
.st-ballot .screen{background:#f3f3f1}
.st-ballot.dark .screen{background:#000}
.st-ballot :is(.label,.draft,.helper,.srow .val,.chip.sm,.hint){font-family:"DejaVu Sans Mono",monospace;letter-spacing:-.02em}
.st-ballot .label{font-size:11px;letter-spacing:.04em}
.st-ballot .q{font-size:26px;font-weight:800;letter-spacing:-.03em;line-height:1.2}
.st-ballot .text{font-size:18px;letter-spacing:-.01em}
.st-ballot .sheet h2{font-size:24px;letter-spacing:-.025em}
.st-ballot .av{border-radius:12px}
.st-ballot .mention{background:none;color:var(--text);padding:0;border-radius:0;box-shadow:inset 0 -2.5px 0 var(--pri)}
.st-ballot .hash{color:var(--sec);font-weight:700}
.st-ballot .caret{background:var(--pri)}
/* top bar */
.st-ballot .seg{border-radius:14px;padding:3px;background:var(--sl);border:1px solid var(--div);box-shadow:none}
.st-ballot .seg div{border-radius:11px}
.st-ballot .seg div.on{background:var(--inkb);color:var(--oninkb)}
.st-ballot .btn{border-radius:14px}
.st-ballot .btn.fill{background:var(--pri);color:#1b1300}
.st-ballot .btn.fill.dis{background:transparent;border:1.5px dashed var(--perf);color:var(--text3)}
.st-ballot .btn.out{border-radius:14px}
.st-ballot .badge{border-radius:6px}
/* option slips: numbered stub, perforation, notches */
.st-ballot .opts{counter-reset:o;gap:10px}
.st-ballot .opt{position:relative;border-radius:14px;border:none;background:var(--sl);padding-left:58px;height:56px;
  -webkit-mask:radial-gradient(circle 7px at 46px 0,#0000 97%,#000) top/100% 51% no-repeat,radial-gradient(circle 7px at 46px 100%,#0000 97%,#000) bottom/100% 51% no-repeat;
          mask:radial-gradient(circle 7px at 46px 0,#0000 97%,#000) top/100% 51% no-repeat,radial-gradient(circle 7px at 46px 100%,#0000 97%,#000) bottom/100% 51% no-repeat}
.st-ballot .opt .grip{display:none}
.st-ballot .opt{counter-increment:o}
.st-ballot .opt::before{content:counter(o,decimal-leading-zero);position:absolute;left:0;top:0;bottom:0;width:46px;display:flex;align-items:center;justify-content:center;
  font:700 13px "DejaVu Sans Mono",monospace;color:var(--text2)}
.st-ballot .opt::after{content:"";position:absolute;left:45px;top:9px;bottom:9px;border-left:2px dashed var(--perf)}
.st-ballot .opt.focus{box-shadow:inset 0 0 0 2px var(--pri)}
.st-ballot .opt.focus::before{background:var(--pri);color:#1b1300}
.st-ballot .opt.err{box-shadow:inset 0 0 0 2px var(--err)}
.st-ballot .opt.err::before{background:var(--err);color:#fff}
.st-ballot .helper{padding-left:58px}
.st-ballot .addopt{border-radius:14px;border:1.5px dashed var(--perf);color:var(--text)}
.st-ballot .addopt .ic{color:var(--pri)}
/* settings ticket */
.st-ballot .card{border:none;border-radius:16px;background:var(--sl);box-shadow:none;
  -webkit-mask:radial-gradient(circle 8px at 0 64px,#0000 97%,#000) left/51% 100% no-repeat,radial-gradient(circle 8px at 100% 64px,#0000 97%,#000) right/51% 100% no-repeat;
          mask:radial-gradient(circle 8px at 0 64px,#0000 97%,#000) left/51% 100% no-repeat,radial-gradient(circle 8px at 100% 64px,#0000 97%,#000) right/51% 100% no-repeat}
.st-ballot .card .srow+.srow{border-top:2px dashed var(--perf);margin:0 14px;padding:0 2px}
.st-ballot .lic{border-radius:10px;background:transparent!important;border:1.5px solid var(--div2)}
/* chips / thumbs / templates */
.st-ballot .chip{border-radius:9px;border:1px solid var(--div2);background:var(--sl)}
.st-ballot .chip.secc{background:transparent;border:1.5px dashed var(--perf);color:var(--sec)}
.st-ballot .chip.warn{border-radius:9px}
.st-ballot .thumb{border-radius:12px}
.st-ballot .tcard{border-radius:14px;box-shadow:none}
/* dock = a ticket */
.st-ballot .tools{border-radius:18px;background:var(--inkb);border:none;box-shadow:0 14px 30px -14px rgba(0,0,0,.5);padding:4px 10px;
  -webkit-mask:radial-gradient(circle 6px at 0 50%,#0000 97%,#000) left/51% 100% no-repeat,radial-gradient(circle 6px at 100% 50%,#0000 97%,#000) right/51% 100% no-repeat;
          mask:radial-gradient(circle 6px at 0 50%,#0000 97%,#000) left/51% 100% no-repeat,radial-gradient(circle 6px at 100% 50%,#0000 97%,#000) right/51% 100% no-repeat}
.st-ballot .tool{color:var(--oninkb);border-radius:12px}
.st-ballot .tool.on-warn{background:var(--pri);color:#1b1300}
.st-ballot .tool.pv{border-radius:16px;background:var(--pri);color:#1b1300;box-shadow:none}
/* sheet tears off along a perforation */
.st-ballot .sheet{background:var(--sl);border-radius:22px 22px 0 0}
.st-ballot .handle{width:auto;height:0;border-radius:0;background:none;border-top:2px dashed var(--perf);margin:8px -20px 18px}
.st-ballot .choice{border-radius:14px;border:1.5px solid var(--div);position:relative}
.st-ballot .choice::after{content:"";position:absolute;left:69px;top:10px;bottom:10px;border-left:2px dashed var(--perf)}
.st-ballot .choice .tt{padding-left:14px}
.st-ballot .choice .lic{border:none;background:transparent!important}
.st-ballot .choice.on{border:2px solid var(--pri);background:var(--sl)}
.st-ballot .choice.on .lic{background:var(--pri)!important;color:#1b1300;border-radius:10px}
.st-ballot .radio{border-radius:6px}
.st-ballot .choice.on .radio{border:7px solid var(--pri)}
.st-ballot .tile{border-radius:12px}
.st-ballot .tile.on{background:var(--inkb);color:var(--oninkb);border-color:var(--inkb)}
.st-ballot .field{border-radius:12px}
.st-ballot .kbd{background:#e6e6e3}.st-ballot.dark .kbd{background:#0f0f0f}
.st-ballot.dark .key{background:#262626}
.st-ballot .key{border-radius:6px}
.st-ballot .key.ent{background:var(--inkb);color:var(--oninkb)}
.st-ballot .scrim{background:rgba(0,0,0,.4)}

/* =========================================================== AURA */
.st-aura{--as:#ffffff;--a1:rgba(218,165,32,.55);--a2:rgba(180,83,9,.45)}
.st-aura.dark{--as:#0a0a0a;--a1:rgba(250,209,63,.55);--a2:rgba(240,169,59,.40)}
.st-aura .screen{background:#fbfbfa}
.st-aura.dark .screen{background:#000}
.st-aura .screen::before{background:radial-gradient(90% 26% at 50% -4%, var(--pri-tint2), transparent 70%)}
.st-aura :is(.seg,.tools,.card,.opt,.chip,.tcard,.mentionpop,.field,.choice,.tile,.addopt){
  border:1.5px solid transparent;box-shadow:none;
  background:linear-gradient(var(--as),var(--as)) padding-box,linear-gradient(135deg,var(--a1),var(--a2)) border-box}
.st-aura :is(.seg,.tools,.card,.mentionpop){background:linear-gradient(var(--as),var(--as)) padding-box,linear-gradient(135deg,var(--pri),var(--sec)) border-box}
.st-aura .opt.focus{border-width:2px;background:linear-gradient(var(--as),var(--as)) padding-box,linear-gradient(135deg,var(--pri),var(--sec)) border-box;box-shadow:0 0 0 6px var(--pri-tint),0 12px 30px -12px var(--pri)}
.st-aura .opt.err{background:linear-gradient(var(--as),var(--as)) padding-box,linear-gradient(var(--err),var(--err)) border-box}
.st-aura .choice.on{border-width:2px;background:linear-gradient(var(--pri-tint),var(--pri-tint)) padding-box,linear-gradient(var(--as),var(--as)) padding-box,linear-gradient(135deg,var(--pri),var(--sec)) border-box;box-shadow:0 12px 30px -14px var(--pri)}
.st-aura :is(.btn.fill,.seg div.on,.chip.on,.tile.on,.key.ent,.tool.pv){background:linear-gradient(135deg,var(--pri),var(--sec));color:#fff;box-shadow:0 8px 22px -8px var(--sec)}
.st-aura.dark :is(.btn.fill,.seg div.on,.chip.on,.tile.on,.key.ent,.tool.pv){color:#1b1300}
.st-aura .choice.on .lic{background:linear-gradient(135deg,var(--pri),var(--sec))!important;color:#fff}
.st-aura .btn.fill.dis{background:rgba(0,0,0,.05);color:var(--text3);box-shadow:none}
.st-aura.dark .btn.fill.dis{background:rgba(255,255,255,.07)}
.st-aura .q{font-size:25px;font-weight:800;letter-spacing:-.025em;line-height:1.25}
.st-aura .text{font-size:18.5px;letter-spacing:-.01em}
.st-aura .sheet h2{font-size:24px;letter-spacing:-.02em}
.st-aura .mention{background:none;color:var(--text);border-radius:0;padding:0;box-shadow:inset 0 -3px 0 var(--pri)}
.st-aura .hash{background:linear-gradient(135deg,var(--pri),var(--sec));-webkit-background-clip:text;color:transparent}
.st-aura .lic{background:linear-gradient(135deg,var(--pri-tint2),var(--sec-tint))!important}
.st-aura .sheet{background:var(--as);box-shadow:0 -24px 60px -20px var(--pri)}
.st-aura .card .srow+.srow{border-top-color:var(--div)}
.st-aura .kbd{background:#f0f0ee}.st-aura.dark .kbd{background:#0f0f0f}
.st-aura.dark .key{background:#262626}
.st-aura .thumb{border-radius:20px}
.st-aura .tool .ic{color:var(--sec)}

/* =========================================================== COLOR BLOCK */
/* --blk: block color, --onblk: text on it, --acc: bright accent for black surfaces, --sel: selection color */
.st-block{--blk:var(--pri);--onblk:#1b1300;--acc:#FAD13F;--sel:var(--blk);--onsel:var(--onblk);--slab:#ffffff;--onsec:#fff;--t1:var(--acc);--t2:var(--acc);--t3:var(--acc)}
.st-block.dark{--slab:#161616;--onsec:#1b1300}
.st-block .screen{background:#f4f4f2}
.st-block.dark .screen{background:#000}
.st-block .status,.st-block .appbar{background:var(--blk);color:var(--onblk)}
.st-block .appbar .iconbtn{color:var(--onblk)}
.st-block .scroll{padding-top:0}
.st-block .scroll>.editor:first-child{background:var(--blk);margin:0 -16px;padding:4px 18px 26px;border-radius:0 0 36px 36px;color:var(--onblk)}
.st-block .scroll>.editor:first-child :is(.who,.text,.q,.who b){color:var(--onblk)}
.st-block .scroll>.editor:first-child .draft{color:var(--onblk);opacity:.7}
.st-block .scroll>.editor:first-child .ph{color:var(--onblk);opacity:.5}
.st-block .scroll>.editor:first-child .caret{background:var(--onblk)}
.st-block .scroll>.editor:first-child .hash{color:var(--onblk);font-weight:800;text-decoration:underline;text-decoration-thickness:2.5px;text-underline-offset:3px}
.st-block .scroll>.editor:first-child .mention{background:var(--onblk);color:var(--blk)}
.st-block .scroll>.editor:first-child .av{box-shadow:0 0 0 3px var(--onblk)}
.st-block .q{font-size:27px;font-weight:900;letter-spacing:-.03em;line-height:1.18}
.st-block .seg{background:rgba(0,0,0,.14);border:none;box-shadow:none}
.st-block .seg div{color:var(--onblk);opacity:.75}
.st-block .seg div.on{background:var(--onblk);color:var(--blk);opacity:1}
.st-block .appbar .btn.fill{background:var(--onblk);color:var(--blk)}
.st-block .appbar .btn.fill.dis{background:rgba(0,0,0,.14);color:var(--onblk);opacity:.6}
.st-block .btn.fill{background:var(--sel);color:var(--onsel)}
.st-block .badge{background:var(--onblk);color:var(--blk);box-shadow:0 0 0 2px var(--blk)}
.st-block .opts{padding-top:20px}
.st-block :is(.opt,.card,.chip,.tcard,.choice,.tile,.field){background:var(--slab);border:none;box-shadow:none}
.st-block .opt{border-radius:18px;height:58px}
.st-block .opt.focus{box-shadow:inset 0 0 0 2.5px var(--text)}
.st-block .opt.err{box-shadow:inset 0 0 0 2.5px var(--err)}
.st-block .addopt{border-radius:18px;border:2px dashed var(--div2)}
.st-block .card{border-radius:24px}
.st-block .lic{background:var(--blk)!important;color:var(--onblk)}
.st-block .chip{border-radius:12px}
.st-block .chip.secc{background:var(--sec);color:var(--onsec)}
.st-block .chip.warn{background:var(--warn-tint)}
.st-block .tools{background:#141414;border:none;box-shadow:0 12px 30px -10px rgba(0,0,0,.45)}
.st-block.dark .tools{background:#1c1c1c}
.st-block .tools .tool:nth-child(3n+1){color:var(--t1)}
.st-block .tools .tool:nth-child(3n+2){color:var(--t2)}
.st-block .tools .tool:nth-child(3n){color:var(--t3)}
.st-block .tool.on-warn{background:rgba(255,255,255,.14)}
.st-block .tool.pv{background:var(--acc);color:#111}
.st-block .sheet{background:var(--slab);border-radius:36px 36px 0 0}
.st-block.dark .sheet{background:#121212}
.st-block .sheet .choice{background:#f4f4f2}
.st-block.dark .sheet .choice{background:#1e1e1e}
.st-block .choice.on{background:var(--sel)!important;color:var(--onsel)}
.st-block .choice.on .tt span{color:var(--onsel);opacity:.75}
.st-block .choice.on .lic{background:var(--onsel)!important;color:var(--sel)}
.st-block .choice.on .radio{border-color:var(--onsel)}
.st-block .tile.on{background:var(--sel);color:var(--onsel)}
.st-block .sheet h2{font-size:26px;font-weight:900;letter-spacing:-.03em}
.st-block .kbd{background:#e7e7e4}.st-block.dark .kbd{background:#111}
.st-block.dark .key{background:#262626}
.st-block .key.ent{background:var(--blk);color:var(--onblk)}
.st-block .scrim{background:rgba(0,0,0,.45)}
.st-block .mention{background:var(--onblk);color:var(--blk)}
/* =========================================================== POP */
.st-pop{--ink:#141414;--pb:#ffffff;--shc:#141414}
.st-pop.dark{--ink:#f2f2f2;--pb:#0b0b0b;--shc:var(--pri)}
.st-pop .screen{background:var(--pb);font-family:"Shantell Sans",sans-serif}
.st-pop .kbd{font-family:"Noto Sans",sans-serif}
.st-pop .screen::before{background-image:radial-gradient(var(--pri) 1.5px,transparent 1.8px);background-size:9px 9px;opacity:.55;
  -webkit-mask-image:radial-gradient(55% 32% at 100% 0%,#000,transparent 75%),radial-gradient(60% 30% at 0% 100%,#000,transparent 75%);
  mask-image:radial-gradient(55% 32% at 100% 0%,#000,transparent 75%),radial-gradient(60% 30% at 0% 100%,#000,transparent 75%)}
.st-pop :is(.seg,.tools,.card,.opt,.chip,.tcard,.mentionpop,.field,.choice,.tile,.addopt,.thumb,.btn.fill,.btn.out,.btn.tonal){
  border:2px solid var(--ink);box-shadow:3px 3px 0 var(--shc);background-color:var(--pb)}
.st-pop .thumb{border-radius:14px}
.st-pop .btn.fill{background:var(--pri);color:#141414}
.st-pop .btn.fill.dis{background:var(--pb);color:var(--text3);border-color:var(--div2);box-shadow:none}
.st-pop .seg{padding:3px}
.st-pop .seg div.on{background:var(--pri);color:#141414;box-shadow:inset 0 0 0 2px var(--ink)}
.st-pop .editor{gap:16px}
.st-pop .editor .body{border:2px solid var(--ink);border-radius:22px;padding:10px 14px 14px;box-shadow:4px 4px 0 var(--shc);background:var(--pb);position:relative}
.st-pop .editor .body::before{content:"";position:absolute;left:-10px;top:14px;width:16px;height:16px;background:var(--pb);border-left:2px solid var(--ink);border-bottom:2px solid var(--ink);transform:rotate(45deg)}
.st-pop .text{font-size:17.5px}
.st-pop .q{font-size:22px}
.st-pop .mention{background:var(--pri);color:#141414;border:1.5px solid var(--ink);border-radius:8px;padding:0 4px}
.st-pop .hash{color:var(--sec);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px}
.st-pop .opt.focus{background:var(--pri-tint);box-shadow:3px 3px 0 var(--pri)}
.st-pop .opt.err{border-color:var(--err);box-shadow:3px 3px 0 var(--err)}
.st-pop .choice.on,.st-pop .tile.on,.st-pop .chip.on{background:var(--pri);color:#141414}
.st-pop .choice.on .tt span{color:#3a3a3a}
.st-pop .choice.on .radio{border-color:#141414}
.st-pop .lic{background:var(--pri)!important;color:#141414;border:1.5px solid var(--ink)}
.st-pop .chip.secc{background:var(--pb);color:var(--sec)}
.st-pop .tool{color:var(--ink)}
.st-pop .tool.on-warn{background:var(--pri);color:#141414}
.st-pop .tool.pv{background:var(--pri);color:#141414;border:2px solid var(--ink);box-shadow:3px 3px 0 var(--shc)}
.st-pop .sheet{background:var(--pb);border:2px solid var(--ink);border-bottom:none;box-shadow:none}
.st-pop .handle{background:var(--ink)}
.st-pop .sheet h2{font-size:24px}
.st-pop .av{box-shadow:0 0 0 2px var(--ink)}
.st-pop .badge{border:1.5px solid var(--ink);box-shadow:none}
.st-pop .kbd{background:#eeeeee}.st-pop.dark .kbd{background:#121212}
.st-pop.dark .key{background:#262626}
.st-pop .scrim{background:rgba(0,0,0,.35)}
"""

STYLES = [
    ('ballot', 'Ballot', 'Every surface is a slip or ticket. Options are tear-off ballot slips with a numbered stub, a perforation and notches. Settings are a notched ticket, and sheets tear off along a dashed line. The UI is monochrome, with the preset color used only as a signal (Post, focus, selection).',
     ['Rooted in what Pollerama is (ballots and tickets), so it\'s ours and not a trend.',
      'Reads as serious and precise (boarding pass, bank-ticket vibe) while still having character.',
      'Flat and fast: no blur. Light and dark use the same rules, and dark stays OLED black.']),
    ('aura', 'Aura', 'Clean white / OLED black canvas. Every control is drawn with a gradient stroke from the preset colors, and focus makes it glow. Big, tight, confident type.',
     ['Premium and modern without blur or fake 3D.',
      'Each of the 8 presets gives a different gradient.',
      'Less tied to polls. Closer to a general "modern app" look.']),
    ('block', 'Color Block', 'The theme color becomes structure: what you\'re writing sits in a solid block of the preset color, options are bold slabs below it, and the tool dock is dark ink.',
     ['Loud and instantly recognizable.',
      'Huge type for the question.',
      'Can feel heavy on every screen. Better as an accent than the whole system.']),
]

def phone(inner, style, dark=False):
    d = B.device(inner, dark)
    return d.replace('<div class="device', f'<div class="device st-{style}', 1)

def strip(h):
    import re
    return re.sub(r' data-(pin|side|dx|dy)="[^"]*"', '', h)

SCREENS = [
    ('Note · light', lambda: B.n_filled(pins=False), False),
    ('Poll · light', lambda: B.p_filled(pins=False), False),
    ('Sheet · light', lambda: strip(B.p_type()), False),
    ('Note · dark', lambda: B.n_filled(pins=False), True),
    ('Poll · dark', lambda: B.p_filled(pins=False), True),
    ('Sheet · dark', lambda: strip(B.p_type()), True),
]

def css():
    return B.CSS + STYLE_CSS.replace('%FONT%', FONT)

def page(body):
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{css()}</style></head><body>{body}</body></html>'

SC = .6
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
    body = f'''<div style="padding:50px 56px;width:2060px;display:flex;flex-direction:column;gap:56px">
      <div class="legend"><div class="kicker">Pollerama · composer</div><h1>Style directions — round 3</h1>
      <p class="lede" style="max-width:1100px">Same layout and features, three visual languages, each in light and dark. Golden preset. We start with the composer, and the winner then rolls out screen by screen.</p></div>{rows}</div>'''
    B.render_to(os.path.join(OUT, '00-style-directions.png'), page(body), 2060, 2060)

def hero(style, title):
    cells = ''.join(cell(fn(), style, d) for t, fn, d in SCREENS)
    body = f'<div style="padding:44px 50px;width:2000px"><div class="legend" style="margin-bottom:24px"><div class="kicker">Style direction</div><h1>{title}</h1></div><div style="display:flex;gap:26px">{cells}</div></div>'
    B.render_to(os.path.join(OUT, f'{style}.png'), page(body), 2000, 760)

if __name__ == '__main__':
    board_all()
    for s, t, *_ in STYLES:
        hero(s, t)

def detail(style, title, screens):
    global SC
    old, SC = SC, 1.0
    cells = ''.join(cell(fn(), style, d) for fn, d in screens)
    SC = old
    body = f'<div style="padding:44px 50px;width:{120+len(screens)*440}px"><div class="legend" style="margin-bottom:24px"><div class="kicker">Style direction · close-up</div><h1>{title}</h1></div><div style="display:flex;gap:26px">{cells}</div></div>'
    B.render_to(os.path.join(OUT, f'{style}-detail.png'), page(body), 120+len(screens)*440, 1080)

# ---------------------------------------------------------------- Color Block: presets & palettes
from build import CSS as _C
def _lum(h):
    h = h.lstrip('#'); r, g, b = [int(h[i:i+2], 16)/255 for i in (0, 2, 4)]
    f = lambda c: c/12.92 if c <= .03928 else ((c+.055)/1.055)**2.4
    return .2126*f(r)+.7152*f(g)+.0722*f(b)
def on(h): return '#141414' if _lum(h) > 0.3 else '#ffffff'

# From src/styles/themes.ts (lightPrimary, darkPrimary, lightSecondary, darkSecondary)
PRESETS = [
    ('Golden', '#DAA520', '#FAD13F', '#B45309', '#F0A93B'),
    ('Ocean', '#0277bd', '#40c4ff', '#0E7490', '#22D3EE'),
    ('Forest', '#2e7d32', '#69f0ae', '#92400E', '#D9A066'),
    ('Dusk', '#6a1b9a', '#e040fb', '#BE185D', '#F472B6'),
    ('Ember', '#d84315', '#ff6d00', '#B45309', '#FBBF24'),
    ('Midnight', '#000000', '#ffffff', '#3730A3', '#818CF8'),
    ('Crimson', '#8e1d2b', '#e35d6a', '#B8860B', '#E0B84A'),
    ('Cyberpunk', '#00875a', '#00ff9f', '#d6006e', '#ff2a6d'),
]

def preset_vars(p, dark):
    name, lp, dp, ls, ds = p
    blk = dp if dark else lp
    sec = ds if dark else ls
    return (f'--pri:{blk};--blk:{blk};--onblk:{on(blk)};--acc:{dp};--sec:{sec};--onsec:{on(sec)};'
            f'--pri-tint:{blk}26;--pri-tint2:{blk}4d')

# Multi-color palettes: c1 = notes, c2 = polls, c3 = selection / accents. (light, dark)
PALETTES = [
    ('Festival', ('#F4B400', '#FF5A5F', '#5B5BD6'), ('#FFD24A', '#FF7A7E', '#8B8BFF')),
    ('Lagoon',   ('#0FA3B1', '#3D5AFE', '#FFB400'), ('#3FE0EC', '#7C8CFF', '#FFCA4D')),
    ('Orchard',  ('#2BB673', '#FF7A1A', '#E0457B'), ('#5CE39A', '#FF9A4D', '#FF6FA0')),
]

def palette_vars(pal, dark, kind):
    c1, c2, c3 = pal[2] if dark else pal[1]
    d1, d2, d3 = pal[2]
    blk = c1 if kind == 'note' else c2
    return (f'--pri:{blk};--blk:{blk};--onblk:{on(blk)};--acc:{d1};--sec:{c3};--onsec:{on(c3)};'
            f'--sel:{c3};--onsel:{on(c3)};--t1:{d1};--t2:{d2};--t3:{d3};--pri-tint:{blk}26;--pri-tint2:{blk}4d')

def vcell(inner, dark, vars_, sc):
    w, h = int(414*sc), int(868*sc)
    d = phone(inner, 'block', dark).replace('<div class="device', f'<div style="{vars_}" class="device', 1)
    return f'<div style="width:{w}px;height:{h}px"><div style="transform:scale({sc});transform-origin:top left;width:414px">{d}</div></div>'

def block_presets():
    sc = .5
    def col(p):
        return (f'<div style="display:flex;flex-direction:column;gap:16px;align-items:center">'
                f'{vcell(B.p_filled(pins=False), False, preset_vars(p, False), sc)}'
                f'{vcell(B.n_filled(pins=False), True, preset_vars(p, True), sc)}'
                f'<b style="font-size:16px">{p[0]}</b></div>')
    cols = ''.join(col(p) for p in PRESETS)
    W = 120 + 8*(int(414*sc)+22)
    body = f'''<div style="padding:44px 56px;width:{W}px"><div class="legend" style="margin-bottom:26px"><div class="kicker">Color Block</div><h1>Every preset, light (top) and dark (bottom)</h1>
      <p class="lede" style="max-width:1300px">The 8 existing presets from Settings → Appearance. The block takes the preset color, and text on it flips between ink and white automatically for contrast. Dark mode uses the preset's bright variant on OLED black.</p></div>
      <div style="display:flex;gap:22px">{cols}</div></div>'''
    B.render_to(os.path.join(OUT, 'block-presets.png'), page(body), W, 1180)

def block_palettes():
    sc = .55
    def row_(pal):
        name, L, D = pal
        sw = ''.join(f'<i style="width:34px;height:34px;border-radius:10px;background:{c};display:inline-block;margin-right:6px"></i>' for c in L)
        cells = (vcell(B.n_filled(pins=False), False, palette_vars(pal, False, 'note'), sc) +
                 vcell(B.p_filled(pins=False), False, palette_vars(pal, False, 'poll'), sc) +
                 vcell(strip(B.p_type()), False, palette_vars(pal, False, 'poll'), sc) +
                 vcell(B.n_filled(pins=False), True, palette_vars(pal, True, 'note'), sc) +
                 vcell(B.p_filled(pins=False), True, palette_vars(pal, True, 'poll'), sc))
        return (f'<div style="display:flex;gap:36px;align-items:center"><div style="width:220px;flex:none"><div class="legend"><h1 style="font-size:26px">{name}</h1>'
                f'<div style="margin:6px 0 10px">{sw}</div><p class="lede" style="font-size:13.5px;margin:0">Notes · Polls · Selection</p></div></div>'
                f'<div style="display:flex;gap:20px">{cells}</div></div>')
    rows = ''.join(row_(p) for p in PALETTES)
    W = 120 + 260 + 5*(int(414*sc)+20)
    body = f'''<div style="padding:44px 56px;width:{W}px;display:flex;flex-direction:column;gap:34px"><div class="legend"><div class="kicker">Color Block · idea</div><h1>Multi-color palettes</h1>
      <p class="lede" style="max-width:1200px">Instead of one accent, a theme is a palette of three colors. Each content type owns one: notes, polls, and selections and highlights. The tool dock picks up all three. Users pick a palette the same way they pick light or dark.</p></div>{rows}</div>'''
    B.render_to(os.path.join(OUT, 'block-palettes.png'), page(body), W, 230 + 3*(int(868*sc)+34))

if __name__ == '__main__':
    block_presets()
    block_palettes()
