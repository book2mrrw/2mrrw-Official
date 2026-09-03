"use client";
import { useState, useEffect, useCallback } from "react";

// Platform color system — exact match to globals.css / HomeClient aesthetic
const C = {
  bg:           "#050505",
  surface:      "#0a0a0a",
  surface2:     "#0e0e0e",
  surface3:     "#161618",
  border:       "rgba(255,255,255,0.06)",
  border2:      "rgba(255,255,255,0.03)",
  borderAccent: "rgba(0,255,255,0.28)",
  text:         "#ffffff",
  textSub:      "rgba(255,255,255,0.6)",
  muted:        "#666",
  dim:          "#3a3a3a",
  accent:       "#00ffff",
  accentGlow:   "rgba(0,255,255,0.18)",
  accentDim:    "rgba(0,255,255,0.07)",
  purple:       "#a259ff",
  purpleGlow:   "rgba(162,89,255,0.18)",
  gold:         "#f0b429",
  goldGlow:     "rgba(240,180,41,0.18)",
  green:        "#10d56e",
  greenGlow:    "rgba(16,213,110,0.15)",
  red:          "#ef4444",
};

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
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function monthLabel(key) { const [,m]=key.split("-"); return MONTHS_SHORT[parseInt(m,10)-1]||key; }

// ── Section eyebrow label ────────────────────────────────────────────────────
function Label({ children, style }) {
  return (
    <div style={{
      fontSize:8, fontWeight:900, letterSpacing:4,
      color:C.dim, textTransform:"uppercase", ...style,
    }}>
      {children}
    </div>
  );
}

// ── Glow card container ──────────────────────────────────────────────────────
function Card({ children, style, orbColor }) {
  return (
    <div style={{
      position:"relative",
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius:16,
      padding:20,
      overflow:"hidden",
      ...style,
    }}>
      {orbColor && (
        <div style={{
          position:"absolute", top:-50, right:-50,
          width:160, height:160, borderRadius:"50%",
          background:orbColor, filter:"blur(55px)",
          opacity:0.45, pointerEvents:"none",
        }} />
      )}
      {children}
    </div>
  );
}

// ── KPI Tile ─────────────────────────────────────────────────────────────────
function KPITile({ label, value, sub, color=C.accent, glow, isMobile }) {
  const [hov, setHov] = useState(false);
  const borderHov = glow ? glow.replace(/[\d.]+\)$/, "0.38)") : C.border;
  return (
    <div
      onMouseEnter={()=>setHov(true)}
      onMouseLeave={()=>setHov(false)}
      style={{
        flex:"1 1 0",
        minWidth: isMobile ? "calc(50% - 5px)" : 0,
        position:"relative",
        background: hov ? "rgba(255,255,255,0.02)" : C.surface,
        border: `1px solid ${hov ? borderHov : C.border}`,
        borderRadius:14,
        padding: isMobile ? "16px" : "18px 20px",
        overflow:"hidden",
        transition:"border-color 0.2s, background 0.2s, box-shadow 0.2s",
        boxShadow: hov && glow ? `0 0 28px ${glow}` : "none",
        cursor:"default",
      }}
    >
      {/* Top accent line */}
      <div style={{
        position:"absolute", top:0, left:20, right:20, height:1,
        background: glow ? glow.replace(/[\d.]+\)$/, "0.6)") : "transparent",
      }} />
      {/* Inner orb */}
      {glow && (
        <div style={{
          position:"absolute", top:-24, right:-20,
          width:80, height:80, borderRadius:"50%",
          background:glow, filter:"blur(28px)",
          opacity: hov ? 0.7 : 0.4,
          transition:"opacity 0.2s",
          pointerEvents:"none",
        }} />
      )}
      <Label style={{ marginBottom:12 }}>{label}</Label>
      <div style={{
        fontSize: isMobile ? 28 : 32, fontWeight:900, color,
        lineHeight:1, fontVariantNumeric:"tabular-nums",
        letterSpacing:"-0.02em",
        textShadow: hov && glow ? `0 0 24px ${glow}` : "none",
        transition:"text-shadow 0.2s",
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize:10, color:C.muted, marginTop:8, letterSpacing:0.4 }}>{sub}</div>}
    </div>
  );
}

// ── Interactive Growth Chart ─────────────────────────────────────────────────
function GrowthChart({ data }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  if (!data?.length) return null;

  const max = Math.max(...data.map(d=>d.newFans), 1);
  const W=600, H=140, PL=6, PR=6, PT=14, PB=28;
  const cW=W-PL-PR, cH=H-PT-PB, n=data.length;
  const px=i=>PL+(i/(n-1))*cW;
  const py=v=>PT+cH-(v/max)*cH;

  const pts = data.map((d,i)=>`${px(i)},${py(d.newFans)}`).join(" ");
  const area = `M${px(0)},${py(data[0].newFans)} ${data.map((d,i)=>`L${px(i)},${py(d.newFans)}`).join(" ")} L${px(n-1)},${PT+cH} L${px(0)},${PT+cH} Z`;

  const hovData = hoverIdx!=null ? data[hoverIdx] : null;
  const hovX = hoverIdx!=null ? px(hoverIdx) : 0;
  const tooltipLeft = hoverIdx!=null && hoverIdx < n/2;

  return (
    <div style={{ position:"relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width:"100%", height:H, display:"block", overflow:"visible" }}
      >
        <defs>
          <linearGradient id="adAreaGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#00ffff" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#00ffff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="adLineGrad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#a259ff" />
            <stop offset="50%" stopColor="#00c8e0" />
            <stop offset="100%" stopColor="#00ffff" />
          </linearGradient>
          <filter id="adDotGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2.5" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        {/* Dashed grid lines */}
        {[0, 0.33, 0.66, 1].map((v,vi)=>(
          <line key={vi}
            x1={PL} x2={PL+cW}
            y1={PT+cH*(1-v)} y2={PT+cH*(1-v)}
            stroke="rgba(255,255,255,0.04)" strokeWidth="1"
            strokeDasharray="4,8"
          />
        ))}

        {/* Area fill */}
        <path d={area} fill="url(#adAreaGrad)" />

        {/* Hover crosshair */}
        {hoverIdx!=null && (
          <line
            x1={hovX} x2={hovX} y1={PT} y2={PT+cH}
            stroke="rgba(0,255,255,0.18)" strokeWidth="1"
          />
        )}

        {/* Gradient line */}
        <polyline
          points={pts} fill="none"
          stroke="url(#adLineGrad)" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round"
        />

        {/* Dots + invisible hit targets */}
        {data.map((d,i)=>{
          const isHov = hoverIdx===i;
          const isLast = i===n-1;
          return (
            <g key={i}
              onMouseEnter={()=>setHoverIdx(i)}
              onMouseLeave={()=>setHoverIdx(null)}
              style={{ cursor:"crosshair" }}
            >
              <circle cx={px(i)} cy={py(d.newFans)} r="14" fill="transparent" />
              {(d.newFans>0 || isHov || isLast) && (
                <circle
                  cx={px(i)} cy={py(d.newFans)}
                  r={isHov ? 4.5 : isLast ? 3.5 : 2.5}
                  fill={isHov ? "#fff" : C.accent}
                  filter={isHov || isLast ? "url(#adDotGlow)" : undefined}
                  opacity={d.newFans===0 && !isHov ? 0.2 : 1}
                />
              )}
            </g>
          );
        })}

        {/* Month labels */}
        {data.map((d,i)=>(i===0||i===n-1||i%3===0)&&(
          <text key={i} x={px(i)} y={H-4}
            textAnchor={i===0?"start":i===n-1?"end":"middle"}
            fill={C.muted} fontSize="8"
            fontFamily="system-ui,sans-serif" letterSpacing="1"
          >
            {monthLabel(d.month)}
          </text>
        ))}
      </svg>

      {/* Floating tooltip */}
      {hovData && (
        <div style={{
          position:"absolute",
          bottom:"calc(100% - 20px)",
          left: tooltipLeft ? `calc(${(hoverIdx/(n-1))*100}% + 10px)` : undefined,
          right: !tooltipLeft ? `calc(${((n-1-hoverIdx)/(n-1))*100}% + 10px)` : undefined,
          background:"rgba(8,8,12,0.96)",
          border:`1px solid ${C.borderAccent}`,
          borderRadius:10,
          padding:"10px 14px",
          pointerEvents:"none",
          whiteSpace:"nowrap",
          boxShadow:"0 0 20px rgba(0,255,255,0.14)",
          zIndex:10,
        }}>
          <div style={{ fontSize:8, color:C.muted, letterSpacing:2.5, textTransform:"uppercase", marginBottom:4 }}>
            {monthLabel(hovData.month)}
          </div>
          <div style={{ fontSize:22, fontWeight:900, color:C.accent, fontVariantNumeric:"tabular-nums", lineHeight:1 }}>
            +{fmt(hovData.newFans)}
          </div>
          <div style={{ fontSize:9, color:C.muted, marginTop:3 }}>new fans</div>
        </div>
      )}
    </div>
  );
}

// ── Gender donut chart ────────────────────────────────────────────────────────
function GenderDonut({ male, female, unknown }) {
  const total = male+female+unknown;
  if (!total) return (
    <div style={{ fontSize:12, color:C.muted, padding:"16px 0" }}>
      Demographic data is collected at signup going forward.
    </div>
  );

  const mP = pct(male, total);
  const fP = pct(female, total);

  const R=50, cx=62, cy=62, strokeW=13;
  const circ=2*Math.PI*R;
  const gap=3;
  const mArc=Math.max(0,(mP/100)*circ - gap);
  const fArc=Math.max(0,(fP/100)*circ - gap);

  return (
    <div style={{ display:"flex", alignItems:"center", gap:18, flexWrap:"wrap" }}>
      {/* Donut SVG */}
      <div style={{ flexShrink:0 }}>
        <svg width="124" height="124" viewBox="0 0 124 124">
          <defs>
            <filter id="gfGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          {/* Track */}
          <circle cx={cx} cy={cy} r={R} fill="none"
            stroke="rgba(255,255,255,0.04)" strokeWidth={strokeW}/>
          {/* Female arc */}
          {fArc>0 && (
            <circle cx={cx} cy={cy} r={R} fill="none"
              stroke={C.purple} strokeWidth={strokeW}
              strokeDasharray={`${fArc} ${circ-fArc}`}
              strokeDashoffset={-(mArc+gap/2+gap)}
              strokeLinecap="round"
              transform="rotate(-90,62,62)"
            />
          )}
          {/* Male arc */}
          {mArc>0 && (
            <circle cx={cx} cy={cy} r={R} fill="none"
              stroke={C.accent} strokeWidth={strokeW}
              strokeDasharray={`${mArc} ${circ-mArc}`}
              strokeDashoffset="0"
              strokeLinecap="round"
              transform="rotate(-90,62,62)"
              filter="url(#gfGlow)"
            />
          )}
          {/* Center */}
          <text x={cx} y={cy-5} textAnchor="middle" fill={C.text}
            fontSize="17" fontWeight="900" fontFamily="system-ui,sans-serif">
            {fmt(total)}
          </text>
          <text x={cx} y={cy+9} textAnchor="middle" fill={C.muted}
            fontSize="7" letterSpacing="2" fontFamily="system-ui,sans-serif">
            FANS
          </text>
        </svg>
      </div>

      {/* Legend */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", gap:14, minWidth:0 }}>
        {[
          { label:"Male",         p:mP,               count:male,    color:C.accent, glow:"rgba(0,255,255,0.35)" },
          { label:"Female",       p:fP,               count:female,  color:C.purple, glow:"rgba(162,89,255,0.35)" },
          ...(unknown>0 ? [{ label:"Unknown", p:pct(unknown,total), count:unknown, color:C.dim, glow:null }] : []),
        ].map(item=>(
          <div key={item.label}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
              <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                <div style={{
                  width:6, height:6, borderRadius:2, background:item.color, flexShrink:0,
                  boxShadow: item.glow ? `0 0 6px ${item.glow}` : "none",
                }} />
                <span style={{ fontSize:12, color:C.textSub, letterSpacing:0.4 }}>{item.label}</span>
              </div>
              <div style={{ display:"flex", alignItems:"baseline", gap:5 }}>
                <span style={{
                  fontSize:20, fontWeight:900, color:item.color,
                  fontVariantNumeric:"tabular-nums", lineHeight:1,
                }}>
                  {item.p}%
                </span>
                <span style={{ fontSize:10, color:C.muted }}>({fmt(item.count)})</span>
              </div>
            </div>
            <div style={{ height:3, background:"rgba(255,255,255,0.04)", borderRadius:3, overflow:"hidden" }}>
              <div style={{
                height:"100%", width:`${item.p}%`, background:item.color, borderRadius:3,
                boxShadow: item.glow ? `0 0 8px ${item.glow}` : "none",
              }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Age range panel ───────────────────────────────────────────────────────────
function AgeRangePanel({ ageRange }) {
  const ar = ageRange || {};
  const buckets = [
    { key:"18-25", color:C.accent,  glow:"rgba(0,255,255,0.3)"     },
    { key:"25-40", color:C.purple,  glow:"rgba(162,89,255,0.3)"    },
    { key:"40-65", color:C.gold,    glow:"rgba(240,180,41,0.3)"    },
  ];
  const maxVal = Math.max(...buckets.map(b=>ar[b.key]||0), 1);
  const total  = buckets.reduce((s,b)=>s+(ar[b.key]||0), 0);
  if (!total) return <div style={{ fontSize:12, color:C.muted }}>No age data yet.</div>;

  return (
    <div>
      {/* Stacked bar preview */}
      <div style={{ display:"flex", height:5, borderRadius:5, overflow:"hidden", gap:2, marginBottom:18 }}>
        {buckets.map(b=>{
          const p = pct(ar[b.key]||0, total);
          return p>0 ? (
            <div key={b.key} style={{
              flex:p, background:b.color,
              boxShadow:`0 0 8px ${b.glow}`,
            }} />
          ) : null;
        })}
      </div>
      {buckets.map(b=>{
        const count = ar[b.key]||0;
        const w = maxVal ? `${Math.max(2,(count/maxVal)*100)}%` : "0%";
        return (
          <div key={b.key} style={{ marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:5 }}>
              <span style={{ fontSize:12, color:C.text }}>{b.key}</span>
              <div style={{ display:"flex", alignItems:"baseline", gap:5 }}>
                <span style={{ fontSize:18, fontWeight:900, color:b.color, fontVariantNumeric:"tabular-nums", lineHeight:1 }}>
                  {pct(count,total)}%
                </span>
                <span style={{ fontSize:10, color:C.muted }}>({fmt(count)})</span>
              </div>
            </div>
            <div style={{ height:3, background:"rgba(255,255,255,0.04)", borderRadius:3, overflow:"hidden" }}>
              <div style={{
                height:"100%", width:w, background:b.color, borderRadius:3,
                boxShadow:`0 0 8px ${b.glow}`,
              }} />
            </div>
          </div>
        );
      })}
      {(ar.unknown||0)>0 && (
        <div style={{ fontSize:10, color:C.dim, marginTop:4 }}>{fmt(ar.unknown)} fans haven't specified age</div>
      )}
    </div>
  );
}

// ── Horizontal bar (geography) ────────────────────────────────────────────────
function HBar({ label, count, max, color=C.accent, rank, sub, glow }) {
  const w = max ? `${Math.max(2,(count/max)*100)}%` : "0%";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:11 }}>
      {rank!=null && (
        <div style={{ fontSize:9, color:C.dim, width:16, textAlign:"right", flexShrink:0, fontVariantNumeric:"tabular-nums", fontWeight:700 }}>
          {rank}
        </div>
      )}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5, alignItems:"baseline" }}>
          <span style={{ fontSize:12, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {label}{sub&&<span style={{ color:C.muted, fontSize:11 }}>{sub}</span>}
          </span>
          <span style={{ fontSize:13, color, fontVariantNumeric:"tabular-nums", fontWeight:700, flexShrink:0, marginLeft:10 }}>
            {fmt(count)}
          </span>
        </div>
        <div style={{ height:3, background:"rgba(255,255,255,0.04)", borderRadius:3, overflow:"hidden" }}>
          <div style={{
            height:"100%", width:w, background:color, borderRadius:3,
            boxShadow: glow ? `0 0 8px ${glow}` : "none",
          }} />
        </div>
      </div>
    </div>
  );
}

// ── Track row ─────────────────────────────────────────────────────────────────
function TrackRow({ track, rank, isFirst, isMobile }) {
  const [hov, setHov] = useState(false);
  const cr = track.completionRate;
  const crColor = cr>=70 ? C.green : cr>=40 ? C.gold : cr!=null ? C.red : C.dim;
  const crGlow  = cr>=70 ? "rgba(16,213,110,0.35)" : cr>=40 ? "rgba(240,180,41,0.35)" : null;

  const coverStyle = {
    width:40, height:40, borderRadius:8, background:C.surface3, flexShrink:0,
    backgroundImage: track.coverUrl ? `url(${track.coverUrl})` : "none",
    backgroundSize:"cover", backgroundPosition:"center",
    boxShadow: hov ? "0 0 18px rgba(0,255,255,0.14)" : "none",
    transition:"box-shadow 0.2s",
  };
  const rowBase = {
    borderTop: isFirst ? "none" : `1px solid ${C.border}`,
    borderRadius:10,
    background: hov ? "rgba(255,255,255,0.02)" : "transparent",
    marginLeft:-10, marginRight:-10,
    transition:"background 0.2s",
  };

  if (isMobile) {
    return (
      <div
        onMouseEnter={()=>setHov(true)}
        onMouseLeave={()=>setHov(false)}
        style={{ ...rowBase, padding:"14px 10px" }}
      >
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
          <span style={{ fontSize:10, color:C.dim, width:18, textAlign:"right", fontVariantNumeric:"tabular-nums", flexShrink:0 }}>{rank}</span>
          <div style={coverStyle} />
          <div style={{ fontSize:13, fontWeight:600, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>
            {track.title||track.slug}
          </div>
        </div>
        <div style={{ display:"flex", gap:20, paddingLeft:30 }}>
          {[
            { label:"Plays", val:fmt(track.plays), color:C.text },
            { label:"Purchases", val:fmt(track.purchases), color:C.gold },
            cr!=null ? { label:"Completion", val:`${cr}%`, color:crColor } : null,
          ].filter(Boolean).map(s=>(
            <div key={s.label}>
              <Label style={{ marginBottom:4 }}>{s.label}</Label>
              <div style={{ fontSize:14, fontWeight:700, color:s.color, fontVariantNumeric:"tabular-nums" }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      onMouseEnter={()=>setHov(true)}
      onMouseLeave={()=>setHov(false)}
      style={{
        ...rowBase,
        display:"grid",
        gridTemplateColumns:"22px 40px 1fr 72px 72px 72px 104px",
        gap:12, alignItems:"center",
        padding:"12px 10px",
      }}
    >
      <div style={{ fontSize:10, color:C.dim, textAlign:"right", fontVariantNumeric:"tabular-nums", fontWeight:700 }}>{rank}</div>
      <div style={coverStyle} />
      <div style={{ fontSize:13, fontWeight:500, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", minWidth:0 }}>
        {track.title||track.slug}
      </div>
      <div style={{ fontSize:13, color:C.textSub, fontVariantNumeric:"tabular-nums", textAlign:"right" }}>{fmt(track.plays)}</div>
      <div style={{ fontSize:13, color:C.gold, fontVariantNumeric:"tabular-nums", fontWeight:700, textAlign:"right" }}>{fmt(track.purchases)}</div>
      <div style={{ fontSize:13, color:C.muted, fontVariantNumeric:"tabular-nums", textAlign:"right" }}>{fmt(track.listeners)}</div>
      <div style={{ display:"flex", alignItems:"center", gap:8, justifyContent:"flex-end" }}>
        {cr!=null ? (
          <>
            <div style={{ width:44, height:3, background:"rgba(255,255,255,0.06)", borderRadius:3, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${cr}%`, background:crColor, borderRadius:3, boxShadow:crGlow?`0 0 6px ${crGlow}`:"none" }} />
            </div>
            <span style={{ fontSize:11, color:crColor, fontVariantNumeric:"tabular-nums", minWidth:30, textAlign:"right", fontWeight:700 }}>
              {cr}%
            </span>
          </>
        ) : <span style={{ fontSize:11, color:C.dim }}>—</span>}
      </div>
    </div>
  );
}

const TABS = [
  { id:"overview", label:"Overview" },
  { id:"audience", label:"Audience" },
  { id:"tracks",   label:"Tracks"   },
  { id:"revenue",  label:"Revenue"  },
];
const SORT_OPTS = [
  { key:"plays",          label:"Plays"      },
  { key:"purchases",      label:"Purchases"  },
  { key:"listeners",      label:"Listeners"  },
  { key:"completionRate", label:"Completion" },
];

export default function AnalyticsDashboard({ isMobile }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [tab,     setTab]     = useState("overview");
  const [sortBy,  setSortBy]  = useState("plays");

  // Revenue tab has its own fetch/loading/error state, entirely separate from
  // the overview/audience/tracks load above — it only fires once the Revenue
  // tab is actually opened, so opening this dashboard never does more work
  // than it did before this tab existed.
  const [revenueData,    setRevenueData]    = useState(null);
  const [revenueLoading, setRevenueLoading] = useState(false);
  const [revenueError,   setRevenueError]   = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    fetch("/api/admin/analytics", { credentials:"include" })
      .then(r=>r.ok?r.json():Promise.reject(r.status))
      .then(d=>{ setData(d); setLoading(false); })
      .catch(()=>{ setError("Could not load analytics."); setLoading(false); });
  }, []);

  const loadRevenue = useCallback(() => {
    setRevenueLoading(true); setRevenueError(null);
    fetch("/api/admin/analytics/revenue", { credentials:"include" })
      .then(r=>r.ok?r.json():Promise.reject(r.status))
      .then(d=>{ setRevenueData(d); setRevenueLoading(false); })
      .catch(()=>{ setRevenueError("Could not load revenue."); setRevenueLoading(false); });
  }, []);

  useEffect(()=>{ load(); },[load]);
  useEffect(()=>{
    if (tab==="revenue" && !revenueData && !revenueLoading) loadRevenue();
  },[tab, revenueData, revenueLoading, loadRevenue]);

  if (loading) return (
    <div style={{ padding:"60px 0", textAlign:"center" }}>
      <style>{`@keyframes adSpin{to{transform:rotate(360deg)}}`}</style>
      <div style={{
        width:36, height:36, borderRadius:"50%",
        border:"2px solid rgba(0,255,255,0.1)",
        borderTopColor:C.accent,
        margin:"0 auto 14px",
        animation:"adSpin 0.8s linear infinite",
      }} />
      <div style={{ fontSize:8, color:C.muted, letterSpacing:4, textTransform:"uppercase" }}>Loading analytics</div>
    </div>
  );

  if (error) return (
    <div style={{ padding:"24px 0", color:C.red, fontSize:13, display:"flex", alignItems:"center", gap:10 }}>
      <span>⚠</span> {error}
      <button onClick={load} style={{ marginLeft:"auto", background:"none", border:`1px solid #333`, borderRadius:8, color:C.muted, fontSize:11, padding:"5px 12px", cursor:"pointer", fontFamily:"inherit" }}>
        Retry
      </button>
    </div>
  );
  if (!data) return null;

  const {
    tracks=[],
    overview={},
    demographics={},
    geography={},
    growth={},
  } = data;
  const sortedTracks = [...tracks].sort((a,b)=>((b[sortBy]??-1)-(a[sortBy]??-1)));
  const twoCol = !isMobile;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
        <div style={{
          display:"flex", gap:4, padding:"3px",
          background:"rgba(255,255,255,0.02)",
          border:`1px solid ${C.border}`,
          borderRadius:999,
        }}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              background: tab===t.id ? "rgba(0,255,255,0.08)" : "transparent",
              border: `1px solid ${tab===t.id ? "rgba(0,255,255,0.28)" : "transparent"}`,
              borderRadius:999,
              color: tab===t.id ? C.accent : C.muted,
              fontSize:8, fontWeight:900, letterSpacing:3, textTransform:"uppercase",
              padding:"6px 16px", cursor:"pointer", fontFamily:"inherit",
              transition:"all 0.18s",
              boxShadow: tab===t.id ? "0 0 16px rgba(0,255,255,0.12)" : "none",
            }}>{t.label}</button>
          ))}
        </div>
        <div style={{ flex:1 }} />
        <a href="/admin/analytics" style={{
          display:"inline-flex", alignItems:"center", gap:5,
          background:"rgba(0,255,255,0.07)",
          border:`1px solid rgba(0,255,255,0.22)`,
          borderRadius:8, color:C.accent,
          fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase",
          padding:"6px 13px", cursor:"pointer", fontFamily:"inherit",
          textDecoration:"none",
          transition:"background 0.15s, border-color 0.15s",
        }}>
          Global Map ↗
        </a>
        <button onClick={load} style={{
          background:"none",
          border:`1px solid ${C.border}`,
          borderRadius:8, color:C.dim,
          fontSize:12, padding:"6px 12px",
          cursor:"pointer", fontFamily:"inherit",
          transition:"border-color 0.2s, color 0.2s",
        }}>↺</button>
      </div>

      {/* ══════════════════════════════════════════════════════════
          OVERVIEW
      ══════════════════════════════════════════════════════════ */}
      {tab==="overview" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>

          {/* KPI row */}
          <div style={{ display:"flex", gap:10, flexWrap: isMobile?"wrap":"nowrap" }}>
            <KPITile isMobile={isMobile} label="Total Fans"      value={fmt(overview.totalFans)}           sub="All-time accounts"    color={C.accent} glow={C.accentGlow} />
            <KPITile isMobile={isMobile} label="Plays · 90d"     value={fmt(overview.totalPlays)}          sub="Stream events"        color="#ffffff"  glow="rgba(255,255,255,0.07)" />
            <KPITile isMobile={isMobile} label="Purchases · 90d" value={fmt(overview.totalPurchases)}      sub="Completed orders"     color={C.gold}   glow={C.goldGlow} />
            <KPITile isMobile={isMobile} label="Revenue · 90d"   value={fmtRevenue(overview.totalRevenueCents)} sub="Gross sales"    color={C.green}  glow={C.greenGlow} />
          </div>

          {/* Growth chart */}
          <Card orbColor="rgba(0,255,255,0.1)">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:16, flexWrap:"wrap", gap:8 }}>
              <Label>Fan Growth · Last 12 Months</Label>
              <div style={{ display:"flex", gap:20, alignItems:"baseline" }}>
                <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                  <span style={{ fontSize:8, color:C.muted, letterSpacing:2, textTransform:"uppercase" }}>This month</span>
                  <span style={{ fontSize:22, fontWeight:900, color:C.accent, fontVariantNumeric:"tabular-nums" }}>
                    +{fmt(growth.monthly?.at(-1)?.newFans||0)}
                  </span>
                </div>
              </div>
            </div>
            <GrowthChart data={growth.monthly} />
            <div style={{ marginTop:14, display:"flex", gap:6, alignItems:"center" }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:C.accent, boxShadow:"0 0 8px rgba(0,255,255,0.6)", flexShrink:0 }} />
              <span style={{ fontSize:10, color:C.muted }}>Demographics captured</span>
              <span style={{
                fontSize:16, fontWeight:900,
                color: (overview.demographicsCoverage||0)>50 ? C.green : C.gold,
                fontVariantNumeric:"tabular-nums",
              }}>
                {overview.demographicsCoverage||0}%
              </span>
            </div>
          </Card>

          {/* Gender + Age */}
          <div style={{ display:"grid", gridTemplateColumns:twoCol?"1fr 1fr":"1fr", gap:12 }}>
            <Card>
              <Label style={{ marginBottom:16 }}>Gender</Label>
              <GenderDonut
                male={demographics.gender?.male||0}
                female={demographics.gender?.female||0}
                unknown={demographics.gender?.unknown||0}
              />
            </Card>
            <Card>
              <Label style={{ marginBottom:16 }}>Age Range</Label>
              <AgeRangePanel ageRange={demographics.ageRange} />
            </Card>
          </div>

          {/* Top 5 tracks */}
          <Card>
            <Label style={{ marginBottom:14 }}>Top Tracks</Label>
            {!isMobile && (
              <div style={{
                display:"grid",
                gridTemplateColumns:"22px 40px 1fr 72px 72px 72px 104px",
                gap:12, paddingBottom:10,
                borderBottom:`1px solid ${C.border}`,
                marginLeft:-10, marginRight:-10,
                paddingLeft:10, paddingRight:10,
              }}>
                {["#","","Track","Plays","Buys","Fans","Completion"].map((h,i)=>(
                  <div key={i} style={{ fontSize:7, color:C.dim, letterSpacing:2, textTransform:"uppercase", textAlign:i>2?"right":"left" }}>{h}</div>
                ))}
              </div>
            )}
            {tracks.slice(0,5).map((t,i)=>(
              <TrackRow key={t.slug} track={t} rank={i+1} isFirst={i===0} isMobile={isMobile} />
            ))}
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          AUDIENCE
      ══════════════════════════════════════════════════════════ */}
      {tab==="audience" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>

          {/* KPIs */}
          <div style={{ display:"flex", gap:10, flexWrap: isMobile?"wrap":"nowrap" }}>
            <KPITile isMobile={isMobile} label="Total Fans"      value={fmt(overview.totalFans)}                                           color={C.accent} glow={C.accentGlow} />
            <KPITile isMobile={isMobile} label="Fully Profiled"  value={fmt(overview.fansWithDemographics)}  sub={`${overview.demographicsCoverage||0}% of total`} color={C.purple} glow={C.purpleGlow} />
            <KPITile isMobile={isMobile} label="States"          value={fmt(geography.topStates?.length||0)} sub="Represented"             color={C.gold}   glow={C.goldGlow} />
            <KPITile isMobile={isMobile} label="Cities"          value={fmt(geography.topCities?.length||0)} sub="Represented"             color={C.green}  glow={C.greenGlow} />
          </div>

          {/* Gender + Age */}
          <div style={{ display:"grid", gridTemplateColumns:twoCol?"1fr 1fr":"1fr", gap:12 }}>
            <Card>
              <Label style={{ marginBottom:16 }}>Gender Breakdown</Label>
              <GenderDonut
                male={demographics.gender?.male||0}
                female={demographics.gender?.female||0}
                unknown={demographics.gender?.unknown||0}
              />
            </Card>
            <Card>
              <Label style={{ marginBottom:16 }}>Age Range</Label>
              <AgeRangePanel ageRange={demographics.ageRange} />
            </Card>
          </div>

          {/* Top States */}
          <Card>
            <Label style={{ marginBottom:14 }}>Top States</Label>
            {!geography.topStates?.length ? (
              <div style={{ fontSize:12, color:C.muted }}>No location data yet.</div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:twoCol?"1fr 1fr":"1fr", gap:"0 32px" }}>
                {(geography.topStates||[]).map((s,i)=>(
                  <HBar key={s.state}
                    label={STATE_NAMES[s.state]||s.state}
                    count={s.count}
                    max={geography.topStates[0].count}
                    rank={i+1}
                    color={i===0?C.accent:i<3?C.purple:C.muted}
                    glow={i===0?"rgba(0,255,255,0.3)":i<3?"rgba(162,89,255,0.25)":null}
                  />
                ))}
              </div>
            )}
          </Card>

          {/* Top Cities */}
          <Card>
            <Label style={{ marginBottom:14 }}>Top Cities</Label>
            {!geography.topCities?.length ? (
              <div style={{ fontSize:12, color:C.muted }}>No city data yet.</div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:twoCol?"1fr 1fr":"1fr", gap:"0 32px" }}>
                {(geography.topCities||[]).map((c,i)=>(
                  <HBar key={`${c.city}-${c.state}-${i}`}
                    label={c.city}
                    sub={c.state?`, ${c.state}`:""}
                    count={c.count}
                    max={geography.topCities[0].count}
                    rank={i+1}
                    color={i===0?C.accent:i<3?C.purple:C.muted}
                    glow={i===0?"rgba(0,255,255,0.3)":i<3?"rgba(162,89,255,0.25)":null}
                  />
                ))}
              </div>
            )}
          </Card>

          {/* Fan growth */}
          <Card orbColor="rgba(162,89,255,0.08)">
            <Label style={{ marginBottom:14 }}>Fan Growth · Last 12 Months</Label>
            <GrowthChart data={growth.monthly} />
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TRACKS
      ══════════════════════════════════════════════════════════ */}
      {tab==="tracks" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>

          {/* Sort bar */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
            <Label style={{ marginRight:4 }}>Sort</Label>
            {SORT_OPTS.map(opt=>(
              <button key={opt.key} onClick={()=>setSortBy(opt.key)} style={{
                background: sortBy===opt.key ? "rgba(0,255,255,0.07)" : "rgba(255,255,255,0.02)",
                color: sortBy===opt.key ? C.accent : C.muted,
                border: `1px solid ${sortBy===opt.key ? "rgba(0,255,255,0.28)" : C.border}`,
                borderRadius:8, padding:"5px 14px", fontSize:9,
                fontWeight: sortBy===opt.key ? 900 : 400,
                letterSpacing: sortBy===opt.key ? 1.5 : 0.5,
                textTransform:"uppercase",
                cursor:"pointer", fontFamily:"inherit",
                transition:"all 0.18s",
                boxShadow: sortBy===opt.key ? "0 0 12px rgba(0,255,255,0.1)" : "none",
              }}>{opt.label}</button>
            ))}
            <div style={{ flex:1 }} />
            <span style={{ fontSize:9, color:C.dim, letterSpacing:1.5, textTransform:"uppercase" }}>
              {sortedTracks.length} tracks
            </span>
          </div>

          <Card style={{ padding:"16px 20px" }}>
            {!isMobile && (
              <div style={{
                display:"grid",
                gridTemplateColumns:"22px 40px 1fr 72px 72px 72px 104px",
                gap:12, paddingBottom:10,
                borderBottom:`1px solid ${C.border}`,
                marginLeft:-10, marginRight:-10,
                paddingLeft:10, paddingRight:10,
              }}>
                {["#","","Track","Plays","Buys","Fans","Completion"].map((h,i)=>(
                  <div key={i} style={{ fontSize:7, color:C.dim, letterSpacing:2, textTransform:"uppercase", textAlign:i>2?"right":"left" }}>{h}</div>
                ))}
              </div>
            )}
            {sortedTracks.length===0 ? (
              <div style={{ textAlign:"center", padding:"40px 0", color:C.muted, fontSize:13 }}>No track data yet</div>
            ) : sortedTracks.map((t,i)=>(
              <TrackRow key={t.slug} track={t} rank={i+1} isFirst={i===0} isMobile={isMobile} />
            ))}
          </Card>
        </div>
      )}

      {tab==="revenue" && (
        <RevenueTab
          data={revenueData}
          loading={revenueLoading}
          error={revenueError}
          onRetry={loadRevenue}
          isMobile={isMobile}
        />
      )}
    </div>
  );
}

// ── Revenue tab: per-release attribution + subscription snapshot ────────────
function RevenueTab({ data, loading, error, onRetry, isMobile }) {
  if (loading) return (
    <div style={{ textAlign:"center", padding:"40px 0", color:C.muted, fontSize:13 }}>Loading revenue…</div>
  );
  if (error) return (
    <div style={{ padding:"24px 0", color:C.red, fontSize:13, display:"flex", alignItems:"center", gap:10 }}>
      <span>⚠</span> {error}
      <button onClick={onRetry} style={{ marginLeft:"auto", background:"none", border:`1px solid #333`, borderRadius:8, color:C.muted, fontSize:11, padding:"5px 12px", cursor:"pointer", fontFamily:"inherit" }}>
        Retry
      </button>
    </div>
  );
  if (!data) return null;

  const { releases=[], subscriptions={}, overview={} } = data;

  const KPI = ({ label, value, glow }) => (
    <Card style={{ padding:"16px 18px", flex:1, minWidth:120 }} orbColor={glow}>
      <Label>{label}</Label>
      <div style={{ fontSize:22, fontWeight:900, color:C.text, marginTop:6 }}>{value}</div>
    </Card>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
        <KPI label="Gross · 90d" value={fmtRevenue(overview.totalGrossCents)} glow={C.greenGlow} />
        <KPI label="MRR" value={fmtRevenue(subscriptions.mrrCents)} glow={C.accentGlow} />
        <KPI label="Active Subs" value={fmt(subscriptions.activeCount)} glow={C.purpleGlow} />
        <KPI label="Trialing" value={fmt(subscriptions.trialingCount)} />
        <KPI label="Past Due" value={fmt(subscriptions.pastDueCount)} />
        <KPI label="Canceled · 30d" value={fmt(subscriptions.canceledLast30d)} />
      </div>

      <Card style={{ padding:"16px 20px" }}>
        <Label style={{ marginBottom:12 }}>Revenue by release · 90d</Label>
        {!isMobile && (
          <div style={{
            display:"grid",
            gridTemplateColumns:"1fr 96px 96px",
            gap:12, paddingBottom:10,
            borderBottom:`1px solid ${C.border}`,
          }}>
            {["Release","Gross","Sold"].map((h,i)=>(
              <div key={i} style={{ fontSize:7, color:C.dim, letterSpacing:2, textTransform:"uppercase", textAlign:i>0?"right":"left" }}>{h}</div>
            ))}
          </div>
        )}
        {releases.length===0 ? (
          <div style={{ textAlign:"center", padding:"40px 0", color:C.muted, fontSize:13 }}>No revenue data yet</div>
        ) : releases.map((r)=>(
          <div key={r.productId || r.slug} style={{
            display:"grid",
            gridTemplateColumns: isMobile ? "1fr" : "1fr 96px 96px",
            gap:12, padding:"10px 0",
            borderBottom:`1px solid ${C.border2}`,
          }}>
            <div style={{ fontSize:13, color:C.text, fontWeight:600 }}>{r.title || r.slug}</div>
            <div style={{ fontSize:13, color:C.green, fontWeight:700, textAlign: isMobile ? "left" : "right" }}>{fmtRevenue(r.grossCents)}</div>
            <div style={{ fontSize:13, color:C.muted, textAlign: isMobile ? "left" : "right" }}>{fmt(r.itemsSold)}</div>
          </div>
        ))}
      </Card>
    </div>
  );
}
