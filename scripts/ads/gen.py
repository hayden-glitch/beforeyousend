#!/usr/bin/env python3
"""Generate 1080x1920 HTML frames for Before You Send TikTok ad creatives.
Creates 3 beats per creative (cr03/cr06/cr09). Run from /tmp/adsrc.
Writes frames/<id>/beat{1,2,3}.html — pass --guides to add overlay safe-zone guides.
"""
import os, sys

GUIDES = "--guides" in sys.argv

CSS = """
* { margin:0; padding:0; box-sizing:border-box; }
html,body { width:1080px; height:1920px; overflow:hidden; background:#FAF7F1; }
@font-face { font-family:'Inter'; font-weight:400; src:url('/fonts/inter-400.woff2') format('woff2'); }
@font-face { font-family:'Inter'; font-weight:600; src:url('/fonts/inter-600.woff2') format('woff2'); }
@font-face { font-family:'Fraunces'; font-weight:600; src:url('/fonts/fraunces-latin.woff2') format('woff2'); }
body { font-family:'Inter', 'Helvetica Neue', Arial, sans-serif; }

.eyebrow { position:absolute; top:200px; left:0; width:1080px; text-align:center;
  font-family:'Inter'; font-weight:600; font-size:30px; letter-spacing:14px;
  text-transform:uppercase; color:#6B7A72; }
.headline { position:absolute; top:310px; left:50%; transform:translateX(-50%); width:max-content;
  max-width:1020px; text-align:center; font-family:'Fraunces'; font-weight:600; font-size:{hsize}px;
  line-height:1.08; letter-spacing:-1.2px; color:#1F2B26; }

.phone { position:absolute; left:290px; top:{phone_top}px; width:500px; height:860px;
  background:#FFFFFF; border-radius:58px; border:2px solid #E4DCCE;
  box-shadow:0 44px 90px rgba(31,43,38,.13); }
.phone-screen { position:absolute; inset:20px; background:#FFFFFF; border-radius:42px;
  overflow:hidden; display:flex; flex-direction:column; }
.statusbar { display:flex; justify-content:space-between; align-items:center;
  padding:26px 36px 8px; font-family:'Inter'; font-weight:600; font-size:22px; color:#1F2B26; }
.statusbar .dots { display:flex; gap:7px; }
.statusbar .dots span { width:9px; height:9px; border-radius:50%; background:#C9BFAD; }
.chat { flex:1; padding:14px 26px 20px; display:flex; flex-direction:column; gap:16px; overflow:hidden; }
.bubble-in { align-self:flex-start; background:#EFE9DF; color:#1F2B26; border-radius:24px;
  border-bottom-left-radius:8px; padding:18px 24px; font-size:27px; line-height:1.42; max-width:82%; }
.bubble-out { align-self:flex-end; background:#1E4236; color:#FAF7F1; border-radius:24px;
  border-bottom-right-radius:8px; padding:18px 24px; font-size:27px; line-height:1.42; max-width:88%; }
.bubble-out.calm { font-size:29px; }

.reviewed { border-top:1.5px solid #EFE7D8; margin:0 22px 18px; padding-top:14px; }
.reviewed .rv-label { font-family:'Inter'; font-weight:600; font-size:20px; letter-spacing:5px;
  text-transform:uppercase; color:#6B7A72; margin-bottom:10px; }
.pill { background:#F5EFE6; border:1.5px solid #D9CFC0; border-radius:18px; padding:11px 18px;
  font-family:'Inter'; font-weight:600; font-size:24px; color:#1F2B26; margin-bottom:8px; }

.horizon { position:absolute; left:120px; top:1350px; width:840px; height:220px; }
.horizon .band { position:absolute; left:0; top:0; width:840px; height:220px;
  background:linear-gradient(180deg, rgba(243,236,224,0) 0%, #F3ECE0 70%, #EFE7D8 100%); }
.horizon .line { position:absolute; left:60px; top:118px; width:720px; height:2px; background:#E3D9C8; }
.horizon .sun { position:absolute; left:300px; top:34px; width:170px; height:170px; border-radius:50%;
  background:#F2E9DA; border:1.5px solid #E7DCC9; }
.phone-shadow { position:absolute; left:290px; top:{phone_top}px; width:500px; height:860px;
  border-radius:58px; box-shadow:0 90px 60px -30px rgba(31,43,38,.16); }

.logo { position:absolute; left:48px; top:1490px; display:flex; align-items:center; gap:18px; }
.logo img { width:66px; height:66px; }
.logo span { font-family:'Inter'; font-weight:600; font-size:30px; letter-spacing:-0.3px; color:#1F2B26; }

.card { position:absolute; left:150px; top:572px; width:680px; background:#F5EFE6;
  border:1.5px solid #D9CFC0; border-radius:46px; padding:52px 46px 48px; }
.card .rv-label { font-family:'Inter'; font-weight:600; font-size:26px; letter-spacing:7px;
  text-transform:uppercase; color:#6B7A72; text-align:center; margin-bottom:26px; }
.pill-big { display:flex; align-items:center; gap:22px; background:#FFFFFF;
  border:1.5px solid #D9CFC0; border-radius:28px; padding:26px 32px; margin-bottom:20px; }
.pill-big .dot { width:22px; height:22px; border-radius:50%; background:#1E4236; flex:none; }
.pill-big .name { font-family:'Inter'; font-weight:600; font-size:38px; color:#1F2B26; letter-spacing:-0.3px; }
.cta { text-align:center; font-family:'Inter'; font-weight:400; font-size:33px; color:#6B7A72; margin-top:26px; }
.cta b { font-weight:600; color:#1E4236; }

.guides .zone { position:absolute; background:rgba(214,69,69,.07); border:2px dashed rgba(214,69,69,.55); }
.guides .z-right { left:830px; top:0; width:250px; height:1920px; }
.guides .z-bottom { left:0; top:1600px; width:1080px; height:320px; }
.guides .z-band { left:0; top:300px; width:1080px; height:1400px; border-color:rgba(30,66,54,.45); background:none; }
"""

CREATIVES = {
  "cr03": {
    "headline": "You don’t have to<br>answer hot.",
    "hsize": 84,
    "incoming": "Dropping him at 6.",
    "draft": "You said 5:30. He was ready at 5:15 and we waited on the steps for forty minutes. He asked why you were late again. This is the third time this month and he notices. Please just be on time like you promised.",
    "calm": "Got it. He was ready at 5:15. We’ll be set for next week.",
  },
  "cr06": {
    "headline": "Know how it reads<br>before it’s sent.",
    "hsize": 84,
    "incoming": "Pick-up is Saturday now.",
    "draft": "You changed the drop-off again without telling me. I only found out when he mentioned it on the ride home. I keep having to fix the things you decide on your own and I’m tired of it. We need to talk.",
    "calm": "Can we set a fixed pick-up day? He does best when we keep it the same.",
  },
  "cr09": {
    "headline": "Keep it calm,<br>for the kids.",
    "hsize": 84,
    "incoming": "He seemed upset after practice.",
    "draft": "He came home from your weekend saying you called him slow in front of the team. He asked me if something is wrong with him. I don’t know how many more times I can hold him together.",
    "calm": "Got it. I’ll keep things calm and steady. Thanks for telling me.",
  },
}

def page(cid, c, beat):
    hz = "<div class='horizon'><div class='band'></div><div class='sun'></div><div class='line'></div></div>" if cid=="cr09" and beat in (1,2) else ""
    ph = ""
    if beat == 1:
        ph = f"""
  <div class='phone'><div class='phone-screen'>
    <div class='statusbar'><span>9:41</span><span class='dots'><span></span><span></span><span></span></span></div>
    <div class='chat'>
      <div class='bubble-in'>{c['incoming']}</div>
      <div class='bubble-out'>{c['draft']}</div>
    </div>
  </div></div>"""
    elif beat == 2:
        ph = f"""
  <div class='phone'><div class='phone-screen'>
    <div class='statusbar'><span>9:41</span><span class='dots'><span></span><span></span><span></span></span></div>
    <div class='chat'>
      <div class='bubble-in'>{c['incoming']}</div>
      <div class='bubble-out calm'>{c['calm']}</div>
    </div>
    <div class='reviewed'>
      <div class='rv-label'>Reviewed</div>
      <div class='pill'>Gentle</div>
      <div class='pill'>Direct</div>
      <div class='pill'>Firm but Neutral</div>
    </div>
  </div></div>"""
    else:
        ph = f"""
  <div class='card'>
    <div class='rv-label'>Reviewed</div>
    <div class='pill-big'><div class='dot'></div><div class='name'>Gentle</div></div>
    <div class='pill-big'><div class='dot'></div><div class='name'>Direct</div></div>
    <div class='pill-big'><div class='dot'></div><div class='name'>Firm but Neutral</div></div>
    <div class='cta'>First review <b>free</b>. No account.</div>
  </div>"""
    guides = ""
    if GUIDES:
        guides = ("<div class='zone z-right'></div><div class='zone z-bottom'></div><div class='zone z-band'></div>"
                  + """<script>
window.addEventListener('load', () => {
  document.fonts.ready.then(() => {
    const r = s => { const b = document.querySelector(s).getBoundingClientRect();
      return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
    const out = {
      fonts: { fraunces: document.fonts.check('600 84px Fraunces'), inter: document.fonts.check('600 27px Inter') },
      eyebrow: r('.eyebrow'), headline: r('.headline'),
      phone: document.querySelector('.phone') ? r('.phone') : null,
      card: document.querySelector('.card') ? r('.card') : null,
      logo: r('.logo'),
    };
    const pre = document.createElement('pre'); pre.id = 'report';
    pre.textContent = JSON.stringify(out); document.body.appendChild(pre);
  });
});
</script>""")
    css = CSS.replace("{hsize}", str(c["hsize"])).replace("{phone_top}", "560")
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>{css}</style></head>
<body class="{'guides' if GUIDES else ''}">
  {guides}
  {hz}
  <div class='eyebrow'>Before You Send</div>
  <div class='headline'>{c['headline']}</div>
  {ph}
  <div class='logo'><img src="/logo-bys.svg"><span>Before You Send</span></div>
</body></html>"""

os.makedirs("frames", exist_ok=True)
for cid, c in CREATIVES.items():
    d = f"frames/{cid}"
    os.makedirs(d, exist_ok=True)
    for b in (1, 2, 3):
        with open(f"{d}/beat{b}.html", "w") as f:
            f.write(page(cid, c, b))
print("wrote", len(CREATIVES) * 3, "frames")
