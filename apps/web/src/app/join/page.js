"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { validateEmail } from "@/lib/auth/validation";

const VALID_GENDERS = ["male", "female"];
const VALID_AGE_RANGES = ["18-25", "25-40", "40-65"];

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
  const [city,        setCity]        = useState("");
  const [state,       setState]       = useState("");
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

  const nextPath = giftToken ? `/gift/${giftToken}` : "/?tab=mymusic";

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setEmailError(""); setPassError(""); setConfError(""); setPhoneError(""); setExistsHint(false);

    const emailCheck = validateEmail(email);
    const passCheck  = validatePassword(password);
    const phoneTrimmed = phone.trim();
    const phoneCheck = (giftToken && !phoneTrimmed) ? { ok: true, value: null } : validatePhone(phone);

    let hasError = false;
    if (!emailCheck.ok)  { setEmailError(emailCheck.error); hasError = true; }
    if (!passCheck.ok)   { setPassError(passCheck.error); hasError = true; }
    if (password && confirm && password !== confirm) { setConfError("Passwords do not match"); hasError = true; }
    if (!phoneCheck.ok)  { setPhoneError(phoneCheck.error); hasError = true; }
    if (!city.trim())    { setError("City is required"); hasError = true; }
    if (!state.trim())   { setError("State is required"); hasError = true; }
    if (!VALID_GENDERS.includes(gender))    { setError("Please select your gender"); hasError = true; }
    if (!VALID_AGE_RANGES.includes(ageRange)) { setError("Please select your age range"); hasError = true; }
    if (hasError) return;

    if (inFlightRef.current || loading) return;
    inFlightRef.current = true;
    setLoading(true);

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
            giftToken, city: city.trim(), state: state.trim(), gender, age_range: ageRange,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.existsHint) { setExistsHint(true); setError(data.error || "An account with this email already exists. Sign in instead."); }
          else if (data.error === "email_mismatch") { setEmailError(data.message || "This gift was sent to a different email address."); }
          else { setError(data.error || "Sign up failed"); }
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
          city: city.trim(), state: state.trim(), gender, age_range: ageRange,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.existsHint) { setExistsHint(true); setError(data.error || "An account with this email already exists. Sign in instead."); }
        else { setError(data.error || "Sign up failed"); }
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

        {/* City + State */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 10 }}>
          <input
            placeholder="City"
            type="text"
            value={city}
            onChange={e => setCity(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            placeholder="State"
            type="text"
            value={state}
            onChange={e => setState(e.target.value.toUpperCase().slice(0, 2))}
            required
            maxLength={2}
            style={{ ...inputStyle, textTransform: "uppercase" }}
          />
        </div>

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
