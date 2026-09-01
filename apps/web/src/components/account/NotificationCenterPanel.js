import { memo } from "react";

function NotificationCenterPanel({
  isMobile,
  notificationSummary,
  notificationToggles,
  notificationPreferences,
  notificationSaving,
  notificationError,
  markNotificationsRead,
  updateNotificationPreference,
}) {
  return (
    <div style={{background:"linear-gradient(135deg,rgba(0,255,255,0.035),rgba(162,89,255,0.025))",border:"1px solid rgba(0,255,255,0.12)",borderRadius:20,padding:isMobile?18:24}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:14,flexWrap:"wrap",marginBottom:16}}>
        <div>
          <div style={{fontSize:10,color:"#00ffff",letterSpacing:3,textTransform:"uppercase",fontWeight:900,marginBottom:8}}>Notification Center</div>
          <div style={{fontSize:isMobile?17:20,fontWeight:900,letterSpacing:"-0.03em",marginBottom:6}}>Cinematic alerts, synced to your identity.</div>
          <div style={{fontSize:12,color:"#666",lineHeight:1.7,maxWidth:620}}>Release, live, Vault, collector, Audio Diary, and community alerts are attached to this account so SMS, email, web, in-platform, and future app push can share one preference layer.</div>
        </div>
        <button onClick={markNotificationsRead} disabled={notificationSaving || !notificationSummary.unreadCount} style={{padding:"9px 13px",background:notificationSummary.unreadCount?"rgba(0,255,255,0.1)":"#090909",color:notificationSummary.unreadCount?"#00ffff":"#444",border:`1px solid ${notificationSummary.unreadCount?"rgba(0,255,255,0.32)":"#1a1a1a"}`,borderRadius:999,cursor:notificationSummary.unreadCount?"pointer":"default",fontSize:10,fontWeight:900,letterSpacing:1.5,textTransform:"uppercase"}}>{notificationSummary.unreadCount || 0} unread</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(2,minmax(0,1fr))",gap:10}}>
        {notificationToggles.map(item=>{
          const active = notificationPreferences[item.key] !== false;
          return (
            <button key={item.key} onClick={()=>updateNotificationPreference(item.key, !active)} disabled={notificationSaving} style={{padding:"12px 13px",background:active?"rgba(0,255,255,0.045)":"#080808",border:`1px solid ${active?"rgba(0,255,255,0.22)":"#171717"}`,borderRadius:14,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12,opacity:notificationSaving?0.72:1}}>
              <span style={{width:34,height:20,borderRadius:999,background:active?"#00ffff":"#1a1a1a",position:"relative",boxShadow:active?"0 0 16px rgba(0,255,255,0.22)":"none",transition:"0.2s",flexShrink:0}}><span style={{position:"absolute",top:3,left:active?17:3,width:14,height:14,borderRadius:"50%",background:active?"#000":"#555",transition:"0.2s"}}/></span>
              <span style={{minWidth:0}}><span style={{display:"block",fontSize:12,fontWeight:900,color:active?"#ddd":"#777",marginBottom:3}}>{item.label}</span><span style={{display:"block",fontSize:10,color:"#555",lineHeight:1.45}}>{item.detail}</span></span>
            </button>
          );
        })}
      </div>
      {notificationSummary.latest?.length > 0 && (
        <div style={{marginTop:18,borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:14}}>
          <div style={{fontSize:10,color:"#555",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Recent Signals</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {notificationSummary.latest.slice(0,3).map(item=>(
              <div key={item.id} style={{padding:"10px 12px",border:"1px solid #171717",borderRadius:12,background:item.readAt?"#080808":"rgba(162,89,255,0.045)"}}>
                <div style={{fontSize:12,color:"#ddd",fontWeight:800,marginBottom:3}}>{item.title}</div>
                <div style={{fontSize:10,color:"#555",lineHeight:1.5}}>{item.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {notificationError && <div style={{fontSize:12,color:"#ff8a8a",marginTop:12}}>{notificationError}</div>}
    </div>
  );
}

export default memo(NotificationCenterPanel);
