"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useAdminGate } from "@/hooks/useAdminGate";
import { geoNaturalEarth1, geoPath, geoGraticule } from "d3-geo";
import { feature as topoFeature } from "topojson-client";
import worldTopo from "world-atlas/countries-110m.json";
import { CITY_COORDS } from "@/lib/geo/city-coords";
import { NAME_TO_A2, A2_TO_NUMERIC, A2_TO_NAME } from "@/lib/geo/country-codes";

// ─── Mobile breakpoint hook ───────────────────────────────────────────────────
function useIsMobile(bp = 768) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () => setMobile(window.innerWidth < bp);
    check();
    window.addEventListener("resize", check, { passive: true });
    return () => window.removeEventListener("resize", check);
  }, [bp]);
  return mobile;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const MAP_W = 960, MAP_H = 460;

const C = {
  bg: "#050505", surface: "#0d0d0d", surface2: "#141414", surface3: "#1a1a1a",
  border: "rgba(255,255,255,0.07)", border2: "rgba(255,255,255,0.04)",
  borderAccent: "rgba(0,255,255,0.22)",
  text: "#ffffff", muted: "#888", dim: "#444",
  accent: "#00ffff", accentGlow: "rgba(0,255,255,0.16)",
  purple: "#a259ff", gold: "#f59e0b", green: "#22c55e", red: "#ef4444",
};



// ─── Flag emoji from ISO alpha-2 ─────────────────────────────────────────────
function flag(a2) {
  if (!a2 || a2.length !== 2) return "";
  return String.fromCodePoint(
    a2.toUpperCase().charCodeAt(0) - 65 + 0x1F1E6,
    a2.toUpperCase().charCodeAt(1) - 65 + 0x1F1E6
  );
}

// ─── Formatting ───────────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}
function pct(part, total) { return total ? Math.round((part / total) * 100) : 0; }
function fmtRevenue(cents) {
  if (!cents) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}
function growthPct(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function monthLabel(key) { const [,m] = key.split("-"); return MONTHS_SHORT[parseInt(m,10)-1]||key; }

// ─── Metric accessor: reads the right field off a by_country/by_city row for
// whichever metric is currently selected ────────────────────────────────────
const METRICS = {
  fans:    { label: "Fans",    color: "0,255,255", get: (row) => row.fans },
  streams: { label: "Streams", color: "162,89,255", get: (row) => row.streams },
  revenue: { label: "Revenue", color: "34,197,94",  get: (row) => row.revenueCents },
};

// ─── Primitives ───────────────────────────────────────────────────────────────
function Card({ children, style }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 16, padding: 24, ...style,
    }}>
      {children}
    </div>
  );
}
function Label({ children, style }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: 4, color: C.dim,
      textTransform: "uppercase", marginBottom: 16, ...style,
    }}>
      {children}
    </div>
  );
}
function KPITile({ label, value, sub, color = C.accent, style }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
      padding: "18px 22px", flex: "1 1 0", minWidth: 140, position: "relative",
      overflow: "hidden", ...style,
    }}>
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, ${color}, transparent)`,
      }} />
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 3, color: C.dim, textTransform: "uppercase", marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 900, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 7 }}>{sub}</div>}
    </div>
  );
}
function HBar({ label, count, max, color = C.accent, rank, sub, small }) {
  const w = max ? `${Math.max(2, (count / max) * 100)}%` : "0%";
  const fs = small ? 12 : 13;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: small ? 8 : 11 }}>
      {rank != null && <div style={{ fontSize: 10, color: C.dim, width: 20, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{rank}</div>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: fs, color: C.text, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {label}{sub && <span style={{ color: C.muted, fontWeight: 400 }}>{sub}</span>}
          </span>
          <span style={{ fontSize: fs, color, fontVariantNumeric: "tabular-nums", fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>{fmt(count)}</span>
        </div>
        <div style={{ height: small ? 3 : 4, background: C.surface2, borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: w, background: color, borderRadius: 3 }} />
        </div>
      </div>
    </div>
  );
}

// ─── Growth chart ─────────────────────────────────────────────────────────────
function GrowthChart({ data, height = 120 }) {
  const [hovered, setHovered] = useState(null);
  if (!data?.length) return null;
  const max = Math.max(...data.map(d => d.fans), 1);
  const W = 520, H = height, PL = 4, PR = 4, PT = 10, PB = 22;
  const cW = W - PL - PR, cH = H - PT - PB, n = data.length;
  const px = i => PL + (i / (n - 1)) * cW;
  const py = v => PT + cH - (v / max) * cH;
  const areaD = `M${px(0)},${py(data[0].fans)} ${data.map((d,i)=>`L${px(i)},${py(d.fans)}`).join(" ")} L${px(n-1)},${PT+cH} L${px(0)},${PT+cH} Z`;
  const lineD = `M${px(0)},${py(data[0].fans)} ${data.map((d,i)=>`L${px(i)},${py(d.fans)}`).join(" ")}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:H, display:"block", overflow:"visible" }}>
      <defs>
        <linearGradient id="gcAreaGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={C.accent} stopOpacity="0.22"/>
          <stop offset="100%" stopColor={C.accent} stopOpacity="0"/>
        </linearGradient>
        <linearGradient id="gcLineGrad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={C.purple}/>
          <stop offset="100%" stopColor={C.accent}/>
        </linearGradient>
        <filter id="gcGlow"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      {[0.33,0.66,1].map(v=>(
        <line key={v} x1={PL} x2={PL+cW} y1={PT+cH*(1-v)} y2={PT+cH*(1-v)} stroke={C.border2} strokeWidth="1"/>
      ))}
      <path d={areaD} fill="url(#gcAreaGrad)"/>
      <path d={lineD} fill="none" stroke="url(#gcLineGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" filter="url(#gcGlow)"/>
      {data.map((d,i) => (
        <g key={i}>
          <circle cx={px(i)} cy={py(d.fans)} r={14} fill="transparent"
            onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} style={{cursor:"default"}}/>
          {(d.fans > 0 || hovered === i) && (
            <circle cx={px(i)} cy={py(d.fans)} r={hovered===i ? 5 : 3} fill={C.accent} filter="url(#gcGlow)"/>
          )}
          {hovered === i && (
            <g>
              <line x1={px(i)} x2={px(i)} y1={PT} y2={PT+cH} stroke={C.borderAccent} strokeWidth="1" strokeDasharray="3 3"/>
              <rect x={Math.min(px(i)-28,cW-52)} y={py(d.fans)-32} width={56} height={22} rx={6} fill={C.surface3} stroke={C.borderAccent} strokeWidth="1"/>
              <text x={Math.min(px(i),cW-24)} y={py(d.fans)-17} textAnchor="middle" fill={C.accent} fontSize="10" fontWeight="700" fontFamily="system-ui">{fmt(d.fans)}</text>
            </g>
          )}
        </g>
      ))}
      {data.map((d,i) => (i===0||i===n-1||i%2===0) && (
        <text key={`l${i}`} x={px(i)} y={H-3} textAnchor="middle" fill={C.dim} fontSize="8" fontFamily="system-ui">{monthLabel(d.month)}</text>
      ))}
    </svg>
  );
}

// ─── World map ────────────────────────────────────────────────────────────────
function WorldMap({ data, selectedCountry, onCountryClick, mapMode, metric }) {
  const svgRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const isGrowth = mapMode === "GROWTH";
  const metricGet = METRICS[metric]?.get || METRICS.fans.get;
  const metricColor = METRICS[metric]?.color || METRICS.fans.color;
  const EMPTY_COUNTRY = { fans: 0, streams: 0, revenueCents: 0, male: 0, female: 0, ages: {}, growth: { fans: 0, prevFans: 0, streams: 0, prevStreams: 0, revenueCents: 0, prevRevenueCents: 0 } };

  // geo + topo computed once. Every country A2_TO_NUMERIC knows about gets an
  // entry — not just ones with by_country data — so every country on the map
  // stays clickable with its real name and a correct zero, instead of only
  // countries that already have a fan/stream/revenue row.
  const { geoFeatures, pathGen, projection, valueMap, numericToA2, countryByA2 } = useMemo(() => {
    try {
      const proj = geoNaturalEarth1().scale(153).translate([MAP_W / 2, MAP_H / 2]);
      const pg = geoPath().projection(proj);
      const features = topoFeature(worldTopo, worldTopo.objects.countries).features;

      const byA2 = new Map((data?.by_country || []).map(c => [c.a2, c]));
      const vm = new Map();
      const n2a = new Map();
      for (const [a2, num] of Object.entries(A2_TO_NUMERIC)) {
        const c = byA2.get(a2) || EMPTY_COUNTRY;
        const value = isGrowth ? growthPct(c.growth.fans, c.growth.prevFans) : metricGet(c);
        vm.set(num, value);
        n2a.set(num, a2);
      }
      return { geoFeatures: features, pathGen: pg, projection: proj, valueMap: vm, numericToA2: n2a, countryByA2: byA2 };
    } catch (e) { console.error("Map init:", e); return { geoFeatures: [], pathGen: null, projection: null, valueMap: new Map(), numericToA2: new Map(), countryByA2: new Map() }; }
  }, [data, metric, isGrowth, metricGet]);

  // Zoom into the selected country's own bounding box — a real focus
  // transform (not just a side-panel), so switching countries visually
  // brings its cities into view instead of leaving the whole world at the
  // same fixed scale. Resets to the full-world view when nothing is selected.
  const zoomTransform = useMemo(() => {
    if (!selectedCountry || !pathGen || !geoFeatures.length) return null;
    const feature = geoFeatures.find(f => f.id === selectedCountry.numericId);
    if (!feature) return null;
    try {
      const [[x0, y0], [x1, y1]] = pathGen.bounds(feature);
      const dx = x1 - x0, dy = y1 - y0;
      if (!dx || !dy || !isFinite(dx) || !isFinite(dy)) return null;
      const scale = Math.max(1, Math.min(8, 0.82 / Math.max(dx / MAP_W, dy / MAP_H)));
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      return { scale, translateX: MAP_W / 2 - scale * cx, translateY: MAP_H / 2 - scale * cy };
    } catch { return null; }
  }, [selectedCountry, pathGen, geoFeatures]);

  // Country centroids in SVG space
  const centroids = useMemo(() => {
    if (!pathGen || !geoFeatures.length) return new Map();
    const m = new Map();
    for (const f of geoFeatures) {
      const c = pathGen.centroid(f);
      if (c && !isNaN(c[0]) && !isNaN(c[1])) m.set(f.id, c);
    }
    return m;
  }, [pathGen, geoFeatures]);

  // City dot positions — prefer a resolved, precise lat/lng (from geocoded
  // profiles) over the curated CITY_COORDS table, which itself beats the
  // country-centroid fallback used only when neither resolves.
  const cityDots = useMemo(() => {
    if (!projection || !data?.by_city) return [];
    return data.by_city.slice(0, 600).map(c => {
      let svgX, svgY;
      if (c.lat != null && c.lng != null) {
        const pt = projection([c.lng, c.lat]);
        if (!pt || isNaN(pt[0])) return null;
        [svgX, svgY] = pt;
      } else {
        const key = `${c.city}|${c.state}|${c.country}`;
        const coords = CITY_COORDS[key];
        if (coords) {
          const pt = projection(coords);
          if (!pt || isNaN(pt[0])) return null;
          [svgX, svgY] = pt;
        } else {
          const a2 = NAME_TO_A2[c.country];
          const num = a2 ? A2_TO_NUMERIC[a2] : null;
          const cen = num ? centroids.get(num) : null;
          if (!cen) return null;
          [svgX, svgY] = cen;
        }
      }
      const hasActivity = (c.fans || 0) + (c.streams || 0) + (c.revenueCents || 0) > 0;
      return { ...c, svgX, svgY, value: metricGet(c), hasActivity };
    }).filter(Boolean);
  }, [data, projection, centroids, metricGet]);

  const maxValue = useMemo(() => {
    const values = (data?.by_country || []).map((c) => isGrowth ? Math.abs(growthPct(c.growth.fans, c.growth.prevFans)) : metricGet(c));
    return values.length ? Math.max(...values, 1) : 1;
  }, [data, metricGet, isGrowth]);

  const valueOpacity = (v) => v ? 0.08 + (Math.log(Math.abs(v) + 1) / Math.log(maxValue + 1)) * 0.57 : 0;

  if (!geoFeatures.length || !pathGen) {
    return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height: MAP_H, color: C.muted, fontSize: 13 }}>Loading map…</div>;
  }

  const graticuleD = pathGen(geoGraticule()()) || "";
  const sphereD = pathGen({ type: "Sphere" }) || "";

  const maxCityValue = cityDots.length ? Math.max(...cityDots.map(d => d.value), 1) : 1;

  function handleMouseMove(e) {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    setTooltip(t => t ? { ...t, px: e.clientX - rect.left, py: e.clientY - rect.top } : t);
  }

  return (
    <div style={{ position:"relative", lineHeight: 0 }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        style={{ width:"100%", height:"auto", display:"block", cursor: "default" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { setHoveredId(null); setTooltip(null); }}
      >
        <defs>
          <filter id="dotGlow">
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="sphereGrad" cx="50%" cy="35%" r="60%">
            <stop offset="0%" stopColor="rgba(0,255,255,0.04)"/>
            <stop offset="100%" stopColor="rgba(0,0,0,0)"/>
          </radialGradient>
        </defs>

        {/* Sphere background stays full-scale — only the content group below zooms */}
        {sphereD && <path d={sphereD} fill="url(#sphereGrad)" stroke="rgba(255,255,255,0.06)" strokeWidth="0.8"/>}

        <g style={{ transition: "transform 0.5s cubic-bezier(0.22,1,0.36,1)" }}
           transform={zoomTransform ? `translate(${zoomTransform.translateX},${zoomTransform.translateY}) scale(${zoomTransform.scale})` : undefined}>

          {/* Graticule */}
          {graticuleD && <path d={graticuleD} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.4" vectorEffect="non-scaling-stroke"/>}

          {/* Countries */}
          {geoFeatures.map(f => {
            const value = valueMap.get(f.id) || 0;
            const a2 = numericToA2.get(f.id);
            const isSelected = selectedCountry?.numericId === f.id;
            const isHovered = hoveredId === f.id;
            const d = pathGen(f);
            if (!d) return null;

            // GROWTH diverges around zero (decline=red, growth=the selected metric's
            // color); DOTS/HEAT use a single sequential scale in that color.
            const rgb = isGrowth ? (value < 0 ? "239,68,68" : metricColor) : metricColor;
            let fill;
            if (isSelected) fill = `rgba(${rgb},0.32)`;
            else if (isHovered) fill = value !== 0 ? `rgba(${rgb},${valueOpacity(value) + 0.12})` : "rgba(255,255,255,0.1)";
            else if (value !== 0) fill = `rgba(${rgb},${valueOpacity(value)})`;
            else fill = "rgba(255,255,255,0.04)";

            return (
              <path
                key={f.id}
                d={d}
                fill={fill}
                stroke={isSelected ? `rgba(${rgb},0.7)` : "rgba(255,255,255,0.11)"}
                strokeWidth={isSelected ? 1.2 : 0.5}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: "pointer", transition: "fill 0.12s, stroke 0.12s" }}
                onMouseEnter={(e) => {
                  setHoveredId(f.id);
                  const rect = svgRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  const found = countryByA2.get(a2);
                  const name = found?.country || A2_TO_NAME[a2] || a2 || "Unknown";
                  setTooltip({
                    px: e.clientX - rect.left,
                    py: e.clientY - rect.top,
                    maxLeft: rect.width - 190,
                    maxTop: rect.height,
                    name,
                    a2: a2 || null,
                    fans: found?.fans || 0,
                    streams: found?.streams || 0,
                    revenueCents: found?.revenueCents || 0,
                    growthFans: found ? growthPct(found.growth.fans, found.growth.prevFans) : 0,
                  });
                }}
                onMouseLeave={() => { setHoveredId(null); setTooltip(null); }}
                onClick={() => {
                  if (!a2) return;
                  const found = countryByA2.get(a2);
                  const countryName = found?.country || A2_TO_NAME[a2] || a2;
                  const cities = (data?.by_city || []).filter(c => c.country === countryName).slice(0, 10);
                  onCountryClick({
                    numericId: f.id, a2,
                    name: countryName,
                    fans: found?.fans || 0,
                    streams: found?.streams || 0,
                    revenueCents: found?.revenueCents || 0,
                    male: found?.male || 0,
                    female: found?.female || 0,
                    ages: found?.ages || {},
                    growth: found?.growth || EMPTY_COUNTRY.growth,
                    cities,
                  });
                }}
              />
            );
          })}

          {/* City dots — visible whenever a city has ANY recorded activity, not
              only when the currently-selected metric happens to be nonzero for
              it (a city with plays but no registered fan there was previously
              invisible in the default Fans view). */}
          {mapMode === "DOTS" && cityDots.map((dot, i) => {
            if (!dot.hasActivity) return null;
            const r = dot.value > 0 ? 2 + Math.sqrt(dot.value / maxCityValue) * 9 : 2.5;
            const opacity = dot.value > 0 ? 0.5 + (dot.value / maxCityValue) * 0.5 : 0.35;
            return (
              <circle
                key={i}
                cx={dot.svgX} cy={dot.svgY} r={r}
                fill={`rgb(${metricColor})`} opacity={opacity}
                filter="url(#dotGlow)"
                vectorEffect="non-scaling-stroke"
                style={{ cursor: "pointer", transition: "r 0.15s, opacity 0.15s" }}
                onMouseEnter={(e) => {
                  const rect = svgRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setTooltip({
                    px: e.clientX - rect.left,
                    py: e.clientY - rect.top,
                    maxLeft: rect.width - 190,
                    maxTop: rect.height,
                    name: `${dot.city}${dot.state ? `, ${dot.state}` : ""}`,
                    a2: NAME_TO_A2[dot.country] || null,
                    country: dot.country,
                    fans: dot.fans,
                    streams: dot.streams,
                    revenueCents: dot.revenueCents,
                    isCity: true,
                  });
                }}
                onMouseLeave={() => setTooltip(null)}
              />
            );
          })}
        </g>
      </svg>

      {/* Tooltip — clamped to stay fully inside the map, so it can never
          overlap content below the card (previously unbounded vertically). */}
      {tooltip && (
        <div style={{
          position: "absolute",
          left: Math.max(8, Math.min(tooltip.px + 14, tooltip.maxLeft)),
          top: Math.max(8, Math.min(tooltip.py - 64, tooltip.maxTop - 140)),
          background: C.surface3, border: `1px solid ${C.borderAccent}`,
          borderRadius: 10, padding: "10px 14px",
          pointerEvents: "none", zIndex: 20, width: 172,
          boxShadow: `0 4px 32px rgba(0,255,255,0.12)`,
          display: "flex", flexDirection: "column", gap: 3,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            {tooltip.a2 && <span style={{ fontSize: 18, flexShrink: 0 }}>{flag(tooltip.a2)}</span>}
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tooltip.name}</span>
          </div>
          <div style={{ fontSize: 12, color: C.accent, fontVariantNumeric: "tabular-nums" }}>
            {fmt(tooltip.fans)} fan{tooltip.fans !== 1 ? "s" : ""}
          </div>
          {tooltip.streams > 0 && (
            <div style={{ fontSize: 11, color: C.purple, fontVariantNumeric: "tabular-nums" }}>{fmt(tooltip.streams)} streams</div>
          )}
          {tooltip.revenueCents > 0 && (
            <div style={{ fontSize: 11, color: C.green, fontVariantNumeric: "tabular-nums" }}>{fmtRevenue(tooltip.revenueCents)}</div>
          )}
          {!!tooltip.growthFans && (
            <div style={{ fontSize: 11, color: tooltip.growthFans < 0 ? C.red : C.accent }}>
              {tooltip.growthFans > 0 ? "+" : ""}{tooltip.growthFans}% · 30d
            </div>
          )}
          {!tooltip.isCity && <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>Click to explore</div>}
        </div>
      )}
    </div>
  );
}

// ─── Country detail panel ─────────────────────────────────────────────────────
function CountryPanel({ country, data, onClose }) {
  const totalFans = data?.overview?.total_fans || 1;
  const totalDemoFans = (country.male + country.female) || 0;
  const growthFansPct = growthPct(country.growth?.fans || 0, country.growth?.prevFans || 0);

  const topWorldCities = (data?.by_city || [])
    .filter(c => c.country === country.name)
    .slice(0, 8);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Country header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 28, marginBottom: 4 }}>{flag(country.a2)}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>{country.name}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            {pct(country.fans, totalFans)}% of global fanbase
          </div>
        </div>
        <button onClick={onClose} style={{
          background: "rgba(0,255,255,0.06)", border: `1px solid rgba(0,255,255,0.18)`,
          borderRadius: 8, color: C.accent, fontSize: 11, fontWeight: 700,
          padding: "8px 14px", cursor: "pointer", fontFamily: "inherit",
          letterSpacing: 1, flexShrink: 0,
        }}>
          ← World
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ background: C.surface2, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 9, letterSpacing: 3, color: C.dim, textTransform: "uppercase", marginBottom: 6 }}>Fans</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: C.accent, fontVariantNumeric: "tabular-nums" }}>{fmt(country.fans)}</div>
        </div>
        <div style={{ background: C.surface2, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 9, letterSpacing: 3, color: C.dim, textTransform: "uppercase", marginBottom: 6 }}>Streams</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: C.purple, fontVariantNumeric: "tabular-nums" }}>
            {country.streams > 0 ? fmt(country.streams) : <span style={{ fontSize: 14, color: C.dim }}>Accumulating</span>}
          </div>
        </div>
        <div style={{ background: C.surface2, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 9, letterSpacing: 3, color: C.dim, textTransform: "uppercase", marginBottom: 6 }}>Revenue</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: C.green, fontVariantNumeric: "tabular-nums" }}>
            {country.revenueCents > 0 ? fmtRevenue(country.revenueCents) : <span style={{ fontSize: 14, color: C.dim }}>None yet</span>}
          </div>
        </div>
        <div style={{ background: C.surface2, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 9, letterSpacing: 3, color: C.dim, textTransform: "uppercase", marginBottom: 6 }}>30d Growth</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: growthFansPct < 0 ? C.red : C.accent, fontVariantNumeric: "tabular-nums" }}>
            {growthFansPct > 0 ? "+" : ""}{growthFansPct}%
          </div>
        </div>
      </div>

      {/* Gender */}
      {totalDemoFans > 0 && (
        <div>
          <Label>Gender</Label>
          <div style={{ height: 6, borderRadius: 6, overflow: "hidden", display: "flex", gap: 2, marginBottom: 10 }}>
            <div style={{ flex: country.male, background: C.accent }}/>
            <div style={{ flex: country.female, background: C.purple }}/>
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <span style={{ fontSize: 12, color: C.muted }}>
              <span style={{ color: C.accent, fontWeight: 700 }}>{pct(country.male, totalDemoFans)}%</span> Male
            </span>
            <span style={{ fontSize: 12, color: C.muted }}>
              <span style={{ color: C.purple, fontWeight: 700 }}>{pct(country.female, totalDemoFans)}%</span> Female
            </span>
          </div>
        </div>
      )}

      {/* Age ranges */}
      {Object.keys(country.ages).length > 0 && (
        <div>
          <Label>Age Range</Label>
          {[
            { key: "18-25", color: C.accent },
            { key: "25-40", color: C.purple },
            { key: "40-65", color: C.gold },
          ].map(({ key, color }) => country.ages[key] > 0 && (
            <HBar key={key} label={key} count={country.ages[key]}
              max={Math.max(...Object.values(country.ages))} color={color} small />
          ))}
        </div>
      )}

      {/* Top cities */}
      {topWorldCities.length > 0 && (
        <div>
          <Label>Top Cities</Label>
          {topWorldCities.map((c, i) => (
            <HBar key={`${c.city}-${i}`} label={c.city}
              sub={c.state ? `, ${c.state}` : ""} count={c.fans}
              max={topWorldCities[0].fans} rank={i + 1}
              color={i === 0 ? C.accent : C.muted} small />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Global summary panel (shown when no country selected) ────────────────────
function GlobalSummaryPanel({ data }) {
  const top = (data?.by_country || []).slice(0, 12);
  const maxFans = top[0]?.fans || 1;
  const topByStreams = [...(data?.by_country || [])].filter(c => c.streams > 0).sort((a, b) => b.streams - a.streams).slice(0, 8);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <Label>Top Markets</Label>
        {top.length === 0 ? (
          <div style={{ fontSize: 13, color: C.dim }}>Fan geography appears here as your audience grows.</div>
        ) : top.map((c, i) => (
          <div key={c.a2 || c.country} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: C.dim, width: 18, textAlign: "right", flexShrink: 0 }}>{i + 1}</div>
            {c.a2 && <span style={{ fontSize: 14, flexShrink: 0 }}>{flag(c.a2)}</span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{c.country}</span>
                <span style={{ fontSize: 12, color: i < 3 ? C.accent : C.muted, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(c.fans)}</span>
              </div>
              <div style={{ height: 3, background: C.surface2, borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(c.fans / maxFans) * 100}%`, background: i < 3 ? C.accent : C.dim, borderRadius: 2 }}/>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(data?.by_country || []).length > 12 && (
        <div style={{ fontSize: 11, color: C.dim, textAlign: "center" }}>
          +{(data.by_country.length - 12)} more countries · Click a country on the map for detail
        </div>
      )}

      <div>
        <Label>Streams by Country</Label>
        {topByStreams.length === 0 ? (
          <div style={{ fontSize: 12, color: C.dim }}>Stream location data accumulates as fans play music.</div>
        ) : topByStreams.map((c) => (
          <div key={c.a2 || c.country} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            {c.a2 && <span style={{ fontSize: 13, flexShrink: 0 }}>{flag(c.a2)}</span>}
            <span style={{ flex: 1, fontSize: 12, color: C.text }}>{c.country}</span>
            <span style={{ fontSize: 12, color: C.purple, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(c.streams)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Geography table ──────────────────────────────────────────────────────────
function GeographyTable({ data, onCountryClick }) {
  const [sortBy, setSortBy] = useState("fans");
  const totalFans = data?.overview?.total_fans || 1;

  const rows = useMemo(() => {
    const arr = [...(data?.by_country || [])];
    if (sortBy === "streams") arr.sort((a, b) => b.streams - a.streams);
    else if (sortBy === "revenue") arr.sort((a, b) => b.revenueCents - a.revenueCents);
    else arr.sort((a, b) => b.fans - a.fans);
    return arr.slice(0, 30);
  }, [data, sortBy]);

  if (!rows.length) return null;

  const SORT_OPTS = [{ key: "fans", label: "Fans" }, { key: "streams", label: "Streams" }, { key: "revenue", label: "Revenue" }];

  return (
    <Card style={{ padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
        <Label style={{ marginBottom: 0, flex: 1 }}>All Markets</Label>
        <div style={{ display: "flex", gap: 6 }}>
          {SORT_OPTS.map(o => (
            <button key={o.key} onClick={() => setSortBy(o.key)} style={{
              background: sortBy === o.key ? C.accent : C.surface2,
              color: sortBy === o.key ? "#000" : C.muted,
              border: `1px solid ${sortBy === o.key ? C.accent : C.border}`,
              borderRadius: 6, padding: "4px 12px", fontSize: 11, cursor: "pointer",
              fontFamily: "inherit", fontWeight: sortBy === o.key ? 700 : 400,
            }}>{o.label}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "32px 28px 1fr 90px 90px 90px 100px", gap: 10, paddingBottom: 10, borderBottom: `1px solid ${C.border}`, marginBottom: 4 }}>
        {["#","","Country","Fans","% Total","Streams","Revenue"].map((h,i) => (
          <div key={i} style={{ fontSize: 9, color: C.dim, letterSpacing: 2, textTransform: "uppercase", textAlign: i > 2 ? "right" : "left" }}>{h}</div>
        ))}
      </div>
      {rows.map((c, i) => (
        <div
          key={c.a2 || c.country}
          onClick={() => {
            if (!c.a2) return;
            const num = A2_TO_NUMERIC[c.a2];
            const cities = (data?.by_city || []).filter(x => x.country === c.country).slice(0, 10);
            onCountryClick({ numericId: num, a2: c.a2, name: c.country, fans: c.fans, streams: c.streams, revenueCents: c.revenueCents, male: c.male, female: c.female, ages: c.ages, growth: c.growth, cities });
          }}
          style={{
            display: "grid", gridTemplateColumns: "32px 28px 1fr 90px 90px 90px 100px",
            gap: 10, alignItems: "center", padding: "9px 0",
            borderBottom: `1px solid ${C.border2}`,
            cursor: c.a2 ? "pointer" : "default",
            transition: "background 0.1s",
          }}
          onMouseEnter={e => { if (c.a2) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        >
          <div style={{ fontSize: 11, color: C.dim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{i + 1}</div>
          <div style={{ fontSize: 16 }}>{c.a2 ? flag(c.a2) : ""}</div>
          <div style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>{c.country}</div>
          <div style={{ fontSize: 13, color: C.accent, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(c.fans)}</div>
          <div style={{ fontSize: 13, color: C.muted, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pct(c.fans, totalFans)}%</div>
          <div style={{ fontSize: 13, color: c.streams > 0 ? C.purple : C.dim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.streams > 0 ? fmt(c.streams) : "—"}</div>
          <div style={{ fontSize: 13, color: c.revenueCents > 0 ? C.green : C.dim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.revenueCents > 0 ? fmtRevenue(c.revenueCents) : "—"}</div>
        </div>
      ))}
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;

const RANGE_PRESETS = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "ytd", label: "YTD" },
  { key: "all", label: "All" },
  { key: "custom", label: "Custom" },
];

function rangeToDates(range, customSince, customUntil) {
  const now = new Date();
  switch (range) {
    case "7d": return { since: new Date(now.getTime() - 7 * DAY_MS), until: null };
    case "30d": return { since: new Date(now.getTime() - 30 * DAY_MS), until: null };
    case "90d": return { since: new Date(now.getTime() - 90 * DAY_MS), until: null };
    case "ytd": return { since: new Date(now.getFullYear(), 0, 1), until: null };
    case "custom": return {
      since: customSince ? new Date(customSince) : null,
      until: customUntil ? new Date(`${customUntil}T23:59:59`) : null,
    };
    default: return { since: null, until: null };
  }
}

export default function AdminGlobalAnalytics() {
  const isMobile = useIsMobile(768);
  const gate = useAdminGate();
  const ready = gate === "ok";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [mapMode, setMapMode] = useState("DOTS");
  const [metric, setMetric] = useState("fans");
  const [range, setRange] = useState("all");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");

  const { since, until } = useMemo(() => rangeToDates(range, customSince, customUntil), [range, customSince, customUntil]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (since) params.set("since", since.toISOString());
      if (until) params.set("until", until.toISOString());
      const qs = params.toString();
      const res = await fetch(`/api/admin/analytics/global${qs ? `?${qs}` : ""}`, { credentials: "include", cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [since, until]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  if (!ready) return <div style={{ minHeight: "100vh", background: C.bg }} />;

  const ov = data?.overview || {};
  const pad = isMobile ? "0 16px" : "0 28px";
  const bodyPad = isMobile ? "18px 16px 80px" : "28px 28px 60px";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "system-ui,-apple-system,sans-serif" }}>
      {/* ── Sticky nav ───────────────────────────────────────────────────────── */}
      <div style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(5,5,5,0.96)", backdropFilter: "blur(24px)",
        borderBottom: `1px solid ${C.border}`,
      }}>
        {/* Primary row */}
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: pad, display: "flex", alignItems: "center", gap: 14, height: 50 }}>
          <Link href="/" style={{ fontSize: 12, fontWeight: 900, letterSpacing: 5, color: C.accent, textDecoration: "none" }}>2MRRW</Link>
          <div style={{ width: 1, height: 16, background: C.border, flexShrink: 0 }} />
          {!isMobile && <div style={{ fontSize: 12, color: C.muted, fontWeight: 500, whiteSpace: "nowrap" }}>Global Analytics</div>}
          {selectedCountry && (
            <>
              {!isMobile && <div style={{ fontSize: 12, color: C.dim }}>›</div>}
              <div style={{ fontSize: 12, color: C.text, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                <span>{flag(selectedCountry.a2)}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedCountry.name}</span>
              </div>
            </>
          )}
          {!selectedCountry && isMobile && (
            <div style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}>Global Analytics</div>
          )}
          <div style={{ flex: 1 }} />
          {/* Map mode toggle — hidden on mobile (dots is fine by default) */}
          {!isMobile && (
            <div style={{ display: "flex", gap: 1, background: C.surface2, borderRadius: 8, padding: 3 }}>
              {["DOTS","HEAT","GROWTH"].map(mode => (
                <button key={mode} onClick={() => setMapMode(mode)} style={{
                  background: mapMode === mode ? C.surface3 : "none",
                  border: mapMode === mode ? `1px solid ${C.border}` : "1px solid transparent",
                  borderRadius: 6, padding: "4px 10px", fontSize: 9, fontWeight: 700,
                  color: mapMode === mode ? C.accent : C.muted, cursor: "pointer",
                  fontFamily: "inherit", letterSpacing: 1.5,
                }}>{mode}</button>
              ))}
            </div>
          )}
          <button onClick={load} style={{
            background: "none", border: `1px solid ${C.border}`, borderRadius: 8,
            color: C.muted, fontSize: 11, padding: isMobile ? "5px 10px" : "5px 14px",
            cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
          }}>
            {isMobile ? "↺" : "↺ Refresh"}
          </button>
        </div>
        {/* Mobile map mode row */}
        {isMobile && (
          <div style={{ display: "flex", gap: 1, padding: "0 16px 8px", justifyContent: "flex-end" }}>
            {["DOTS","HEAT","GROWTH"].map(mode => (
              <button key={mode} onClick={() => setMapMode(mode)} style={{
                background: mapMode === mode ? "rgba(0,255,255,0.08)" : "none",
                border: mapMode === mode ? `1px solid rgba(0,255,255,0.22)` : `1px solid ${C.border}`,
                borderRadius: 6, padding: "3px 10px", fontSize: 9, fontWeight: 700,
                color: mapMode === mode ? C.accent : C.muted, cursor: "pointer",
                fontFamily: "inherit", letterSpacing: 1.5,
              }}>{mode}</button>
            ))}
          </div>
        )}

        {/* Metric + date-range controls — govern DOTS/HEAT totals; GROWTH is always fixed 30d-vs-prior */}
        <div style={{
          maxWidth: 1400, margin: "0 auto", padding: isMobile ? "0 16px 10px" : "0 28px 10px",
          display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
        }}>
          <div style={{ display: "flex", gap: 1, background: C.surface2, borderRadius: 8, padding: 3 }}>
            {Object.entries(METRICS).map(([key, m]) => (
              <button key={key} onClick={() => setMetric(key)} style={{
                background: metric === key ? C.surface3 : "none",
                border: metric === key ? `1px solid ${C.border}` : "1px solid transparent",
                borderRadius: 6, padding: "4px 10px", fontSize: 9, fontWeight: 700,
                color: metric === key ? `rgb(${m.color})` : C.muted, cursor: "pointer",
                fontFamily: "inherit", letterSpacing: 1,
              }}>{m.label}</button>
            ))}
          </div>
          {mapMode !== "GROWTH" && (
            <>
              <div style={{ display: "flex", gap: 1, background: C.surface2, borderRadius: 8, padding: 3 }}>
                {RANGE_PRESETS.map(r => (
                  <button key={r.key} onClick={() => setRange(r.key)} style={{
                    background: range === r.key ? C.surface3 : "none",
                    border: range === r.key ? `1px solid ${C.border}` : "1px solid transparent",
                    borderRadius: 6, padding: "4px 10px", fontSize: 9, fontWeight: 700,
                    color: range === r.key ? C.accent : C.muted, cursor: "pointer",
                    fontFamily: "inherit", letterSpacing: 1,
                  }}>{r.label}</button>
                ))}
              </div>
              {range === "custom" && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="date" value={customSince} onChange={e => setCustomSince(e.target.value)}
                    style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 11, padding: "4px 8px", fontFamily: "inherit", colorScheme: "dark" }} />
                  <span style={{ color: C.dim, fontSize: 11 }}>→</span>
                  <input type="date" value={customUntil} onChange={e => setCustomUntil(e.target.value)}
                    style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 11, padding: "4px 8px", fontFamily: "inherit", colorScheme: "dark" }} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: bodyPad }}>
        {loading && !data && (
          <div style={{ textAlign: "center", padding: "100px 0", color: C.muted, fontSize: 14 }}>
            Loading global analytics…
          </div>
        )}
        {error && (
          <div style={{ textAlign: "center", padding: "100px 0", color: C.red, fontSize: 14 }}>
            {error}
          </div>
        )}

        {data && (
          <>
            {/* KPI strip */}
            <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
              <KPITile label="Total Fans" value={fmt(ov.total_fans)} sub="Streamed at least once" color={C.accent}
                style={{ minWidth: isMobile ? "calc(50% - 5px)" : 140 }} />
              <KPITile label="Countries" value={fmt(ov.unique_countries)} sub="Markets reached" color={C.purple}
                style={{ minWidth: isMobile ? "calc(50% - 5px)" : 140 }} />
              <KPITile label="Cities" value={fmt(ov.unique_cities)} sub="Locations recorded" color={C.gold}
                style={{ minWidth: isMobile ? "calc(50% - 5px)" : 140 }} />
              <KPITile label="Streams" value={fmt(ov.total_streams)} sub="Geo-tagged plays" color={C.purple}
                style={{ minWidth: isMobile ? "calc(50% - 5px)" : 140 }} />
              <KPITile label="Revenue" value={fmtRevenue(ov.total_revenue_cents)} sub="In this range" color={C.green}
                style={{ minWidth: isMobile ? "calc(50% - 5px)" : 140 }} />
              <KPITile
                label="This Month" value={`+${fmt(data.monthly_growth?.at(-1)?.fans || 0)}`} sub="New fans" color={C.accent}
                style={{ minWidth: isMobile ? "100%" : 140 }} />
            </div>

            {/* Map + side panel — stacks on mobile */}
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 340px",
              gap: 14, marginBottom: 18, alignItems: "start",
            }}>
              {/* Map card */}
              <Card style={{ padding: 0, overflow: "hidden", position: "relative" }}>
                <div style={{
                  position: "absolute", top: isMobile ? 8 : 14, left: isMobile ? 10 : 16, zIndex: 10,
                  fontSize: 8, fontWeight: 700, letterSpacing: 3,
                  color: C.dim, textTransform: "uppercase",
                }}>
                  {mapMode === "GROWTH" ? "30-Day Growth" : `${METRICS[metric].label} ${mapMode === "DOTS" ? "Locations" : "Density"}`}
                  {!isMobile && " · Click a country to explore"}
                </div>
                <WorldMap
                  data={data}
                  selectedCountry={selectedCountry}
                  onCountryClick={setSelectedCountry}
                  mapMode={mapMode}
                  metric={metric}
                />
                {isMobile && (
                  <div style={{ padding: "8px 12px", borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.dim, textAlign: "center" }}>
                    Tap a country to explore
                  </div>
                )}
              </Card>

              {/* Side panel */}
              <Card style={{ padding: isMobile ? 16 : 20 }}>
                {selectedCountry ? (
                  <CountryPanel
                    country={selectedCountry}
                    data={data}
                    onClose={() => setSelectedCountry(null)}
                  />
                ) : (
                  <GlobalSummaryPanel data={data} />
                )}
              </Card>
            </div>

            {/* Fan growth timeline */}
            <Card style={{ marginBottom: 18 }}>
              <Label>Fan Growth — Last 12 Months</Label>
              <GrowthChart data={data.monthly_growth} height={isMobile ? 110 : 140} />
              <div style={{ display: "flex", gap: isMobile ? 16 : 32, flexWrap: "wrap", marginTop: 14 }}>
                {[
                  { label: "This month", value: `+${fmt(data.monthly_growth?.at(-1)?.fans || 0)}`, color: C.accent },
                  { label: "Countries", value: ov.unique_countries || 0, color: C.purple },
                  { label: "Total fanbase", value: fmt(ov.total_fans), color: C.text },
                ].map(item => (
                  <div key={item.label}>
                    <span style={{ fontSize: 11, color: C.muted }}>{item.label}  </span>
                    <span style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, color: item.color, fontVariantNumeric: "tabular-nums" }}>
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Geography table — scrollable on mobile */}
            <div style={{ overflowX: isMobile ? "auto" : "visible", WebkitOverflowScrolling: "touch" }}>
              <div style={{ minWidth: isMobile ? 560 : "auto" }}>
                <GeographyTable data={data} onCountryClick={setSelectedCountry} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
