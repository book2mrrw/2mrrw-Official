"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { validateEmail } from "@/lib/auth/validation";

const VALID_GENDERS   = ["male", "female"];
const VALID_AGE_RANGES = ["18-25", "25-40", "40-65"];

// Countries list — United States always first so it's the default expected selection.
// The rest are alphabetical UN member states + common territories.
const COUNTRIES = [
  "United States",
  "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda",
  "Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain",
  "Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan",
  "Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria",
  "Burkina Faso","Burundi","Cabo Verde","Cambodia","Cameroon","Canada",
  "Central African Republic","Chad","Chile","China","Colombia","Comoros",
  "Congo","Costa Rica","Croatia","Cuba","Cyprus","Czech Republic","Denmark",
  "Djibouti","Dominica","Dominican Republic","Ecuador","Egypt","El Salvador",
  "Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji",
  "Finland","France","Gabon","Gambia","Georgia","Germany","Ghana","Greece",
  "Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras",
  "Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel",
  "Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kuwait",
  "Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya",
  "Liechtenstein","Lithuania","Luxembourg","Madagascar","Malawi","Malaysia",
  "Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius",
  "Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco",
  "Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands","New Zealand",
  "Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway",
  "Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay",
  "Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia","Rwanda",
  "Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines",
  "Samoa","San Marino","Sao Tome and Principe","Saudi Arabia","Senegal",
  "Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia",
  "Solomon Islands","Somalia","South Africa","South Korea","South Sudan",
  "Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria",
  "Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga",
  "Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda",
  "Ukraine","United Arab Emirates","United Kingdom","Uruguay","Uzbekistan",
  "Vanuatu","Vatican City","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe",
];

const inputStyle = {
  padding: "12px 14px",
  background: "#111",
  border: "1px solid #2a2a2a",
  color: "white",
  borderRadius: 10,
  fontSize: 14,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const selectStyle = {
  ...inputStyle,
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%23666' d='M5 6L0 0h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 14px center",
  paddingRight: 38,
  cursor: "pointer",
};

function validatePassword(pw) {
  if (!pw || pw.length < 8) return { ok: false, error: "Password must be at least 8 characters" };
  return { ok: true };
}

function validatePhone(ph) {
  const digits = String(ph || "").replace(/\D/g, "");
  if (digits.length < 10) return { ok: false, error: "Enter a valid phone number" };
  return { ok: true, value: ph.trim() };
}

function SegmentedPicker({ label, options, value, onChange }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 8, letterSpacing: 1 }}>{label}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {options.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              flex: "1 1 0", minWidth: 0, padding: "10px 8px", borderRadius: 10, border: "1px solid",
              borderColor: value === opt.value ? "#00ffff" : "#2a2a2a",
              background: value === opt.value ? "rgba(0,255,255,0.08)" : "#111",
              color: value === opt.value ? "#00ffff" : "#777",
              fontWeight: value === opt.value ? 700 : 400,
              fontSize: 13, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function JoinForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { applySessionUser } = useAuth();
  const giftToken    = searchParams.get("gift") || "";

  const [name,        setName]        = useState("");
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [confirm,     setConfirm]     = useState("");
  const [phone,       setPhone]       = useState("");
  const [country,     setCountry]     = useState("");
  const [city,        setCity]        = useState("");
  const [stateField,  setStateField]  = useState("");
  const [gender,      setGender]      = useState("");
  const [ageRange,    setAgeRange]    = useState("");
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [emailError,  setEmailError]  = useState("");
  const [passError,   setPassError]   = useState("");
  const [confError,   setConfError]   = useState("");
  const [phoneError,  setPhoneError]  = useState("");
  const [existsHint,  setExistsHint]  = useState(false);
  const [giftPreview, setGiftPreview] = useState(null);
  const inFlightRef  = useRef(false);

  // Derived: United States requires a 2-letter state for city disambiguation
  const isUS = country === "United States";

  useEffect(() => {
    if (!giftToken) return;
    fetch(`/api/gifts/preview/${giftToken}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        if (d?.gift) {
          setGiftPreview(d);
          if (d.gift.recipient_email) setEmail(d.gift.recipient_email);
        }
      })
      .catch(() => {});
  }, [giftToken]);

  // Clear state field when switching away from US to avoid stale 2-char value
  useEffect(() => {
    if (!isUS) setStateField("");
  }, [isUS]);

  const nextPath = giftToken ? `/gift/${giftToken}` : "/?tab=mymusic";

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setEmailError(""); setPassError(""); setConfError(""); setPhoneError(""); setExistsHint(false);

    const emailCheck   = validateEmail(email);
    const passCheck    = validatePassword(password);
    const phoneTrimmed = phone.trim();
    const phoneCheck   = (giftToken && !phoneTrimmed) ? { ok: true, value: null } : validatePhone(phone);

    let hasError = false;
    if (!emailCheck.ok)  { setEmailError(emailCheck.error); hasError = true; }
    if (!passCheck.ok)   { setPassError(passCheck.error); hasError = true; }
    if (password && confirm && password !== confirm) { setConfError("Passwords do not match"); hasError = true; }
    if (!phoneCheck.ok)  { setPhoneError(phoneCheck.error); hasError = true; }
    if (!country)        { setError("Please select your country"); hasError = true; }
    if (!city.trim())    { setError("City is required"); hasError = true; }
    // State is required only inside the U.S. — same cities exist across states
    if (isUS && !stateField.trim()) { setError("State is required for U.S. locations"); hasError = true; }
    if (!VALID_GENDERS.includes(gender))      { setError("Please select your gender"); hasError = true; }
    if (!VALID_AGE_RANGES.includes(ageRange)) { setError("Please select your age range"); hasError = true; }
    if (hasError) return;

    if (inFlightRef.current || loading) return;
    inFlightRef.current = true;
    setLoading(true);

    const locationPayload = {
      country: country.trim(),
      city: city.trim(),
      state: stateField.trim() || null,
    };

    try {
      if (giftToken) {
        const res = await fetch("/api/gifts/claim-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            email: emailCheck.value, password,
            name: name.trim() || undefined,
            phone: phoneCheck.value,
            giftToken,
            ...locationPayload,
            gender, age_range: ageRange,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.existsHint)          { setExistsHint(true); setError(data.error || "An account with this email already exists. Sign in instead."); }
          else if (data.error === "email_mismatch") { setEmailError(data.message || "This gift was sent to a different email address."); }
          else                          { setError(data.error || "Sign up failed"); }
          return;
        }
        await applySessionUser(data.session);
        router.push(nextPath);
        router.refresh();
        return;
      }

      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: emailCheck.value, password,
          name: name.trim() || undefined,
          phone: phoneCheck.value,
          ...locationPayload,
          gender, age_range: ageRange,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.existsHint) { setExistsHint(true); setError(data.error || "An account with this email already exists. Sign in instead."); }
        else                 { setError(data.error || "Sign up failed"); }
        return;
      }
      await applySessionUser(data.session);
      router.push(nextPath);
      router.refresh();
    } catch (err) {
      setError(err?.message || "Sign up failed");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  return (
    <main style={{ minHeight: "100vh", background: "#050505", color: "white", display: "grid", placeItems: "center", padding: 24, fontFamily: "sans-serif" }}>
      <form
        onSubmit={submit}
        style={{ width: "100%", maxWidth: 440, background: "#0d0d0d", border: "1px solid #222", borderRadius: 20, padding: 28, display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: "#00ffff" }}>2MRRW</div>

        {giftPreview?.gift ? (
          <div style={{ padding: 14, borderRadius: 12, background: "rgba(162,89,255,0.08)", border: "1px solid rgba(162,89,255,0.25)", marginBottom: 4 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#c9b8ff", lineHeight: 1.6 }}>
              You have a gift waiting — create your account to claim it{giftPreview.gift.item_title ? `: ${giftPreview.gift.item_title}` : ""}.
            </p>
          </div>
        ) : null}

        <h1 style={{ margin: "2px 0 0", fontSize: 22 }}>Join 2MRRW</h1>

        {/* Name */}
        <input
          placeholder="Full Name (optional)"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          style={inputStyle}
        />

        {/* Email */}
        <div>
          <input
            placeholder="Email"
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); if (emailError) setEmailError(""); }}
            required
            style={{ ...inputStyle, borderColor: emailError ? "#ef4444" : "#2a2a2a" }}
          />
          {emailError ? <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{emailError}</div> : null}
        </div>

        {/* Password */}
        <div>
          <input
            placeholder="Password (min 8 characters)"
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={e => { setPassword(e.target.value); if (passError) setPassError(""); }}
            required
            style={{ ...inputStyle, borderColor: passError ? "#ef4444" : "#2a2a2a" }}
          />
          {passError ? <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{passError}</div> : null}
        </div>

        {/* Confirm password */}
        <div>
          <input
            placeholder="Confirm password"
            type="password"
            value={confirm}
            autoComplete="new-password"
            onChange={e => { setConfirm(e.target.value); if (confError) setConfError(""); }}
            required
            style={{ ...inputStyle, borderColor: confError ? "#ef4444" : "#2a2a2a" }}
          />
          {confError ? <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{confError}</div> : null}
        </div>

        {/* Phone */}
        <div>
          <input
            placeholder={giftToken ? "Phone number (optional)" : "Phone number"}
            type="tel"
            value={phone}
            onChange={e => { setPhone(e.target.value); if (phoneError) setPhoneError(""); }}
            required={!giftToken}
            style={{ ...inputStyle, borderColor: phoneError ? "#ef4444" : "#2a2a2a" }}
          />
          {phoneError
            ? <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{phoneError}</div>
            : <div style={{ color: "#555", fontSize: 11, marginTop: 4 }}>{giftToken ? "Optional — add later in settings." : "For SMS login codes."}</div>
          }
        </div>

        {/* Country — dropdown, required */}
        <div>
          <select
            value={country}
            onChange={e => setCountry(e.target.value)}
            required
            style={{ ...selectStyle, color: country ? "white" : "#555" }}
          >
            <option value="" disabled>Select your country</option>
            {COUNTRIES.map(c => (
              <option key={c} value={c} style={{ background: "#111", color: "white" }}>{c}</option>
            ))}
          </select>
        </div>

        {/* City + State — state required only for U.S. */}
        <div style={{ display: "grid", gridTemplateColumns: isUS ? "1fr 80px" : "1fr", gap: 10 }}>
          <input
            placeholder="City"
            type="text"
            value={city}
            onChange={e => setCity(e.target.value)}
            required
            style={inputStyle}
          />
          {isUS && (
            <input
              placeholder="State"
              type="text"
              value={stateField}
              onChange={e => setStateField(e.target.value.toUpperCase().slice(0, 2))}
              required
              maxLength={2}
              style={{ ...inputStyle, textTransform: "uppercase" }}
            />
          )}
        </div>
        {/* Non-US: optional province/region */}
        {!isUS && country && (
          <input
            placeholder="State / Province (optional)"
            type="text"
            value={stateField}
            onChange={e => setStateField(e.target.value)}
            style={inputStyle}
          />
        )}

        {/* Gender */}
        <SegmentedPicker
          label="GENDER"
          options={[{ value: "male", label: "Male" }, { value: "female", label: "Female" }]}
          value={gender}
          onChange={setGender}
        />

        {/* Age range */}
        <SegmentedPicker
          label="AGE RANGE"
          options={VALID_AGE_RANGES.map(r => ({ value: r, label: r }))}
          value={ageRange}
          onChange={setAgeRange}
        />

        {error ? <div style={{ color: "#ff4d4d", fontSize: 13 }}>{error}</div> : null}
        {existsHint ? (
          <Link href={giftToken ? `/login?gift=${giftToken}` : "/login"} style={{ color: "#00ffff", fontSize: 13 }}>
            Sign in instead →
          </Link>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          style={{ padding: "13px 0", background: "#00ffff", color: "#000", fontWeight: 900, border: "none", borderRadius: 10, cursor: loading ? "wait" : "pointer", opacity: loading ? 0.7 : 1, fontFamily: "inherit" }}
        >
          {loading ? "Creating account…" : "Create Account"}
        </button>

        <Link href={giftToken ? `/login?gift=${giftToken}` : "/login"} style={{ color: "#777", fontSize: 13, textAlign: "center", marginTop: 4 }}>
          Already have an account? Sign in
        </Link>
      </form>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh", background: "#050505" }} />}>
      <JoinForm />
    </Suspense>
  );
}
