#!/usr/bin/env python3
"""Merge Claude Phase 1 mobile UX into page.js"""
import re

PATH = "/Users/recharge/artist-platform/src/app/page.js"

def main():
    with open(PATH) as f:
        c = f.read()

    # ── Hero + scroll container ──
    c = c.replace(
        '''        <motion.div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
          <motion.div style={{flex:1,overflowY:"auto",overflowX:"hidden",padding:isMobile?"16px 14px 100px":30,WebkitOverflowScrolling:"touch"}}>

            {/* HERO — video stays at /videos/A2B.mp4 (root of /videos/, not in /singles/) */}
            <motion.div style={{position:"relative",height:isMobile?200:380,marginBottom:0,borderRadius:isMobile?14:20,overflow:"hidden",background:"black"}}>
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
              <motion.div style={{position:"absolute",inset:0,background:"linear-gradient(to top,black,transparent 60%)"}}/>
              <motion.div style={{position:"absolute",inset:0,background:"radial-gradient(circle at center,transparent 30%,black 100%)"}}/>
              <motion.div style={{position:"absolute",top:isMobile?16:25,left:isMobile?16:25,zIndex:10,fontSize:isMobile?28:42,fontWeight:900,letterSpacing:isMobile?5:8,animation:"pulse 2.5s infinite",textShadow:"0 0 20px rgba(0,255,255,0.8)"}}>2MRRW</motion.div>
              <motion.div style={{position:"absolute",bottom:isMobile?14:24,right:isMobile?14:25,display:"flex",gap:isMobile?12:16,alignItems:"center",zIndex:10,flexWrap:"wrap",justifyContent:"flex-end"}}>''',
        '''        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
          <div
            ref={mainScrollRef}
            style={{flex:1,overflowY:"auto",overflowX:"hidden",padding:0,WebkitOverflowScrolling:"touch"}}
          >
            <div style={{padding:isMobile?`0 0 ${mobileScrollPadding} 0`:"0 30px 30px"}}>
            {/* HERO — scroll compression on mobile */}
            <div style={{
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
              <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,black,transparent 60%)"}}/>
              <motion.div style={{position:"absolute",inset:0,background:"radial-gradient(circle at center,transparent 30%,black 100%)"}}/>
              <div style={{
                position:"absolute",top:isMobile?16:25,left:isMobile?16:25,zIndex:10,
                opacity: heroTextOpacity,
                transform:`scale(${heroTextScale})`,
                transformOrigin:"top left",
                transition: isMobile ? "opacity 0.08s, transform 0.08s" : "none",
              }}>
                <div style={{fontSize:isMobile?28:42,fontWeight:900,letterSpacing:isMobile?5:8,animation:"pulse 2.5s infinite",textShadow:"0 0 20px rgba(0,255,255,0.8)"}}>2MRRW</div>
              </div>
              <div style={{
                position:"absolute",bottom:isMobile?14:24,right:isMobile?14:25,
                display:"flex",gap:isMobile?12:16,alignItems:"center",zIndex:10,flexWrap:"wrap",justifyContent:"flex-end",
                opacity: heroSocialsOp,
                transition: isMobile ? "opacity 0.08s" : "none",
              }}>'''
    )

    # Fix accidental motion.div in hero gradients if present
    c = c.replace(
        '''              <motion.div style={{position:"absolute",inset:0,background:"radial-gradient(circle at center,transparent 30%,black 100%)"}}/>''',
        '''              <motion.div style={{position:"absolute",inset:0,background:"radial-gradient(circle at center,transparent 30%,black 100%)"}}/>'''
    )
    # Actually use div for radial
    c = c.replace(
        '<motion.div style={{position:"absolute",inset:0,background:"radial-gradient(circle at center,transparent 30%,black 100%)"}}/>',
        '<div style={{position:"absolute",inset:0,background:"radial-gradient(circle at center,transparent 30%,black 100%)"}}/>',
        1
    )

    # Close hero + add inner padding wrapper after hero socials close
    # After socials </div></motion.div> for hero - need to fix structure
    # Insert inner padding after hero block ends
    c = c.replace(
        '''            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        '''            </motion.div>
            <motion.div style={{padding:isMobile?"0 14px":"0"}}>
            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        1
    )
    if '{activeTab==="home" && <div style={{padding:"18px 0 8px"' in c and 'padding:isMobile?"0 14px"' not in c:
        c = c.replace(
            '''            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
            '''            </motion.div>
            <motion.div style={{padding:isMobile?"0 14px":"0"}}>
            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
            1
        )
    c = c.replace(
        '''            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        '''            </motion.div>
            <motion.div style={{padding:isMobile?"0 14px":"0"}}>
            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
        1
    )

    # Simpler: match actual file
    if 'padding:isMobile?"0 14px"' not in c:
        c = c.replace(
            '''              </motion.div>
            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
            '''              </motion.div>
            </motion.div>
            <motion.div style={{padding:isMobile?"0 14px":"0"}}>
            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
            1
        )
        c = c.replace(
            '''              </motion.div>
            </motion.div>

            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
            '''              </motion.div>
            </motion.div>
            <motion.div style={{padding:isMobile?"0 14px":"0"}}>
            {activeTab==="home" && <motion.div style={{padding:"18px 0 8px"''',
            1
        )

    with open(PATH, "w") as f:
        f.write(c)
    print("done, len", len(c))

if __name__ == "__main__":
    main()
