"""
Builds the composer mockups: HTML -> PNG via headless Chrome.

    python3 designs/composer/src/build.py

Output: designs/composer/*.png  (annotated screens, dark-mode screens, desktop, overview)
Each screen is plain HTML/CSS using the Golden preset tokens from src/styles/themes.ts
and real @mui/icons-material (Rounded) paths, so values can be lifted straight into code.
"""
import os, subprocess, sys, html
sys.path.insert(0, os.path.dirname(__file__))
from icons import ic

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..'))
TMP = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'pollerama-composer-mockups')
os.makedirs(TMP, exist_ok=True)
CHROME = os.environ.get('CHROME', 'google-chrome')

# ---------------------------------------------------------------- styles
CSS = r"""
/* floating tool dock: one capsule of tools + a separate round preview button */
.tray{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 14px 12px;flex:none;position:relative}
.tools{display:flex;gap:2px;padding:4px;border-radius:999px;background:var(--surface);border:1px solid var(--div);box-shadow:0 6px 20px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.05)}
.tool{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--sec);flex:none}
.tool span{display:none}
.tool.on-warn{background:var(--warn-tint);color:var(--warn)}
.tool.pv{width:50px;height:50px;background:var(--text);color:var(--bg);box-shadow:0 6px 20px rgba(0,0,0,.15)}
.tool.pv.on{background:var(--pri);color:var(--onpri)}
.dark .tools{background:#1a1a1a}
.draft{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;color:var(--text2)}
.draft::before{content:"·";margin-right:2px}

:root{
  /* Golden preset (src/styles/themes.ts) */
  --pri:#DAA520; --onpri:#1b1b1b; --sec:#B45309; --onsec:#fff;
  --bg:#f5f4f1; --surface:#ffffff; --field:#ffffff; --text:#1d1b16; --text2:#6b665c; --text3:#9a958a;
  --div:rgba(0,0,0,.10); --div2:rgba(0,0,0,.16);
  --pri-tint:rgba(218,165,32,.16); --pri-tint2:rgba(218,165,32,.30); --sec-tint:rgba(180,83,9,.10);
  --warn:#9a5b00; --warn-tint:#fff1d6; --err:#c62828; --err-tint:#fdecea; --ok:#2e7d32; --ok-tint:#e7f4e8;
  --kbd:#e3e1dc; --key:#fbfaf8; --key2:#cfccc5; --scrim:rgba(20,16,8,.42);
  --shadow:0 1px 2px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.06);
}
.dark{
  --pri:#FAD13F; --onpri:#1b1b1b; --sec:#F0A93B; --onsec:#1b1b1b;
  --bg:#000000; --surface:#121212; --field:#0b0b0b; --text:#f1efe9; --text2:#a7a296; --text3:#6f6b62;
  --div:rgba(255,255,255,.10); --div2:rgba(255,255,255,.18);
  --pri-tint:rgba(250,209,63,.14); --pri-tint2:rgba(250,209,63,.28); --sec-tint:rgba(240,169,59,.14);
  --warn:#ffc266; --warn-tint:rgba(255,179,71,.14); --err:#ff8a80; --err-tint:rgba(255,82,82,.14); --ok:#81c784; --ok-tint:rgba(129,199,132,.14);
  --kbd:#1b1b1b; --key:#2e2e2e; --key2:#232323; --scrim:rgba(0,0,0,.6);
  --shadow:0 0 0 1px rgba(255,255,255,.06);
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Noto Sans",system-ui,Roboto,sans-serif;-webkit-font-smoothing:antialiased;background:#e9e6df;color:#1d1b16}
.ic{display:block;flex:none}

/* ---------- board (phone + legend) ---------- */
.board{display:flex;gap:56px;padding:48px 56px;width:1240px;align-items:flex-start}
.board.solo{width:auto;padding:40px}
.legend{flex:1;padding-top:8px;color:#1d1b16}
.legend .kicker{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#a0761a}
.legend h1{font-size:30px;line-height:1.2;margin:6px 0 10px;font-weight:800}
.legend .lede{font-size:15.5px;line-height:1.55;color:#4d493f;margin-bottom:26px;max-width:620px}
.legend ol{list-style:none;display:flex;flex-direction:column;gap:16px}
.legend li{display:flex;gap:14px;align-items:flex-start}
.legend li .n{width:28px;height:28px;border-radius:50%;background:#1d1b16;color:#fff;font-weight:800;font-size:13.5px;display:flex;align-items:center;justify-content:center;flex:none;margin-top:1px}
.legend li b.t{font-size:15.5px;display:block;margin-bottom:3px}
.legend li span.d{font-size:14px;line-height:1.5;color:#55514a;display:block}
.tag{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.06em;padding:2px 7px;border-radius:6px;margin-left:8px;vertical-align:2px}
.tag.new{background:#1f8a4c;color:#fff}.tag.changed{background:#2f5fd0;color:#fff}.tag.same{background:#d9d5cc;color:#4d493f}
.pin{position:absolute;width:26px;height:26px;border-radius:50%;background:#1d1b16;color:#fff;font:800 13px "Noto Sans",sans-serif;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 3px #fff,0 2px 8px rgba(0,0,0,.35);z-index:99;pointer-events:none}

/* ---------- device ---------- */
.device{position:relative;width:414px;height:868px;border-radius:56px;background:#161513;padding:12px;box-shadow:0 30px 60px rgba(0,0,0,.18),0 0 0 1.5px #3a3833 inset;flex:none}
.screen{position:relative;width:390px;height:844px;border-radius:44px;overflow:hidden;background:var(--bg);color:var(--text);display:flex;flex-direction:column}
.status{height:44px;display:flex;align-items:center;justify-content:space-between;padding:0 30px 0 34px;font-weight:700;font-size:15px;flex:none}
.status .r{display:flex;gap:6px;align-items:center}
.punch{position:absolute;top:13px;left:50%;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:#000}
.gesture{height:22px;flex:none;display:flex;align-items:center;justify-content:center}
.gesture i{width:132px;height:5px;border-radius:3px;background:var(--text);opacity:.55}

/* ---------- composer chrome ---------- */
.appbar{height:60px;display:flex;align-items:center;padding:0 10px 0 6px;gap:4px;flex:none}
.iconbtn{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--text);position:relative;flex:none}
.iconbtn.tonal{background:var(--pri-tint)}
.badge{position:absolute;top:5px;right:4px;min-width:17px;height:17px;border-radius:9px;background:var(--pri);color:var(--onpri);font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 4px;box-shadow:0 0 0 2px var(--bg)}
.seg{display:flex;background:var(--surface);border:1px solid var(--div);border-radius:999px;padding:3px;margin:0 auto;box-shadow:var(--shadow)}
.seg div{height:34px;padding:0 14px;border-radius:999px;display:flex;align-items:center;gap:6px;font-size:14.5px;font-weight:600;color:var(--text2)}
.seg div.on{background:var(--pri);color:var(--onpri)}
.btn{height:40px;padding:0 20px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;gap:8px;font-weight:700;font-size:15px;flex:none;white-space:nowrap}
.btn.fill{background:var(--pri);color:var(--onpri)}
.btn.fill.dis{background:var(--div);color:var(--text3)}
.btn.sec{background:var(--sec);color:var(--onsec)}
.btn.out{border:1.5px solid var(--div2);color:var(--text)}
.btn.text{color:var(--sec);padding:0 12px}
.btn.tonal{background:var(--pri-tint);color:var(--text)}
.btn.lg{height:52px;font-size:16px;width:100%}

.content{flex:1;overflow:hidden;position:relative;display:flex;flex-direction:column}
.scroll{flex:1;overflow:hidden;padding:4px 16px 0}
.row{display:flex;align-items:center;gap:8px}
.av{width:40px;height:40px;border-radius:50%;flex:none;background:linear-gradient(135deg,#f0b357,#c46a2b);position:relative;overflow:hidden}
.av::after{content:"";position:absolute;left:50%;top:26%;width:38%;height:38%;margin-left:-19%;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 18px 0 6px rgba(255,255,255,.85)}
.av.sm{width:32px;height:32px}.av.xs{width:24px;height:24px}
.av.b{background:linear-gradient(135deg,#7cc7e8,#2d77b8)}.av.g{background:linear-gradient(135deg,#9ad48a,#3c8f4e)}.av.p{background:linear-gradient(135deg,#d6a0e6,#7b3fa3)}.av.r{background:linear-gradient(135deg,#f6a6a0,#c2443b)}

.editor{display:flex;gap:12px;padding-top:6px}
.editor .body{flex:1;min-width:0;padding-top:7px}
.who{font-size:13.5px;color:var(--text2);margin-bottom:4px;display:flex;align-items:center;gap:6px}
.who b{color:var(--text);font-size:14.5px}
.text{font-size:18px;line-height:1.5;color:var(--text);white-space:pre-wrap;word-wrap:break-word}
.ph{color:var(--text3)}
.caret{display:inline-block;width:2px;height:22px;background:var(--sec);vertical-align:-4px;margin-left:1px}
.mention{color:var(--sec);background:var(--sec-tint);border-radius:6px;padding:0 3px;font-weight:600}
.hash{color:var(--sec);font-weight:600}
.q{font-size:21px;line-height:1.4;font-weight:700}

.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{height:32px;padding:0 12px;border-radius:999px;border:1px solid var(--div2);display:inline-flex;align-items:center;gap:6px;font-size:13.5px;font-weight:600;color:var(--text);white-space:nowrap}
.chip.sm{height:28px;font-size:13px;padding:0 10px}
.chip.on{background:var(--pri);border-color:var(--pri);color:var(--onpri)}
.chip.secc{color:var(--sec);border-color:transparent;background:var(--sec-tint)}
.chip.warn{background:var(--warn-tint);border-color:transparent;color:var(--warn)}
.chip.tonal{background:var(--pri-tint);border-color:transparent}
.chip .x{opacity:.7;margin-right:-4px}
.meta{display:flex;gap:8px;flex-wrap:wrap;padding:14px 0 0 52px}
.label{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text2)}

.media{display:flex;gap:8px;padding:12px 0 0 52px}
.thumb{width:104px;height:104px;border-radius:16px;position:relative;overflow:hidden;flex:none}
.thumb .xb{position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:50%;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;color:#fff}
.thumb .alt{position:absolute;left:6px;bottom:6px;height:22px;padding:0 7px;border-radius:6px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center}
.ring{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);color:#fff;font-size:12px;font-weight:800}
.img1{background:linear-gradient(160deg,#ffd38a 0%,#f2994a 45%,#7a4b2a 100%)}
.img2{background:linear-gradient(200deg,#bfe3f5 0%,#5aa6d6 50%,#245a86 100%)}
.img3{background:linear-gradient(140deg,#d7f0c2 0%,#79b866 50%,#2f6b3a 100%)}
.img1::after,.img2::after,.img3::after{content:"";position:absolute;left:-10%;right:-10%;bottom:-30%;height:60%;background:rgba(0,0,0,.18);border-radius:50% 50% 0 0}

.hint{font-size:13px;color:var(--text2);display:flex;align-items:center;gap:6px}

/* toolbar above keyboard */
.toolbar{height:56px;display:flex;align-items:center;padding:0 6px 0 4px;border-top:1px solid var(--div);background:var(--bg);flex:none}
.toolbar .iconbtn{color:var(--sec);width:42px}
.toolbar .iconbtn.warnon{color:var(--warn);background:var(--warn-tint)}
.toolbar .sp{flex:1}
.saved{display:flex;align-items:center;gap:5px;font-size:12.5px;color:var(--text2);padding-right:6px}
.vr{width:1px;height:24px;background:var(--div2);margin:0 4px}

/* keyboard */
.kbd{background:var(--kbd);padding:6px 4px 4px;flex:none}
.sugg{height:38px;display:flex;align-items:center;justify-content:space-around;color:var(--text);font-size:15px;border-bottom:1px solid var(--div);margin:0 4px 6px}
.krow{display:flex;justify-content:center;gap:6px;margin-bottom:10px}
.key{height:44px;flex:0 0 32.5px;border-radius:7px;background:var(--key);display:flex;align-items:center;justify-content:center;font-size:19px;color:var(--text);box-shadow:0 1px 0 rgba(0,0,0,.18)}
.key.w{flex:0 0 46px;background:var(--key2);font-size:14px}
.key.space{flex:0 0 170px}
.key.ent{flex:0 0 72px;background:var(--pri);color:var(--onpri)}

/* option rows (poll) */
.opts{display:flex;flex-direction:column;gap:10px;padding:16px 0 0}
.opt{height:54px;border-radius:999px;border:1.5px solid var(--div2);background:var(--field);display:flex;align-items:center;padding:0 6px 0 4px;gap:2px;font-size:16px}
.opt .grip{color:var(--text3);width:30px;display:flex;justify-content:center}
.opt .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.opt .act{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--text2)}
.opt.focus{border:2px solid var(--pri);box-shadow:0 0 0 4px var(--pri-tint)}
.opt.err{border-color:var(--err)}
.opt .mini{width:34px;height:34px;border-radius:10px;flex:none;margin-right:6px;position:relative;overflow:hidden}
.opt .num{width:24px;height:24px;border-radius:50%;background:var(--pri-tint);color:var(--text);font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;margin-right:8px;flex:none}
.helper{font-size:12.5px;padding:4px 0 0 22px;color:var(--text2);display:flex;align-items:center;gap:5px}
.helper.err{color:var(--err)}
.addopt{height:50px;border-radius:999px;border:1.5px dashed var(--div2);display:flex;align-items:center;justify-content:center;gap:8px;font-weight:700;color:var(--sec);font-size:15px}

.card{background:var(--surface);border-radius:22px;box-shadow:var(--shadow);border:1px solid var(--div);overflow:hidden}
.srow{display:flex;align-items:center;gap:14px;padding:0 16px;height:64px}
.srow+.srow{border-top:1px solid var(--div)}
.srow .lic{width:38px;height:38px;border-radius:12px;background:var(--pri-tint);display:flex;align-items:center;justify-content:center;color:var(--text);flex:none}
.srow .tt{flex:1}
.srow .tt b{display:block;font-size:15.5px;font-weight:600}
.srow .tt span{font-size:13px;color:var(--text2)}
.srow .val{font-size:14.5px;color:var(--text2);font-weight:600;display:flex;align-items:center;gap:2px}

.tmpl{display:flex;gap:10px;overflow:hidden;padding:2px 0}
.tcard{flex:none;width:136px;border-radius:18px;background:var(--surface);border:1px solid var(--div);padding:12px;box-shadow:var(--shadow)}
.tcard .e{font-size:22px;line-height:1}
.tcard b{display:block;font-size:14px;margin-top:8px}
.tcard span{font-size:12px;color:var(--text2)}

/* sheets */
.scrim{position:absolute;inset:0;background:var(--scrim);z-index:20}
.sheet{position:absolute;left:0;right:0;bottom:0;z-index:21;background:var(--surface);border-radius:30px 30px 0 0;padding:10px 20px 18px;box-shadow:0 -10px 40px rgba(0,0,0,.2)}
.dark .sheet{background:#1a1a1a}
.handle{width:40px;height:5px;border-radius:3px;background:var(--div2);margin:0 auto 14px}
.sheet h2{font-size:21px;font-weight:800;margin-bottom:4px}
.sheet .sub{font-size:14px;color:var(--text2);line-height:1.45;margin-bottom:16px}
.choice{display:flex;align-items:center;gap:14px;padding:14px;border-radius:18px;border:1.5px solid var(--div);margin-bottom:10px}
.choice.on{border-color:var(--pri);background:var(--pri-tint)}
.choice.dis{opacity:.45}
.choice .lic{width:42px;height:42px;border-radius:14px;background:var(--pri-tint);display:flex;align-items:center;justify-content:center;flex:none}
.choice.on .lic{background:var(--pri);color:var(--onpri)}
.choice .tt{flex:1}
.choice .tt b{font-size:16px;display:block}
.choice .tt span{font-size:13.5px;color:var(--text2);line-height:1.4;display:block;margin-top:2px}
.radio{width:22px;height:22px;border-radius:50%;border:2px solid var(--div2);flex:none}
.choice.on .radio{border:7px solid var(--pri)}
.note{display:flex;gap:10px;padding:12px 14px;border-radius:16px;font-size:13.5px;line-height:1.45}
.note.warn{background:var(--warn-tint);color:var(--warn)}
.note.info{background:var(--pri-tint);color:var(--text)}
.note.ok{background:var(--ok-tint);color:var(--ok)}
.field{height:54px;border-radius:16px;border:1.5px solid var(--div2);display:flex;align-items:center;gap:10px;padding:0 14px;font-size:15.5px;background:var(--field)}
.field .lab{font-size:12px;color:var(--text2);display:block}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.grid5{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.tile{height:62px;border-radius:16px;border:1.5px solid var(--div2);display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:700;font-size:16px}
.tile small{font-size:11.5px;font-weight:600;color:var(--text2)}
.tile.on{background:var(--pri);border-color:var(--pri);color:var(--onpri)}
.tile.on small{color:var(--onpri);opacity:.75}

/* feed-style preview */
.post{display:flex;gap:12px;padding:14px 0}
.post .bd{flex:1;min-width:0}
.post .hd{font-size:14.5px;display:flex;gap:6px;align-items:center;margin-bottom:3px}
.post .hd span{color:var(--text2)}
.post .tx{font-size:16px;line-height:1.5}
.post .acts{display:flex;justify-content:space-between;padding:12px 30px 0 0;color:var(--text2);font-size:13px}
.post .acts div{display:flex;align-items:center;gap:6px}
.pimg{height:190px;border-radius:16px;margin-top:10px;position:relative;overflow:hidden}
.popt{height:48px;border-radius:999px;border:1.5px solid var(--div2);display:flex;align-items:center;padding:0 18px;font-size:15.5px;margin-top:8px}
.banner{display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:14px;background:var(--pri-tint);font-size:13.5px;margin:8px 0 4px}
.mentionpop{position:absolute;left:12px;right:12px;bottom:6px;background:var(--surface);border-radius:22px;box-shadow:0 12px 40px rgba(0,0,0,.18),0 0 0 1px var(--div);padding:6px;z-index:5}
.dark .mentionpop{background:#1a1a1a}
.mrow{display:flex;align-items:center;gap:12px;padding:9px 10px;border-radius:16px}
.mrow.on{background:var(--pri-tint)}
.mrow b{font-size:15px;display:block}
.mrow span{font-size:13px;color:var(--text2)}
.typo{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--div);font-size:15.5px}
.typo s{color:var(--err);text-decoration-thickness:2px}
.typo .to{color:var(--ok);font-weight:700}
.cb{width:22px;height:22px;border-radius:7px;background:var(--pri);color:var(--onpri);display:flex;align-items:center;justify-content:center;flex:none}
.cb.off{background:none;border:2px solid var(--div2)}
.slider{height:6px;border-radius:3px;background:var(--div2);position:relative;margin:22px 8px 10px}
.slider i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--sec)}
.slider b{position:absolute;top:50%;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;background:var(--sec);box-shadow:0 0 0 6px var(--sec-tint)}
.relay{display:flex;align-items:center;gap:10px;font-size:13.5px;padding:7px 0}
.relay .dot{width:8px;height:8px;border-radius:50%;background:var(--ok)}
.relay .dot.bad{background:var(--err)}
.mono{font-family:"DejaVu Sans Mono",monospace;font-size:12.5px}

/* desktop */
.desk{width:1280px;height:820px;position:relative;overflow:hidden;background:var(--bg);color:var(--text);border-radius:14px;box-shadow:0 30px 60px rgba(0,0,0,.18);flex:none}
.chrome{height:40px;background:#dedad2;display:flex;align-items:center;gap:8px;padding:0 16px}
.chrome i{width:12px;height:12px;border-radius:50%;background:#c9c4ba}
.chrome .url{margin-left:20px;height:26px;width:420px;border-radius:13px;background:#f5f3ee;font-size:12.5px;color:#6b665c;display:flex;align-items:center;padding:0 14px}
.dialog{position:absolute;left:50%;top:76px;width:1040px;margin-left:-520px;height:700px;background:var(--bg);border-radius:28px;z-index:21;box-shadow:0 30px 80px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden}
.kbdhint{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;color:var(--text2)}
.kbdhint kbd{font-family:inherit;font-size:11.5px;font-weight:700;border:1px solid var(--div2);border-bottom-width:2px;border-radius:6px;padding:1px 6px;background:var(--surface)}
"""

PIN_JS = r"""
<script>
window.addEventListener('load',()=>{
  document.querySelectorAll('[data-pin]').forEach(el=>{
    const host=el.closest('.device,.desk'); if(!host) return;
    const hr=host.getBoundingClientRect(), r=el.getBoundingClientRect();
    const side=el.dataset.side||'r';
    const p=document.createElement('div'); p.className='pin'; p.textContent=el.dataset.pin;
    let x = side==='l' ? r.left-hr.left-13 : side==='c' ? r.left-hr.left+r.width/2-13 : r.right-hr.left-13;
    let y = side==='b' ? r.bottom-hr.top-13 : r.top-hr.top-13;
    if(side==='b') x=r.left-hr.left+r.width/2-13;
    x+=+(el.dataset.dx||0); y+=+(el.dataset.dy||0);
    p.style.left=x+'px'; p.style.top=y+'px'; host.appendChild(p);
  });
});
</script>"""

def esc(s): return html.escape(s)

# ---------------------------------------------------------------- building blocks
def status():
    return f'''<div class="status"><span>9:41</span><div class="r">{ic("SignalCellularAltRounded",17)}{ic("WifiRounded",17)}{ic("Battery5BarRounded",18)}</div></div><div class="punch"></div>'''

def appbar(kind='note', post='Post', post_on=True, drafts=3, pins=(), back=False):
    P = dict(pins)
    def pin(k, side='r', dx=0, dy=0):
        return f' data-pin="{P[k]}" data-side="{side}" data-dx="{dx}" data-dy="{dy}"' if k in P else ''
    seg = f'''<div class="seg"{pin("seg","r",4,-4)}>
      <div class="{'on' if kind=='note' else ''}">{ic("EditNoteRounded",19)}Note</div>
      <div class="{'on' if kind=='poll' else ''}">{ic("PollRounded",18)}Poll</div></div>'''
    lead = ic("ArrowBackRounded",24) if back else ic("CloseRounded",24)
    return f'''<div class="appbar">
      <div class="iconbtn"{pin("close","r",-6,4)}>{lead}</div>
      {seg}
      <div class="iconbtn"{pin("drafts","r",-2,-6)}>{ic("DescriptionRounded",22)}{'<span class="badge">%d</span>'%drafts if drafts else ''}</div>
      <div class="btn fill{'' if post_on else ' dis'}"{pin("post","r",-6,-8)}>{post}</div>
    </div>'''

def toolbar(kind='note', expiry=False, preview=False, pins=()):
    """Floating tool tray: separate labeled pills above the keyboard, no full-width strip."""
    P = dict(pins)
    def pin(k, side='c', dx=0, dy=-12):
        return f' data-pin="{P[k]}" data-side="{side}" data-dx="{dx}" data-dy="{dy}"' if k in P else ''
    def tool(key, icon, label=None, cls=''):
        lab = f'<span>{label}</span>' if label else ''
        return f'<div class="tool{" round" if not label else ""} {cls}"{pin(key)}>{ic(icon,19)}{lab}</div>'
    b = [tool('attach','AddPhotoAlternateRounded','Media'),
         tool('emoji','EmojiEmotionsRounded'),
         tool('at','AlternateEmailRounded'),
         tool('hash','TagRounded')]
    if kind == 'note':
        b.append(tool('timer','TimerRounded','24h' if expiry else 'Expire','on-warn' if expiry else ''))
        b.append(tool('ai','AutoFixHighRounded','Proofread'))
    pv = f'<div class="tool round pv{" on" if preview else ""}"{pin("preview")}>{ic("VisibilityRounded",20)}</div>'
    return f'<div class="tray"><div class="tools">{"".join(b)}</div>{pv}</div>'

def who(saved=None, pin=None):
    p = f' data-pin="{pin}" data-side="r" data-dx="4" data-dy="-4"' if pin else ''
    sv = f'<span class="draft"{p}>{ic("CloudDoneRounded",14)}{saved}</span>' if saved else ''
    return f'<div class="who"><b>abhay</b>{sv}</div>'

def keyboard(sugg=('the','and','I')):
    r1 = ''.join(f'<div class="key">{c}</div>' for c in 'qwertyuiop')
    r2 = ''.join(f'<div class="key">{c}</div>' for c in 'asdfghjkl')
    r3 = ''.join(f'<div class="key">{c}</div>' for c in 'zxcvbnm')
    s = ''.join(f'<span>{esc(x)}</span>' for x in sugg)
    return f'''<div class="kbd"><div class="sugg">{s}</div>
      <div class="krow">{r1}</div><div class="krow">{r2}</div>
      <div class="krow"><div class="key w">{ic("ArrowUpwardRounded",20)}</div>{r3}<div class="key w">{ic("BackspaceOutlined",20)}</div></div>
      <div class="krow"><div class="key w">?123</div><div class="key">,</div><div class="key space"></div><div class="key">.</div><div class="key ent">{ic("KeyboardReturnRounded",20)}</div></div></div>'''

def device(inner, dark=False):
    return f'<div class="device{" dark" if dark else ""}"><div class="screen">{status()}{inner}<div class="gesture"><i></i></div></div></div>'

def tag(kind):
    return {'new':'<span class="tag new">NEW</span>','changed':'<span class="tag changed">REDESIGNED</span>','same':'<span class="tag same">EXISTING</span>'}[kind]

def legend(kicker, title, lede, items):
    li = ''.join(f'<li><div class="n">{i+1}</div><div><b class="t">{esc(t)}{tag(k)}</b><span class="d">{d}</span></div></li>' for i,(t,k,d) in enumerate(items))
    return f'<div class="legend"><div class="kicker">{kicker}</div><h1>{esc(title)}</h1><p class="lede">{lede}</p><ol>{li}</ol></div>'

def page(body, cls='board', dark=False):
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body><div class="{cls}">{body}</div>{PIN_JS}</body></html>'

def render_to(out, html_doc, w, h):
    p = os.path.join(TMP, os.path.basename(out) + '.html'); open(p, 'w').write(html_doc)
    subprocess.run([CHROME, '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
                    '--allow-file-access-from-files', '--force-device-scale-factor=2', '--virtual-time-budget=1500',
                    f'--window-size={w},{h}', f'--screenshot={out}', 'file://' + p],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    print('wrote', os.path.relpath(out))

def render(name, html_doc, w, h):
    render_to(os.path.join(OUT, name + '.png'), html_doc, w, h)

BOARD_W, BOARD_H = 1240, 970
def board(name, phone_html, leg, dark=False):
    render(name, page(device(phone_html, dark) + leg), BOARD_W, BOARD_H)

# ---------------------------------------------------------------- note screens
ME = '<div class="who"><b>abhay</b>{}</div>'
def audience_chip(private=False, pin=None):
    p = f' data-pin="{pin}" data-side="r" data-dx="-8" data-dy="-6"' if pin else ''
    if private:
        return f'<span class="chip tonal"{p}>{ic("LinkRounded",17)}Private link{ic("ArrowDropDownRounded",20,cls="x")}</span>'
    return f'<span class="chip"{p}>{ic("PublicRounded",17)}Public{ic("ArrowDropDownRounded",20,cls="x")}</span>'

def note_text_filled():
    return ('<span class="mention">@Mira Okafor</span> finally tried the pour-over spot by the harbor ☕ '
            'Honestly the best flat white in town.\n\nWho else has been? <span class="hash">#coffee</span> <span class="hash">#nostr</span><span class="caret"></span>')

def n_empty(dark=False, pins=True):
    P = [('close',1),('seg',2),('drafts',3),('post',4)] if pins else []
    T = [('attach',6),('at',7),('timer',8),('ai',9),('preview',10)] if pins else []
    inner = appbar('note', post_on=False, pins=P) + f'''
    <div class="content"><div class="scroll">
      <div class="editor"><div class="av"></div><div class="body">
        <div class="who"><b>abhay</b></div>
        <div class="text"><span class="caret"></span><span class="ph">What’s on your mind?</span></div>
      </div></div>
      <div class="meta">{audience_chip(pin=5 if pins else None)}</div>
    </div></div>''' + toolbar('note', pins=T) + keyboard(('I','The','Just'))
    return inner

def n_filled(dark=False, pins=True):
    P = [('post',6)] if pins else []
    T = [('timer',7)] if pins else []
    pin = (lambda n, side='r', dx=0, dy=0: f' data-pin="{n}" data-side="{side}" data-dx="{dx}" data-dy="{dy}"') if pins else (lambda *a, **k: '')
    inner = appbar('note', pins=P) + f'''
    <div class="content"><div class="scroll">
      <div class="editor"><div class="av"></div><div class="body">
        {who('Draft saved', 8 if pins else None)}
        <div class="text"{pin(1,'l',-6,30)}>{note_text_filled()}</div>
      </div></div>
      <div class="media">
        <div class="thumb img1"><div class="xb">{ic("CloseRounded",16)}</div><div class="alt">ALT</div></div>
        <div class="thumb img2"{pin(2,'r',8,40)}><div class="ring">{ic("CloudUploadRounded",22)}&nbsp;64%</div></div>
      </div>
      <div class="meta">
        {audience_chip()}
        <span class="chip warn"{pin(3,'r',-8,-6)}>{ic("TimerRounded",16)}24h{ic("CloseRounded",16,cls="x")}</span>
      </div>
      <div style="padding:18px 0 0 52px">
        <div class="label" style="margin-bottom:8px;display:inline-block"{pin(4,'r',10,-4)}>Topics</div>
        <div class="chips"><span class="chip sm secc">#coffee</span><span class="chip sm secc">#nostr</span></div>
      </div>
      <div style="padding:18px 0 0 52px">
        <div class="hint"{pin(5,'l',-20,-2)}>{ic("InfoOutlined",16)}Paste or drop images and videos anywhere to attach.</div>
      </div>
    </div></div>''' + toolbar('note', expiry=True, pins=T)
    return inner

def n_mention():
    inner = appbar('note') + f'''
    <div class="content"><div class="scroll">
      <div class="editor"><div class="av"></div><div class="body">
        {who('Saving…')}
        <div class="text">Shoutout to <span class="mention" style="background:var(--pri-tint2);color:var(--text)">@mi</span><span class="caret"></span></div>
      </div></div>
    </div>
    <div class="mentionpop" data-pin="1" data-side="r" data-dx="-14" data-dy="0">
      <div class="mrow on"><div class="av sm g"></div><div style="flex:1"><b>Mira Okafor</b><span>mira@nostr.example</span></div>{ic("KeyboardReturnRounded",18,"var(--text2)")}</div>
      <div class="mrow"><div class="av sm b"></div><div><b>Mike Dilger</b><span>mike@gossip.example</span></div></div>
      <div class="mrow"><div class="av sm p"></div><div><b>Milo</b><span>npub1m1lo…8xq2</span></div></div>
    </div></div>''' + toolbar('note', pins=[('at',2)]) + keyboard(('Mira','Mike','Milo'))
    return inner

def sheet_wrap(base, sheet):
    return base.replace('<div class="content">', '<div class="content" style="position:static">', 1) + f'<div class="scrim"></div><div class="sheet">{sheet}</div>'

def n_expiry():
    tiles = ''.join(f'<div class="tile{" on" if v=="24h" else ""}">{v}<small>{s}</small></div>' for v,s in [('1h','1 hour'),('6h','6 hours'),('24h','1 day'),('7d','1 week')])
    sheet = f'''<div class="handle"></div>
      <div class="row" style="justify-content:space-between"><h2>Disappearing note</h2><div class="iconbtn" style="margin-right:-10px">{ic("CloseRounded",22)}</div></div>
      <p class="sub">Relays that support NIP-40 delete the note after this time. Copies others already saved may stay.</p>
      <div class="grid4" data-pin="1" data-side="r" data-dx="-8" data-dy="-8">{tiles}</div>
      <div class="field" style="margin-top:12px" data-pin="2" data-side="r" data-dx="-8" data-dy="-8">{ic("EventRounded",22,"var(--text2)")}<div style="flex:1"><span class="lab">Custom date & time</span>Pick a date…</div>{ic("ChevronRightRounded",22,"var(--text2)")}</div>
      <div class="row" style="margin-top:18px;gap:10px"><div class="btn out" style="flex:1" data-pin="3" data-side="l" data-dx="-4" data-dy="-6">Don’t expire</div><div class="btn fill" style="flex:1.4">Expire in 24 hours</div></div>
      <div style="height:10px"></div>'''
    return sheet_wrap(n_filled(pins=False), sheet)

def n_audience():
    sheet = f'''<div class="handle"></div>
      <h2>Who can see this?</h2><p class="sub">You can change this until you post.</p>
      <div class="choice"><div class="lic">{ic("PublicRounded",22)}</div><div class="tt"><b>Public</b><span>Visible to everyone on Nostr. Hashtags become topics.</span></div><div class="radio"></div></div>
      <div class="choice on" data-pin="1" data-side="r" data-dx="-10" data-dy="-6"><div class="lic">{ic("LinkRounded",22)}</div><div class="tt"><b>Private link</b><span>Encrypted. Only people with the link can read it.</span></div><div class="radio"></div></div>
      <div class="note warn" style="margin-top:6px" data-pin="2" data-side="r" data-dx="-10" data-dy="-6">{ic("WarningAmberRounded",20)}<div>You’ll get a share link after posting. <b>Save it</b> — we don’t store the key, so losing the link means losing access.</div></div>
      <div class="note info" style="margin-top:10px" data-pin="3" data-side="r" data-dx="-10" data-dy="-6">{ic("TagRounded",20)}<div>Hashtags stay in your text but aren’t published as topic tags.</div></div>
      <div class="btn fill lg" style="margin-top:16px">Done</div><div style="height:6px"></div>'''
    base = n_filled(pins=False).replace(appbar('note'), appbar('note', post=ic('LockRounded',17)+'Post'), 1).replace(audience_chip(), audience_chip(True), 1)
    return sheet_wrap(base, sheet)

def n_preview():
    inner = appbar('note') + f'''
    <div class="content"><div class="scroll">
      <div class="banner" data-pin="1" data-side="r" data-dx="-10" data-dy="-8">{ic("VisibilityRounded",18)}<span style="flex:1">Preview — this is how it appears in feeds</span><b style="color:var(--sec)">Edit</b></div>
      <div class="post" data-pin="2" data-side="r" data-dx="-14" data-dy="20"><div class="av"></div><div class="bd">
        <div class="hd"><b>abhay</b><span>@abhay · now</span></div>
        <div class="tx"><span class="hash">@Mira Okafor</span> finally tried the pour-over spot by the harbor ☕ Honestly the best flat white in town.<br><br>Who else has been? <span class="hash">#coffee</span> <span class="hash">#nostr</span></div>
        <div class="pimg img1"></div>
        <div class="row" style="margin-top:10px;gap:6px"><span class="chip sm warn" data-pin="3" data-side="r" data-dx="-8" data-dy="-6">{ic("TimerRounded",15)}Disappears in 24h</span></div>
        <div class="acts"><div>{ic("ChatBubbleOutlineRounded",18)}0</div><div>{ic("RepeatRounded",19)}0</div><div>{ic("FavoriteBorderRounded",18)}0</div><div>{ic("BoltRounded",19)}0</div></div>
      </div></div>
    </div></div>''' + toolbar('note', expiry=True, preview=True, pins=[('preview',4)])
    return inner

def n_ai():
    sheet = f'''<div class="handle"></div>
      <div class="row" style="gap:10px;margin-bottom:4px"><div class="lic" style="width:38px;height:38px;border-radius:12px;background:var(--sec-tint);color:var(--sec);display:flex;align-items:center;justify-content:center">{ic("AutoFixHighRounded",20)}</div><h2 style="margin:0">Proofread</h2></div>
      <p class="sub" style="margin-top:6px">Suggestions from your AI model (Settings → AI). Nothing changes until you apply.</p>
      <div class="label">2 fixes</div>
      <div data-pin="1" data-side="r" data-dx="-10" data-dy="6">
        <div class="typo"><div class="cb">{ic("CheckRounded",16)}</div><s>Honnestly</s>{ic("ArrowForwardRounded",16,"var(--text2)")}<span class="to">Honestly</span></div>
        <div class="typo"><div class="cb">{ic("CheckRounded",16)}</div><s>beleive</s>{ic("ArrowForwardRounded",16,"var(--text2)")}<span class="to">believe</span></div>
      </div>
      <div class="label" style="margin-top:18px;margin-bottom:10px">Suggested hashtags</div>
      <div class="chips" data-pin="2" data-side="r" data-dx="-10" data-dy="-6"><span class="chip sm on">{ic("CheckRounded",15)}#flatwhite</span><span class="chip sm">#harbor</span><span class="chip sm">#cafe</span><span class="chip sm">#specialtycoffee</span></div>
      <div class="row" style="margin-top:20px;gap:10px"><div class="btn out" style="flex:1">Dismiss</div><div class="btn fill" style="flex:1.4">Apply 3 changes</div></div><div style="height:6px"></div>'''
    return sheet_wrap(n_filled(pins=False), sheet)

def n_published():
    sheet = f'''<div class="handle"></div>
      <div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:6px 0 4px">
        <div style="width:64px;height:64px;border-radius:50%;background:var(--ok-tint);color:var(--ok);display:flex;align-items:center;justify-content:center">{ic("LockRounded",32)}</div>
        <h2 style="margin-top:12px">Private note posted</h2>
        <p class="sub" style="margin-bottom:12px">Anyone with this link can read it.</p></div>
      <div class="field mono" style="height:auto;padding:12px 14px;line-height:1.5;word-break:break-all" data-pin="1" data-side="r" data-dx="-10" data-dy="-6">pollerama.fun/p/nevent1qqs9x7…k3vq#key=8f2a…c41e</div>
      <div class="row" style="margin-top:12px;gap:10px"><div class="btn fill" style="flex:1" data-pin="2" data-side="l" data-dx="-4" data-dy="-6">{ic("ContentCopyRounded",18)}Copy link</div><div class="btn out" style="flex:1">{ic("ShareRounded",18)}Share…</div></div>
      <div class="note warn" style="margin-top:14px">{ic("WarningAmberRounded",20)}<div>We don’t store the key. Lose the link and the note is gone for good.</div></div>
      <div class="card" style="margin-top:14px;padding:6px 14px;box-shadow:none" data-pin="3" data-side="r" data-dx="-10" data-dy="-6">
        <div class="row" style="justify-content:space-between;padding:6px 0"><b style="font-size:14.5px">Sent to 4 of 5 relays</b>{ic("ExpandLessRounded",22,"var(--text2)")}</div>
        <div class="relay"><i class="dot"></i>relay.formstr.app</div><div class="relay"><i class="dot"></i>relay.damus.io</div><div class="relay"><i class="dot"></i>nos.lol</div>
        <div class="relay"><i class="dot bad"></i><span style="flex:1">relay.example.com — timed out</span><b style="color:var(--sec)">Retry</b></div>
      </div>
      <div class="btn tonal lg" style="margin-top:14px">Done</div><div style="height:4px"></div>'''
    base = n_filled(pins=False).replace(appbar('note'), appbar('note', post=ic('LockRounded',17)+'Post'), 1).replace(audience_chip(), audience_chip(True), 1)
    return sheet_wrap(base, sheet)

# ---------------------------------------------------------------- poll screens
SETTINGS_ROWS = lambda typ, ends, pow_, pins=(): (
    f'''<div class="card"{pins[0] if pins else ''}>
      <div class="srow"><div class="lic">{ic("RadioButtonCheckedRounded" if typ.startswith('Single') else "CheckBoxRounded",20)}</div><div class="tt"><b>Answer type</b></div><div class="val">{typ}{ic("ChevronRightRounded",20)}</div></div>
      <div class="srow"><div class="lic">{ic("ScheduleRounded",20)}</div><div class="tt"><b>Voting ends</b></div><div class="val">{ends}{ic("ChevronRightRounded",20)}</div></div>
      <div class="srow"><div class="lic">{ic("ShieldRounded",20)}</div><div class="tt"><b>Spam protection</b></div><div class="val">{pow_}{ic("ChevronRightRounded",20)}</div></div>
    </div>''')

def opt(text, ph=False, focus=False, err=False, img=None, grip=True, num=None):
    cls = 'opt' + (' focus' if focus else '') + (' err' if err else '')
    g = f'<div class="grip">{ic("DragIndicatorRounded",20)}</div>' if grip else '<div style="width:14px"></div>'
    n = f'<div class="num">{num}</div>' if num else ''
    m = f'<div class="mini {img}"></div>' if img else ''
    t = f'<div class="t{" ph" if ph else ""}">{esc(text)}{"<span class=caret></span>" if focus else ""}</div>'
    a = f'<div class="act">{ic("AddPhotoAlternateOutlined",20)}</div>' if not img else ''
    x = f'<div class="act">{ic("CloseRounded",20)}</div>'
    return f'<div class="{cls}">{g}{n}{m}{t}{a}{x}</div>'

def p_empty():
    tm = [('👍','Yes / No','2 options'),('⭐','Rate it','1 – 5 stars'),('🆚','This or that','A vs B'),('😍','Emoji scale','5 moods')]
    tc = ''.join(f'<div class="tcard"><div class="e">{e}</div><b>{t}</b><span>{s}</span></div>' for e,t,s in tm)
    inner = appbar('poll', post_on=False, pins=[('post',1)]) + f'''
    <div class="content"><div class="scroll">
      <div class="editor"><div class="av"></div><div class="body">
        <div class="who"><b>abhay</b></div>
        <div class="q"><span class="caret"></span><span class="ph">Ask a question…</span></div>
      </div></div>
      <div class="opts" data-pin="2" data-side="r" data-dx="6" data-dy="30">{opt('Option 1',ph=True)}{opt('Option 2',ph=True)}</div>
      <div style="padding-top:18px" data-pin="3" data-side="r" data-dx="6" data-dy="60">
        <div class="label" style="margin-bottom:10px">Or start from a template</div>
        <div class="tmpl">{tc}</div></div>
      <div style="padding-top:20px" data-pin="4" data-side="r" data-dx="6" data-dy="40">{SETTINGS_ROWS('Single choice','In 7 days','Off')}</div>
    </div></div>''' + toolbar('poll')
    return inner

def p_filled(pins=True, dark=False):
    pin = (lambda n, side='r', dx=0, dy=0: f' data-pin="{n}" data-side="{side}" data-dx="{dx}" data-dy="{dy}"') if pins else (lambda *a, **k: '')
    inner = appbar('poll', pins=[('post',8)] if pins else []) + f'''
    <div class="content"><div class="scroll">
      <div class="editor"><div class="av"></div><div class="body">
        {who('Draft saved')}
        <div class="q">Best way to start a Sunday? <span class="hash" style="font-weight:700">#coffee</span></div>
      </div></div>
      <div class="opts">
        <div{pin(1,'l',-8,13)}>{opt('Long walk by the sea')}</div>
        <div{pin(2,'r',6,14)}>{opt('Slow coffee', img='img1')}</div>
        <div{pin(3,'r',6,14)}>{opt('Back to bed', focus=True)}<div class="helper">{ic("KeyboardReturnRounded",15)}Enter adds another option</div></div>
        <div{pin(4,'r',6,14)}>{opt('slow coffee', err=True)}<div class="helper err">{ic("ErrorOutlineRounded",15)}Same as option 2</div></div>
        <div class="addopt"{pin(5,'r',6,12)}>{ic("AddRounded",20)}Add option</div>
      </div>
      <div style="padding-top:18px"{pin(6,'r',6,20)}>{SETTINGS_ROWS('Single choice','In 3 days','Off')}</div>
    </div></div>''' + toolbar('poll', pins=[('preview',7)] if pins else [])
    return inner

def p_type():
    sheet = f'''<div class="handle"></div>
      <h2>Answer type</h2><p class="sub">How voters pick their answer.</p>
      <div class="choice on" data-pin="1" data-side="r" data-dx="-10" data-dy="-6"><div class="lic">{ic("RadioButtonCheckedRounded",22)}</div><div class="tt"><b>Single choice</b><span>Voters pick exactly one option.</span></div><div class="radio"></div></div>
      <div class="choice"><div class="lic">{ic("CheckBoxRounded",22)}</div><div class="tt"><b>Multiple choice</b><span>Voters pick any number of options.</span></div><div class="radio"></div></div>
      <div class="choice dis" data-pin="2" data-side="r" data-dx="-10" data-dy="-6"><div class="lic">{ic("FormatListNumberedRounded",22)}</div><div class="tt"><b style="display:flex;align-items:center;gap:8px">Ranked choice <span class="chip sm" style="height:22px;font-size:11px;padding:0 8px">Coming soon</span></b><span>Voters order options by preference.</span></div><div class="radio"></div></div>
      <div style="height:14px"></div>'''
    return sheet_wrap(p_filled(pins=False), sheet)

def p_ends():
    tiles = ''.join(f'<div class="tile{" on" if v=="3d" else ""}">{v}<small>{s}</small></div>' for v,s in [('1h','1 hour'),('1d','1 day'),('3d','3 days'),('1w','1 week'),('∞','Never')])
    sheet = f'''<div class="handle"></div>
      <h2>Voting ends</h2><p class="sub">After this, the poll stops accepting votes and shows final results.</p>
      <div class="grid5" data-pin="1" data-side="r" data-dx="-8" data-dy="-8">{tiles}</div>
      <div class="field" style="margin-top:12px" data-pin="2" data-side="r" data-dx="-8" data-dy="-8">{ic("EventRounded",22,"var(--text2)")}<div style="flex:1"><span class="lab">Ends at</span>Wed, Oct 21 · 9:41 AM</div>{ic("EditRounded",20,"var(--text2)")}</div>
      <div class="btn fill lg" style="margin-top:16px">Done</div><div style="height:6px"></div>'''
    return sheet_wrap(p_filled(pins=False), sheet)

def p_pow():
    sheet = f'''<div class="handle"></div>
      <h2>Spam protection</h2><p class="sub">Each vote must include a small proof-of-work, so bots can’t flood the poll. Higher levels mean voters wait longer.</p>
      <div class="grid4" data-pin="1" data-side="r" data-dx="-8" data-dy="-8">
        <div class="tile">Off<small>instant</small></div><div class="tile on">Low<small>~1 sec</small></div><div class="tile">Medium<small>~10 sec</small></div><div class="tile">High<small>~1 min</small></div></div>
      <div class="row" style="justify-content:space-between;margin-top:18px" data-pin="2" data-side="r" data-dx="-8" data-dy="-10"><b style="font-size:14.5px">Difficulty</b><span class="mono" style="font-size:14px;font-weight:700">16 bits</span></div>
      <div class="slider"><i style="width:40%"></i><b style="left:40%"></b></div>
      <div class="row" style="justify-content:space-between;font-size:12px;color:var(--text2)"><span>0</span><span>40</span></div>
      <div class="note info" style="margin-top:14px">{ic("InfoOutlined",20)}<div>Times are estimates for a mid-range phone.</div></div>
      <div class="btn fill lg" style="margin-top:16px">Done</div><div style="height:6px"></div>'''
    return sheet_wrap(p_filled(pins=False), sheet)

def p_preview():
    inner = appbar('poll') + f'''
    <div class="content"><div class="scroll">
      <div class="banner">{ic("VisibilityRounded",18)}<span style="flex:1">Preview — how voters will see it</span><b style="color:var(--sec)">Edit</b></div>
      <div class="post" data-pin="1" data-side="r" data-dx="-14" data-dy="20"><div class="av"></div><div class="bd">
        <div class="hd"><b>abhay</b><span>@abhay · now</span></div>
        <div class="tx" style="font-size:18px;font-weight:700;line-height:1.35">Best way to start a Sunday? <span class="hash">#coffee</span></div>
        <div class="popt">Long walk by the sea</div>
        <div class="popt" style="padding-left:6px"><div class="mini img1" style="width:36px;height:36px;border-radius:50%;margin-right:12px;position:relative;overflow:hidden"></div>Slow coffee</div>
        <div class="popt">Back to bed</div>
        <div class="row" style="margin-top:10px;font-size:13px;color:var(--text2);gap:6px" data-pin="2" data-side="r" data-dx="-8" data-dy="-6">{ic("RadioButtonCheckedRounded",15)}Pick one · {ic("ScheduleRounded",15)}3 days left · {ic("ShieldRounded",15)}Low</div>
        <div class="acts"><div>{ic("ChatBubbleOutlineRounded",18)}0</div><div>{ic("RepeatRounded",19)}0</div><div>{ic("FavoriteBorderRounded",18)}0</div><div>{ic("BoltRounded",19)}0</div></div>
      </div></div>
    </div></div>''' + toolbar('poll', preview=True)
    return inner

# ---------------------------------------------------------------- desktop
def desktop():
    editor = f'''
      <div class="appbar" style="height:68px;padding:0 18px 0 12px;border-bottom:1px solid var(--div)">
        <div class="iconbtn">{ic("CloseRounded",24)}</div>
        <div class="seg" style="margin:0 0 0 8px"><div>{ic("EditNoteRounded",19)}Note</div><div class="on">{ic("PollRounded",18)}Poll</div></div>
        <div style="flex:1"></div>
        <div class="saved" style="margin-right:10px">{ic("CloudDoneRounded",17)}Saved</div>
        <div class="btn out" style="margin-right:8px">{ic("DescriptionRounded",18)}Drafts · 3</div>
        <div class="btn fill" data-pin="3" data-side="r" data-dx="-6" data-dy="-8">Post</div>
      </div>
      <div style="display:flex;flex:1;min-height:0">
        <div style="flex:1;padding:22px 28px;border-right:1px solid var(--div)">
          <div class="editor"><div class="av"></div><div class="body"><div class="who"><b>abhay</b></div>
            <div class="q">Best way to start a Sunday? <span class="hash" style="font-weight:700">#coffee</span></div></div></div>
          <div class="opts">{opt('Long walk by the sea')}{opt('Slow coffee', img='img1')}{opt('Back to bed', focus=True)}<div class="addopt">{ic("AddRounded",20)}Add option</div></div>
          <div style="padding-top:18px">{SETTINGS_ROWS('Single choice','In 3 days','Low')}</div>
        </div>
        <div style="width:420px;padding:22px 26px;background:var(--surface)" data-pin="1" data-side="l" data-dx="-4" data-dy="10">
          <div class="label">Live preview</div>
          <div class="post"><div class="av"></div><div class="bd">
            <div class="hd"><b>abhay</b><span>@abhay · now</span></div>
            <div class="tx" style="font-size:17px;font-weight:700;line-height:1.35">Best way to start a Sunday? <span class="hash">#coffee</span></div>
            <div class="popt">Long walk by the sea</div><div class="popt" style="padding-left:6px"><div class="img1" style="width:36px;height:36px;border-radius:50%;margin-right:12px;position:relative;overflow:hidden"></div>Slow coffee</div><div class="popt">Back to bed</div>
            <div class="row" style="margin-top:10px;font-size:13px;color:var(--text2);gap:6px">Pick one · 3 days left</div>
          </div></div>
        </div>
      </div>
      <div class="toolbar" style="height:60px;padding:0 18px">
        <div class="iconbtn">{ic("AddPhotoAlternateRounded",24)}</div><div class="iconbtn">{ic("EmojiEmotionsRounded",24)}</div><div class="iconbtn">{ic("AlternateEmailRounded",23)}</div><div class="iconbtn">{ic("TagRounded",23)}</div>
        <div class="sp"></div>
        <span class="kbdhint" data-pin="2" data-side="r" data-dx="-6" data-dy="-6"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> to post · <kbd>Esc</kbd> to close</span>
      </div>'''
    d = f'''<div class="desk"><div class="chrome"><i></i><i></i><i></i><div class="url">pollerama.fun/create?type=poll</div></div>
      <div style="padding:24px;opacity:.9"><div style="height:40px;width:220px;border-radius:12px;background:var(--div)"></div>
      {''.join('<div style="height:110px;border-radius:16px;background:var(--div);margin-top:16px;width:640px;margin-left:300px"></div>' for _ in range(5))}</div>
      <div class="scrim"></div><div class="dialog">{editor}</div></div>'''
    leg = legend('Composer · desktop ≥ 900px', 'Poll composer — desktop dialog',
        'Same composer in a centered dialog over the feed. The extra width shows a live preview instead of a preview toggle.',
        [('Live preview pane','new','Renders the existing <code>PollPreview</code>/<code>NotePreview</code> side by side and updates as you type. Below 900px it falls back to the 👁 toggle.'),
         ('Keyboard shortcuts','new','<b>Ctrl/⌘+Enter</b> posts and <b>Esc</b> closes (the draft is already autosaved). The app already handles Ctrl+K the same way.'),
         ('Post','same','Same submit and publish flow, including the relay diagnostic.')])
    render('desktop-poll', page(d + f'<div style="width:420px">{leg}</div>', cls='board solo'), 1860, 900)

# ---------------------------------------------------------------- overview
def overview(items):
    import re as _re
    items = [(t, _re.sub(r' data-(pin|side|dx|dy)="[^"]*"', '', h), d) for t,h,d in items]
    cells = ''.join(f'<div style="display:flex;flex-direction:column;align-items:center;gap:14px"><div style="width:{int(414*.62)}px;height:{int(868*.62)}px"><div style="transform:scale(.62);transform-origin:top left;width:414px">{device(h, d)}</div></div><b style="font-size:15px">{esc(t)}</b></div>' for t,h,d in items)
    body = f'''<div style="padding:44px 56px;width:2200px"><div class="legend" style="margin-bottom:28px"><div class="kicker">Pollerama · composer redesign</div><h1>All composer states</h1>
      <p class="lede" style="max-width:none">Golden preset. Each screen has its own annotated PNG in this folder. NEW = small additions, REDESIGNED = existing feature with a new layout, EXISTING = same behavior.</p></div>
      <div style="display:grid;grid-template-columns:repeat(8,1fr);row-gap:30px;column-gap:10px">{cells}</div></div>'''
    rows = (len(items)+7)//8
    render('00-overview', page(body, cls=''), 2200, 230 + rows*(int(868*.62)+60))

# ---------------------------------------------------------------- main
if __name__ == '__main__':
    board('01-note-empty', n_empty(), legend('Composer · note', 'Note — empty, keyboard open',
        'Opens straight into writing. The old stacked card (tabs, form, big buttons, preview toggle) becomes a full-screen editor. Tools live in a floating capsule above the keyboard, not a full-width toolbar strip.',
        [('Close','changed','Closes the composer. Drafts already autosave locally, so nothing is lost and there’s no confirm dialog.'),
         ('Note / Poll switch','changed','Replaces the full-width tabs. Text you’ve typed carries over, as it does now (shared <code>eventContent</code>).'),
         ('Drafts','same','Opens <code>/drafts</code>. The badge shows the draft count.'),
         ('Post','changed','Disabled until there is content. Shows a 🔒 when the audience is Private link. Replaces "Create Note".'),
         ('Audience','same','The Public / Private link menu (<code>AudienceMenu</code>), now an inline chip under the text.'),
         ('Attach media','same','Blossom upload. Paste and drag-and-drop still work in the text.'),
         ('@ and # buttons','new','Insert "@" (opens the existing mention picker) or "#" at the cursor. Saves fiddly symbol-keyboard trips on mobile.'),
         ('Disappearing note','same','NIP-40 expiration. Was a toggle with chips squeezed into the toolbar; now opens a sheet (see 04).'),
         ('Proofread with AI','same','Only shown when an AI model is configured. Was a full-width button.'),
         ('Preview','changed','Switches the editor to a feed-accurate preview (see 06). Was "Show Preview" with a collapse.')]))

    board('02-note-writing', n_filled(), legend('Composer · note', 'Note — writing, keyboard dismissed',
        'A filled note with everything visible at once: mention, media, expiry, topics and draft status.',
        [('Inline highlighting','new','@mentions and #hashtags are tinted while you type, so you can see they were picked up. Uses the same parsing as topics.'),
         ('Media tray','new','Uploaded media shows as thumbnails instead of only raw URLs in the text. ✕ removes the URL from the content, and upload progress shows on the tile. ALT is a stretch goal.'),
         ('Expiry chip','changed','Shows the active expiration in warning color. ✕ clears it. Tap to edit.'),
         ('Topics','same','Hashtags found in the text, published as <code>t</code> tags. Faded when the note is private, as today.'),
         ('Paste/drop hint','same','The existing helper text, moved down so it doesn’t sit in the toolbar.'),
         ('Post','same','Enabled once there’s content.'),
         ('Expiry active','changed','The timer icon turns amber while an expiration is set.'),
         ('Draft status','same','"Saving…" → "Saved" from <code>useDraftAutosave</code>. Was a caption under the buttons.')]))

    board('03-note-mention', n_mention(), legend('Composer · note', 'Mention autocomplete',
        'The existing <code>MentionTextArea</code> picker, restyled as a floating card above the toolbar so the keyboard never covers it.',
        [('Mention picker','changed','Same profile search (name / nip05). Larger rows with avatar and nip05 or a short npub. Enter or tap inserts the mention. The typed query is highlighted.'),
         ('@ button','new','Tapping @ inserts "@" and opens this picker straight away.')]))

    board('04-note-expiry', n_expiry(), legend('Composer · note', 'Disappearing note sheet',
        'The NIP-40 expiration controls (1h / 6h / 24h / 7d chips + DateTimePicker) moved out of the cramped toolbar into a sheet.',
        [('Presets','changed','Same four presets as the current chips, as large tap targets.'),
         ('Custom date & time','same','Opens the existing MUI DateTimePicker. The minimum stays one minute from now.'),
         ('Don’t expire','changed','Clears the expiration, the same as toggling the timer off today.')]))

    board('05-note-audience', n_audience(), legend('Composer · note', 'Audience sheet — private link',
        'The <code>AudienceMenu</code> options as a sheet with room for the warnings that are currently tiny captions.',
        [('Private link','same','Encrypted note shared by link. The Post button gets a lock icon.'),
         ('Save-the-link warning','changed','Same copy as today, but shown before posting in warning style instead of a small caption.'),
         ('Hashtag notice','same','The "hashtags aren’t published as topic tags" caption for private notes.')]))

    board('06-note-preview', n_preview(), legend('Composer · note', 'Note preview',
        'The preview takes over the editor area instead of collapsing in below the buttons, so it’s always on screen.',
        [('Preview banner','changed','Shows you’re in preview. "Edit" (or the 👁 button) goes back.'),
         ('Feed-accurate render','same','Uses the existing <code>NotePreview</code>: same post component as the feed, media included.'),
         ('Expiry shown','new','The preview shows the disappearing badge readers will see.'),
         ('Preview toggle','changed','Active (tinted) while previewing.')]))

    board('07-note-proofread', n_ai(), legend('Composer · note', 'Proofread with AI',
        'The existing <code>PostEnhancementDialog</code>, restyled as a sheet. Same data: typo corrections and suggested hashtags.',
        [('Corrections','same','Each fix shows original → correction. Checkboxes let you skip individual fixes (today it’s all or nothing, so that part is small and new).'),
         ('Suggested hashtags','same','Tap to toggle, as now. The apply button counts the selected changes.')]))

    board('08-note-private-posted', n_published(), legend('Composer · note', 'After posting privately',
        'Today this is the publish diagnostic modal with the link squeezed into its header. Here the link is the main content.',
        [('Share link','same','Read-only and monospace. Tap selects all.'),
         ('Copy / Share','new','Copy works as today. Share… opens the native share sheet (needs the small <code>@capacitor/share</code> plugin; Web Share API on web).'),
         ('Relay results','same','The <code>PublishDiagnosticModal</code> content, collapsed to a summary with retry for failed relays.')]))

    board('09-poll-empty', p_empty(), legend('Composer · poll', 'Poll — empty',
        'Question first, two option slots ready, settings in one card. A row of templates gets people to a finished poll faster.',
        [('Post','changed','Disabled until there’s a question and two non-empty options.'),
         ('Option pills','changed','Same shape as how votes appear in the feed, so the composer looks like the poll it makes. Replaces the outlined card with "Option N" text fields.'),
         ('Templates','new','One tap fills the options (Yes/No, 1–5 ★, A vs B, emoji scale). Just pre-filled <code>options</code>, so no protocol change. Hidden once you’ve typed an option.'),
         ('Settings card','changed','Poll type, expiration and PoW were a Select, a DateTimePicker and a number field under "Poll Settings"/"Advanced Settings". Now three rows that open sheets (11–13).')]))

    board('10-poll-writing', p_filled(), legend('Composer · poll', 'Poll — writing options',
        'Options can be typed, reordered and illustrated in place.',
        [('Reorder','new','Drag the handle to reorder options. Option ids stay stable, so only the order changes.'),
         ('Option image','same','Attach an image or video to an option (Blossom), as now. It shows as a thumbnail instead of a URL inside the field.'),
         ('Enter adds an option','new','Return in the last option adds a new one and focuses it. Backspace in an empty option removes it.'),
         ('Duplicate check','new','Flags options that match another (ignoring case and spaces). Blocks Post until fixed.'),
         ('Add option','same','Same as the "Add Option" button.'),
         ('Settings','changed','Summary rows. Values update as you change them in the sheets.'),
         ('Preview','changed','Switches to the voter view (see 14).'),
         ('Post','changed','Replaces "Create Poll".')]))

    board('11-poll-type', p_type(), legend('Composer · poll', 'Answer type sheet',
        'The poll-type Select, as a sheet with a one-line explanation per type.',
        [('Single / Multiple','same','Same <code>polltype</code> values: singlechoice, multiplechoice.'),
         ('Ranked choice','same','Still disabled, now labeled "Coming soon" so it doesn’t look broken.')]))

    board('12-poll-ends', p_ends(), legend('Composer · poll', 'Voting ends sheet',
        'Today this is only a DateTimePicker. Quick presets cover most cases. The date field stays for anything else.',
        [('Duration presets','new','1h · 1d · 3d · 1w · Never set <code>endsAt</code> relative to now. Uses the same chip pattern as the note expiry.'),
         ('Exact date','same','The existing DateTimePicker with disablePast. Shows the computed end time for presets too.')]))

    board('13-poll-spam', p_pow(), legend('Composer · poll', 'Spam protection (proof-of-work)',
        'The "Proof of Work Difficulty" number field, renamed and explained. It sets the <code>PoW</code> tag that voters’ clients must mine for.',
        [('Levels','new','Off / Low / Medium / High map to difficulty 0 / 16 / 20 / 24 bits, with a rough vote-time estimate so people know the cost.'),
         ('Exact difficulty','same','The slider still allows any value, as the number field does today.')]))

    board('14-poll-preview', p_preview(), legend('Composer · poll', 'Poll preview',
        'The existing <code>PollPreview</code>, shown in place of the editor.',
        [('Voter view','same','Question, options and option media as they render in the feed.'),
         ('Rules summary','new','One line showing answer type, time left and spam-protection level.')]))

    # dark mode (no pins)
    render('15-note-writing-dark', page(device(n_filled(pins=False), True) + legend('Composer · dark', 'Note — dark mode', 'Golden preset, OLED black background. Sheets and cards sit on a slightly lifted #121212 so they don’t vanish into the black.', []), dark=True), BOARD_W, BOARD_H)
    render('16-poll-writing-dark', page(device(p_filled(pins=False), True) + legend('Composer · dark', 'Poll — dark mode', 'Same layout. Focus ring, chips and toolbar take the dark preset values (primary #FAD13F, secondary #F0A93B).', []), dark=True), BOARD_W, BOARD_H)
    desktop()

    overview([('Note · empty', n_empty(pins=False), False), ('Note · writing', n_filled(pins=False), False), ('Mention', n_mention(), False),
              ('Disappearing', n_expiry(), False), ('Audience', n_audience(), False), ('Note preview', n_preview(), False),
              ('Proofread', n_ai(), False), ('Private posted', n_published(), False),
              ('Poll · empty', p_empty(), False), ('Poll · writing', p_filled(pins=False), False), ('Answer type', p_type(), False),
              ('Voting ends', p_ends(), False), ('Spam protection', p_pow(), False), ('Poll preview', p_preview(), False),
              ('Note · dark', n_filled(pins=False), True), ('Poll · dark', p_filled(pins=False), True)])
