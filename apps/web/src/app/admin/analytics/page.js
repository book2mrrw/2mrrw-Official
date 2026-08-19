"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

const ADMIN_EMAIL = "book2mrrw@gmail.com";

// ─── US State lookup ──────────────────────────────────────────────────────────
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

// ─── Formatting ───────────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null) return "—";
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}
function fmtRevenue(cents) {
  if (!cents) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}
function pct(part, total) {
  return total ? Math.round((part / total) * 100) : 0;
}
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function monthLabel(key) {
  const [,m] = key.split("-");
  return MONTHS[parseInt(m, 10) - 1] || key;
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:       "#050505",
  surface:  "#0d0d0d",
  surface2: "#141414",
  border:   "rgba(255,255,255,0.07)",
  border2:  "rgba(255,255,255,0.04)",
  text:     "#ffffff",
  muted:    "#888",
  dim:      "#444",
  accent:   "#00ffff",
  purple:   "#a259ff",
  gold:     "#f59e0b",
  green:    "#22c55e",
  red:      "#ef4444",
};

// ─── Shared primitives ────────────────────────────────────────────────────────
function Card({ children, style }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, ...style }}>
      {children}
    </div>
  );
}
function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 4, color: C.dim, textTransform: "uppercase", marginBottom: 20, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
      {children}
    </div>
  );
}
function KPITile({ label, value, sub, color = C.accent }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: "22px 26px", flex: "1 1 0", minWidth: 160 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 3, color: C.dim, textTransform: "uppercase", marginBottom: 14 }}>{label}</div>
      <div style={{ fontSize: 38, fontWeight: 900, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>{sub}</div> : null}
    </div>
  );
}

// ─── Gender split bar ─────────────────────────────────────────────────────────
function GenderSplit({ male, female, unknown }) {
  const total = male + female + unknown;
  if (total === 0) return <div style={{ fontSize: 13, color: C.muted }}>No demographic data yet. Collected at signup going forward.</div>;
  const mPct = pct(male, total);
  const fPct = pct(female, total);
  const uPct = pct(unknown, total);
  return (
    <div>
      <div style={{ display: "flex", height: 10, borderRadius: 10, overflow: "hidden", gap: 2, marginBottom: 20 }}>
        <div style={{ flex: mPct, background: C.accent }} />
        <div style={{ flex: fPct, background: C.purple }} />
        {unknown > 0 && <div style={{ flex: uPct, background: C.dim }} />}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {[
          { label: "Male", p: mPct, count: male, color: C.accent },
          { label: "Female", p: fPct, count: female, color: C.purple },
          unknown > 0 ? { label: "Not specified", p: uPct, count: unknown, color: C.dim } : null,
        ].filter(Boolean).map(item => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: item.color, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: C.text }}>{item.label}</span>
                <span style={{ fontSize: 13, color: item.color, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{item.p}% <span style={{ color: C.muted, fontWeight: 400 }}>({fmt(item.count)})</span></span>
              </div>
              <div style={{ height: 4, background: C.surface2, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${item.p}%`, background: item.color, borderRadius: 3 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Horizontal bar ───────────────────────────────────────────────────────────
function HBar({ label, count, max, color = C.accent, rank, sub }) {
  const w = max ? `${Math.max(2, (count / max) * 100)}%` : "0%";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      {rank != null && <div style={{ fontSize: 11, color: C.dim, width: 22, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{rank}</div>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
          <span style={{ fontSize: 13, color: C.text, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {label}
            {sub && <span style={{ color: C.muted, fontWeight: 400 }}>{sub}</span>}
          </span>
          <span style={{ fontSize: 13, color: color, fontVariantNumeric: "tabular-nums", fontWeight: 700, flexShrink: 0, marginLeft: 12 }}>{fmt(count)}</span>
        </div>
        <div style={{ height: 5, background: C.surface2, borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: w, background: color, borderRadius: 3 }} />
        </div>
      </div>
    </div>
  );
}

// ─── Growth SVG chart ─────────────────────────────────────────────────────────
function GrowthChart({ data }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map(d => d.newFans), 1);
  const W = 600, H = 130, PL = 4, PR = 4, PT = 12, PB = 24;
  const cW = W - PL - PR, cH = H - PT - PB, n = data.length;
  const px = i => PL + (i / (n - 1)) * cW;
  const py = v => PT + cH - (v / max) * cH;
  const pts = data.map((d, i) => `${px(i)},${py(d.newFans)}`).join(" ");
  const area = `M${px(0)},${py(data[0].newFans)} ${data.map((d, i) => `L${px(i)},${py(d.newFans)}`).join(" ")} L${px(n-1)},${PT+cH} L${px(0)},${PT+cH} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }}>
      <defs>
        <linearGradient id="fanAreaGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={C.accent} stopOpacity="0.28" />
          <stop offset="100%" stopColor={C.accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.33, 0.66, 1].map(v => (
        <line key={v} x1={PL} x2={PL+cW} y1={PT+cH*(1-v)} y2={PT+cH*(1-v)} stroke={C.border2} strokeWidth="1" />
      ))}
      <path d={area} fill="url(#fanAreaGrad)" />
      <polyline points={pts} fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((d, i) => d.newFans > 0 && (
        <circle key={i} cx={px(i)} cy={py(d.newFans)} r="3" fill={C.accent} />
      ))}
      {data.map((d, i) => (i === 0 || i === n-1 || i % 3 === 0) && (
        <text key={i} x={px(i)} y={H-4} textAnchor="middle" fill={C.dim} fontSize="8.5" fontFamily="system-ui">
          {monthLabel(d.month)}
        </text>
      ))}
    </svg>
  );
}

// ─── Track row ────────────────────────────────────────────────────────────────
function TrackRow({ track, rank, isFirst }) {
  const cr = track.completionRate;
  const crColor = cr >= 70 ? C.green : cr >= 40 ? C.gold : cr != null ? C.red : C.dim;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "28px 40px 1fr 90px 90px 90px 110px",
      gap: 12, alignItems: "center",
      padding: "12px 0",
      borderTop: isFirst ? "none" : `1px solid ${C.border}`,
    }}>
      <div style={{ fontSize: 12, color: C.dim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{rank}</div>
      <div style={{
        width: 40, height: 40, borderRadius: 8, background: C.surface2, flexShrink: 0,
        backgroundImage: track.coverUrl ? `url(${track.coverUrl})` : "none",
        backgroundSize: "cover", backgroundPosition: "center",
      }} />
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
        {track.title || track.slug}
      </div>
      <div style={{ fontSize: 14, color: C.text, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{fmt(track.plays)}</div>
      <div style={{ fontSize: 14, color: C.gold, fontVariantNumeric: "tabular-nums", fontWeight: 700, textAlign: "right" }}>{fmt(track.purchases)}</div>
      <div style={{ fontSize: 14, color: C.muted, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{fmt(track.listeners)}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
        {cr != null ? (
          <>
            <div style={{ width: 44, height: 4, background: C.surface2, borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${cr}%`, background: crColor, borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: 12, color: crColor, fontVariantNumeric: "tabular-nums", minWidth: 32, textAlign: "right" }}>{cr}%</span>
          </>
        ) : <span style={{ fontSize: 12, color: C.dim, textAlign: "right", minWidth: 32 }}>—</span>}
      </div>
    </div>
  );
}

const TABLE_HEADERS = ["#", "", "Track", "Plays", "Purchases", "Listeners", "Completion"];
const SORT_OPTS = [
  { key: "plays", label: "Plays" },
  { key: "purchases", label: "Purchases" },
  { key: "listeners", label: "Listeners" },
  { key: "completionRate", label: "Completion" },
];

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AdminAnalyticsPage() {
  const router = useRouter();
  const [ready, setReady]   = useState(false);
  const [tab, setTab]       = useState("overview");
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState("");
  const [sortBy, setSortBy] = useState("plays");

  useEffect(() => {
    const sb = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    sb.auth.getSession().then(({ data: d }) => {
      if ((d.session?.user?.email?.toLowerCase() || "") !== ADMIN_EMAIL) {
        router.replace("/"); return;
      }
      setReady(true);
    });
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res  = await fetch("/api/admin/analytics", { credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  if (!ready) return <div style={{ minHeight: "100vh", background: C.bg }} />;

  const sortedTracks = [...(data?.tracks || [])].sort((a, b) => {
    const av = a[sortBy] ?? -1, bv = b[sortBy] ?? -1;
    return bv - av;
  });

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "audience", label: "Audience" },
    { id: "tracks",   label: "Tracks"   },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* ─── Nav bar ─────────────────────────────────────────────────────── */}
      <div style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(5,5,5,0.95)", backdropFilter: "blur(24px)",
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 28px", display: "flex", alignItems: "center", gap: 28, height: 56 }}>
          <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 5, color: C.accent }}>2MRRW</div>
          <div style={{ width: 1, height: 20, background: C.border }} />
          <div style={{ fontSize: 13, color: C.muted, fontWeight: 500 }}>Analytics</div>
          <div style={{ flex: 1 }} />
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
              fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
              color: tab === t.id ? C.accent : C.muted,
              padding: "0 2px 2px",
              borderBottom: `2px solid ${tab === t.id ? C.accent : "transparent"}`,
            }}>
              {t.label}
            </button>
          ))}
          <button onClick={load} style={{
            background: "none", border: `1px solid ${C.border}`, borderRadius: 8,
            color: C.muted, fontSize: 12, padding: "5px 14px", cursor: "pointer",
            fontFamily: "inherit", transition: "border-color 0.15s",
          }}>
            ↺ Refresh
          </button>
        </div>
      </div>

      {/* ─── Body ────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "36px 28px" }}>
        {loading && !data && (
          <div style={{ textAlign: "center", padding: "100px 0", color: C.muted, fontSize: 14 }}>
            Loading analytics…
          </div>
        )}
        {error && (
          <div style={{ textAlign: "center", padding: "100px 0", color: C.red, fontSize: 14 }}>
            {error}
          </div>
        )}

        {data && !error && (
          <>
            {/* ═══════════════════════════════════════════════════════════════
                OVERVIEW TAB
            ═══════════════════════════════════════════════════════════════ */}
            {tab === "overview" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {/* KPI row */}
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <KPITile label="Total Fans" value={fmt(data.overview.totalFans)} sub="All-time accounts" color={C.accent} />
                  <KPITile label="Plays (90d)" value={fmt(data.overview.totalPlays)} sub="Stream events" color={C.text} />
                  <KPITile label="Purchases (90d)" value={fmt(data.overview.totalPurchases)} sub="Completed orders" color={C.gold} />
                  <KPITile label="Revenue (90d)" value={fmtRevenue(data.overview.totalRevenueCents)} sub="Gross sales" color={C.green} />
                </div>

                {/* Growth chart */}
                <Card>
                  <SectionLabel>New Fans — Last 12 Months</SectionLabel>
                  <GrowthChart data={data.growth.monthly} />
                  <div style={{ marginTop: 16, display: "flex", gap: 32, flexWrap: "wrap" }}>
                    <div>
                      <span style={{ fontSize: 12, color: C.muted }}>This month  </span>
                      <span style={{ fontSize: 22, fontWeight: 900, color: C.accent, fontVariantNumeric: "tabular-nums" }}>
                        +{fmt(data.growth.monthly.at(-1)?.newFans || 0)}
                      </span>
                    </div>
                    <div>
                      <span style={{ fontSize: 12, color: C.muted }}>Demographics captured  </span>
                      <span style={{ fontSize: 22, fontWeight: 900, color: data.overview.demographicsCoverage > 50 ? C.green : C.gold, fontVariantNumeric: "tabular-nums" }}>
                        {data.overview.demographicsCoverage}%
                      </span>
                    </div>
                    <div>
                      <span style={{ fontSize: 12, color: C.muted }}>Fans profiled  </span>
                      <span style={{ fontSize: 22, fontWeight: 900, color: C.text, fontVariantNumeric: "tabular-nums" }}>
                        {fmt(data.overview.fansWithDemographics)}
                      </span>
                    </div>
                  </div>
                </Card>

                {/* Gender + Age snapshot */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Card>
                    <SectionLabel>Gender</SectionLabel>
                    <GenderSplit
                      male={data.demographics.gender.male}
                      female={data.demographics.gender.female}
                      unknown={data.demographics.gender.unknown}
                    />
                  </Card>
                  <Card>
                    <SectionLabel>Age Range</SectionLabel>
                    {(() => {
                      const ar = data.demographics.ageRange;
                      const t = ar["18-25"] + ar["25-40"] + ar["40-65"];
                      if (t === 0) return <div style={{ fontSize: 13, color: C.muted }}>No age data yet.</div>;
                      return [
                        { key: "18-25", color: C.accent },
                        { key: "25-40", color: C.purple },
                        { key: "40-65", color: C.gold },
                      ].map(({ key, color }) => (
                        <HBar key={key} label={key} count={ar[key]} max={t} color={color} />
                      ));
                    })()}
                  </Card>
                </div>

                {/* Top 5 tracks */}
                <Card>
                  <SectionLabel>Top Tracks</SectionLabel>
                  <div style={{ display: "grid", gridTemplateColumns: "28px 40px 1fr 90px 90px 90px 110px", gap: 12, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
                    {TABLE_HEADERS.map((h, i) => (
                      <div key={i} style={{ fontSize: 10, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", textAlign: i > 2 ? "right" : "left" }}>{h}</div>
                    ))}
                  </div>
                  {data.tracks.slice(0, 5).map((t, i) => <TrackRow key={t.slug} track={t} rank={i + 1} isFirst={i === 0} />)}
                </Card>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                AUDIENCE TAB
            ═══════════════════════════════════════════════════════════════ */}
            {tab === "audience" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {/* Audience KPIs */}
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <KPITile label="Total Fans" value={fmt(data.overview.totalFans)} color={C.accent} />
                  <KPITile
                    label="Fully Profiled"
                    value={fmt(data.overview.fansWithDemographics)}
                    sub={`${data.overview.demographicsCoverage}% of total`}
                    color={C.purple}
                  />
                  <KPITile label="States" value={fmt(data.geography.topStates.length)} sub="Represented" color={C.gold} />
                  <KPITile label="Cities" value={fmt(data.geography.topCities.length)} sub="Represented" color={C.green} />
                </div>

                {/* Gender + Age */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Card>
                    <SectionLabel>Gender</SectionLabel>
                    <GenderSplit
                      male={data.demographics.gender.male}
                      female={data.demographics.gender.female}
                      unknown={data.demographics.gender.unknown}
                    />
                  </Card>
                  <Card>
                    <SectionLabel>Age Range</SectionLabel>
                    {(() => {
                      const ar = data.demographics.ageRange;
                      const t = ar["18-25"] + ar["25-40"] + ar["40-65"];
                      if (t === 0) return <div style={{ fontSize: 13, color: C.muted }}>No age data yet.</div>;
                      return (
                        <>
                          {[
                            { key: "18-25", color: C.accent },
                            { key: "25-40", color: C.purple },
                            { key: "40-65", color: C.gold },
                          ].map(({ key, color }) => (
                            <HBar key={key} label={key} count={ar[key]} max={Math.max(ar["18-25"], ar["25-40"], ar["40-65"])} color={color} />
                          ))}
                          {ar.unknown > 0 && (
                            <div style={{ fontSize: 12, color: C.dim, marginTop: 10 }}>
                              {fmt(ar.unknown)} fans haven't specified age yet
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </Card>
                </div>

                {/* Top states */}
                <Card>
                  <SectionLabel>Top States</SectionLabel>
                  {data.geography.topStates.length === 0 ? (
                    <div style={{ fontSize: 13, color: C.muted }}>No location data yet.</div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px" }}>
                      {data.geography.topStates.map((s, i) => (
                        <HBar
                          key={s.state}
                          label={STATE_NAMES[s.state] || s.state}
                          count={s.count}
                          max={data.geography.topStates[0].count}
                          rank={i + 1}
                          color={i === 0 ? C.accent : i < 3 ? C.muted : C.dim}
                        />
                      ))}
                    </div>
                  )}
                </Card>

                {/* Top cities */}
                <Card>
                  <SectionLabel>Top Cities</SectionLabel>
                  {data.geography.topCities.length === 0 ? (
                    <div style={{ fontSize: 13, color: C.muted }}>No city data yet.</div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px" }}>
                      {data.geography.topCities.map((c, i) => (
                        <HBar
                          key={`${c.city}-${c.state}-${i}`}
                          label={c.city}
                          sub={c.state ? `, ${c.state}` : ""}
                          count={c.count}
                          max={data.geography.topCities[0].count}
                          rank={i + 1}
                          color={i === 0 ? C.accent : i < 3 ? C.muted : C.dim}
                        />
                      ))}
                    </div>
                  )}
                </Card>

                {/* Growth chart */}
                <Card>
                  <SectionLabel>Fan Growth — Last 12 Months</SectionLabel>
                  <GrowthChart data={data.growth.monthly} />
                </Card>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                TRACKS TAB
            ═══════════════════════════════════════════════════════════════ */}
            {tab === "tracks" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Sort controls */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: C.muted }}>Sort by</span>
                  {SORT_OPTS.map(opt => (
                    <button key={opt.key} onClick={() => setSortBy(opt.key)} style={{
                      background: sortBy === opt.key ? C.accent : C.surface,
                      color: sortBy === opt.key ? "#000" : C.muted,
                      border: `1px solid ${sortBy === opt.key ? C.accent : C.border}`,
                      borderRadius: 8, padding: "6px 16px", fontSize: 12,
                      fontWeight: sortBy === opt.key ? 700 : 400,
                      cursor: "pointer", fontFamily: "inherit",
                    }}>
                      {opt.label}
                    </button>
                  ))}
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, color: C.dim }}>{sortedTracks.length} tracks</span>
                </div>

                <Card style={{ padding: "20px 24px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "28px 40px 1fr 90px 90px 90px 110px", gap: 12, paddingBottom: 12, marginBottom: 4, borderBottom: `1px solid ${C.border}` }}>
                    {TABLE_HEADERS.map((h, i) => (
                      <div key={i} style={{ fontSize: 10, color: C.dim, letterSpacing: 1.5, textTransform: "uppercase", textAlign: i > 2 ? "right" : "left" }}>{h}</div>
                    ))}
                  </div>
                  {sortedTracks.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "48px 0", color: C.muted }}>No track data yet</div>
                  ) : sortedTracks.map((t, i) => (
                    <TrackRow key={t.slug} track={t} rank={i + 1} isFirst={i === 0} />
                  ))}
                </Card>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
