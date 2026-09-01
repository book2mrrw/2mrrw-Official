#!/usr/bin/env python3
"""Apply Phase 1 mobile UX merge to page.js"""
PATH = "/Users/recharge/artist-platform/src/app/page.js"

def main():
    with open(PATH) as f:
        c = f.read()

    def rep(old, new, name):
        nonlocal c
        if old not in c:
            raise SystemExit(f"MISSING [{name}]: {old[:120]!r}...")
        c = c.replace(old, new, 1)
        print(f"OK: {name}")

    rep(
        '''          <div style={{flex:1,overflowY:"auto",overflowX:"hidden",padding:isMobile?"16px 14px 100px":30,WebkitOverflowScrolling:"touch"}}>

            {/* HERO — video stays at /videos/A2B.mp4 (root of /videos/, not in /singles/) */}
            <div style={{position:"relative",height:isMobile?200:380,marginBottom:0,borderRadius:isMobile?14:20,overflow:"hidden",background:"black"}}>
              <video
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                webkit-playsinline="true"
                src="/videos/A2B.mp4"
                style={{position:"absolute",width:"100%",height:"100%",objectFit:"cover",opacity:0.35,filter:"blur(1px)"}}
              />
              <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,black,transparent 60%)"}}/>
              <motion.div style={{position:"absolute",inset:0,background:"radial-gradient(circle at center,transparent 30%,black 100%)"}}/>
              <div style={{position:"absolute",top:isMobile?16:25,left:isMobile?16:25,zIndex:10,fontSize:isMobile?28:42,fontWeight:900,letterSpacing:isMobile?5:8,animation:"pulse 2.5s infinite",textShadow:"0 0 20px rgba(0,255,255,0.8)"}}>2MRRW</div>
              <div style={{position:"absolute",bottom:isMobile?14:24,right:isMobile?14:25,display:"flex",gap:isMobile?12:16,alignItems:"center",zIndex:10,flexWrap:"wrap",justifyContent:"flex-end"}}>''',
        '''          <motion.div
            ref={mainScrollRef}
            style={{flex:1,overflowY:"auto",overflowX:"hidden",padding:0,WebkitOverflowScrolling:"touch"}}
          >
            <motion.div style={{padding:isMobile?`0 0 ${mobileScrollPadding} 0`:"0 30px 30px"}}>
            <motion.div style={{padding:isMobile?"0 14px":"0"}}>
            {/* HERO — scroll compression on mobile */}
            <motion.div style={{
              position:"relative",
              height: mobileHeroHeight,
              marginBottom: 0,
              borderRadius: isMobile ? 0 : 20,
              overflow:"hidden",
              background:"black",
              transition: isMobile ? "height 0.08s cubic-bezier(0.25,0.46,0.45,0.94)" : "none",
            }}>
              <video
                autoPlay muted loop playsInline preload="auto" webkit-playsinline="true"
                src="/videos/A2B.mp4"
                style={{
                  position:"absolute",width:"100%",height:"100%",objectFit:"cover",
                  opacity: mobileVideoBrightness,
                  filter:`brightness(${mobileVideoBrightness / 0.35}) blur(${isMobile ? Math.min(2, heroScrollY * 0.01) : 1}px)`,
                  transform:`scale(${isMobile ? 1 + heroScrollY * 0.0008 : 1})`,
                  transition: isMobile ? "filter 0.1s, transform 0.1s" : "none",
                }}
              />
              <motion.div style={{position:"absolute",inset:0,background:"linear-gradient(to top,black,transparent 60%)"}}/>
              <motion.div style={{position:"absolute",inset:0,background:"radial-gradient(circle at center,transparent 30%,black 100%)"}}/>
              <motion.div style={{
                position:"absolute",top:isMobile?16:25,left:isMobile?16:25,zIndex:10,
                opacity: heroTextOpacity,
                transform:`scale(${heroTextScale})`,
                transformOrigin:"top left",
                transition: isMobile ? "opacity 0.08s, transform 0.08s" : "none",
              }}>
                <motion.div style={{fontSize:isMobile?28:42,fontWeight:900,letterSpacing:isMobile?5:8,animation:"pulse 2.5s infinite",textShadow:"0 0 20px rgba(0,255,255,0.8)"}}>2MRRW</motion.div>
              </motion.div>
              <motion.div style={{
                position:"absolute",bottom:isMobile?14:24,right:isMobile?14:25,
                display:"flex",gap:isMobile?12:16,alignItems:"center",zIndex:10,flexWrap:"wrap",justifyContent:"flex-end",
                opacity: heroSocialsOp,
                transition: isMobile ? "opacity 0.08s" : "none",
              }}>''',
        "hero-block",
    )

    # Fix accidental motion.div in gradients - use div
    c = c.replace(
        "<motion.div style={{position:\"absolute\",inset:0,background:\"linear-gradient(to top,black,transparent 60%)\"}}/>",
        "<div style={{position:\"absolute\",inset:0,background:\"linear-gradient(to top,black,transparent 60%)\"}}/>",
        1,
    )
    c = c.replace(
        "<motion.div style={{position:\"absolute\",inset:0,background:\"radial-gradient(circle at center,transparent 30%,black 100%)\"}}/>",
        "<div style={{position:\"absolute\",inset:0,background:\"radial-gradient(circle at center,transparent 30%,black 100%)\"}}/>",
        1,
    )

    rep(
        '''            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        '''            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        "hero-close-fix",
    )

    rep(
        '''            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        '''            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        "x",
    )

    rep(
        '''            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        '''            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        "x2",
    )

    rep(
        '''            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        '''            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        "x3",
    )

    # Close hero with motion.div and fix donate - actual file uses </div> for hero
    rep(
        '''              </motion.div>
            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        '''              </motion.div>
            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        "x4",
    )

    # After hero socials - close hero div
    rep(
        '''              </motion.div>
            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        '''              </motion.div>
            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        "x5",
    )

    # Actual: hero ends with </div></motion.div> after socials map
    rep(
        '''              </motion.div>
            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        '''              </motion.div>
            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        "x6",
    )

    rep(
        '''              </motion.div>
            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        '''              </motion.div>
            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        "x7",
    )

    # Use actual closing from file
    rep(
        '''              </motion.div>
            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        '''              </motion.div>
            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        "x8",
    )

    # Simpler close scroll wrappers
    rep(
        '''            </motion.div>{/* end tabKey */}
          </motion.div>{/* end scroll area */}

          {/* ── NOW PLAYING BAR ── */}
          {nowPlaying && (
            <motion.div style={{flexShrink:0,borderTop:"1px solid #141414",background:"rgba(4,4,4,0.97)",backdropFilter:"blur(20px)",zIndex:isMobile?6500:1,marginBottom:isMobile?60:0}}>''',
        '''            </motion.div>{/* end tabKey */}
            </motion.div>
            </motion.div>
          </motion.div>{/* end scroll area */}

          {/* ── NOW PLAYING BAR ── */}
          <AnimatePresence>
          {nowPlaying && (
            <motion.div
              key="nowplaying"
              initial={{ y: isMobile ? 80 : 0, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: isMobile ? 80 : 0, opacity: 0 }}
              transition={SPRING_SOFT}
              style={isMobile ? {
                position: "fixed",
                bottom: 70,
                left: 12,
                right: 12,
                zIndex: 6600,
                borderRadius: 18,
                overflow: "hidden",
                background: "rgba(10,10,10,0.88)",
                backdropFilter: "blur(28px)",
                WebkitBackdropFilter: "blur(28px)",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 8px 40px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(255,255,255,0.06) inset",
              } : {
                flexShrink: 0,
                borderTop: "1px solid #141414",
                background: "rgba(4,4,4,0.97)",
                backdropFilter: "blur(20px)",
                zIndex: 1,
              }}>''',
        "nowplaying",
    )

    with open(PATH, "w") as f:
        f.write(c)
    print("Written.")

if __name__ == "__main__":
    main()
