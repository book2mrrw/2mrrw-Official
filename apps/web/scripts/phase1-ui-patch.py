#!/usr/bin/env python3
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "src/app/page.js"
lines = PATH.read_text().splitlines(keepends=True)

def find_line(substr):
    for i, ln in enumerate(lines):
        if substr in ln:
            return i
    return -1

def replace_range(start, end, new_lines):
    global lines
    lines = lines[:start] + new_lines + lines[end:]

# Find markers
gate_start = find_line("{/* ── GATE ── */}")
single_start = find_line("{/* ── SINGLE MODAL ── */}")
album_start = find_line("{/* ── ALBUM MODAL ── */}")
ticket_start = find_line("{/* ── TICKET MODAL ── */}")
now_start = find_line("{/* ── NOW PLAYING BAR ── */}")
desktop_cart = find_line("{/* ── DESKTOP CART SIDEBAR ── */}")
mobile_start = find_line("{/* ── MOBILE UI ── */}")
css_start = find_line("{/* ── CSS ── */}")
stripe_start = find_line("{/* ── STRIPE MODAL ── */}")

GATE = '''      {/* ── GATE ── */}
      <AnimatePresence>
        {!gateSubmitted && (
          <motion.div
            key="gate"
            {...OVERLAY_FADE}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,padding:30}}
          >
            <div style={{fontSize:28,fontWeight:900,letterSpacing:6,color:"white",textShadow:"0 0 20px rgba(0,255,255,0.8)"}}>2MRRW</motion.div>
            <p style={{color:"#aaa",marginBottom:10,textAlign:"center"}}>Enter your info to access the site</p>
            <input placeholder="Full Name"     value={gateName}  onChange={e=>setGateName(e.target.value)}  onKeyDown={e=>e.key==="Enter"&&handleGateSubmit()} style={{width:"min(280px,90vw)",padding:"10px 14px",background:"#111",border:"1px solid #333",color:"white",borderRadius:8,fontSize:14}}/>
            <input placeholder="Phone Number"  value={gatePhone} onChange={e=>setGatePhone(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleGateSubmit()} style={{width:"min(280px,90vw)",padding:"10px 14px",background:"#111",border:"1px solid #333",color:"white",borderRadius:8,fontSize:14}}/>
            <input placeholder="Email Address" value={gateEmail} onChange={e=>setGateEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleGateSubmit()} style={{width:"min(280px,90vw)",padding:"10px 14px",background:"#111",border:"1px solid #333",color:"white",borderRadius:8,fontSize:14}}/>
            {gateError && <p style={{color:"red",fontSize:13}}>{gateError}</p>}
            <button onClick={handleGateSubmit} style={{width:"min(280px,90vw)",padding:"12px 0",background:"#00ffff",color:"#000",fontWeight:"bold",border:"none",borderRadius:8,cursor:"pointer",fontSize:14}}>Enter Site</button>
          </motion.div>
        )}
      </AnimatePresence>

'''

SINGLE = '''      {/* ── SINGLE MODAL ── */}
      <AnimatePresence>
        {selectedSingle && (
          <motion.div
            key="single-overlay"
            {...OVERLAY_FADE}
            onClick={() => setSelectedSingle(null)}
            style={{
              position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:8888,
              display:"flex",alignItems:isMobile?"flex-end":"center",justifyContent:"center",
              padding:isMobile?0:16,
            }}
          >
            <motion.div
              key="single-sheet"
              {...(isMobile ? SHEET_UP : MODAL_CENTER)}
              onClick={e => e.stopPropagation()}
              style={{
                background:"#0d0d0d",
                border:isMobile?"1px solid #1e1e1e":"1px solid #222",
                borderRadius:isMobile?"20px 20px 0 0":20,
                width:isMobile?"100%":340,
                maxWidth:isMobile?"100%":"none",
                maxHeight:isMobile?"92vh":"90vh",
                overflow:"hidden",
                display:"flex",
                flexDirection:"column",
              }}
            >
              {isMobile && <motion.div style={{width:36,height:4,borderRadius:2,background:"#333",margin:"12px auto 0",flexShrink:0}} />}
              {isMobile ? (
                <motion.div style={{position:"relative",width:"100%",height:220,flexShrink:0,overflow:"hidden"}}>
                  <video
                    key={selectedSingle.slug}
                    src={selectedSingle.video}
                    autoPlay muted loop playsInline preload="auto" webkit-playsinline="true"
                    style={{width:"100%",height:"100%",objectFit:"cover",pointerEvents:"none"}}
                  />
                  <motion.div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(0,0,0,0.85) 0%,transparent 55%)"}} />
                </motion.div>
              ) : (
                <motion.div style={{padding:"24px 24px 0",display:"flex",flexDirection:"column",alignItems:"center",gap:14}}>
                  <video
                    key={selectedSingle.slug}
                    src={selectedSingle.video}
                    autoPlay muted loop playsInline preload="auto" webkit-playsinline="true"
                    style={{width:200,height:200,borderRadius:14,objectFit:"cover",display:"block",pointerEvents:"none"}}
                  />
                </motion.div>
              )}
              <motion.div style={{padding:isMobile?"16px 20px 28px":"0 24px 24px",display:"flex",flexDirection:"column",gap:12,overflowY:"auto"}}>
                <motion.div style={{fontSize:isMobile?20:18,fontWeight:800}}>{selectedSingle.title}</motion.div>
                <motion.div style={{fontSize:12,opacity:0.5,letterSpacing:1}}>SINGLE PREVIEW · ${selectedSingle.price.toFixed(2)}</motion.div>
                <motion.div style={{width:"100%"}}>
                  <ModalAudioPlayer audioRef={modalAudioRef} isMobile={isMobile}/>
                </motion.div>
                <button onClick={()=>{addToCart(selectedSingle);setSelectedSingle(null);}} style={{width:"100%",padding:"12px 0",background:"#1f1f1f",color:"white",border:"1px solid #333",borderRadius:10,cursor:"pointer",fontSize:13,fontWeight:700}}>Add to Cart – ${selectedSingle.price.toFixed(2)}</button>
                <button onClick={()=>{addVinylToCart(selectedSingle);setSelectedSingle(null);}} style={{width:"100%",padding:"12px 0",background:"#0a0a0a",color:"#00ffff",border:"1px solid #00ffff",borderRadius:10,cursor:"pointer",fontSize:13,fontWeight:"bold"}}>+ Add Vinyl – $47.99 (Optional)</button>
                <button onClick={()=>setSelectedSingle(null)} style={{background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:12,marginTop:4}}>Close</button>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

'''

ALBUM = '''      {/* ── ALBUM MODAL ── */}
      <AnimatePresence>
        {selectedAlbum && (
          <motion.div
            key="album-overlay"
            {...OVERLAY_FADE}
            onClick={() => setSelectedAlbum(null)}
            style={{
              position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:8888,
              display:"flex",alignItems:isMobile?"flex-end":"center",justifyContent:"center",
              padding:isMobile?0:16,
            }}
          >
            <motion.div
              key="album-sheet"
              {...(isMobile ? SHEET_UP : MODAL_CENTER)}
              onClick={e => e.stopPropagation()}
              style={{
                background:"#0d0d0d",
                border:isMobile?"1px solid #1e1e1e":"1px solid #222",
                borderRadius:isMobile?"20px 20px 0 0":20,
                width:isMobile?"100%":320,
                maxWidth:isMobile?"100%":"none",
                maxHeight:isMobile?"88vh":"80vh",
                overflowY:"auto",
                display:"flex",
                flexDirection:"column",
                alignItems:"center",
                gap:10,
                padding:isMobile?"0 0 28px":"22px 26px",
              }}
            >
              {isMobile && <motion.div style={{width:36,height:4,borderRadius:2,background:"#333",margin:"12px auto 0",flexShrink:0}} />}
              {isMobile && (
                <motion.div style={{position:"relative",width:"100%",height:180,flexShrink:0,overflow:"hidden"}}>
                  <img src={selectedAlbum.cover} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}} alt="" />
                  <motion.div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(0,0,0,0.9) 0%,transparent 50%)"}} />
                  <motion.div style={{position:"absolute",bottom:16,left:20,right:20}}>
                    <motion.div style={{fontSize:20,fontWeight:900,letterSpacing:2}}>{selectedAlbum.title}</motion.div>
                    <motion.div style={{fontSize:11,opacity:0.5,letterSpacing:1,marginTop:4}}>{selectedAlbum.date}</motion.div>
                  </motion.div>
                </motion.div>
              )}
              <motion.div style={{padding:isMobile?"0 20px":"0",width:"100%",display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
                {!isMobile && <img src={selectedAlbum.cover} style={{width:130,height:130,borderRadius:10,objectFit:"cover"}} alt="" />}
                {!isMobile && <motion.div style={{fontSize:17,fontWeight:900,letterSpacing:2,textAlign:"center"}}>{selectedAlbum.title}</motion.div>}
                {!isMobile && <motion.div style={{fontSize:11,opacity:0.4,letterSpacing:1}}>{selectedAlbum.date}</motion.div>}
                <motion.div style={{width:"100%",marginTop:4}}>
                  <motion.div style={{fontSize:10,letterSpacing:2,opacity:0.4,marginBottom:8,textTransform:"uppercase"}}>Track Listing</motion.div>
                  {selectedAlbum.tracks.map((t,i)=><motion.div key={i} style={{padding:"6px 0",fontSize:13,borderBottom:"1px solid #1a1a1a",color:"white"}}>{i+1}. {t}</motion.div>)}
                </motion.div>
                <button onClick={()=>{addToCart(selectedAlbum);setSelectedAlbum(null);}} style={{width:"100%",padding:"12px 0",background:"#1f1f1f",color:"white",border:"1px solid #333",borderRadius:10,cursor:"pointer",fontSize:13,marginTop:6,fontWeight:700}}>Add to Cart – ${selectedAlbum.price.toFixed(2)}</button>
                <button onClick={()=>{addToCart({title:`${selectedAlbum.title} – Vinyl`,slug:`${selectedAlbum.slug}-vinyl`,cover:selectedAlbum.cover,price:selectedAlbum.vinyl});setSelectedAlbum(null);}} style={{width:"100%",padding:"12px 0",background:"#0a0a0a",color:"#00ffff",border:"1px solid #00ffff",borderRadius:10,cursor:"pointer",fontSize:13,fontWeight:"bold"}}>+ Add Vinyl – ${selectedAlbum.vinyl.toFixed(2)} (Optional)</button>
                <button onClick={()=>setSelectedAlbum(null)} style={{background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:12,marginTop:4}}>Close</button>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

'''

NOW_DESKTOP = '''          {/* ── NOW PLAYING BAR (desktop) ── */}
          {nowPlaying && !isMobile && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              style={{flexShrink:0,borderTop:"1px solid #141414",background:"rgba(4,4,4,0.97)",backdropFilter:"blur(20px)",zIndex:1}}
            >
              <motion.div onClick={seekTo} style={{width:"100%",height:3,background:"#111",cursor:"pointer",position:"relative"}}>
                <motion.div style={{width:audioDuration?`${(audioCurrentTime/audioDuration)*100}%`:"0%",height:"100%",background:"#00ffff",transition:"width 0.1s linear",boxShadow:"0 0 4px rgba(0,255,255,0.5)"}}/>
              </motion.div>
              <motion.div style={{padding:"10px 20px",display:"flex",alignItems:"center",gap:14,boxShadow:"0 -4px 30px rgba(0,0,0,0.5)"}}>
                <img src={nowPlaying.cover} alt="" style={{width:36,height:36,borderRadius:8,objectFit:"cover",flexShrink:0}}/>
                <motion.div style={{flex:1,minWidth:0}}>
                  <motion.div style={{fontSize:12,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{nowPlaying.title}</motion.div>
                  <motion.div style={{fontSize:10,color:"#555",letterSpacing:1,fontVariantNumeric:"tabular-nums"}}>{formatTime(audioCurrentTime)} / {formatTime(audioDuration)}</motion.div>
                </motion.div>
                <button onClick={()=>{
                  if (!nowPlayingAudioRef.current) return;
                  if (nowPlayingPlaying) { nowPlayingAudioRef.current.pause(); setNowPlayingPlaying(false); }
                  else { nowPlayingAudioRef.current.play().catch(()=>{}); setNowPlayingPlaying(true); }
                }} style={{width:36,height:36,borderRadius:"50%",background:"#00ffff",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
                  {nowPlayingPlaying
                    ? <svg viewBox="0 0 24 24" fill="#000" width="14" height="14"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
                    : <svg viewBox="0 0 24 24" fill="#000" width="14" height="14" style={{marginLeft:2}}><path d="M8 5v14l11-7z"/></svg>}
                </button>
                <button onClick={()=>{setNowPlaying(null);setNowPlayingPlaying(false);if(nowPlayingAudioRef.current)nowPlayingAudioRef.current.pause();}} style={{background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:18,lineHeight:1,flexShrink:0}}>×</button>
              </motion.div>
            </motion.div>
          )}
'''

MOBILE_UI = '''      {/* ── MOBILE UI ── */}
      {isMobile && (
        <>
          <motion.button
            layout
            onClick={()=>setMobileCartOpen(true)}
            animate={{ bottom: mobileCartFabBottom }}
            transition={SPRING_SOFT}
            style={{
              position:"fixed",right:16,zIndex:6800,width:50,height:50,borderRadius:"50%",
              background:"#00ffff",border:"none",cursor:"pointer",display:"flex",alignItems:"center",
              justifyContent:"center",boxShadow:"0 4px 24px rgba(0,255,255,0.4)",flexShrink:0,
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" width="20" height="20"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
            {cart.length>0 && <motion.div style={{position:"absolute",top:-4,right:-4,minWidth:20,height:20,borderRadius:10,padding:"0 5px",background:"#ff4d4d",color:"white",fontSize:10,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center"}}>{cart.length}</motion.div>}
          </motion.button>

          <motion.div style={{
            position:"fixed",bottom:0,left:0,right:0,zIndex:6700,
            background:"rgba(6,6,6,0.94)",backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",
            borderTop:"1px solid rgba(255,255,255,0.06)",
            display:"flex",alignItems:"center",justifyContent:"space-around",
            paddingTop:6,paddingBottom:"max(14px, env(safe-area-inset-bottom))",
            minHeight:62,
          }}>
            {[
              {id:"home",    label:"Home",  svg:MOBILE_NAV_SVGS.home},
              {id:"singles", label:"Music", svg:MOBILE_NAV_SVGS.music},
              {id:"shop",    label:"Shop",  svg:MOBILE_NAV_SVGS.shop},
              {id:"vault",   label:"Vault", svg:MOBILE_NAV_SVGS.vault},
              {id:"shows",   label:"Shows", svg:MOBILE_NAV_SVGS.shows},
            ].map(tab=>{
              const active = activeTab===tab.id||(tab.id==="singles"&&(activeTab==="singles"||activeTab==="albums"||activeTab==="mymusic"));
              return (
                <motion.button
                  key={tab.id}
                  whileTap={{ scale: 0.92 }}
                  onClick={()=>switchTab(tab.id)}
                  style={{
                    display:"flex",flexDirection:"column",alignItems:"center",gap:2,
                    background:"none",border:"none",cursor:"pointer",
                    color:active?"#00ffff":"#555",fontSize:9,fontWeight:700,letterSpacing:0.5,
                    padding:"4px 8px",borderRadius:10,minWidth:44,minHeight:44,justifyContent:"center",
                    textShadow:active?"0 0 12px rgba(0,255,255,0.5)":"none",
                    transition:"color 0.2s",
                  }}
                >
                  {tab.svg}<span>{tab.label}</span>
                </motion.button>
              );
            })}
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={()=>setMobileNavOpen(true)}
              style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,background:"none",border:"none",cursor:"pointer",color:"#555",fontSize:9,fontWeight:700,padding:"4px 8px",minWidth:44,minHeight:44,justifyContent:"center"}}
            >
              {MOBILE_NAV_SVGS.more}<span>More</span>
            </motion.button>
          </motion.div>

          <AnimatePresence>
            {nowPlaying && (
              <motion.div
                key="mobile-mini-player"
                initial={{ y: 72, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 72, opacity: 0 }}
                transition={SPRING_SOFT}
                style={{
                  position:"fixed",left:12,right:12,bottom:mobileMiniPlayerBottom,zIndex:6750,
                  borderRadius:16,overflow:"hidden",
                  background:"rgba(10,10,10,0.9)",backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",
                  border:"1px solid rgba(255,255,255,0.08)",
                  boxShadow:"0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,255,255,0.05)",
                }}
              >
                <motion.div onClick={seekTo} style={{width:"100%",height:3,background:"#111",cursor:"pointer"}}>
                  <motion.div style={{width:audioDuration?`${(audioCurrentTime/audioDuration)*100}%`:"0%",height:"100%",background:"#00ffff",transition:"width 0.1s linear"}}/>
                </motion.div>
                <motion.div style={{padding:"8px 12px",display:"flex",alignItems:"center",gap:10}}>
                  <img src={nowPlaying.cover} alt="" style={{width:40,height:40,borderRadius:8,objectFit:"cover",flexShrink:0}}/>
                  <motion.div style={{flex:1,minWidth:0}}>
                    <motion.div style={{fontSize:12,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{nowPlaying.title}</motion.div>
                    <motion.div style={{fontSize:10,color:"#555",fontVariantNumeric:"tabular-nums"}}>{formatTime(audioCurrentTime)} / {formatTime(audioDuration)}</motion.div>
                  </motion.div>
                  <button onClick={()=>{
                    if (!nowPlayingAudioRef.current) return;
                    if (nowPlayingPlaying) { nowPlayingAudioRef.current.pause(); setNowPlayingPlaying(false); }
                    else { nowPlayingAudioRef.current.play().catch(()=>{}); setNowPlayingPlaying(true); }
                  }} style={{width:38,height:38,borderRadius:"50%",background:"#00ffff",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
                    {nowPlayingPlaying
                      ? <svg viewBox="0 0 24 24" fill="#000" width="14" height="14"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
                      : <svg viewBox="0 0 24 24" fill="#000" width="14" height="14" style={{marginLeft:2}}><path d="M8 5v14l11-7z"/></svg>}
                  </button>
                  <button onClick={()=>{setNowPlaying(null);setNowPlayingPlaying(false);if(nowPlayingAudioRef.current)nowPlayingAudioRef.current.pause();}} style={{background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:20,lineHeight:1,padding:"0 4px"}}>×</button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

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

          <AnimatePresence>
            {mobileCartOpen && (
              <motion.div
                key="cart-sheet"
                {...OVERLAY_FADE}
                onClick={()=>setMobileCartOpen(false)}
                style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:8100,display:"flex",alignItems:"flex-end"}}
              >
                <motion.div
                  {...SHEET_UP}
                  onClick={e=>e.stopPropagation()}
                  style={{width:"100%",background:"#0a0a0a",borderRadius:"20px 20px 0 0",padding:"0 0 max(32px, env(safe-area-inset-bottom))",border:"1px solid #1e1e1e",maxHeight:"82vh",overflowY:"auto"}}
                >
                  <motion.div style={{width:36,height:4,borderRadius:2,background:"#333",margin:"14px auto 0"}}/>
                  <motion.div style={{padding:"16px 20px 0"}}><h3 style={{fontSize:12,letterSpacing:3,color:"#555",marginBottom:16,textTransform:"uppercase"}}>Cart {cart.length>0&&`(${cart.length})`}</h3></motion.div>
                  {cart.length===0 && <p style={{opacity:0.4,fontSize:13,padding:"0 20px 20px"}}>Your cart is empty.</p>}
                  <motion.div style={{padding:"0 20px"}}>{cart.map((item,i)=><motion.div key={i} style={{marginBottom:10,display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #1a1a1a"}}>{item.cover&&<img src={item.cover} style={{width:44,height:44,borderRadius:8,objectFit:"cover",flexShrink:0}} alt="" />}<span style={{fontSize:13,flex:1,lineHeight:1.4}}>{item.title}<br/><span style={{color:"#00ffff",fontSize:12}}>${item.price.toFixed(2)}</span></span><button onClick={()=>removeFromCart(i)} style={{background:"none",border:"none",color:"#666",fontSize:22,cursor:"pointer",padding:"0 4px",lineHeight:1}}>×</button></motion.div>)}</motion.div>
                  {cart.length>0 && <motion.div style={{padding:"16px 20px 0",display:"flex",flexDirection:"column",gap:10}}><motion.div style={{fontSize:15,fontWeight:700}}>Total: <span style={{color:"#00ffff"}}>${total.toFixed(2)}</span></motion.div><button onClick={handleCheckout} disabled={checkingOut} style={{width:"100%",padding:"14px 0",background:"#00ffff",color:"#000",fontWeight:900,border:"none",borderRadius:10,cursor:"pointer",fontSize:15}}>{checkingOut?"Redirecting…":"Checkout"}</button><button onClick={()=>{clearCart();setMobileCartOpen(false);}} style={{width:"100%",padding:"12px 0",background:"transparent",color:"#ff4d4d",border:"1px solid #ff4d4d33",borderRadius:10,cursor:"pointer",fontSize:13}}>Clear Cart</button></motion.div>}
                  {checkoutError && <p style={{color:"#ff4d4d",fontSize:12,padding:"10px 20px 0"}}>{checkoutError}</p>}
                  <motion.div style={{padding:"12px 20px 0"}}><button onClick={()=>setMobileCartOpen(false)} style={{width:"100%",padding:"12px 0",background:"none",border:"1px solid #1e1e1e",color:"#555",cursor:"pointer",fontSize:13,borderRadius:10}}>Close</button></motion.div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

'''

STRIPE = '''      {/* ── STRIPE MODAL ── */}
      <AnimatePresence>
        {clientSecret && (
          <motion.div
            key="stripe"
            {...OVERLAY_FADE}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.9)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:isMobile?16:0}}
          >
            <motion.div
              {...(isMobile ? SHEET_UP : MODAL_CENTER)}
              style={{background:"#0a0a0a",padding:isMobile?20:30,borderRadius:isMobile?"20px 20px 0 0":20,width:isMobile?"100%":400,maxWidth:isMobile?"100%":"none",border:"1px solid #222",alignSelf:isMobile?"flex-end":"center"}}
            >
              <motion.div style={{fontSize:11,color:"#555",letterSpacing:3,marginBottom:16,textTransform:"uppercase"}}>Checkout</motion.div>
              <Elements stripe={stripePromise} options={{clientSecret,appearance:{theme:"night",variables:{colorPrimary:"#00ffff",colorBackground:"#0a0a0a",colorText:"#ffffff",borderRadius:"8px"}}}}>
                <CheckoutForm onSuccess={handleCheckoutSuccess}/>
              </Elements>
              <button onClick={()=>{setClientSecret(null);setCheckingOut(false);}} style={{marginTop:10,width:"100%",padding:10,background:"none",border:"1px solid #333",color:"#777",cursor:"pointer",borderRadius:8}}>Cancel</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
'''

# Apply replacements by line range
replace_range(gate_start, single_start, [GATE])
replace_range(single_start, album_start, [SINGLE])
replace_range(album_start, ticket_start, [ALBUM])

# Now playing: find end (line before desktop cart closing div)
now_end = desktop_cart
replace_range(now_start, now_end, [NOW_DESKTOP])

# Mobile UI
replace_range(mobile_start, css_start, [MOBILE_UI])

# Stripe - find end before closing </>
stripe_end = find_line("  );\n}")  # might not work
# find line with `    </>` before ModalAudioPlayer
for i in range(stripe_start, len(lines)):
    if lines[i].strip() == "</>":
        stripe_end = i
        break

replace_range(stripe_start, stripe_end, [STRIPE])

PATH.write_text("".join(lines))
print("patch complete", gate_start, single_start, now_start, mobile_start, stripe_start)
