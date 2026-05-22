/**
 * EXCERPTS from src/app/page.js — not runnable alone; for reference/copy
 *
 * Source: /Users/recharge/artist-platform/src/app/page.js
 * Extracted: 2026-05-20
 *
 * Required imports in page.js (see README.md):
 *   motion, AnimatePresence from "framer-motion"
 *   ImmersivePreviewModal, MobileNavAnimatedIcon, VaultNavLockIcon
 *   OVERLAY_FADE, SHEET_UP, SPRING_SOFT (defined near top of page.js)
 */

// ── MOBILE_NAV_TABS (page.js ~15-23) ─────────────────────────────────────────

const MOBILE_NAV_TABS = [
  { id: "home", label: "Home" },
  { id: "singles", label: "Music" },
  { id: "shop", label: "Shop" },
  { id: "cards", label: "Cards" },
  { id: "vault", label: "Vault", vault: true },
  { id: "shows", label: "Shows" },
  { id: "more", label: "More", more: true },
];

// ── MOBILE_NAV_MORE_SVG (page.js ~39-45) ─────────────────────────────────────

const MOBILE_NAV_MORE_SVG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
);

// ── mobileNavOpen state (page.js ~516) ───────────────────────────────────────
//
//   const [mobileNavOpen, setMobileNavOpen] = useState(false);
//
// Opened by More tab: onClick={() => tab.more ? setMobileNavOpen(true) : switchTab(tab.id)}
// Closed by: overlay click, switchTab() when isMobile, More sheet dismiss

// ── isMobileNavTabActive helper (page.js ~959-965) — used by bottom nav ─────

const isMobileNavTabActive = (tabId) => {
  // Depends on: activeTab, homeScrollSection (page state)
  if (tabId === "cards") return activeTab === "cards" || (activeTab === "home" && homeScrollSection === "cards");
  if (tabId === "vault") return activeTab === "vault" || (activeTab === "home" && homeScrollSection === "vault");
  if (tabId === "shows") return activeTab === "shows" || (activeTab === "home" && homeScrollSection === "shows");
  if (tabId === "singles") return activeTab === "singles" || activeTab === "albums" || activeTab === "mymusic";
  return activeTab === tabId;
};

// ── ImmersivePreviewModal usage (page.js ~1136-1150) ─────────────────────────

/*
      <AnimatePresence>
        {selectedSingle && (
          <ImmersivePreviewModal
            key={selectedSingle.slug}
            single={selectedSingle}
            releaseDetail={selectedReleaseDetail}
            isMobile={isMobile}
            audioRef={modalAudioRef}
            onClose={() => setSelectedSingle(null)}
            onAddToCart={addToCart}
            onAddVinyl={addVinylToCart}
          />
        )}
      </AnimatePresence>
*/

// ── Mobile bottom nav JSX (page.js ~1998-2026) ───────────────────────────────

/*
          <motion.div style={{
            position:"fixed",bottom:0,left:0,right:0,zIndex:6700,
            background:"rgba(6,6,6,0.94)",backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",
            borderTop:"1px solid rgba(255,255,255,0.06)",
            display:"flex",alignItems:"center",justifyContent:"space-evenly",
            paddingTop:6,paddingBottom:"max(14px, env(safe-area-inset-bottom))",
            minHeight:62,overflow:"visible",isolation:"auto",
          }}>
            {MOBILE_NAV_TABS.map(tab=>{
              const active = tab.more ? mobileNavOpen : isMobileNavTabActive(tab.id);
              return (
                <button
                  key={tab.id}
                  onClick={()=> tab.more ? setMobileNavOpen(true) : switchTab(tab.id)}
                  style={{
                    display:"flex",flexDirection:"column",alignItems:"center",gap:2,
                    background:"none",border:"none",cursor:"pointer",
                    color:active?"#00ffff":"#555",fontSize:9,fontWeight:700,letterSpacing:0.5,
                    padding:"4px 4px",borderRadius:10,flex:1,minWidth:0,maxWidth:56,minHeight:44,justifyContent:"center",
                    textShadow:active?"0 0 12px rgba(0,255,255,0.5)":"none",
                    transition:"color 0.2s",
                  }}
                >
                  {tab.vault ? <VaultNavLockIcon /> : tab.more ? MOBILE_NAV_MORE_SVG : <MobileNavAnimatedIcon tabId={tab.id} />}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </motion.div>
*/

// ── More sheet overlay (page.js ~2068-2096) ───────────────────────────────────

/*
          <AnimatePresence>
            {mobileNavOpen && (
              <motion.div
                key="nav-sheet"
                {...OVERLAY_FADE}
                onClick={()=>setMobileNavOpen(false)}
                style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:8100,display:"flex",alignItems:"flex-end"}}
              >
                <motion.div
                  {...SHEET_UP}
                  onClick={e=>e.stopPropagation()}
                  style={{width:"100%",background:"#0a0a0a",borderRadius:"20px 20px 0 0",paddingBottom:"max(32px, env(safe-area-inset-bottom))",border:"1px solid #1e1e1e",maxHeight:"80vh",overflowY:"auto"}}
                >
                  <motion.div style={{width:36,height:4,borderRadius:2,background:"#333",margin:"14px auto 16px"}}/>
                  {currentUser&&userStatus&&<motion.div style={{padding:"10px 24px",marginBottom:4,display:"flex",alignItems:"center",gap:10}}><motion.div style={{width:32,height:32,borderRadius:"50%",background:"linear-gradient(135deg,#00ffff22,#a259ff22)",border:"1px solid #333",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:900,color:"#00ffff"}}>{currentUser.name[0].toUpperCase()}</motion.div><motion.div><motion.div style={{fontSize:13,fontWeight:700,color:"white"}}>{currentUser.name}</motion.div><motion.div style={{fontSize:9,color:userStatus.color,fontWeight:700,letterSpacing:1}}>{userStatus.label}</motion.div></motion.div></motion.div>}
                  {sidebarNav.map(group=>(
                    <motion.div key={group.groupId}>
                      <button onClick={()=>switchTab(group.directTab)} style={{width:"100%",padding:"13px 24px",background:"none",border:"none",color:activeTab===group.directTab||group.subTabs.some(st=>st.id===activeTab)?"#00ffff":"#ccc",fontSize:13,fontWeight:700,letterSpacing:2,textAlign:"left",cursor:"pointer",textTransform:"uppercase",transition:"color 0.2s"}}>{group.label}</button>
                      {group.subTabs.length>0 && <motion.div style={{paddingLeft:16,paddingBottom:4}}>{group.subTabs.map(st=><button key={st.id} onClick={()=>switchTab(st.id)} style={{width:"100%",padding:"9px 24px",background:"none",border:"none",color:activeTab===st.id?"#00ffff":"#666",fontSize:12,textAlign:"left",cursor:"pointer",letterSpacing:1,transition:"color 0.2s"}}>{st.label}</button>)}</motion.div>}
                    </motion.div>
                  ))}
                  <motion.div style={{padding:"14px 24px",borderTop:"1px solid #111",marginTop:4,display:"flex",flexDirection:"column",gap:10}}>
                    <button onClick={()=>switchTab("account")} style={{width:"100%",padding:"13px 0",background:"#00ffff",color:"#000",fontWeight:900,border:"none",borderRadius:10,cursor:"pointer",fontSize:14,letterSpacing:1}}>My Account</button>
                    <button onClick={()=>setSoundOn(!soundOn)} style={{width:"100%",padding:"11px 0",background:"transparent",color:soundOn?"#00ffff":"#666",fontWeight:700,border:"1px solid #2a2a2a",borderRadius:10,cursor:"pointer",fontSize:13,letterSpacing:1}}>{soundOn?"♫ Sound On":"♫ Sound Off"}</button>
                  </motion.div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
*/
