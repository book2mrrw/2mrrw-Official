#!/usr/bin/env python3
import re
from pathlib import Path

P = Path(__file__).resolve().parents[1] / "src/app/page.js"
c = P.read_text()
d, m = "div", "motion.div"
DO, MO, DC, MC = f"<{d}", f"<{m}", f"</{d}>", f"</{m}>"

def sub(pat, repl, label):
    global c
    c2, n = re.subn(pat, repl, c, count=1, flags=re.DOTALL)
    print(("OK" if n else "FAIL"), label)
    if n:
        c = c2

# GATE
sub(
    r'      \{/\* ── GATE ── \*/\}.*?\n      \)\}\n\n      \{/\* ── SINGLE MODAL',
    f'''      {{/* ── GATE ── */}}
      <AnimatePresence>
        {{!gateSubmitted && (
          <{m} key="gate" {{...OVERLAY_FADE}} style={{{{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,padding:30}}}}>
            {DO} style={{{{fontSize:28,fontWeight:900,letterSpacing:6,color:"white",textShadow:"0 0 20px rgba(0,255,255,0.8)"}}}}>2MRRW{DC}
            <p style={{{{color:"#aaa",marginBottom:10,textAlign:"center"}}}}>Enter your info to access the site</p>
            <input placeholder="Full Name"     value={{gateName}}  onChange={{e=>setGateName(e.target.value)}}  onKeyDown={{e=>e.key==="Enter"&&handleGateSubmit()}} style={{{{width:"min(280px,90vw)",padding:"10px 14px",background:"#111",border:"1px solid #333",color:"white",borderRadius:8,fontSize:14}}}}/>
            <input placeholder="Phone Number"  value={{gatePhone}} onChange={{e=>setGatePhone(e.target.value)}} onKeyDown={{e=>e.key==="Enter"&&handleGateSubmit()}} style={{{{width:"min(280px,90vw)",padding:"10px 14px",background:"#111",border:"1px solid #333",color:"white",borderRadius:8,fontSize:14}}}}/>
            <input placeholder="Email Address" value={{gateEmail}} onChange={{e=>setGateEmail(e.target.value)}} onKeyDown={{e=>e.key==="Enter"&&handleGateSubmit()}} style={{{{width:"min(280px,90vw)",padding:"10px 14px",background:"#111",border:"1px solid #333",color:"white",borderRadius:8,fontSize:14}}}}/>
            {{gateError && <p style={{{{color:"red",fontSize:13}}}}>{{gateError}}</p>}}
            <button onClick={{handleGateSubmit}} style={{{{width:"min(280px,90vw)",padding:"12px 0",background:"#00ffff",color:"#000",fontWeight:"bold",border:"none",borderRadius:8,cursor:"pointer",fontSize:14}}}}>Enter Site</button>
          {MC}
        )}}
      </AnimatePresence>

      {{/* ── SINGLE MODAL''',
    "gate",
)

# HERO
sub(
    r'          <div style=\{\{flex:1,overflowY:"auto",overflowX:"hidden",padding:isMobile\?"16px 14px 100px":30,WebkitOverflowScrolling:"touch"\}\}>.*?            </div>\n\n            \{activeTab==="home"',
    f'''          {DO}
            ref={{mainScrollRef}}
            style={{{{flex:1,overflowY:"auto",overflowX:"hidden",padding:0,WebkitOverflowScrolling:"touch"}}}}
          >
            {MO} style={{{{padding:isMobile?`0 0 ${{mobileScrollPadding}} 0`:"0 30px 30px"}}}}>
            {MO} style={{{{padding:isMobile?"0 14px":"0"}}}}>
            {{/* HERO — scroll compression on mobile */}}
            {MO} style={{{{
              position:"relative", height: mobileHeroHeight, marginBottom: 0,
              borderRadius: isMobile ? 0 : 20, overflow:"hidden", background:"black",
              transition: isMobile ? "height 0.08s cubic-bezier(0.25,0.46,0.45,0.94)" : "none",
            }}}}>
              <video autoPlay muted loop playsInline preload="auto" webkit-playsinline="true" src="/videos/A2B.mp4"
                style={{{{
                  position:"absolute",width:"100%",height:"100%",objectFit:"cover",
                  opacity: mobileVideoBrightness,
                  filter:`brightness(${{mobileVideoBrightness / 0.35}}) blur(${{isMobile ? Math.min(2, heroScrollY * 0.01) : 1}}px)`,
                  transform:`scale(${{isMobile ? 1 + heroScrollY * 0.0008 : 1}})`,
                  transition: isMobile ? "filter 0.1s, transform 0.1s" : "none",
                }}}}
              />
              {DO} style={{{{position:"absolute",inset:0,background:"linear-gradient(to top,black,transparent 60%)"}}}}/>
              {DO} style={{{{position:"absolute",inset:0,background:"radial-gradient(circle at center,transparent 30%,black 100%)"}}}}/>
              {MO} style={{{{position:"absolute",top:isMobile?16:25,left:isMobile?16:25,zIndex:10,opacity:heroTextOpacity,transform:`scale(${{heroTextScale}})`,transformOrigin:"top left",transition:isMobile?"opacity 0.08s, transform 0.08s":"none"}}}}>
                {DO} style={{{{fontSize:isMobile?28:42,fontWeight:900,letterSpacing:isMobile?5:8,animation:"pulse 2.5s infinite",textShadow:"0 0 20px rgba(0,255,255,0.8)"}}}}>2MRRW{DC}
              {MC}
              {MO} style={{{{position:"absolute",bottom:isMobile?14:24,right:isMobile?14:25,display:"flex",gap:isMobile?12:16,alignItems:"center",zIndex:10,flexWrap:"wrap",justifyContent:"flex-end",opacity:heroSocialsOp,transition:isMobile?"opacity 0.08s":"none"}}}}>
                {{SOCIALS.map(s=><a key={{s.name}} href={{s.href}} target="_blank" rel="noopener noreferrer" title={{s.name}} style={{{{color:"rgba(255,255,255,0.65)",transition:"transform 0.2s,color 0.2s,filter 0.2s",display:"flex",alignItems:"center",textDecoration:"none"}}}} onMouseEnter={{e=>{{e.currentTarget.style.transform="scale(1.5)";e.currentTarget.style.color="#00ffff";e.currentTarget.style.filter="drop-shadow(0 0 6px rgba(0,255,255,0.8))";}}}} onMouseLeave={{e=>{{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.color="rgba(255,255,255,0.65)";e.currentTarget.style.filter="none";}}}}>{{s.svg}}</a>)}}
              {MC}
            {MC}

            {{activeTab==="home"''',
    "hero",
)

sub(
    r'            </div>\{/\* end tabKey \*/\}\n          </motion.div>\{/\* end scroll area \*/\}',
    f'            {DC}{{/* end tabKey */}}\n            {MC}\n            {MC}\n          {DC}{{/* end scroll area */}}',
    "scroll-end",
)

sub(
    r'          \{/\* ── NOW PLAYING BAR ── \*/\}\n          \{nowPlaying && \(',
    '          {/* ── NOW PLAYING BAR (desktop) ── */}\n          {nowPlaying && !isMobile && (',
    "now-desktop",
)

P.write_text(c)
print("lines", len(c.splitlines()))
