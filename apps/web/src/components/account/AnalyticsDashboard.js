"use client";

import { useState, useEffect, useCallback } from "react";

const STATE_NAMES = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",
  HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",
  KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",
  MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",
  OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",
  SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",
  VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",
  DC:"Washington D.C.",
};

function fmt(n) {
  if (n == null) return "—";
  if (n >= 1000000) return `${(n/1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n/1000).toFixed(1)}K`;
  return String(Math.round(n));
}
function fmtRevenue(cents) {
  if (!cents) return "$0";
  return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(cents/100);
}
function pct(part, total) { return total ? Math.round((part/total)*100) : 0; }
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function monthLabel(key) { const [,m]=key.split("-"); return MONTHS[parseInt(m,10)-1]||key; }

const C = {
  surface:  "#0a0a0a",
  surface2: "#111",
  surface3: "#161616",
  border:   "rgba(255,255,255,0.07)",
  border2:  "rgba(255,255,255,0.04)",
  text:     "#ffffff",
  muted:    "#777",
  dim:      "#444",
  accent:   "#00ffff",
  purple:   "#a259ff",
  gold:     "#f59e0b",
  green:    "#22c55e",
  red:      "#ef4444",
};

function Card({ children, style }) {
  return (
    <div style={{ background: C.surface, border:`1px solid ${C.border}`, borderRadius:14, padding:18, ...style }}>
      {children}
    </div>
  );
}
function SectionLabel({ children }) {
  return (
    <div style={{ fontSize:9, fontWeight:700, letterSpacing:3, color:C.dim, textTransform:"uppercase", marginBottom:16, paddingBottom:10, borderBottom:`1px solid ${C.border}` }}>
      {children}
    </div>
  );
}
function KPITile({ label, value, sub, color=C.accent, isMobile }) {
  return (
    <div style={{ background:C.surface2, border:`1px solid ${C.border}`, borderRadius:12, padding:isMobile?"14px 16px":"16px 20px", flex:"1 1 0", minWidth:0 }}>
      <div style={{ fontSize:9, fontWeight:700, letterSpacing:2.5, color:C.dim, textTransform:"uppercase", marginBottom:10 }}>{label}</div>
      <div style={{ fontSize:isMobile?26:30, fontWeight:900, color, lineHeight:1, fontVariantNumeric:"tabular-nums" }}>{value}</div>
      {sub?<div style={{ fontSize:11, color:C.muted, marginTop:6 }}>{sub}</div>:null}
    </div>
  );
}

function GenderSplit({ male, female, unknown }) {
  const total = male+female+unknown;
  if (!total) return <div style={{ fontSize:12, color:C.muted }}>No demographic data yet. Collected at signup going forward.</div>;
  const mP=pct(male,total), fP=pct(female,total), uP=pct(unknown,total);
  return (
    <div>
      <div style={{ display:"flex", height:8, borderRadius:8, overflow:"hidden", gap:2, marginBottom:16 }}>
        <div style={{ flex:mP, background:C.accent }} />
        <div style={{ flex:fP, background:C.purple }} />
        {unknown>0&&<div style={{ flex:uP, background:C.dim }} />}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        {[
          { label:"Male", p:mP, count:male, color:C.accent },
          { label:"Female", p:fP, count:female, color:C.purple },
          unknown>0?{ label:"Not specified", p:uP, count:unknown, color:C.dim }:null,
        ].filter(Boolean).map(item=>(
          <div key={item.label} style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:7, height:7, borderRadius:2, background:item.color, flexShrink:0 }} />
            <div style={{ flex:1 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                <span style={{ fontSize:12, color:C.text }}>{item.label}</span>
                <span style={{ fontSize:12, color:item.color, fontVariantNumeric:"tabular-nums", fontWeight:700 }}>
                  {item.p}% <span style={{ color:C.muted, fontWeight:400 }}>({fmt(item.count)})</span>
                </span>
              </div>
              <div style={{ height:4, background:C.surface3, borderRadius:3, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${item.p}%`, background:item.color, borderRadius:3 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HBar({ label, count, max, color=C.accent, rank, sub }) {
  const w = max ? `${Math.max(2,(count/max)*100)}%` : "0%";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
      {rank!=null&&<div style={{ fontSize:10, color:C.dim, width:18, textAlign:"right", flexShrink:0, fontVariantNumeric:"tabular-nums" }}>{rank}</div>}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
          <span style={{ fontSize:12, color:C.text, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {label}{sub&&<span style={{ color:C.muted }}>{sub}</span>}
          </span>
          <span style={{ fontSize:12, color, fontVariantNumeric:"tabular-nums", fontWeight:700, flexShrink:0, marginLeft:10 }}>{fmt(count)}</span>
        </div>
        <div style={{ height:4, background:C.surface3, borderRadius:3, overflow:"hidden" }}>
          <div style={{ height:"100%", width:w, background:color, borderRadius:3 }} />
        </div>
      </div>
    </div>
  );
}

function GrowthChart({ data }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map(d=>d.newFans), 1);
  const W=560,H=110,PL=4,PR=4,PT=10,PB=22;
  const cW=W-PL-PR, cH=H-PT-PB, n=data.length;
  const px=i=>PL+(i/(n-1))*cW;
  const py=v=>PT+cH-(v/max)*cH;
  const pts=data.map((d,i)=>`${px(i)},${py(d.newFans)}`).join(" ");
  const area=`M${px(0)},${py(data[0].newFans)} ${data.map((d,i)=>`L${px(i)},${py(d.newFans)}`).join(" ")} L${px(n-1)},${PT+cH} L${px(0)},${PT+cH} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:H, display:"block" }}>
      <defs>
        <linearGradient id="inlineAreaGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={C.accent} stopOpacity="0.25" />
          <stop offset="100%" stopColor={C.accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0,0.33,0.66,1].map(v=>(
        <line key={v} x1={PL} x2={PL+cW} y1={PT+cH*(1-v)} y2={PT+cH*(1-v)} stroke={C.border2} strokeWidth="1" />
      ))}
      <path d={area} fill="url(#inlineAreaGrad)" />
      <polyline points={pts} fill="none" stroke={C.accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((d,i)=>d.newFans>0&&(
        <circle key={i} cx={px(i)} cy={py(d.newFans)} r="2.5" fill={C.accent} />
      ))}
      {data.map((d,i)=>(i===0||i===n-1||i%3===0)&&(
        <text key={i} x={px(i)} y={H-4} textAnchor="middle" fill={C.dim} fontSize="8" fontFamily="system-ui">
          {monthLabel(d.month)}
        </text>
      ))}
    </svg>
  );
}

function TrackRow({ track, rank, isFirst, isMobile }) {
  const cr = track.completionRate;
  const crColor = cr>=70?C.green:cr>=40?C.gold:cr!=null?C.red:C.dim;
  if (isMobile) {
    return (
      <div style={{ padding:"12px 0", borderTop:isFirst?"none":`1px solid ${C.border}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
          <span style={{ fontSize:11, color:C.dim, width:18, textAlign:"right", fontVariantNumeric:"tabular-nums", flexShrink:0 }}>{rank}</span>
          <div style={{ width:36, height:36, borderRadius:7, background:C.surface3, flexShrink:0, backgroundImage:track.coverUrl?`url(${track.coverUrl})`:"none", backgroundSize:"cover", backgroundPosition:"center" }} />
          <div style={{ fontSize:13, fontWeight:600, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{track.title||track.slug}</div>
        </div>
        <div style={{ display:"flex", gap:16, paddingLeft:28 }}>
          <div><div style={{ fontSize:9, color:C.dim, letterSpacing:1.5, textTransform:"uppercase" }}>Plays</div><div style={{ fontSize:13, fontWeight:700, color:C.text, fontVariantNumeric:"tabular-nums" }}>{fmt(track.plays)}</div></div>
          <div><div style={{ fontSize:9, color:C.dim, letterSpacing:1.5, textTransform:"uppercase" }}>Buys</div><div style={{ fontSize:13, fontWeight:700, color:C.gold, fontVariantNumeric:"tabular-nums" }}>{fmt(track.purchases)}</div></div>
          <div><div style={{ fontSize:9, color:C.dim, letterSpacing:1.5, textTransform:"uppercase" }}>Done</div><div style={{ fontSize:13, fontWeight:700, color:crColor }}>{cr!=null?`${cr}%`:"—"}</div></div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ display:"grid", gridTemplateColumns:"22px 36px 1fr 70px 70px 70px 90px", gap:10, alignItems:"center", padding:"11px 0", borderTop:isFirst?"none":`1px solid ${C.border}` }}>
      <div style={{ fontSize:11, color:C.dim, textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{rank}</div>
      <div style={{ width:36, height:36, borderRadius:7, background:C.surface3, flexShrink:0, backgroundImage:track.coverUrl?`url(${track.coverUrl})`:"none", backgroundSize:"cover", backgroundPosition:"center" }} />
      <div style={{ fontSize:13, fontWeight:600, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", minWidth:0 }}>{track.title||track.slug}</div>
      <div style={{ fontSize:13, color:C.text, fontVariantNumeric:"tabular-nums", textAlign:"right" }}>{fmt(track.plays)}</div>
      <div style={{ fontSize:13, color:C.gold, fontVariantNumeric:"tabular-nums", fontWeight:700, textAlign:"right" }}>{fmt(track.purchases)}</div>
      <div style={{ fontSize:13, color:C.muted, fontVariantNumeric:"tabular-nums", textAlign:"right" }}>{fmt(track.listeners)}</div>
      <div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"flex-end" }}>
        {cr!=null?(
          <>
            <div style={{ width:36, height:3, background:C.surface3, borderRadius:2, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${cr}%`, background:crColor, borderRadius:2 }} />
            </div>
            <span style={{ fontSize:11, color:crColor, fontVariantNumeric:"tabular-nums", minWidth:28, textAlign:"right" }}>{cr}%</span>
          </>
        ):<span style={{ fontSize:11, color:C.dim }}>—</span>}
      </div>
    </div>
  );
}

const TABS = [
  { id:"overview", label:"Overview" },
  { id:"audience", label:"Audience" },
  { id:"tracks",   label:"Tracks"   },
];
const SORT_OPTS = [
  { key:"plays", label:"Plays" },
  { key:"purchases", label:"Purchases" },
  { key:"listeners", label:"Listeners" },
  { key:"completionRate", label:"Completion" },
];

export default function AnalyticsDashboard({ isMobile }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [tab, setTab]       = useState("overview");
  const [sortBy, setSortBy] = useState("plays");

  const load = useCallback(() => {
    setLoading(true); setError(null);
    fetch("/api/admin/analytics", { credentials:"include" })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError("Could not load analytics."); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding:"40px 0", textAlign:"center", color:C.muted, fontSize:13 }}>Loading analytics…</div>;
  if (error)   return <div style={{ padding:"24px 0", color:C.red, fontSize:13 }}>{error}</div>;
  if (!data)   return null;

  const { tracks=[], totals={ plays:0,purchases:0 }, overview={}, demographics={}, geography={}, growth={} } = data;
  const sortedTracks = [...tracks].sort((a,b)=>((b[sortBy]??-1)-(a[sortBy]??-1)));
  const twoCol = !isMobile;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {/* ── Tab bar ─────────────────────────────────────────────── */}
      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            background: tab===t.id?"rgba(0,255,255,0.1)":"transparent",
            border:`1px solid ${tab===t.id?"rgba(0,255,255,0.35)":"#222"}`,
            borderRadius:999, color:tab===t.id?"#00ffff":"#555",
            fontSize:10, fontWeight:900, letterSpacing:2, textTransform:"uppercase",
            padding:"7px 16px", cursor:"pointer", fontFamily:"inherit",
          }}>{t.label}</button>
        ))}
        <div style={{ flex:1 }} />
        <button onClick={load} style={{ background:"none", border:`1px solid #1a1a1a`, borderRadius:8, color:C.dim, fontSize:11, padding:"5px 12px", cursor:"pointer", fontFamily:"inherit" }}>↺</button>
      </div>

      {/* ══════════════════════════════════════════════════════════
          OVERVIEW
      ══════════════════════════════════════════════════════════ */}
      {tab==="overview"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {/* KPIs */}
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <KPITile isMobile={isMobile} label="Total Fans" value={fmt(overview.totalFans)} sub="All-time accounts" color={C.accent} />
            <KPITile isMobile={isMobile} label="Plays (90d)" value={fmt(overview.totalPlays)} sub="Stream events" color={C.text} />
            <KPITile isMobile={isMobile} label="Purchases (90d)" value={fmt(overview.totalPurchases)} sub="Completed orders" color={C.gold} />
            <KPITile isMobile={isMobile} label="Revenue (90d)" value={fmtRevenue(overview.totalRevenueCents)} sub="Gross sales" color={C.green} />
          </div>

          {/* Growth chart */}
          <Card>
            <SectionLabel>New Fans — Last 12 Months</SectionLabel>
            <GrowthChart data={growth.monthly} />
            <div style={{ marginTop:14, display:"flex", gap:24, flexWrap:"wrap" }}>
              <div>
                <span style={{ fontSize:11, color:C.muted }}>This month  </span>
                <span style={{ fontSize:20, fontWeight:900, color:C.accent, fontVariantNumeric:"tabular-nums" }}>+{fmt(growth.monthly?.at(-1)?.newFans||0)}</span>
              </div>
              <div>
                <span style={{ fontSize:11, color:C.muted }}>Demographics captured  </span>
                <span style={{ fontSize:20, fontWeight:900, color:overview.demographicsCoverage>50?C.green:C.gold, fontVariantNumeric:"tabular-nums" }}>{overview.demographicsCoverage||0}%</span>
              </div>
            </div>
          </Card>

          {/* Gender + Age snapshot */}
          <div style={{ display:"grid", gridTemplateColumns:twoCol?"1fr 1fr":"1fr", gap:12 }}>
            <Card>
              <SectionLabel>Gender</SectionLabel>
              <GenderSplit male={demographics.gender?.male||0} female={demographics.gender?.female||0} unknown={demographics.gender?.unknown||0} />
            </Card>
            <Card>
              <SectionLabel>Age Range</SectionLabel>
              {(()=>{
                const ar=demographics.ageRange||{};
                const t=(ar["18-25"]||0)+(ar["25-40"]||0)+(ar["40-65"]||0);
                if (!t) return <div style={{ fontSize:12, color:C.muted }}>No age data yet.</div>;
                return [
                  {key:"18-25",color:C.accent},
                  {key:"25-40",color:C.purple},
                  {key:"40-65",color:C.gold},
                ].map(({key,color})=>(
                  <HBar key={key} label={key} count={ar[key]||0} max={Math.max(ar["18-25"]||0,ar["25-40"]||0,ar["40-65"]||0)} color={color} />
                ));
              })()}
            </Card>
          </div>

          {/* Top 5 tracks */}
          <Card>
            <SectionLabel>Top Tracks</SectionLabel>
            {!isMobile&&(
              <div style={{ display:"grid", gridTemplateColumns:"22px 36px 1fr 70px 70px 70px 90px", gap:10, paddingBottom:10, borderBottom:`1px solid ${C.border}`, marginBottom:2 }}>
                {["#","","Track","Plays","Buys","Listeners","Completion"].map((h,i)=>(
                  <div key={i} style={{ fontSize:9, color:C.dim, letterSpacing:1.5, textTransform:"uppercase", textAlign:i>2?"right":"left" }}>{h}</div>
                ))}
              </div>
            )}
            {tracks.slice(0,5).map((t,i)=><TrackRow key={t.slug} track={t} rank={i+1} isFirst={i===0} isMobile={isMobile} />)}
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          AUDIENCE
      ══════════════════════════════════════════════════════════ */}
      {tab==="audience"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {/* Audience KPIs */}
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <KPITile isMobile={isMobile} label="Total Fans" value={fmt(overview.totalFans)} color={C.accent} />
            <KPITile isMobile={isMobile} label="Fully Profiled" value={fmt(overview.fansWithDemographics)} sub={`${overview.demographicsCoverage||0}% of total`} color={C.purple} />
            <KPITile isMobile={isMobile} label="States" value={fmt(geography.topStates?.length||0)} sub="Represented" color={C.gold} />
            <KPITile isMobile={isMobile} label="Cities" value={fmt(geography.topCities?.length||0)} sub="Represented" color={C.green} />
          </div>

          {/* Gender + Age */}
          <div style={{ display:"grid", gridTemplateColumns:twoCol?"1fr 1fr":"1fr", gap:12 }}>
            <Card>
              <SectionLabel>Gender</SectionLabel>
              <GenderSplit male={demographics.gender?.male||0} female={demographics.gender?.female||0} unknown={demographics.gender?.unknown||0} />
            </Card>
            <Card>
              <SectionLabel>Age Range</SectionLabel>
              {(()=>{
                const ar=demographics.ageRange||{};
                const t=(ar["18-25"]||0)+(ar["25-40"]||0)+(ar["40-65"]||0);
                if (!t) return <div style={{ fontSize:12, color:C.muted }}>No age data yet.</div>;
                return (
                  <>
                    {[{key:"18-25",color:C.accent},{key:"25-40",color:C.purple},{key:"40-65",color:C.gold}].map(({key,color})=>(
                      <HBar key={key} label={key} count={ar[key]||0} max={Math.max(ar["18-25"]||0,ar["25-40"]||0,ar["40-65"]||0)} color={color} />
                    ))}
                    {(ar.unknown||0)>0&&<div style={{ fontSize:11, color:C.dim, marginTop:8 }}>{fmt(ar.unknown)} haven't specified age yet</div>}
                  </>
                );
              })()}
            </Card>
          </div>

          {/* Top States */}
          <Card>
            <SectionLabel>Top States</SectionLabel>
            {!geography.topStates?.length?(
              <div style={{ fontSize:12, color:C.muted }}>No location data yet.</div>
            ):(
              <div style={{ display:"grid", gridTemplateColumns:twoCol?"1fr 1fr":"1fr", gap:"0 32px" }}>
                {(geography.topStates||[]).map((s,i)=>(
                  <HBar key={s.state} label={STATE_NAMES[s.state]||s.state} count={s.count} max={geography.topStates[0].count} rank={i+1} color={i===0?C.accent:i<3?C.muted:C.dim} />
                ))}
              </div>
            )}
          </Card>

          {/* Top Cities */}
          <Card>
            <SectionLabel>Top Cities</SectionLabel>
            {!geography.topCities?.length?(
              <div style={{ fontSize:12, color:C.muted }}>No city data yet.</div>
            ):(
              <div style={{ display:"grid", gridTemplateColumns:twoCol?"1fr 1fr":"1fr", gap:"0 32px" }}>
                {(geography.topCities||[]).map((c,i)=>(
                  <HBar key={`${c.city}-${c.state}-${i}`} label={c.city} sub={c.state?`, ${c.state}`:""} count={c.count} max={geography.topCities[0].count} rank={i+1} color={i===0?C.accent:i<3?C.muted:C.dim} />
                ))}
              </div>
            )}
          </Card>

          {/* Growth chart */}
          <Card>
            <SectionLabel>Fan Growth — Last 12 Months</SectionLabel>
            <GrowthChart data={growth.monthly} />
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TRACKS
      ══════════════════════════════════════════════════════════ */}
      {tab==="tracks"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {/* Sort controls */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
            <span style={{ fontSize:11, color:C.muted }}>Sort</span>
            {SORT_OPTS.map(opt=>(
              <button key={opt.key} onClick={()=>setSortBy(opt.key)} style={{
                background:sortBy===opt.key?C.accent:C.surface2,
                color:sortBy===opt.key?"#000":C.muted,
                border:`1px solid ${sortBy===opt.key?C.accent:C.border}`,
                borderRadius:8, padding:"5px 13px", fontSize:11,
                fontWeight:sortBy===opt.key?700:400,
                cursor:"pointer", fontFamily:"inherit",
              }}>{opt.label}</button>
            ))}
            <div style={{ flex:1 }} />
            <span style={{ fontSize:11, color:C.dim }}>{sortedTracks.length} tracks</span>
          </div>

          <Card style={{ padding:"16px 18px" }}>
            {!isMobile&&(
              <div style={{ display:"grid", gridTemplateColumns:"22px 36px 1fr 70px 70px 70px 90px", gap:10, paddingBottom:10, borderBottom:`1px solid ${C.border}`, marginBottom:2 }}>
                {["#","","Track","Plays","Buys","Listeners","Completion"].map((h,i)=>(
                  <div key={i} style={{ fontSize:9, color:C.dim, letterSpacing:1.5, textTransform:"uppercase", textAlign:i>2?"right":"left" }}>{h}</div>
                ))}
              </div>
            )}
            {sortedTracks.length===0?(
              <div style={{ textAlign:"center", padding:"36px 0", color:C.muted, fontSize:13 }}>No track data yet</div>
            ):sortedTracks.map((t,i)=>(
              <TrackRow key={t.slug} track={t} rank={i+1} isFirst={i===0} isMobile={isMobile} />
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
