"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useAdminGate } from "@/hooks/useAdminGate";
import { geoNaturalEarth1, geoPath, geoGraticule } from "d3-geo";
import { feature as topoFeature } from "topojson-client";
import worldTopo from "world-atlas/countries-110m.json";

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

// ─── Country name → ISO alpha-2 ───────────────────────────────────────────────
const NAME_TO_A2 = {
  "United States":"US","United Kingdom":"GB","Canada":"CA","Australia":"AU",
  "Germany":"DE","France":"FR","Japan":"JP","South Korea":"KR","Brazil":"BR",
  "Mexico":"MX","India":"IN","China":"CN","Spain":"ES","Italy":"IT","Netherlands":"NL",
  "Sweden":"SE","Norway":"NO","Denmark":"DK","Finland":"FI","Switzerland":"CH",
  "Austria":"AT","Belgium":"BE","Portugal":"PT","Ireland":"IE","New Zealand":"NZ",
  "Singapore":"SG","Hong Kong":"HK","Taiwan":"TW","Israel":"IL","United Arab Emirates":"AE",
  "Saudi Arabia":"SA","Nigeria":"NG","South Africa":"ZA","Ghana":"GH","Kenya":"KE",
  "Egypt":"EG","Ethiopia":"ET","Tanzania":"TZ","Uganda":"UG","Senegal":"SN",
  "Côte d'Ivoire":"CI","Cameroon":"CM","Zimbabwe":"ZW","Rwanda":"RW","Angola":"AO",
  "Mozambique":"MZ","Zambia":"ZM","Algeria":"DZ","Morocco":"MA","Tunisia":"TN",
  "Libya":"LY","Sudan":"SD","Somalia":"SO","Madagascar":"MG","Malawi":"MW",
  "Botswana":"BW","Namibia":"NA","Lesotho":"LS","Eswatini":"SZ","Burundi":"BI",
  "Sierra Leone":"SL","Liberia":"LR","Guinea":"GN","Guinea-Bissau":"GW","Mali":"ML",
  "Burkina Faso":"BF","Niger":"NE","Chad":"TD","Central African Republic":"CF",
  "Congo":"CG","Democratic Republic of the Congo":"CD","Gabon":"GA","Equatorial Guinea":"GQ",
  "São Tomé and Príncipe":"ST","Cape Verde":"CV","Comoros":"KM","Djibouti":"DJ",
  "Eritrea":"ER","Gambia":"GM","Togo":"TG","Benin":"BJ","Mauritania":"MR",
  "Cabo Verde":"CV","Mauritius":"MU","Seychelles":"SC","South Sudan":"SS",
  "Argentina":"AR","Chile":"CL","Colombia":"CO","Peru":"PE","Venezuela":"VE",
  "Ecuador":"EC","Bolivia":"BO","Paraguay":"PY","Uruguay":"UY","Guyana":"GY",
  "Suriname":"SR","Trinidad and Tobago":"TT","Jamaica":"JM","Cuba":"CU",
  "Dominican Republic":"DO","Haiti":"HT","Bahamas":"BS","Barbados":"BB",
  "Saint Lucia":"LC","Grenada":"GD","Saint Vincent and the Grenadines":"VC",
  "Antigua and Barbuda":"AG","Saint Kitts and Nevis":"KN","Panama":"PA",
  "Costa Rica":"CR","Guatemala":"GT","Honduras":"HN","El Salvador":"SV",
  "Nicaragua":"NI","Belize":"BZ","Dominica":"DM",
  "Russia":"RU","Ukraine":"UA","Poland":"PL","Romania":"RO","Czech Republic":"CZ",
  "Hungary":"HU","Bulgaria":"BG","Serbia":"RS","Slovakia":"SK","Croatia":"HR",
  "Greece":"GR","Turkey":"TR","Belarus":"BY","Lithuania":"LT","Latvia":"LV",
  "Estonia":"EE","Slovenia":"SI","North Macedonia":"MK","Bosnia and Herzegovina":"BA",
  "Montenegro":"ME","Albania":"AL","Kosovo":"XK","Moldova":"MD","Luxembourg":"LU",
  "Iceland":"IS","Liechtenstein":"LI","Andorra":"AD","Malta":"MT","Monaco":"MC",
  "San Marino":"SM","Cyprus":"CY","Armenia":"AM","Azerbaijan":"AZ","Georgia":"GE",
  "Kazakhstan":"KZ","Uzbekistan":"UZ","Turkmenistan":"TM","Kyrgyzstan":"KG",
  "Tajikistan":"TJ","Mongolia":"MN","Afghanistan":"AF","Pakistan":"PK",
  "Bangladesh":"BD","Sri Lanka":"LK","Nepal":"NP","Bhutan":"BT","Maldives":"MV",
  "Myanmar":"MM","Thailand":"TH","Vietnam":"VN","Cambodia":"KH","Laos":"LA",
  "Malaysia":"MY","Indonesia":"ID","Philippines":"PH","Brunei":"BN","Timor-Leste":"TL",
  "Papua New Guinea":"PG","Fiji":"FJ","Solomon Islands":"SB","Vanuatu":"VU",
  "Samoa":"WS","Tonga":"TO","Kiribati":"KI","Micronesia":"FM","Palau":"PW",
  "Marshall Islands":"MH","Nauru":"NR","Tuvalu":"TV",
  "Iran":"IR","Iraq":"IQ","Syria":"SY","Lebanon":"LB","Jordan":"JO","Kuwait":"KW",
  "Qatar":"QA","Bahrain":"BH","Oman":"OM","Yemen":"YE","Palestine":"PS",
  "Tajikistan":"TJ","North Korea":"KP",
};

// ─── ISO alpha-2 → ISO 3166-1 numeric (matches world-atlas feature IDs) ──────
const A2_TO_NUMERIC = {
  US:840,GB:826,CA:124,AU:36,DE:276,FR:250,JP:392,KR:410,BR:76,MX:484,
  IN:356,CN:156,ES:724,IT:380,NL:528,SE:752,NO:578,DK:208,FI:246,CH:756,
  AT:40,BE:56,PT:620,IE:372,NZ:554,SG:702,HK:344,TW:158,IL:376,AE:784,
  SA:682,NG:566,ZA:710,GH:288,KE:404,EG:818,ET:231,TZ:834,UG:800,SN:686,
  CI:384,CM:120,ZW:716,RW:646,AO:24,MZ:508,ZM:894,DZ:12,MA:504,TN:788,
  LY:434,SD:729,SO:706,MG:450,MW:454,BW:72,NA:516,LS:426,SZ:748,BI:108,
  SL:694,LR:430,GN:324,GW:624,ML:466,BF:854,NE:562,TD:148,CF:140,CG:178,
  CD:180,GA:266,GQ:226,ST:678,CV:132,KM:174,DJ:262,ER:232,GM:270,TG:768,
  BJ:204,MR:478,MU:480,SC:690,SS:728,AR:32,CL:152,CO:170,PE:604,VE:862,
  EC:218,BO:68,PY:600,UY:858,GY:328,SR:740,TT:780,JM:388,CU:192,DO:214,
  HT:332,BS:44,BB:52,LC:662,GD:308,VC:670,AG:28,KN:659,PA:591,CR:188,
  GT:320,HN:340,SV:222,NI:558,BZ:84,DM:212,RU:643,UA:804,PL:616,RO:642,
  CZ:203,HU:348,BG:100,RS:688,SK:703,HR:191,GR:300,TR:792,BY:112,LT:440,
  LV:428,EE:233,SI:705,MK:807,BA:70,ME:499,AL:8,MD:498,LU:442,IS:352,
  LI:438,AD:20,MT:470,MC:492,SM:674,CY:196,AM:51,AZ:31,GE:268,KZ:398,
  UZ:860,TM:795,KG:417,TJ:762,MN:496,AF:4,PK:586,BD:50,LK:144,NP:524,
  BT:64,MV:462,MM:104,TH:764,VN:704,KH:116,LA:418,MY:458,ID:360,PH:608,
  BN:96,TL:626,PG:598,FJ:242,SB:90,VU:548,WS:882,TO:776,KI:296,FM:583,
  PW:585,MH:584,NR:520,TV:798,IR:364,IQ:368,SY:760,LB:422,JO:400,KW:414,
  QA:634,BH:48,OM:512,YE:887,PS:275,KP:408,
};

// ─── ISO alpha-2 → display name (reverse of NAME_TO_A2) ─────────────────────
const A2_TO_NAME = Object.fromEntries(Object.entries(NAME_TO_A2).map(([k, v]) => [v, k]));

// ─── City coordinates [lng, lat] (GeoJSON order) ─────────────────────────────
const CITY_COORDS = {
  // United States
  "New York|NY|United States":[-74.006,40.7128],"Los Angeles|CA|United States":[-118.2437,34.0522],
  "Chicago|IL|United States":[-87.6298,41.8781],"Houston|TX|United States":[-95.3698,29.7604],
  "Phoenix|AZ|United States":[-112.074,33.4484],"Philadelphia|PA|United States":[-75.1652,39.9526],
  "San Antonio|TX|United States":[-98.4936,29.4241],"San Diego|CA|United States":[-117.1611,32.7157],
  "Dallas|TX|United States":[-96.797,32.7767],"San Jose|CA|United States":[-121.8863,37.3382],
  "Austin|TX|United States":[-97.7431,30.2672],"Jacksonville|FL|United States":[-81.6557,30.3322],
  "Fort Worth|TX|United States":[-97.3208,32.7555],"Columbus|OH|United States":[-82.9988,39.9612],
  "Charlotte|NC|United States":[-80.8431,35.2271],"Indianapolis|IN|United States":[-86.1581,39.7684],
  "San Francisco|CA|United States":[-122.4194,37.7749],"Seattle|WA|United States":[-122.3321,47.6062],
  "Denver|CO|United States":[-104.9903,39.7392],"Nashville|TN|United States":[-86.7816,36.1627],
  "Oklahoma City|OK|United States":[-97.5164,35.4676],"El Paso|TX|United States":[-106.485,31.7619],
  "Washington|DC|United States":[-77.0369,38.9072],"Las Vegas|NV|United States":[-115.1398,36.1699],
  "Louisville|KY|United States":[-85.7585,38.2527],"Baltimore|MD|United States":[-76.6122,39.2904],
  "Milwaukee|WI|United States":[-87.9065,43.0389],"Atlanta|GA|United States":[-84.388,33.749],
  "Minneapolis|MN|United States":[-93.265,44.9778],"Miami|FL|United States":[-80.1918,25.7617],
  "Tampa|FL|United States":[-82.4572,27.9506],"New Orleans|LA|United States":[-90.0715,29.9511],
  "Portland|OR|United States":[-122.6765,45.5231],"Raleigh|NC|United States":[-78.6382,35.7796],
  "Boston|MA|United States":[-71.0589,42.3601],"Memphis|TN|United States":[-90.049,35.1495],
  "Detroit|MI|United States":[-83.0458,42.3314],"Sacramento|CA|United States":[-121.4944,38.5816],
  "Kansas City|MO|United States":[-94.5786,39.0997],"Oakland|CA|United States":[-122.2712,37.8044],
  "Colorado Springs|CO|United States":[-104.8214,38.8339],"Long Beach|CA|United States":[-118.1937,33.7701],
  "Virginia Beach|VA|United States":[-75.9779,36.8529],"Fresno|CA|United States":[-119.7871,36.7378],
  // Canada
  "Toronto||Canada":[-79.3832,43.6532],"Montreal||Canada":[-73.5673,45.5017],
  "Vancouver||Canada":[-123.1207,49.2827],"Calgary||Canada":[-114.0719,51.0447],
  "Edmonton||Canada":[-113.4909,53.5461],"Ottawa||Canada":[-75.6972,45.4215],
  "Winnipeg||Canada":[-97.1384,49.8951],"Quebec City||Canada":[-71.208,46.8139],
  // UK
  "London||United Kingdom":[-0.1276,51.5074],"Birmingham||United Kingdom":[-1.8904,52.4862],
  "Manchester||United Kingdom":[-2.2374,53.4808],"Glasgow||United Kingdom":[-4.2518,55.8642],
  "Liverpool||United Kingdom":[-2.9916,53.4084],"Bristol||United Kingdom":[-2.5879,51.4545],
  "Edinburgh||United Kingdom":[-3.1883,55.9533],"Leeds||United Kingdom":[-1.5491,53.8008],
  // Europe
  "Paris||France":[2.3522,48.8566],"Marseille||France":[5.3698,43.2965],"Lyon||France":[4.8357,45.764],
  "Berlin||Germany":[13.405,52.52],"Hamburg||Germany":[9.9937,53.5753],"Munich||Germany":[11.582,48.1351],
  "Frankfurt||Germany":[8.6821,50.1109],"Cologne||Germany":[6.9578,50.938],
  "Madrid||Spain":[-3.7038,40.4168],"Barcelona||Spain":[2.1734,41.3851],"Seville||Spain":[-5.9845,37.3891],
  "Rome||Italy":[12.4964,41.9028],"Milan||Italy":[9.19,45.4654],"Naples||Italy":[14.2681,40.8518],
  "Amsterdam||Netherlands":[4.9041,52.3676],"Brussels||Belgium":[4.3517,50.8503],
  "Vienna||Austria":[16.3738,48.2082],"Stockholm||Sweden":[18.0686,59.3293],
  "Oslo||Norway":[10.7522,59.9139],"Copenhagen||Denmark":[12.5683,55.6761],
  "Helsinki||Finland":[24.9384,60.1699],"Zurich||Switzerland":[8.5417,47.3769],
  "Prague||Czech Republic":[14.4378,50.0755],"Warsaw||Poland":[21.0122,52.2297],
  "Budapest||Hungary":[19.0402,47.4979],"Bucharest||Romania":[26.1025,44.4268],
  "Athens||Greece":[23.7275,37.9838],"Lisbon||Portugal":[-9.1395,38.7223],
  "Kyiv||Ukraine":[30.5234,50.4501],"Moscow||Russia":[37.6173,55.7558],
  "Saint Petersburg||Russia":[30.3351,59.9343],"Istanbul||Turkey":[28.9784,41.0082],
  "Ankara||Turkey":[32.8597,39.9334],"Belgrade||Serbia":[20.4651,44.8176],
  // Latin America
  "Mexico City||Mexico":[-99.1332,19.4326],"Guadalajara||Mexico":[-103.3496,20.6597],
  "Monterrey||Mexico":[-100.3161,25.6866],"São Paulo||Brazil":[-46.6333,-23.5505],
  "Rio de Janeiro||Brazil":[-43.1729,-22.9068],"Brasília||Brazil":[-47.9292,-15.7801],
  "Buenos Aires||Argentina":[-58.3816,-34.6037],"Lima||Peru":[-77.0428,-12.0464],
  "Bogotá||Colombia":[-74.0721,4.711],"Santiago||Chile":[-70.6693,-33.4489],
  "Caracas||Venezuela":[-66.9036,10.4806],"Havana||Cuba":[-82.3666,23.1136],
  "Santo Domingo||Dominican Republic":[-69.9312,18.4861],"Kingston||Jamaica":[-76.7936,17.997],
  "San Juan||Puerto Rico":[-66.1057,18.4655],"Medellín||Colombia":[-75.5812,6.2442],
  "Panama City||Panama":[-79.5197,8.9936],
  // Africa
  "Lagos||Nigeria":[3.3792,6.5244],"Cairo||Egypt":[31.2357,30.0444],
  "Nairobi||Kenya":[36.8219,-1.2921],"Johannesburg||South Africa":[28.0473,-26.2041],
  "Cape Town||South Africa":[18.4241,-33.9249],"Casablanca||Morocco":[-7.5898,33.5731],
  "Accra||Ghana":[-0.2057,5.6037],"Abidjan||Côte d'Ivoire":[-4.0083,5.36],
  "Dakar||Senegal":[-17.4441,14.6937],"Dar es Salaam||Tanzania":[39.2083,-6.7924],
  "Addis Ababa||Ethiopia":[38.7578,9.032],"Kinshasa||Democratic Republic of the Congo":[15.3222,-4.3217],
  // Middle East
  "Dubai||United Arab Emirates":[55.2708,25.2048],"Abu Dhabi||United Arab Emirates":[54.3667,24.4539],
  "Riyadh||Saudi Arabia":[46.6753,24.6877],"Doha||Qatar":[51.531,25.2854],
  "Kuwait City||Kuwait":[47.9783,29.3759],"Beirut||Lebanon":[35.5018,33.8938],
  "Amman||Jordan":[35.926,31.9454],"Tel Aviv||Israel":[34.7818,32.0853],
  "Baghdad||Iraq":[44.3661,33.3152],"Tehran||Iran":[51.389,35.6892],
  // Asia
  "Tokyo||Japan":[139.6917,35.6895],"Osaka||Japan":[135.5022,34.6937],
  "Shanghai||China":[121.4737,31.2304],"Beijing||China":[116.4074,39.9042],
  "Guangzhou||China":[113.2644,23.1291],"Shenzhen||China":[114.0579,22.5431],
  "Mumbai||India":[72.8777,19.076],"Delhi||India":[77.1025,28.7041],
  "Bangalore||India":[77.5946,12.9716],"Hyderabad||India":[78.4867,17.385],
  "Chennai||India":[80.2707,13.0827],"Kolkata||India":[88.3639,22.5726],
  "Seoul||South Korea":[126.978,37.5665],"Busan||South Korea":[129.0756,35.1796],
  "Bangkok||Thailand":[100.5018,13.7563],"Singapore||Singapore":[103.8198,1.3521],
  "Jakarta||Indonesia":[106.8456,-6.2088],"Manila||Philippines":[120.9842,14.5995],
  "Ho Chi Minh City||Vietnam":[106.6297,10.8231],"Hanoi||Vietnam":[105.8544,21.0285],
  "Kuala Lumpur||Malaysia":[101.6869,3.139],"Taipei||Taiwan":[121.5654,25.033],
  "Karachi||Pakistan":[67.0099,24.8607],"Lahore||Pakistan":[74.3587,31.5204],
  "Dhaka||Bangladesh":[90.4125,23.8103],"Colombo||Sri Lanka":[79.8612,6.9271],
  "Yangon||Myanmar":[96.1951,16.8661],
  // Oceania
  "Sydney||Australia":[151.2093,-33.8688],"Melbourne||Australia":[144.9631,-37.8136],
  "Brisbane||Australia":[153.0251,-27.4698],"Perth||Australia":[115.8605,-31.9505],
  "Adelaide||Australia":[138.6007,-34.9285],"Auckland||New Zealand":[174.7633,-36.8485],
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
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function monthLabel(key) { const [,m] = key.split("-"); return MONTHS_SHORT[parseInt(m,10)-1]||key; }

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
function WorldMap({ data, selectedCountry, onCountryClick, mapMode }) {
  const svgRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);

  // geo + topo computed once
  const { geoFeatures, pathGen, projection, fanMap, numericToA2 } = useMemo(() => {
    try {
      const proj = geoNaturalEarth1().scale(153).translate([MAP_W / 2, MAP_H / 2]);
      const pg = geoPath().projection(proj);
      const features = topoFeature(worldTopo, worldTopo.objects.countries).features;

      const fm = new Map();
      const n2a = new Map();
      if (data?.fans_by_country) {
        for (const c of data.fans_by_country) {
          const a2 = NAME_TO_A2[c.country];
          if (!a2) continue;
          const num = A2_TO_NUMERIC[a2];
          if (!num) continue;
          fm.set(num, c.fans);
          n2a.set(num, a2);
        }
      }
      return { geoFeatures: features, pathGen: pg, projection: proj, fanMap: fm, numericToA2: n2a };
    } catch (e) { console.error("Map init:", e); return { geoFeatures: [], pathGen: null, projection: null, fanMap: new Map(), numericToA2: new Map() }; }
  }, [data]);

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

  // City dot positions
  const cityDots = useMemo(() => {
    if (!projection || !data?.fans_by_city) return [];
    return data.fans_by_city.slice(0, 400).map(c => {
      const key = `${c.city}|${c.state}|${c.country}`;
      const coords = CITY_COORDS[key];
      let svgX, svgY;
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
      return { ...c, svgX, svgY };
    }).filter(Boolean);
  }, [data, projection, centroids]);

  const maxFans = useMemo(() => data?.fans_by_country?.length ? Math.max(...data.fans_by_country.map(c => c.fans), 1) : 1, [data]);
  const fanOpacity = (fans) => fans ? 0.08 + (Math.log(fans + 1) / Math.log(maxFans + 1)) * 0.57 : 0;

  if (!geoFeatures.length || !pathGen) {
    return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height: MAP_H, color: C.muted, fontSize: 13 }}>Loading map…</div>;
  }

  const graticuleD = pathGen(geoGraticule()()) || "";
  const sphereD = pathGen({ type: "Sphere" }) || "";

  const maxCityFans = cityDots.length ? Math.max(...cityDots.map(d => d.fans), 1) : 1;

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

        {/* Sphere background */}
        {sphereD && <path d={sphereD} fill="url(#sphereGrad)" stroke="rgba(255,255,255,0.06)" strokeWidth="0.8"/>}

        {/* Graticule */}
        {graticuleD && <path d={graticuleD} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.4"/>}

        {/* Countries */}
        {geoFeatures.map(f => {
          const fans = fanMap.get(f.id) || 0;
          const a2 = numericToA2.get(f.id);
          const isSelected = selectedCountry?.numericId === f.id;
          const isHovered = hoveredId === f.id;
          const d = pathGen(f);
          if (!d) return null;

          let fill;
          if (isSelected) fill = `rgba(0,255,255,0.28)`;
          else if (isHovered) fill = fans > 0 ? `rgba(0,255,255,${fanOpacity(fans) + 0.12})` : "rgba(255,255,255,0.1)";
          else if (fans > 0) fill = `rgba(0,255,255,${fanOpacity(fans)})`;
          else fill = "rgba(255,255,255,0.04)";

          return (
            <path
              key={f.id}
              d={d}
              fill={fill}
              stroke={isSelected ? "rgba(0,255,255,0.7)" : "rgba(255,255,255,0.11)"}
              strokeWidth={isSelected ? 1.2 : 0.5}
              style={{ cursor: "pointer", transition: "fill 0.12s, stroke 0.12s" }}
              onMouseEnter={(e) => {
                setHoveredId(f.id);
                const rect = svgRef.current?.getBoundingClientRect();
                if (!rect) return;
                const countryName = a2 ? A2_TO_NAME[a2] : null;
                const found = data?.fans_by_country?.find(c => c.country === countryName);
                setTooltip({
                  px: e.clientX - rect.left,
                  py: e.clientY - rect.top,
                  maxLeft: rect.width - 180,
                  name: countryName || "Unknown",
                  a2: a2 || null,
                  fans,
                  streams: a2 ? (data?.streams_by_code?.[a2] || 0) : 0,
                });
              }}
              onMouseLeave={() => { setHoveredId(null); setTooltip(null); }}
              onClick={() => {
                if (!a2) return;
                const countryName = A2_TO_NAME[a2];
                const found = data?.fans_by_country?.find(c => c.country === countryName);
                const cities = (data?.fans_by_city || []).filter(c => c.country === countryName).slice(0, 10);
                onCountryClick({
                  numericId: f.id, a2,
                  name: countryName || a2,
                  fans: found?.fans || 0,
                  male: found?.male || 0,
                  female: found?.female || 0,
                  ages: found?.ages || {},
                  streams: data?.streams_by_code?.[a2] || 0,
                  cities,
                });
              }}
            />
          );
        })}

        {/* City dots */}
        {mapMode === "DOTS" && cityDots.map((dot, i) => {
          const r = 2 + Math.sqrt(dot.fans / maxCityFans) * 9;
          const opacity = 0.5 + (dot.fans / maxCityFans) * 0.5;
          return (
            <circle
              key={i}
              cx={dot.svgX} cy={dot.svgY} r={r}
              fill={C.accent} opacity={opacity}
              filter="url(#dotGlow)"
              style={{ cursor: "pointer", transition: "r 0.15s, opacity 0.15s" }}
              onMouseEnter={(e) => {
                const rect = svgRef.current?.getBoundingClientRect();
                if (!rect) return;
                setTooltip({
                  px: e.clientX - rect.left,
                  py: e.clientY - rect.top,
                  maxLeft: rect.width - 180,
                  name: `${dot.city}${dot.state ? `, ${dot.state}` : ""}`,
                  a2: NAME_TO_A2[dot.country] || null,
                  country: dot.country,
                  fans: dot.fans,
                  isCity: true,
                });
              }}
              onMouseLeave={() => setTooltip(null)}
            />
          );
        })}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: "absolute",
          left: Math.min(tooltip.px + 14, tooltip.maxLeft),
          top: Math.max(tooltip.py - 60, 8),
          background: C.surface3, border: `1px solid ${C.borderAccent}`,
          borderRadius: 10, padding: "10px 14px",
          pointerEvents: "none", zIndex: 20, minWidth: 140,
          boxShadow: `0 4px 32px rgba(0,255,255,0.12)`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            {tooltip.a2 && <span style={{ fontSize: 18 }}>{flag(tooltip.a2)}</span>}
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{tooltip.name}</span>
          </div>
          <div style={{ fontSize: 12, color: C.accent, fontVariantNumeric: "tabular-nums" }}>
            {fmt(tooltip.fans)} fan{tooltip.fans !== 1 ? "s" : ""}
          </div>
          {tooltip.streams > 0 && (
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{fmt(tooltip.streams)} streams</div>
          )}
          {!tooltip.isCity && <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>Click to explore</div>}
        </div>
      )}
    </div>
  );
}

// ─── Country detail panel ─────────────────────────────────────────────────────
function CountryPanel({ country, data, onClose }) {
  const totalFans = data?.overview?.total_fans || 1;
  const totalDemoFans = (country.male + country.female) || 0;

  const topWorldCities = (data?.fans_by_city || [])
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
  const top = (data?.fans_by_country || []).slice(0, 12);
  const maxFans = top[0]?.fans || 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <Label>Top Markets</Label>
        {top.length === 0 ? (
          <div style={{ fontSize: 13, color: C.dim }}>Fan geography appears here as your audience grows.</div>
        ) : top.map((c, i) => {
          const a2 = NAME_TO_A2[c.country];
          return (
            <div key={c.country} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: C.dim, width: 18, textAlign: "right", flexShrink: 0 }}>{i + 1}</div>
              {a2 && <span style={{ fontSize: 14, flexShrink: 0 }}>{flag(a2)}</span>}
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
          );
        })}
      </div>

      {(data?.fans_by_country || []).length > 12 && (
        <div style={{ fontSize: 11, color: C.dim, textAlign: "center" }}>
          +{(data.fans_by_country.length - 12)} more countries · Click a country on the map for detail
        </div>
      )}

      <div>
        <Label>Streams by Country (ISO)</Label>
        {Object.keys(data?.streams_by_code || {}).length === 0 ? (
          <div style={{ fontSize: 12, color: C.dim }}>Stream location data accumulates as fans play music.</div>
        ) : Object.entries(data.streams_by_code).sort((a,b) => b[1]-a[1]).slice(0, 8).map(([code, count]) => (
          <div key={code} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 13, flexShrink: 0 }}>{flag(code)}</span>
            <span style={{ flex: 1, fontSize: 12, color: C.text }}>{A2_TO_NAME[code] || code}</span>
            <span style={{ fontSize: 12, color: C.purple, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(count)}</span>
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
    const arr = [...(data?.fans_by_country || [])];
    if (sortBy === "fans") arr.sort((a,b) => b.fans - a.fans);
    else if (sortBy === "streams") {
      arr.sort((a,b) => {
        const aCode = NAME_TO_A2[a.country];
        const bCode = NAME_TO_A2[b.country];
        return (data?.streams_by_code?.[bCode] || 0) - (data?.streams_by_code?.[aCode] || 0);
      });
    }
    return arr.slice(0, 30);
  }, [data, sortBy]);

  if (!rows.length) return null;

  const SORT_OPTS = [{ key: "fans", label: "Fans" }, { key: "streams", label: "Streams" }];

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
      <div style={{ display: "grid", gridTemplateColumns: "32px 28px 1fr 90px 90px 90px", gap: 10, paddingBottom: 10, borderBottom: `1px solid ${C.border}`, marginBottom: 4 }}>
        {["#","","Country","Fans","% Total","Streams"].map((h,i) => (
          <div key={i} style={{ fontSize: 9, color: C.dim, letterSpacing: 2, textTransform: "uppercase", textAlign: i > 2 ? "right" : "left" }}>{h}</div>
        ))}
      </div>
      {rows.map((c, i) => {
        const a2 = NAME_TO_A2[c.country];
        const streams = a2 ? (data?.streams_by_code?.[a2] || 0) : 0;
        return (
          <div
            key={c.country}
            onClick={() => {
              if (!a2) return;
              const num = A2_TO_NUMERIC[a2];
              const cities = (data?.fans_by_city || []).filter(x => x.country === c.country).slice(0, 10);
              onCountryClick({ numericId: num, a2, name: c.country, fans: c.fans, male: c.male, female: c.female, ages: c.ages, streams, cities });
            }}
            style={{
              display: "grid", gridTemplateColumns: "32px 28px 1fr 90px 90px 90px",
              gap: 10, alignItems: "center", padding: "9px 0",
              borderBottom: `1px solid ${C.border2}`,
              cursor: a2 ? "pointer" : "default",
              transition: "background 0.1s",
            }}
            onMouseEnter={e => { if (a2) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
          >
            <div style={{ fontSize: 11, color: C.dim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{i + 1}</div>
            <div style={{ fontSize: 16 }}>{a2 ? flag(a2) : ""}</div>
            <div style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>{c.country}</div>
            <div style={{ fontSize: 13, color: C.accent, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(c.fans)}</div>
            <div style={{ fontSize: 13, color: C.muted, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pct(c.fans, totalFans)}%</div>
            <div style={{ fontSize: 13, color: streams > 0 ? C.purple : C.dim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{streams > 0 ? fmt(streams) : "—"}</div>
          </div>
        );
      })}
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AdminGlobalAnalytics() {
  const isMobile = useIsMobile(768);
  const gate = useAdminGate();
  const ready = gate === "ok";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [mapMode, setMapMode] = useState("DOTS");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/admin/analytics/global", { credentials: "include" });
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
              <KPITile label="Total Fans" value={fmt(ov.total_fans)} sub="All-time signups" color={C.accent}
                style={{ minWidth: isMobile ? "calc(50% - 5px)" : 140 }} />
              <KPITile label="Countries" value={fmt(ov.unique_countries)} sub="Markets reached" color={C.purple}
                style={{ minWidth: isMobile ? "calc(50% - 5px)" : 140 }} />
              <KPITile label="Cities" value={fmt(ov.unique_cities)} sub="Locations recorded" color={C.gold}
                style={{ minWidth: isMobile ? "calc(50% - 5px)" : 140 }} />
              <KPITile label="Streams" value={fmt(ov.total_streams)} sub="Geo-tagged plays" color={C.green}
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
                  {mapMode === "DOTS" ? "Fan Locations" : mapMode === "HEAT" ? "Fan Density" : "30-Day Growth"}
                  {!isMobile && " · Click a country to explore"}
                </div>
                <WorldMap
                  data={data}
                  selectedCountry={selectedCountry}
                  onCountryClick={setSelectedCountry}
                  mapMode={mapMode}
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
