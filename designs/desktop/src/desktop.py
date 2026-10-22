"""
Color Block — desktop directions.

    python3 designs/desktop/src/desktop.py

Output: designs/desktop/*.png (1440x900 viewport, rendered at 2x). Reuses the
render helper and icons from designs/composer/src.
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '../../composer/src'))
import build as B
import styles as S
from icons import ic

OUT = os.path.abspath(os.path.join(HERE, '..'))
W, H = 1440, 900

FEST_L = ['#F4B400', '#FF5A5F', '#5B5BD6', '#00A88F', '#E84393', '#FF8A00']
FEST_D = ['#FFD24A', '#FF7A7E', '#8B8BFF', '#2EE6C3', '#FF6FB5', '#FFA940']

FEEDS = [  # label, icon, palette slot (matches navConfig FEED_SECTION)
    ('Home', 'AllInclusiveRounded', 0), ('Polls', 'HowToVoteRounded', 1), ('Topics', 'TagRounded', 5),
    ('Notes', 'ArticleRounded', 3), ('Articles', 'MenuBookRounded', 2), ('Music', 'MusicNoteRounded', 4),
    ('Movies', 'MovieRounded', 5), ('Packs', 'PeopleRounded', 3), ('Bookmarks', 'BookmarkRounded', 2),
    ('Games', 'SportsEsportsRounded', 5),
]

CSS = r"""
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Noto Sans",system-ui,Roboto,sans-serif;-webkit-font-smoothing:antialiased;width:1440px;height:900px;overflow:hidden}
.app{width:1440px;height:900px;background:var(--page);color:var(--text);position:relative;overflow:hidden;
  --page:#f2f2ef;--slab:#fff;--inner:#f4f4f1;--ink:#141414;--text:#1d1b16;--text2:#6b665c;--div:rgba(0,0,0,.08)}
.app.dark{--page:#000;--slab:#141414;--inner:#1f1f1f;--ink:#1c1c1c;--text:#f2f2f2;--text2:#9a9a9a;--div:rgba(255,255,255,.09)}
svg{display:block;flex:none}
.av{width:40px;height:40px;border-radius:50%;flex:none;background:linear-gradient(135deg,#f0b357,#c46a2b);position:relative;overflow:hidden}
.av::after{content:"";position:absolute;left:50%;top:26%;width:38%;height:38%;margin-left:-19%;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 18px 0 6px rgba(255,255,255,.85)}
.av.sm{width:32px;height:32px}.av.xs{width:26px;height:26px}
.av.b{background:linear-gradient(135deg,#7cc7e8,#2d77b8)}.av.g{background:linear-gradient(135deg,#9ad48a,#3c8f4e)}.av.p{background:linear-gradient(135deg,#d6a0e6,#7b3fa3)}.av.r{background:linear-gradient(135deg,#f6a6a0,#c2443b)}

/* slabs + cards */
.slab{background:var(--slab);border-radius:26px;padding:16px 16px 8px;break-inside:avoid;margin-bottom:14px}
.ph{display:flex;align-items:center;gap:10px}
.ph .nm{flex:1;min-width:0;line-height:1.25}
.ph .nm b{font-size:15px;display:block}
.ph .nm span{font-size:12.5px;color:var(--text2)}
.ph .more{color:var(--text2)}
.kind{height:24px;padding:0 10px;border-radius:8px;font-size:11.5px;font-weight:800;letter-spacing:.03em;display:inline-flex;align-items:center;gap:4px;background:var(--pc);color:var(--onpc)}
.pq{font-size:19px;font-weight:800;letter-spacing:-.02em;line-height:1.3;margin:12px 0 8px}
.po{position:relative;height:46px;border-radius:14px;background:var(--inner);display:flex;align-items:center;padding:0 14px;font-size:15px;font-weight:600;overflow:hidden;margin-top:6px;gap:8px}
.po i{position:absolute;left:0;top:0;bottom:0;background:var(--pc);opacity:.32}
.po i.win{opacity:.55}
.po span,.po b,.po svg{position:relative}
.po span{flex:1}
.po.me{box-shadow:inset 0 0 0 2px var(--text)}
.po .rad{width:20px;height:20px;border-radius:50%;border:2px solid var(--text2);opacity:.6}
.pmeta{font-size:12.5px;color:var(--text2);margin-top:10px;display:flex;gap:6px;align-items:center}
.acts{display:flex;justify-content:space-between;align-items:center;padding:12px 4px 6px;color:var(--text2);font-size:13px;font-weight:600}
.acts div{display:flex;align-items:center;gap:5px}
.acts .liked{color:#e0245e}
.pimg{height:150px;border-radius:18px;margin-top:10px}
.g1{background:linear-gradient(135deg,#ffd7a8,#ff8a5c 60%,#c2443b)}
.g2{background:linear-gradient(135deg,#a8e6ff,#4f8fe8 55%,#3b3fb8)}
.g3{background:linear-gradient(160deg,#c9f5c9,#3c9f6e)}

/* block header */
.blk{background:var(--blk);color:var(--onblk)}
.ib{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;position:relative;color:inherit}
.bd{position:absolute;top:3px;right:2px;min-width:17px;height:17px;border-radius:9px;background:var(--onblk);color:var(--blk);font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 4px;box-shadow:0 0 0 2px var(--blk)}
.pills{display:flex;gap:8px}
.pills span{height:34px;padding:0 15px;border-radius:999px;background:rgba(0,0,0,.13);font-weight:700;font-size:14px;display:flex;align-items:center;white-space:nowrap}
.pills span.on{background:var(--onblk);color:var(--blk)}
.ttl{font-weight:900;letter-spacing:-.035em}
kbd{font-family:inherit;font-size:11.5px;font-weight:800;padding:2px 7px;border-radius:7px;background:rgba(0,0,0,.12)}

/* ink nav */
.ink{background:var(--ink);color:#fff}
.dark .ink{box-shadow:0 0 0 1px rgba(255,255,255,.09)}
.ni{display:flex;align-items:center;gap:12px;height:44px;padding:0 14px;border-radius:16px;color:rgba(255,255,255,.62);font-size:14.5px;font-weight:600}
.ni.on{color:#111;font-weight:800}
.ni .dotc{width:8px;height:8px;border-radius:50%;margin-left:auto}
.create{display:flex;align-items:center;justify-content:center;gap:8px;background:var(--blk);color:var(--onblk);font-weight:800;font-size:15.5px}

/* side widgets */
.wt{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text2);margin-bottom:10px;display:flex;align-items:center;justify-content:space-between}
.wt em{font-style:normal;text-transform:none;letter-spacing:0;font-weight:700;color:var(--text)}
.tag{display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:12px;font-weight:700;font-size:13.5px;margin:0 6px 8px 0}
.lr{display:flex;align-items:center;gap:10px;padding:9px 0}
.lr+.lr{border-top:1px solid var(--div)}
.lr .t{flex:1;min-width:0;line-height:1.3}
.lr .t b{font-size:14px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lr .t span{font-size:12.5px;color:var(--text2)}
.fbtn{height:32px;padding:0 14px;border-radius:12px;font-weight:800;font-size:13px;display:flex;align-items:center;background:var(--text);color:var(--page)}
.new{position:absolute;font-size:10px;font-weight:900;letter-spacing:.06em;padding:3px 7px;border-radius:6px;background:#111;color:#fff;box-shadow:0 0 0 2px #fff;z-index:50}
.fade{position:absolute;left:0;right:0;bottom:0;height:120px;background:linear-gradient(rgba(0,0,0,0),var(--page) 80%);pointer-events:none;z-index:5}
"""

def on(h): return S.on(h)

def vars_(dark, slot):
    pal = FEST_D if dark else FEST_L
    blk = pal[slot]
    v = dict(blk=blk, onblk=on(blk), pc=pal[1], onpc=on(pal[1]))
    return ';'.join(f'--{k}:{x}' for k, x in v.items())

def acc(dark, slot):  # bright variant on ink
    return FEST_D[slot]

# ---------------------------------------------------------------- cards
def head(name, handle, time, hue=''):
    return (f'<div class="ph"><div class="av {hue}"></div><div class="nm"><b>{name}</b><span>{handle} · {time}</span></div>'
            f'<span class="kind">{ic("PollRounded",13)}POLL</span><div class="more">{ic("MoreVertRounded",20)}</div></div>')

def actions(c=(48, 9, 102, '880'), liked=False):
    return (f'<div class="acts"><div>{ic("ChatBubbleOutlineRounded",18)}{c[0]}</div><div>{ic("RepeatRounded",19)}{c[1]}</div>'
            f'<div class="{"liked" if liked else ""}">{ic("FavoriteRounded" if liked else "FavoriteBorderRounded",18)}{c[2]}</div>'
            f'<div>{ic("BoltRounded",19)}{c[3]}</div><div>{ic("BookmarkBorderRounded",19)}</div><div>{ic("ShareRounded",17)}</div></div>')

def poll(q, opts, who, meta, voted=True, me=1, img=None, liked=False, c=(48, 9, 102, '880')):
    rows = ''
    mx = max(p for _, p in opts)
    for i, (t, p) in enumerate(opts):
        if voted:
            rows += (f'<div class="po{" me" if i==me else ""}"><i class="{"win" if p==mx else ""}" style="width:{p}%"></i><span>{t}</span>'
                     f'{ic("CheckCircleRounded",18) if i==me else ""}<b>{p}%</b></div>')
        else:
            rows += f'<div class="po"><span>{t}</span><div class="rad"></div></div>'
    im = f'<div class="pimg {img}"></div>' if img else ''
    return (f'<div class="slab">{head(*who)}<div class="pq">{q}</div>{im}{rows}'
            f'<div class="pmeta">{ic("HowToVoteRounded",15)}{meta}</div>{actions(c, liked)}</div>')

CARDS = [
    poll('Best way to start a Sunday? ☕', (('Long walk by the sea', 31), ('Slow coffee', 44), ('Back to bed', 25)),
         ('Mira Okafor', '@mira', '2h', 'g'), '1,284 votes · 2 days left', liked=True),
    poll('Which relay setup do you run?', (('Just the defaults', 0), ('Self-hosted', 0), ('Paid relay', 0)),
         ('devon.lee', '@devon', '5h', 'b'), '311 votes · 6 hours left', voted=False, c=(12, 3, 40, '210')),
    poll('Pick the cover for our next zine', (('Sunset', 58), ('Ocean', 42)),
         ('Ana Lima', '@ana', '6h', 'p'), '902 votes · ends tomorrow', img='g1', me=0, c=(30, 11, 77, '1.2k')),
    poll('How many relays is too many?', (('Under 5', 22), ('5–10', 51), ('10+', 27)),
         ('fiatjaf fan', '@ffan', '8h', 'r'), '2,040 votes · final', me=2, c=(91, 20, 300, '5.4k')),
    poll('Weekend project: what should I build?', (('A Nostr bot', 0), ('A game', 0), ('Nothing, rest', 0)),
         ('Sam Rivera', '@sam', '9h', ''), '88 votes · 3 days left', voted=False, c=(4, 1, 12, '42')),
    poll('Where should the meetup be?', (('Lisbon', 38), ('Berlin', 34), ('Online', 28)),
         ('Kai', '@kai', '11h', 'b'), '640 votes · 1 day left', img='g2', me=0, c=(22, 6, 54, '600')),
]

# ---------------------------------------------------------------- shared bits
def header_icons(badges=True):
    b = (lambda n: f'<span class="bd">{n}</span>') if badges else (lambda n: '')
    return (f'<div class="ib">{ic("SearchRounded",23)}</div><div class="ib">{ic("NotificationsRounded",23)}{b(5)}</div>'
            f'<div class="ib">{ic("MailRounded",23)}{b(2)}</div>')

def pills(labels=('Global', 'Following', 'Web of Trust'), sel=0):
    return '<div class="pills">' + ''.join(f'<span class="{"on" if i==sel else ""}">{l}</span>' for i, l in enumerate(labels)) + '</div>'

def nav_items(dark, active='Polls', labels=True, size=44):
    out = ''
    for label, icon, slot in FEEDS:
        on_ = label == active
        st = f'background:{acc(dark, slot)}' if on_ else ''
        dot = '' if on_ or not labels else ''
        if labels:
            out += f'<div class="ni{" on" if on_ else ""}" style="{st}">{ic(icon,21)}{label}{dot}</div>'
        else:
            out += (f'<div class="ni{" on" if on_ else ""}" style="{st};width:{size}px;height:{size}px;padding:0;justify-content:center">'
                    f'{ic(icon,22)}</div>')
    return out

def new(x, y, label='NEW'):
    return f'<span class="new" style="left:{x}px;top:{y}px">{label}</span>'

def tags(dark):
    pal = FEST_D if dark else FEST_L
    t = [('#nostr', 5), ('#bitcoin', 0), ('#music', 4), ('#zines', 2), ('#lisbon', 3), ('#games', 1), ('#photography', 5)]
    return ''.join(f'<span class="tag" style="background:{pal[s]};color:{on(pal[s])}">{n}</span>' for n, s in t)

# ---------------------------------------------------------------- A: three-pane frame
def dir_a(dark):
    v = vars_(dark, 1)
    rail = f'''
    <div class="ink" style="position:absolute;left:{FX}px;top:16px;bottom:16px;width:236px;border-radius:30px;padding:18px 12px;display:flex;flex-direction:column;gap:2px">
      <div style="display:flex;align-items:center;gap:10px;padding:2px 8px 16px">
        <div class="av sm"></div><div style="line-height:1.2;flex:1"><b style="font-size:14px;display:block">Abhay</b><span style="font-size:12px;opacity:.6">@abhay</span></div>
        <div style="opacity:.6">{ic("SettingsRounded",20)}</div>
      </div>
      {nav_items(dark)}
      <div style="flex:1"></div>
      <div class="create" style="height:56px;border-radius:20px">{ic("AddRounded",26)}Create</div>
    </div>'''
    cx = FX + 236 + 18
    center = f'''
    <div style="position:absolute;left:{cx}px;top:0;width:640px;bottom:0">
      <div class="blk" style="border-radius:0 0 30px 30px;padding:6px 18px 18px">
        <div style="display:flex;align-items:center;height:62px;gap:4px"><div class="ttl" style="font-size:32px;flex:1;margin-left:4px">Polls</div>{header_icons()}</div>
        {pills()}
      </div>
      <div style="padding-top:14px">{CARDS[0]}{CARDS[2]}</div>
    </div>'''
    rx = cx + 640 + 18
    side = f'''
    <div style="position:absolute;left:{rx}px;top:16px;width:300px;bottom:0;display:flex;flex-direction:column;gap:14px">
      <div class="slab" style="padding:0 16px;height:52px;display:flex;align-items:center;gap:10px;color:var(--text2);margin:0;border-radius:18px">{ic("SearchRounded",21)}<span style="flex:1;font-size:14.5px">Search Pollerama</span><kbd style="background:var(--inner);color:var(--text2)">Ctrl K</kbd></div>
      <div class="slab" style="margin:0;padding-bottom:10px"><div class="wt">Trending topics</div>{tags(dark)}</div>
      <div class="slab" style="margin:0;padding-bottom:8px"><div class="wt">Closing soon</div>
        <div class="lr"><div class="t"><b>Where should the meetup be?</b><span>640 votes · 1 day left</span></div></div>
        <div class="lr"><div class="t"><b>Which relay setup do you run?</b><span>311 votes · 6 hours left</span></div></div>
        <div class="lr"><div class="t"><b>Best way to start a Sunday?</b><span>1,284 votes · 2 days left</span></div></div>
      </div>
      <div class="slab" style="margin:0;padding-bottom:8px"><div class="wt">Follow packs</div>
        <div class="lr"><div class="av xs b"></div><div class="t"><b>Lisbon Nostriches</b><span>42 people</span></div><div class="fbtn">Follow</div></div>
        <div class="lr"><div class="av xs p"></div><div class="t"><b>Zine makers</b><span>18 people</span></div><div class="fbtn">Follow</div></div>
      </div>
    </div>'''
    return (f'<div class="app{" dark" if dark else ""}" style="{v}">{rail}{center}{side}<div class="fade"></div>'
            + new(FX + 14, 4, "INK RAIL") + new(rx + 220, 4, 'NEW') + '</div>')

FX = (W - (236 + 18 + 640 + 18 + 300)) // 2  # center the 1212px frame

# ---------------------------------------------------------------- B: color column
def dir_b(dark):
    v = vars_(dark, 1)
    rail = f'''
    <div class="ink" style="position:absolute;left:16px;top:16px;bottom:16px;width:76px;border-radius:28px;padding:16px 0;display:flex;flex-direction:column;align-items:center;gap:4px">
      <div class="av sm" style="margin-bottom:12px"></div>
      {nav_items(dark, labels=False, size=50)}
      <div style="flex:1"></div>
      <div style="opacity:.6;margin-bottom:12px">{ic("SettingsRounded",22)}</div>
      <div class="create" style="width:54px;height:54px;border-radius:19px">{ic("AddRounded",28)}</div>
    </div>'''
    pal = FEST_D if dark else FEST_L
    block = f'''
    <div class="blk" style="position:absolute;left:108px;top:16px;bottom:16px;width:300px;border-radius:30px;padding:16px 20px 22px;display:flex;flex-direction:column">
      <div style="display:flex;justify-content:flex-end;gap:2px;margin-right:-8px">{header_icons()}</div>
      <div class="ttl" style="font-size:52px;line-height:1;margin-top:30px">Polls</div>
      <div style="font-size:14.5px;opacity:.78;margin-top:10px;line-height:1.45">What people are asking right now, from everyone you can reach.</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:26px">
        {''.join(f'<div style="height:46px;border-radius:16px;padding:0 16px;display:flex;align-items:center;font-weight:800;font-size:15px;{"background:var(--onblk);color:var(--blk)" if i==0 else "background:rgba(0,0,0,.12)"}">{l}<span style="margin-left:auto;opacity:.7;font-weight:700;font-size:13px">{n}</span></div>' for i,(l,n) in enumerate([("Global","2.4k"),("Following","38"),("Web of Trust","410")]))}
      </div>
      <div style="flex:1"></div>
      <div style="background:rgba(0,0,0,.12);border-radius:20px;padding:14px 16px">
        <div style="font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;opacity:.7">Trending</div>
        <div style="font-weight:800;font-size:15px;margin-top:6px;line-height:1.5">#nostr · #zines · #lisbon · #music</div>
      </div>
      <div class="ink" style="margin-top:12px;height:54px;border-radius:18px;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:800;font-size:15px">{ic("AddRounded",24)}New poll</div>
    </div>'''
    grid = f'''
    <div style="position:absolute;left:424px;right:16px;top:16px;column-count:2;column-gap:14px">
      {CARDS[0]}{CARDS[3]}{CARDS[2]}{CARDS[1]}{CARDS[4]}{CARDS[5]}
    </div>'''
    return (f'<div class="app{" dark" if dark else ""}" style="{v}">{rail}{block}{grid}<div class="fade" style="left:424px"></div>'
            + new(70, 8, 'ICON RAIL') + new(330, 8, 'BLOCK PANE') + new(1360, 8, '2 COLS') + '</div>')

# ---------------------------------------------------------------- C: wide block + desktop dock
def dir_c(dark):
    v = vars_(dark, 1)
    FW = 1180
    fx = (W - FW) // 2
    head_ = f'''
    <div class="blk" style="position:absolute;left:{fx}px;top:0;width:{FW}px;border-radius:0 0 34px 34px;padding:8px 22px 20px">
      <div style="display:flex;align-items:center;height:64px;gap:14px">
        <div class="av" style="box-shadow:0 0 0 3px var(--onblk)"></div>
        <div class="ttl" style="font-size:34px">Polls</div>
        <div style="flex:1"></div>
        <div style="width:380px;height:44px;border-radius:16px;background:rgba(0,0,0,.13);display:flex;align-items:center;gap:10px;padding:0 14px;font-size:14.5px">{ic("SearchRounded",21)}<span style="opacity:.75;flex:1">Search people, polls, topics</span><kbd>Ctrl K</kbd></div>
        <div style="display:flex">{header_icons().split("</div>",1)[1]}</div>
      </div>
      {pills()}
    </div>'''
    grid = f'''
    <div style="position:absolute;left:{fx}px;width:{FW}px;top:146px;column-count:3;column-gap:14px">
      {CARDS[0]}{CARDS[1]}{CARDS[2]}{CARDS[3]}{CARDS[5]}{CARDS[4]}
    </div>'''
    items = ''
    for label, icon, slot in FEEDS:
        on_ = label == 'Polls'
        st = f'background:{acc(dark, slot)};color:#111' if on_ else ''
        items += f'<div style="width:66px;height:52px;border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:10.5px;font-weight:700;color:rgba(255,255,255,.62);{st}">{ic(icon,22)}{label}</div>'
    dock = f'''
    <div style="position:absolute;left:0;right:0;bottom:22px;display:flex;justify-content:center;align-items:center;gap:12px;z-index:10">
      <div class="ink" style="display:flex;gap:2px;padding:6px;border-radius:28px;box-shadow:0 16px 34px -12px rgba(0,0,0,.55)">{items}</div>
      <div class="create" style="width:64px;height:64px;border-radius:22px;box-shadow:0 16px 30px -12px rgba(0,0,0,.5)">{ic("AddRounded",30)}</div>
    </div>'''
    return (f'<div class="app{" dark" if dark else ""}" style="{v}">{head_}{grid}<div class="fade" style="height:200px"></div>{dock}'
            + new(fx + 640, 14, 'SEARCH IN BLOCK') + new(fx + 10, 160, '3 COLS') + new(560, 806, "DESKTOP DOCK") + '</div>')

# ---------------------------------------------------------------- overview board
OV_CSS = r"""
body{width:1520px;height:auto;background:#e9e6df;font-family:"Noto Sans",system-ui,sans-serif;color:#1d1b16;padding:40px}
h1{font-size:34px;font-weight:900;letter-spacing:-.03em}
p.l{font-size:16px;color:#5d584e;margin:8px 0 26px;max-width:1100px;line-height:1.5}
.row{display:flex;gap:24px;margin-bottom:34px;align-items:flex-start}
.row img{width:700px;border-radius:14px;box-shadow:0 20px 40px -24px rgba(0,0,0,.5)}
.cap{margin:0 0 12px}.cap b{font-size:22px;font-weight:900;letter-spacing:-.02em}.cap span{display:block;font-size:14.5px;color:#5d584e;margin-top:4px;line-height:1.45;max-width:1400px}
"""

def main():
    dirs = [('a', dir_a, 'A · Framed three-pane',
             'The app sits in a centered frame instead of stretching. The sidebar becomes an ink rail (same ink as the phone dock) with your account on top and Create at the bottom. The block header only covers the feed column. A NEW right column fills the space with search, trending topics, polls closing soon and follow packs.'),
            ('b', dir_b, 'B · Color column',
             'The block turns vertical: a tall pane in the section color holds the title, sub-feeds as big buttons (with counts), trending tags and a New poll button. Feeds are reduced to an icon-only ink rail. Cards flow in two columns, so twice as much is visible.'),
            ('c', dir_c, 'C · Wide block + desktop dock',
             'Closest to the phone. No sidebar: the full ink dock floats at the bottom like on mobile, with all ten feeds labelled since there is room. The block becomes a wide banner with a real search field in it. Cards flow in three columns. The smallest code change of the three.')]
    rows = ''
    for k, fn, title, desc in dirs:
        for dark in (False, True):
            doc = f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>{fn(dark)}</body></html>'
            B.render_to(os.path.join(OUT, f'{k}-{"dark" if dark else "light"}.png'), doc, W, H)
        rows += (f'<div class="cap"><b>{title}</b><span>{desc}</span></div>'
                 f'<div class="row"><img src="file://{OUT}/{k}-light.png"><img src="file://{OUT}/{k}-dark.png"></div>')
    doc = (f'<!doctype html><html><head><meta charset="utf-8"><style>{OV_CSS}</style></head><body>'
           f'<h1>Desktop — three directions</h1><p class="l">1440×900, Festival palette, Polls feed. All keep the existing feeds, sub-feeds, search, notifications, messages, account menu and Create. Labels mark what is new or moved.</p>{rows}</body></html>')
    B.render_to(os.path.join(OUT, '00-overview.png'), doc, 1520, 1720)

if __name__ == '__main__':
    main()
