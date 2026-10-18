"""
Color Block — app-wide mockups.

    python3 designs/app/src/app.py

Output: designs/app/*.png. Reuses the device/render helpers from designs/composer/src.
Rule of the system: the block (solid theme color, rounded bottom) always holds whatever is in focus:
the feed's name, the post being read, the profile, the conversation, or the thing being written.
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '../../composer/src'))
import build as B
import styles as S
from icons import ic

OUT = os.path.abspath(os.path.join(HERE, '..'))
esc = B.esc

APP_CSS = r"""
.cbx{--page:#f2f2ef;--slab:#ffffff;--inner:#f4f4f1;--navbg:#141414}
.cbx.dark{--page:#000000;--slab:#141414;--inner:#1f1f1f;--navbg:#1c1c1c}
.cbx .screen{background:var(--page)}
.cbx .status{background:var(--blk);color:var(--onblk)}
.blk{background:var(--blk);color:var(--onblk);border-radius:0 0 34px 34px;padding:2px 16px 18px;flex:none;position:relative}
.tb{display:flex;align-items:center;gap:2px;height:54px}
.tb .ttl{font-size:30px;font-weight:900;letter-spacing:-.035em;flex:1;margin-left:4px}
.tb .ttl.sm{font-size:19px;letter-spacing:-.02em}
.tb .ib{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;position:relative;color:var(--onblk)}
.tb .bd{position:absolute;top:3px;right:2px;min-width:17px;height:17px;border-radius:9px;background:var(--onblk);color:var(--blk);font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 4px;box-shadow:0 0 0 2px var(--blk)}
.cbx .av{width:40px;height:40px}
.blk .av{box-shadow:0 0 0 3px var(--onblk)}
.bp{display:flex;gap:8px;margin-top:4px;overflow:hidden}
.bp span{height:34px;padding:0 15px;border-radius:999px;background:rgba(0,0,0,.13);font-weight:700;font-size:14px;display:flex;align-items:center;white-space:nowrap;flex:none}
.bp span.on{background:var(--onblk);color:var(--blk)}
.bsearch{height:46px;border-radius:16px;background:rgba(0,0,0,.13);display:flex;align-items:center;gap:10px;padding:0 14px;font-size:15px;margin-top:6px}
.bsearch span{opacity:.7}
.feed{flex:1;overflow:hidden;padding:10px 10px 0;display:flex;flex-direction:column;gap:10px;position:relative}
.slab{background:var(--slab);border-radius:26px;padding:14px 14px 8px;flex:none}
.ph{display:flex;align-items:center;gap:10px}
.ph .nm{flex:1;min-width:0;line-height:1.25}
.ph .nm b{font-size:15px;display:block}
.ph .nm span{font-size:12.5px;color:var(--text2)}
.ph .more{color:var(--text2)}
.kind{height:24px;padding:0 10px;border-radius:8px;font-size:11.5px;font-weight:800;letter-spacing:.03em;display:inline-flex;align-items:center;gap:4px}
.kind.poll{background:var(--pc);color:var(--onpc)}
.pq{font-size:19px;font-weight:850;font-weight:800;letter-spacing:-.02em;line-height:1.3;margin:10px 0 8px}
.po{position:relative;height:46px;border-radius:14px;background:var(--inner);display:flex;align-items:center;padding:0 14px;font-size:15px;font-weight:600;overflow:hidden;margin-top:6px;gap:8px}
.po i{position:absolute;left:0;top:0;bottom:0;background:var(--pc);opacity:.32}
.po i.win{opacity:.55}
.po span,.po b,.po .ic{position:relative}
.po span{flex:1}
.po.me{box-shadow:inset 0 0 0 2px var(--text)}
.po .rad{width:20px;height:20px;border-radius:50%;border:2px solid var(--div2);position:relative}
.pmeta{font-size:12.5px;color:var(--text2);margin-top:9px;display:flex;gap:6px;align-items:center}
.acts{display:flex;justify-content:space-between;align-items:center;padding:10px 4px 4px;color:var(--text2);font-size:13px;font-weight:600}
.acts div{display:flex;align-items:center;gap:5px}
.acts .liked{color:#e0245e}.acts .zapped{color:var(--sel2)}
.tx{font-size:15.5px;line-height:1.5;margin-top:8px}
.tx .h{color:var(--sec);font-weight:700}
.tx .m{font-weight:700;color:var(--text);box-shadow:inset 0 -2px 0 var(--sel)}
.pimg{height:180px;border-radius:18px;margin-top:10px;position:relative;overflow:hidden}
.navwrap{position:absolute;left:0;right:0;bottom:26px;display:flex;align-items:center;justify-content:center;gap:10px;z-index:10}
.nav{display:flex;gap:2px;background:var(--navbg);border-radius:26px;padding:6px;box-shadow:0 16px 34px -12px rgba(0,0,0,.55)}
.cbx.dark .nav{box-shadow:0 0 0 1px rgba(255,255,255,.08)}
.nav div{width:52px;height:50px;border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:#9b9b9b;font-size:10px;font-weight:700;position:relative}
.nav div.on{background:var(--acc);color:#111}
.nav .nb{position:absolute;top:5px;right:10px;width:8px;height:8px;border-radius:50%;background:var(--acc)}
.fab{width:62px;height:62px;border-radius:22px;background:var(--blk);color:var(--onblk);display:flex;align-items:center;justify-content:center;box-shadow:0 16px 30px -12px rgba(0,0,0,.5)}
.cbx.dark .fab{box-shadow:0 0 0 1px rgba(255,255,255,.1)}
.fade{position:absolute;left:0;right:0;bottom:0;height:150px;background:linear-gradient(rgba(0,0,0,0),var(--page) 70%);z-index:9;pointer-events:none}
.sec-t{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text2);padding:6px 8px 0}
.row{display:flex;align-items:center;gap:12px}
.lrow{display:flex;align-items:center;gap:12px;padding:11px 4px}
.lrow+.lrow{border-top:1px solid var(--div)}
.lrow .t{flex:1;min-width:0}
.lrow .t b{font-size:15px;display:block}
.lrow .t span{font-size:13.5px;color:var(--text2);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lrow .t .ntx b{display:inline;font-size:inherit}
.lrow .tm{font-size:12px;color:var(--text2);align-self:flex-start;margin-top:3px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--sel)}
.ubadge{min-width:22px;height:22px;border-radius:11px;background:var(--sel);color:var(--onsel);font-size:11.5px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 6px}
.bub{max-width:76%;padding:11px 15px;border-radius:22px;font-size:15px;line-height:1.4}
.bub.me{align-self:flex-end;background:var(--blk);color:var(--onblk);border-bottom-right-radius:6px}
.bub.th{align-self:flex-start;background:var(--slab);border-bottom-left-radius:6px}
.bub small{display:block;font-size:11px;opacity:.65;margin-top:3px;text-align:right}
.inbar{position:absolute;left:10px;right:10px;bottom:28px;display:flex;gap:8px;align-items:center;z-index:10}
.inbar .f{flex:1;height:52px;border-radius:26px;background:var(--slab);display:flex;align-items:center;gap:10px;padding:0 16px;color:var(--text2);font-size:15px;box-shadow:0 8px 24px -12px rgba(0,0,0,.3)}
.cbx.dark .inbar .f{box-shadow:0 0 0 1px rgba(255,255,255,.08)}
.inbar .s{width:52px;height:52px;border-radius:18px;background:var(--blk);color:var(--onblk);display:flex;align-items:center;justify-content:center}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tile2{background:var(--slab);border-radius:24px;padding:14px;height:112px;display:flex;flex-direction:column;justify-content:space-between}
.tile2 .ico{width:42px;height:42px;border-radius:14px;background:var(--blk);color:var(--onblk);display:flex;align-items:center;justify-content:center}
.tile2 b{font-size:16px;display:block}
.tile2 span{font-size:12px;color:var(--text2)}
.chipr{display:flex;flex-wrap:wrap;gap:8px}
.chipr span{height:34px;padding:0 13px;border-radius:12px;background:var(--slab);display:flex;align-items:center;font-weight:700;font-size:14px;color:var(--sec)}
.tabs{display:flex;gap:6px;background:var(--slab);border-radius:18px;padding:5px}
.tabs span{flex:1;height:38px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:var(--text2)}
.tabs span.on{background:var(--text);color:var(--page)}
.nbadge{position:absolute;right:-3px;bottom:-3px;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2.5px var(--slab)}
.swatch{background:var(--slab);border-radius:18px;padding:8px;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11.5px;font-weight:700;position:relative}
.swatch .sw{width:100%;height:46px;border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.swatch.on{box-shadow:inset 0 0 0 2.5px var(--text)}
.swatch .ck{position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:var(--text);color:var(--page);display:flex;align-items:center;justify-content:center}
.seg3{display:flex;background:var(--slab);border-radius:18px;padding:5px;gap:4px}
.seg3 span{flex:1;height:40px;border-radius:14px;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:700;font-size:14px;color:var(--text2)}
.seg3 span.on{background:var(--text);color:var(--page)}
.mini{position:absolute;left:10px;right:10px;bottom:104px;height:62px;border-radius:22px;background:var(--navbg);color:#fff;display:flex;align-items:center;gap:12px;padding:0 10px;z-index:10;overflow:hidden}
.mini .pr{position:absolute;left:0;bottom:0;height:3px;background:var(--acc)}
.cbx.dark .mini{box-shadow:0 0 0 1px rgba(255,255,255,.08)}
.art{border-radius:14px;position:relative;overflow:hidden;flex:none}
"""

def lum(h): return S._lum(h)
def on(h): return S.on(h)

def theme(dark, preset=None, palette=None, ctx='note'):
    """CSS custom properties for a device. ctx picks which palette color owns the block."""
    if palette:
        _, L, D = palette
        c1, c2, c3 = D if dark else L
        d1, d2, d3 = D
        blk = c2 if ctx == 'poll' else c1
        acc = d2 if ctx == 'poll' else d1
        nc, pc, sel, sec, sel2 = c1, c2, c3, (d3 if dark else c3), d3
    else:
        _, lp, dp, ls, ds = preset
        blk = dp if dark else lp
        acc = dp
        nc = pc = sel = blk
        sec = ds if dark else ls
        sel2 = ds
    v = dict(pri=blk, blk=blk, onblk=on(blk), acc=acc, nc=nc, onnc=on(nc), pc=pc, onpc=on(pc),
             sel=sel, onsel=on(sel), sec=sec, onsec=on(sec), sel2=sel2)
    v['pri-tint'] = blk + '26'; v['pri-tint2'] = blk + '4d'
    return ';'.join(f'--{k}:{x}' for k, x in v.items())

GOLD = S.PRESETS[0]

def dev(inner, dark, vars_):
    d = B.device(inner, dark)
    return d.replace('<div class="device', f'<div style="{vars_}" class="device cbx st-block', 1)

def css():
    return S.css() + APP_CSS

def page(body):
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{css()}</style></head><body>{body}</body></html>'

# ---------------------------------------------------------------- pieces
def topbar(title=None, back=False, avatar=True, icons=('SearchRounded', 'NotificationsRounded', 'MailRounded'), badges=None, sm=False, lead_extra=''):
    badges = badges or {'NotificationsRounded': 5, 'MailRounded': 2}
    lead = f'<div class="ib">{ic("ArrowBackRounded",24)}</div>' if back else (f'<div class="av sm" style="margin-right:6px"></div>' if avatar else '')
    t = f'<div class="ttl{" sm" if sm else ""}">{title or ""}</div>' if title is not None else '<div style="flex:1"></div>'
    ib = ''.join(f'<div class="ib">{ic(i,23)}{f"<span class=bd>{badges[i]}</span>" if i in badges else ""}</div>' for i in icons)
    return f'<div class="tb">{lead}{lead_extra}{t}{ib}</div>'

def pills(labels, sel=0):
    return '<div class="bp">' + ''.join(f'<span class="{"on" if i==sel else ""}">{l}</span>' for i, l in enumerate(labels)) + '</div>'

def nav(active=1):
    items = [('HomeRounded', 'Home'), ('PollRounded', 'Polls'), ('ArticleRounded', 'Notes'), ('ExploreRounded', 'Explore'), ('BookmarkRounded', 'Saved')]
    n = ''.join(f'<div class="{"on" if i==active else ""}">{ic(a,22)}{b}</div>' for i, (a, b) in enumerate(items))
    return f'<div class="fade"></div><div class="navwrap"><div class="nav">{n}</div><div class="fab">{ic("AddRounded",30)}</div></div>'

def head(name, handle, time, hue='', kind=None):
    k = f'<span class="kind poll">{ic("PollRounded",13)}POLL</span>' if kind == 'poll' else ''
    return f'<div class="ph"><div class="av {hue}"></div><div class="nm"><b>{name}</b><span>{handle} · {time}</span></div>{k}<div class="more">{ic("MoreVertRounded",20)}</div></div>'

def actions(c=(48, 9, 102, '880'), liked=False, zapped=False):
    return (f'<div class="acts"><div>{ic("ChatBubbleOutlineRounded",18)}{c[0]}</div><div>{ic("RepeatRounded",19)}{c[1]}</div>'
            f'<div class="{"liked" if liked else ""}">{ic("FavoriteRounded" if liked else "FavoriteBorderRounded",18)}{c[2]}</div>'
            f'<div class="{"zapped" if zapped else ""}">{ic("BoltRounded",19)}{c[3]}</div><div>{ic("BookmarkBorderRounded",19)}</div><div>{ic("ShareRounded",17)}</div></div>')

def poll_card(voted=True, q='Best way to start a Sunday? ☕', opts=(('Long walk by the sea', 31), ('Slow coffee', 44), ('Back to bed', 25)), me=1, who=('Mira Okafor', '@mira', '2h', 'g'), meta='1,284 votes · 2 days left'):
    rows = ''
    mx = max(p for _, p in opts)
    for i, (t, p) in enumerate(opts):
        if voted:
            rows += (f'<div class="po{" me" if i==me else ""}"><i class="{"win" if p==mx else ""}" style="width:{p}%"></i><span>{t}</span>'
                     f'{ic("CheckCircleRounded",18) if i==me else ""}<b>{p}%</b></div>')
        else:
            rows += f'<div class="po"><span>{t}</span><div class="rad"></div></div>'
    return (f'<div class="slab">{head(*who, kind="poll")}<div class="pq">{q}</div>{rows}'
            f'<div class="pmeta">{ic("HowToVoteRounded",15)}{meta}</div>{actions()}</div>')

def note_card(text, who=('Sam Rivera', '@sam', '1h', 'r'), img=None, c=(12, 4, 31, '2.1k'), liked=True, zapped=False):
    im = f'<div class="pimg {img}"></div>' if img else ''
    return f'<div class="slab">{head(*who)}<div class="tx">{text}</div>{im}{actions(c, liked, zapped)}</div>'

# ---------------------------------------------------------------- screens
def s_polls():
    return ('<div class="blk">' + topbar('Polls') + pills(['Global', 'Following', 'Web of Trust']) + '</div>'
            '<div class="feed">' + poll_card() +
            poll_card(False, 'Which relay setup do you run?', (('Just the defaults', 0), ('Self-hosted', 0), ('Paid relay', 0)), who=('devon.lee', '@devon', '5h', 'b'), meta='311 votes · 6 hours left') +
            '</div>' + nav(1))

def s_home():
    return ('<div class="blk">' + topbar('Home') + pills(['Following', 'Network']) + '</div>'
            '<div class="feed">' +
            note_card('Shipped the new local relay today. Offline-first feels <span class="m">@Mira</span> so good. <span class="h">#nostr</span>', img='img2') +
            poll_card(False, 'Tabs or spaces?', (('Tabs', 0), ('Spaces', 0)), who=('Ana', '@ana', '3h', 'p'), meta='88 votes · 1 day left') +
            '</div>' + nav(0))

def s_poll_detail():
    blk = ('<div class="blk">' + topbar('', back=True, icons=('ShareRounded', 'MoreVertRounded'), badges={}) +
           '<div class="ph" style="margin-top:2px"><div class="av g"></div><div class="nm"><b>Mira Okafor</b><span style="color:inherit;opacity:.7">@mira · 2h</span></div></div>'
           '<div style="font-size:27px;font-weight:900;letter-spacing:-.03em;line-height:1.18;margin:12px 0 10px">Best way to start a Sunday? ☕</div>'
           '<div class="bp"><span>' + ic("HowToVoteRounded",16) + '&nbsp;1,284 votes</span><span>' + ic("ScheduleRounded",16) + '&nbsp;2 days left</span><span>Pick one</span></div></div>')
    opts = (('Long walk by the sea', 31, 398), ('Slow coffee', 44, 565), ('Back to bed', 25, 321))
    rows = ''.join(f'<div class="po{" me" if i==1 else ""}" style="height:54px;margin-top:8px"><i class="{"win" if p==44 else ""}" style="width:{p}%"></i><span>{t}<br><small style="font-weight:500;color:var(--text2);font-size:12px">{n} votes</small></span>{ic("CheckCircleRounded",18) if i==1 else ""}<b style="font-size:17px">{p}%</b></div>' for i, (t, p, n) in enumerate(opts))
    body = ('<div class="feed">' + f'<div class="slab" style="padding:12px 14px 14px"><div class="row" style="justify-content:space-between"><b style="font-size:15px">Results</b><span style="font-size:13px;color:var(--text2)">You voted · Slow coffee</span></div>{rows}</div>'
            + '<div class="tabs"><span class="on">Comments · 48</span><span>Voters</span><span>Zaps</span></div>'
            + note_card('Coffee, obviously. Then the walk. 🌊', who=('Sam Rivera', '@sam', '1h', 'r'), c=(2, 0, 14, '21'), liked=False) + '</div>'
            + '<div class="inbar"><div class="f">' + ic("ChatBubbleOutlineRounded",19) + 'Add a comment…</div><div class="s">' + ic("SendRounded",22) + '</div></div><div class="fade" style="height:110px"></div>')
    return blk + body

def s_thread():
    blk = ('<div class="blk">' + topbar('Post', back=True, icons=('MoreVertRounded',), badges={}, sm=True) +
           '<div class="ph"><div class="av r"></div><div class="nm"><b>Sam Rivera</b><span style="color:inherit;opacity:.7">sam@nostr.example · 1h</span></div></div>'
           '<div style="font-size:20px;line-height:1.45;margin:12px 0 4px;font-weight:500">Shipped the new local relay today. Offline-first feels so good. <u style="text-decoration-thickness:2px;font-weight:800">#nostr</u></div>'
           '<div class="pimg img2" style="height:150px"></div>'
           '<div class="row" style="gap:16px;margin-top:12px;font-size:13.5px"><span><b>31</b> likes</span><span><b>4</b> reposts</span><span><b>2.1k</b> sats</span></div>'
           '<div class="row" style="justify-content:space-between;margin-top:12px;padding:0 6px">' + ''.join(ic(i, 22) for i in ("ChatBubbleOutlineRounded", "RepeatRounded", "FavoriteRounded", "BoltRounded", "BookmarkBorderRounded", "ShareRounded")) + '</div></div>')
    body = ('<div class="feed">' + '<div class="sec-t">Replies · 12</div>'
            + note_card('Congrats! Does it sync DMs too?', who=('Ana', '@ana', '50m', 'p'), c=(1, 0, 3, '0'), liked=False)
            + note_card('Yes — NIP-17 DMs are cached locally now.', who=('Sam Rivera', '@sam', '42m', 'r'), c=(0, 0, 5, '21'), liked=False) + '</div>'
            + '<div class="inbar"><div class="f">' + ic("ReplyRounded",19) + 'Reply to Sam…</div><div class="s">' + ic("SendRounded",22) + '</div></div><div class="fade" style="height:110px"></div>')
    return blk + body

def s_profile():
    blk = ('<div class="blk" style="padding-bottom:20px">' + topbar('', back=True, icons=('SearchRounded', 'MoreVertRounded'), badges={}) +
           '<div class="row" style="align-items:flex-end;gap:14px"><div class="av g" style="width:78px;height:78px;box-shadow:0 0 0 4px var(--onblk)"></div>'
           '<div style="flex:1"></div><div class="tb" style="height:auto;gap:8px"><div class="ib" style="background:rgba(0,0,0,.13)">' + ic("MailRounded",20) + '</div><div class="ib" style="background:rgba(0,0,0,.13)">' + ic("BoltRounded",20) + '</div></div>'
           '<div class="btn" style="background:var(--onblk);color:var(--blk)">Follow</div></div>'
           '<div style="font-size:28px;font-weight:900;letter-spacing:-.03em;margin-top:12px">Mira Okafor</div>'
           '<div style="font-size:13.5px;opacity:.75;display:flex;gap:4px;align-items:center">' + ic("VerifiedRounded",15) + 'mira@nostr.example</div>'
           '<div style="font-size:15px;line-height:1.45;margin-top:8px">Designer & tinkerer. Polls, pour-overs, and open protocols.</div>'
           '<div class="row" style="gap:18px;margin-top:10px;font-size:14px"><span><b>312</b> following</span><span><b>1.2k</b> followers</span><span style="opacity:.75">Followed by Sam, Ana</span></div></div>')
    body = ('<div class="feed"><div class="tabs"><span>Notes</span><span class="on">Polls</span><span>Articles</span><span>Ratings</span></div>'
            + poll_card(who=('Mira Okafor', '@mira', '2h', 'g')) + '</div>' + nav(-1))
    return blk + body

def s_messages():
    rows = [('g', 'Mira Okafor', 'Coffee won, obviously ☕', '9:41', 2), ('b', 'devon.lee', 'You: sent the relay list', '9:02', 0),
            ('p', 'Ana', 'see you at the meetup!', 'Tue', 1), ('r', 'Sam Rivera', 'NIP-17 is live 🎉', 'Mon', 0), ('', 'Formstr team', 'Release notes for 1.18', 'Sep 30', 0)]
    li = ''.join(f'<div class="lrow"><div class="av {h}" style="width:48px;height:48px"></div><div class="t"><b>{n}</b><span>{m}</span></div>'
                 f'<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><span class="tm" style="margin:0">{t}</span>{f"<span class=ubadge>{u}</span>" if u else ""}</div></div>' for h, n, m, t, u in rows)
    return ('<div class="blk">' + topbar('Messages', icons=('EditRounded',), badges={}) + f'<div class="bsearch">{ic("SearchRounded",20)}<span>Search people & messages</span></div></div>'
            f'<div class="feed"><div class="slab" style="padding:4px 14px">{li}</div></div>' + nav(-1))

def s_chat():
    blk = ('<div class="blk" style="padding-bottom:14px"><div class="tb">' f'<div class="ib">{ic("ArrowBackRounded",24)}</div><div class="av g" style="width:38px;height:38px;margin:0 10px 0 2px"></div>'
           '<div style="flex:1;line-height:1.2"><b style="font-size:17px">Mira Okafor</b><div style="font-size:12.5px;opacity:.75">mira@nostr.example</div></div>'
           f'<div class="ib">{ic("MoreVertRounded",22)}</div></div></div>')
    msgs = ('<div style="align-self:center;font-size:12px;color:var(--text2);font-weight:700;margin:4px 0">Today</div>'
            '<div class="bub th">Did you see the poll results?<small>9:30</small></div>'
            '<div class="bub me">Coffee won, obviously ☕<small>9:31</small></div>'
            '<div class="bub th">Shocking. I voted walk. Want to do a rematch poll next week?<small>9:33</small></div>'
            '<div class="bub me">Deal. Ranked choice this time 😄<small>9:41 ✓✓</small></div>')
    return blk + f'<div class="feed" style="gap:8px;padding:12px 14px">{msgs}</div><div class="inbar"><div class="f">{ic("EmojiEmotionsRounded",21)}<span style="flex:1">Message</span>{ic("AddPhotoAlternateRounded",21)}</div><div class="s">{ic("SendRounded",22)}</div></div>'

def s_notifs():
    def n(h, icon, bg, txt, sub, t, unread=False):
        return (f'<div class="lrow"><div style="position:relative"><div class="av {h}" style="width:46px;height:46px"></div><div class="nbadge" style="background:{bg};color:#fff">{ic(icon,12)}</div></div>'
                f'<div class="t"><span class="ntx" style="color:var(--text);white-space:normal;font-size:14.5px;line-height:1.35">{txt}</span><span style="margin-top:2px">{sub}</span></div>'
                f'<div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;align-self:flex-start"><span class="tm" style="margin:2px 0 0">{t}</span>{"<i class=dot></i>" if unread else ""}</div></div>')
    today = (n('g', 'HowToVoteRounded', 'var(--pc)', '<b>Mira</b> and <b>23 others</b> voted on your poll', '“Best way to start a Sunday?”', '2m', True)
             + n('r', 'BoltRounded', '#e8a317', '<b>Sam</b> zapped you <b>2,100 sats</b>', '“Shipped the new local relay…”', '1h', True)
             + n('p', 'AlternateEmailRounded', 'var(--sec)', '<b>Ana</b> mentioned you', '“…ask @abhay, he knows relays”', '3h'))
    earlier = (n('b', 'FavoriteRounded', '#e0245e', '<b>devon.lee</b> liked your note', '“Morning light on the harbor.”', 'Mon')
               + n('', 'PersonAddRounded', '#2e7d32', '<b>Formstr team</b> followed you', 'Followed by 12 people you follow', 'Sun'))
    return ('<div class="blk">' + topbar('Notifications', icons=('DoneAllRounded',), badges={}) + pills(['All', 'Mentions', 'Votes', 'Zaps']) + '</div>'
            f'<div class="feed"><div class="sec-t">Today</div><div class="slab" style="padding:4px 14px">{today}</div>'
            f'<div class="sec-t">Earlier</div><div class="slab" style="padding:4px 14px">{earlier}</div></div>' + nav(-1))

def s_explore():
    tiles = [('TagRounded', 'Topics', '#hashtags & interests'), ('MenuBookRounded', 'Articles', 'Long reads'), ('MusicNoteRounded', 'Music', 'Now playing'),
             ('MovieRounded', 'Movies', 'Rate & review'), ('GroupsRounded', 'Packs', '3 new packs'), ('SportsEsportsRounded', 'Games', '2048 · Tetris · Racer')]
    t = ''.join(f'<div class="tile2"><div class="ico">{ic(a,22)}</div><div><b>{b}</b><span>{c}</span></div></div>' for a, b, c in tiles)
    chips = ''.join(f'<span>#{x}</span>' for x in ['nostr', 'coffee', 'photography', 'bitcoin', 'foss', 'music'])
    return ('<div class="blk">' + topbar('Explore') + f'<div class="bsearch">{ic("SearchRounded",20)}<span>Search Pollerama</span></div></div>'
            f'<div class="feed"><div class="tiles">{t}</div><div class="sec-t">Trending</div><div class="chipr">{chips}</div></div>' + nav(3))

def s_music():
    arts = ''.join(f'<div style="flex:none;width:112px"><div class="art {c}" style="width:112px;height:112px;border-radius:22px"></div><b style="font-size:13.5px;display:block;margin-top:6px">{n}</b><span style="font-size:12px;color:var(--text2)">{k}</span></div>'
                   for c, n, k in [('img1', 'Focus', '24 tracks'), ('img2', 'Rainy day', '18 tracks'), ('img3', 'Road trip', '31 tracks')])
    tr = ''.join(f'<div class="lrow"><div class="art {c}" style="width:50px;height:50px"></div><div class="t"><b>{a}</b><span>{b}</span></div>{ic("MoreVertRounded",20,"var(--text2)")}</div>'
                 for c, a, b in [('img1', 'Static Bloom', 'Lunar Tides'), ('img2', 'Paper Boats', 'Odd Hours'), ('img3', 'Harbor Lights', 'Mira & Co')])
    mini = (f'<div class="mini"><div class="art img1" style="width:44px;height:44px;border-radius:12px"></div><div style="flex:1;line-height:1.25"><b style="font-size:14.5px">Static Bloom</b><div style="font-size:12px;opacity:.65">Lunar Tides</div></div>'
            f'{ic("SkipPreviousRounded",26)}<div style="width:42px;height:42px;border-radius:14px;background:var(--acc);color:#111;display:flex;align-items:center;justify-content:center">{ic("PauseRounded",26)}</div>{ic("SkipNextRounded",26)}<div class="pr" style="width:38%"></div></div>')
    return ('<div class="blk">' + topbar('Music', back=True, icons=('SearchRounded', 'LibraryMusicRounded'), badges={}) + pills(['Discover', 'Following', 'Local']) + '</div>'
            f'<div class="feed"><div class="sec-t">Playlists</div><div style="display:flex;gap:10px;padding:0 4px">{arts}</div><div class="sec-t">New tracks</div><div class="slab" style="padding:4px 14px">{tr}</div></div>' + mini + nav(3))

def s_appearance(dark):
    def sw(p, sel):
        c = p[2] if dark else p[1]
        return (f'<div class="swatch{" on" if sel else ""}"><div class="sw" style="background:{c}"></div>{p[0]}'
                f'{"<span class=ck>" + ic("CheckRounded",14) + "</span>" if sel else ""}</div>')
    pres = ''.join(sw(p, i == 0) for i, p in enumerate(S.PRESETS))
    pals = ''.join(f'<div class="swatch"><div class="sw">' + ''.join(f'<i style="flex:1;background:{c}"></i>' for c in (p[2] if dark else p[1])) + f'</div>{p[0]}</div>' for p in S.PALETTES)
    pals += f'<div class="swatch"><div class="sw" style="background:var(--inner);align-items:center;justify-content:center">{ic("AddRounded",22,"var(--text2)")}</div>Custom</div>'
    fonts = ''.join(f'<span class="{"on" if i==0 else ""}" style="{f}">{n}</span>' for i, (n, f) in enumerate([('System', ''), ('Pollerama', 'font-family:Shantell Sans'), ('Fredoka', ''), ('Raleway', '')]))
    return ('<div class="blk">' + topbar('Appearance', back=True, icons=(), badges={}) +
            '<div style="font-size:14.5px;opacity:.8;margin:2px 4px 2px">Your theme paints this block, buttons and highlights across the app.</div></div>'
            f'<div class="feed" style="gap:8px"><div class="sec-t">Mode</div><div class="seg3"><span>{ic("BrightnessAutoRounded",18)}System</span><span class="{"" if dark else "on"}">{ic("LightModeRounded",18)}Light</span><span class="{"on" if dark else ""}">{ic("DarkModeRounded",18)}Dark</span></div>'
            f'<div class="sec-t">Single color</div><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">{pres}</div>'
            f'<div class="sec-t">Palettes <span class="kind poll" style="margin-left:6px;height:20px;font-size:10px">NEW</span></div><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">{pals}</div>'
            f'<div class="sec-t">Font</div><div class="seg3">{fonts}</div></div>')

SCREENS = [
    ('01-polls-feed', 'Polls feed', s_polls, 'poll', 'The block holds the feed name and its sub-feeds (the existing sub-modes, now always visible). Polls are slabs: question first, options as rows, results fill with the poll color. Bottom: floating ink nav (Home, Polls, Notes, Explore, Saved) plus a Create button in the block color.'),
    ('02-home-feed', 'Home feed', s_home, 'note', 'Mixed feed. Notes and polls share the slab and action row. Polls carry a POLL tag in the poll color, so in multi-color palettes each content type keeps its own color.'),
    ('03-poll-detail', 'Poll detail & results', s_poll_detail, 'poll', 'The poll in focus moves into the block: big question, vote count, time left, answer type. Results are a slab with per-option counts and your choice ringed. Comments / Voters / Zaps tabs, and a floating comment bar.'),
    ('04-thread', 'Note thread', s_thread, 'note', 'The root note lives in the block with its stats and actions. Replies are slabs underneath, with a floating reply bar.'),
    ('05-profile', 'Profile', s_profile, 'note', 'The person is the block: big avatar, name, NIP-05, bio, counts, Follow / DM / Zap. Content tabs are an ink segmented control, with feeds below.'),
    ('06-messages', 'Messages', s_messages, 'note', 'Search lives in the block. Conversations are one slab with dividers, and unread counts use the selection color.'),
    ('07-chat', 'Chat', s_chat, 'note', 'Compact block with the contact. My bubbles are the block color and theirs are slabs. Floating composer with emoji, attach and send.'),
    ('08-notifications', 'Notifications', s_notifs, 'note', 'Filters in the block. Grouped by Today / Earlier. The type badge on each avatar (vote, zap, mention, like, follow) makes the list scannable, and unread items get a dot.'),
    ('09-explore', 'Explore', s_explore, 'note', 'Hub for the secondary feeds (Topics, Articles, Music, Movies, Packs, Games), with search and trending hashtags. Each tile\'s icon sits on the block color.'),
    ('10-music', 'Music', s_music, 'note', 'Sub-feeds in the block, playlists as big art tiles, tracks in a slab. The mini player is an ink capsule docked above the nav.'),
]

def board(name, title, fn, ctx, lede):
    sc = .86
    w, h = int(414*sc), int(868*sc)
    def cell(dark, label):
        inner = fn() if fn is not s_appearance else fn(dark)
        d = dev(inner, dark, theme(dark, GOLD, ctx=ctx))
        return (f'<div style="display:flex;flex-direction:column;align-items:center;gap:12px"><div style="width:{w}px;height:{h}px"><div style="transform:scale({sc});transform-origin:top left;width:414px">{d}</div></div>'
                f'<b style="font-size:14px;color:#4d493f">{label}</b></div>')
    body = (f'<div style="display:flex;gap:48px;padding:44px 52px;width:1360px;align-items:flex-start">{cell(False,"Light · Golden")}{cell(True,"Dark · Golden")}'
            f'<div class="legend" style="padding-top:10px"><div class="kicker">Color Block · app</div><h1>{title}</h1><p class="lede">{lede}</p></div></div>')
    B.render_to(os.path.join(OUT, name + '.png'), page(body), 1360, h + 140)

def overview(items, name, title, lede, cols=6, sc=.5):
    w, h = int(414*sc), int(868*sc)
    cells = ''.join(f'<div style="display:flex;flex-direction:column;align-items:center;gap:10px"><div style="width:{w}px;height:{h}px"><div style="transform:scale({sc});transform-origin:top left;width:414px">{d}</div></div><b style="font-size:13px">{t}</b></div>' for t, d in items)
    W = 112 + cols*(w+18)
    rows = (len(items)+cols-1)//cols
    body = (f'<div style="padding:44px 56px;width:{W}px"><div class="legend" style="margin-bottom:24px"><div class="kicker">Color Block · app</div><h1>{title}</h1><p class="lede" style="max-width:1400px">{lede}</p></div>'
            f'<div style="display:grid;grid-template-columns:repeat({cols},{w}px);gap:26px 18px">{cells}</div></div>')
    B.render_to(os.path.join(OUT, name + '.png'), page(body), W, 220 + rows*(h+44))

if __name__ == '__main__':
    for args in SCREENS:
        board(*args)
    board('11-appearance', 'Settings → Appearance', s_appearance, 'note',
          'Mode stays System / Light / Dark. Color is chosen like mode: 8 single-color presets (as today) plus new 3-color palettes, where notes, polls and highlights each get their own color. Custom stays. Fonts are unchanged.')
    allsc = [(t, fn) for _, t, fn, *_ in SCREENS]
    ctx = {t: c for _, t, _, c, _ in SCREENS}
    items = [(t + ' · light', dev(fn(), False, theme(False, GOLD, ctx=ctx[t]))) for t, fn in allsc]
    items += [('Appearance · light', dev(s_appearance(False), False, theme(False, GOLD)))]
    items += [(t + ' · dark', dev(fn(), True, theme(True, GOLD, ctx=ctx[t]))) for t, fn in allsc]
    items += [('Appearance · dark', dev(s_appearance(True), True, theme(True, GOLD)))]
    overview(items, '00-overview', 'Every screen, light & dark',
             'Golden preset. The block always holds whatever is in focus. Content sits on slabs. The ink nav dock and the block-colored Create button are shared by every top-level screen.', cols=11, sc=.42)
    # presets
    pi = [(p[0], dev(s_polls(), False, theme(False, p, ctx='poll'))) for p in S.PRESETS] + \
         [(p[0] + ' · dark', dev(s_home(), True, theme(True, p, ctx='note'))) for p in S.PRESETS]
    overview(pi, '12-presets', 'Single-color presets', 'All 8 existing presets, each in light (Polls) and dark (Home). Text on the block flips between ink and white for contrast.', cols=8, sc=.46)
    # palettes
    pa = []
    for p in S.PALETTES:
        pa += [(f'{p[0]} · Home', dev(s_home(), False, theme(False, palette=p, ctx='note'))),
               (f'{p[0]} · Polls', dev(s_polls(), False, theme(False, palette=p, ctx='poll'))),
               (f'{p[0]} · Poll detail', dev(s_poll_detail(), False, theme(False, palette=p, ctx='poll'))),
               (f'{p[0]} · Home dark', dev(s_home(), True, theme(True, palette=p, ctx='note'))),
               (f'{p[0]} · Polls dark', dev(s_polls(), True, theme(True, palette=p, ctx='poll'))),
               (f'{p[0]} · Chat dark', dev(s_chat(), True, theme(True, palette=p, ctx='note')))]
    overview(pa, '13-palettes', 'Multi-color palettes', 'Color 1 owns notes and general screens, color 2 owns polls, and color 3 is for selection, unread and hashtags. Polls in a mixed feed keep their own color via the POLL tag and result fills.', cols=6, sc=.46)
