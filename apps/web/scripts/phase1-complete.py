#!/usr/bin/env python3
"""Apply Phase 1 mobile UX to clean page.js."""
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "src/app/page.js"
lines = PATH.read_text().splitlines(keepends=True)

def idx(marker):
    for i, l in enumerate(lines):
        if marker in l:
            return i
    raise ValueError(f"marker not found: {marker}")

def rep(start_marker, end_marker, new_text):
    global lines
    s = idx(start_marker)
    e = idx(end_marker)
    block = new_text if new_text.endswith("\n") else new_text + "\n"
    lines = lines[:s] + [block] + lines[e:]
    print(f"replaced {start_marker} -> {end_marker} ({e-s} lines)")

# 1 import
if "framer-motion" not in lines[1]:
    lines.insert(2, 'import { motion, AnimatePresence } from "framer-motion";\n')
    print("import added")

# 2 constants
if "SPRING_SOFT" not in "".join(lines[:30]):
    ins = idx("const stripePromise")
    consts = '''
// ── SPRING CONFIG (iOS-feel) ──────────────────────────────────────────────────
const SPRING_SOFT = { type: "spring", stiffness: 280, damping: 32 };
const OVERLAY_FADE = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.22 } };
const SHEET_UP = { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%" }, transition: SPRING_SOFT };
const MODAL_CENTER = { initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.96 }, transition: SPRING_SOFT };
const MOBILE_NAV_SVGS = {
  home: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1V9.5z"/></svg>,
  music: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
  shop: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>,
  vault: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  shows: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>,
  more: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>,
};

'''
    lines.insert(ins + 1, consts)
    print("constants added")

# 3 state + ref
if "heroScrollY" not in "".join(lines):
    i = idx("const [mobileNavOpen")
    lines.insert(i + 1, "  const [heroScrollY, setHeroScrollY]             = useState(0);\n")
    j = idx("const modalAudioRef")
    lines.insert(j + 1, "  const mainScrollRef      = useRef(null);\n")
    print("state/ref added")

# 4 scroll effect
if "mainScrollRef.current" not in "".join(lines):
    i = idx("window.addEventListener(\"resize\", check);")
    eff = '''  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    const onScroll = () => setHeroScrollY(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

'''
    lines.insert(i + 4, eff)
    print("scroll effect added")

# 5 computed
if "mobileHeroHeight" not in "".join(lines):
    i = idx("  return (")
    comp = '''  const mobileHeroHeight = isMobile ? Math.max(108, 200 - heroScrollY * 0.46) : 380;
  const mobileVideoBrightness = isMobile ? Math.max(0.08, 0.35 - heroScrollY * 0.0025) : 0.35;
  const heroTextOpacity = isMobile ? Math.max(0, 1 - heroScrollY / 70) : 1;
  const heroTextScale = isMobile ? Math.max(0.72, 1 - heroScrollY / 350) : 1;
  const heroSocialsOp = isMobile ? Math.max(0, 1 - heroScrollY / 60) : 1;
  const mobileScrollPadding = isMobile ? (nowPlaying ? "178px" : "110px") : "30px";
  const mobileCartFabBottom = nowPlaying
    ? "calc(62px + env(safe-area-inset-bottom, 0px) + 72px)"
    : "calc(62px + env(safe-area-inset-bottom, 0px) + 12px)";
  const mobileMiniPlayerBottom = "calc(62px + env(safe-area-inset-bottom, 0px) + 8px)";

'''
    lines.insert(i, comp)
    print("computed added")

GATE = '''      {/* ── GATE ── */}
      <AnimatePresence>
        {!gateSubmitted && (
          <motion.div key="gate" {...OVERLAY_FADE} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,padding:30}}>
            <motion.div style={{fontSize:28,fontWeight:900,letterSpacing:6,color:"white",textShadow:"0 0 20px rgba(0,255,255,0.8)"}}>2MRRW</motion.div>
            <p style={{color:"#aaa",marginBottom:10,textAlign:"center"}}>Enter your info to access the site</p>
            <input placeholder="Full Name" value={gateName} onChange={e=>setGateName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleGateSubmit()} style={{width:"min(280px,90vw)",padding:"10px 14px",background:"#111",border:"1px solid #333",color:"white",borderRadius:8,fontSize:14}}/>
            <input placeholder="Phone Number" value={gatePhone} onChange={e=>setGatePhone(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleGateSubmit()} style={{width:"min(280px,90vw)",padding:"10px 14px",background:"#111",border:"1px solid #333",color:"white",borderRadius:8,fontSize:14}}/>
            <input placeholder="Email Address" value={gateEmail} onChange={e=>setGateEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleGateSubmit()} style={{width:"min(280px,90vw)",padding:"10px 14px",background:"#111",border:"1px solid #333",color:"white",borderRadius:8,fontSize:14}}/>
            {gateError && <p style={{color:"red",fontSize:13}}>{gateError}</p>}
            <button onClick={handleGateSubmit} style={{width:"min(280px,90vw)",padding:"12px 0",background:"#00ffff",color:"#000",fontWeight:"bold",border:"none",borderRadius:8,cursor:"pointer",fontSize:14}}>Enter Site</button>
          </motion.div>
        )}
      </AnimatePresence>

'''

# Fix GATE - inner 2MRRW should be div not motion - fix in string
GATE = GATE.replace(
    '<motion.div style={{fontSize:28,fontWeight:900,letterSpacing:6,color:"white",textShadow:"0 0 20px rgba(0,255,255,0.8)"}}>2MRRW</motion.div>',
    '<div style={{fontSize:28,fontWeight:900,letterSpacing:6,color:"white",textShadow:"0 0 20px rgba(0,255,255,0.8)"}}>2MRRW</div>',
)

SINGLE = open(Path(__file__).parent / "_single_modal.txt").read() if (Path(__file__).parent / "_single_modal.txt").exists() else None
