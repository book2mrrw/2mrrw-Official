"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PUBLIC_KEY } from "@/lib/supabase/public-key";
import { SUPABASE_URL } from "@/lib/supabase/supabase-url";
import { useAuth } from "@/context/AuthContext";

const ADMIN_EMAIL = (process.env.NEXT_PUBLIC_ADMIN_EMAIL || "callme2mrrw@gmail.com").toLowerCase();

function isAdmin(session) {
  const email = session?.user?.email?.toLowerCase() || "";
  return email === ADMIN_EMAIL;
}

function statusLabel(status, claimed) {
  if (claimed) return { label: "Redeemed", color: "#22c55e" };
  if (status === "expired") return { label: "Expired", color: "#555" };
  if (status === "revoked") return { label: "Revoked", color: "#ef4444" };
  return { label: "Pending", color: "#f59e0b" };
}

function fmt(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Send Gift Form ────────────────────────────────────────────────────────────

function SendGiftForm({ catalog, onSent }) {
  const [form, setForm] = useState({
    releaseSlug: "",
    recipientEmail: "",
    recipientPhone: "",
    recipientName: "",
    message: "",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  function set(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
    setResult(null);
    setError(null);
  }

  async function handleSend(e) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!form.releaseSlug || (!form.recipientEmail && !form.recipientPhone)) {
      setError("Release and recipient email or phone are required.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/gifts/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseSlug: form.releaseSlug,
          recipientEmail: form.recipientEmail || null,
          recipientPhone: form.recipientPhone || null,
          recipientName: form.recipientName || null,
          message: form.message || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult({ giftLink: data.giftLink, delivered: data.delivered, recipientEmail: data.recipientEmail, recipientPhone: data.recipientPhone, smsSent: data.smsSent });
      setForm({ releaseSlug: "", recipientEmail: "", recipientPhone: "", recipientName: "", message: "" });
      onSent?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const selectedRelease = catalog.find((r) => r.slug === form.releaseSlug);

  return (
    <form onSubmit={handleSend} style={s.card}>
      <div style={s.sectionLabel}>SEND A GIFT</div>

      {/* Release picker */}
      <label style={s.label}>Release *</label>
      <select
        value={form.releaseSlug}
        onChange={(e) => set("releaseSlug", e.target.value)}
        style={s.input}
        required
      >
        <option value="">Select release…</option>
        {catalog.map((r) => (
          <option key={r.slug} value={r.slug}>
            {r.title} — {r.release_type?.toUpperCase() || "SINGLE"}
          </option>
        ))}
      </select>

      {/* Recipient email */}
      <label style={s.label}>Recipient Email</label>
      <input
        type="email"
        value={form.recipientEmail}
        onChange={(e) => set("recipientEmail", e.target.value)}
        placeholder="fan@example.com"
        style={s.input}
      />

      {/* Recipient phone */}
      <label style={s.label}>Recipient Phone</label>
      <input
        type="tel"
        value={form.recipientPhone}
        onChange={(e) => set("recipientPhone", e.target.value)}
        placeholder="+1 555 000 0000"
        style={s.input}
      />
      <div style={{ fontSize: 11, color: "#444", marginTop: 4, marginBottom: 4 }}>
        At least one contact method required. Both sends email + SMS.
      </div>

      {/* Recipient name (optional) */}
      <label style={s.label}>Recipient Name (optional)</label>
      <input
        type="text"
        value={form.recipientName}
        onChange={(e) => set("recipientName", e.target.value)}
        placeholder="Fan's name"
        style={s.input}
      />

      {/* Message (optional) */}
      <label style={s.label}>Personal Message (optional)</label>
      <textarea
        value={form.message}
        onChange={(e) => set("message", e.target.value)}
        placeholder="Write a personal note…"
        rows={3}
        style={{ ...s.input, resize: "vertical", lineHeight: "1.5" }}
      />

      {error && <div style={s.errorBox}>{error}</div>}

      {result && (
        <div style={s.successBox}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            {result.delivered ? "Gift delivered!" : "Gift sent!"}
          </div>
          <div style={{ fontSize: 12, color: "#aaa", marginBottom: 8 }}>
            {result.delivered
              ? `Added to ${result.recipientEmail || result.recipientPhone}'s library immediately.`
              : [
                  result.recipientEmail ? `Email sent to ${result.recipientEmail}.` : null,
                  result.smsSent && result.recipientPhone ? `SMS sent to ${result.recipientPhone}.` : null,
                  !result.recipientEmail && !result.smsSent ? `Gift link created — share it manually.` : null,
                ].filter(Boolean).join(" ")}
          </div>
          {result.giftLink && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                readOnly
                value={result.giftLink}
                style={{ ...s.input, flex: 1, fontSize: 11, color: "#888", margin: 0 }}
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(result.giftLink)}
                style={s.copyBtn}
              >
                Copy
              </button>
            </div>
          )}
        </div>
      )}

      <button type="submit" disabled={loading} style={{ ...s.btn, marginTop: 12, opacity: loading ? 0.6 : 1 }}>
        {loading ? "Sending…" : "Send Gift"}
      </button>
    </form>
  );
}

// ─── Gift Link Generator ───────────────────────────────────────────────────────

function GiftLinkForm({ catalog }) {
  const [slugs, setSlugs] = useState([]);
  const [title, setTitle] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState(null);
  const [error, setError] = useState(null);
  const secret = typeof window !== "undefined" ? "" : "";

  function toggleSlug(slug) {
    setSlugs((prev) => prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]);
    setLink(null);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    setLink(null);
    if (!slugs.length) { setError("Select at least one release."); return; }

    // INV-ENT-18: no secret is handled in the browser. This page previously
    // collected ADMIN_SEED_SECRET with window.prompt() and sent it as a header —
    // putting a server master secret (which also signed guest session cookies)
    // into client memory and the network log on every use.
    //
    // The route now authorises the administrator's own session via
    // requireAdminOrService, so the request carries credentials only.
    setLoading(true);
    try {
      const res = await fetch("/api/admin/gifts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title || `Gift Link — ${slugs.join(", ")}`,
          slugs,
          maxRedemptions: maxRedemptions ? Number(maxRedemptions) : null,
          expiresAt: expiresAt || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setLink(data.url);
      setSlugs([]);
      setTitle("");
      setMaxRedemptions("");
      setExpiresAt("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleCreate} style={s.card}>
      <div style={s.sectionLabel}>CREATE SHAREABLE GIFT LINK</div>
      <div style={{ fontSize: 12, color: "#555", marginBottom: 14 }}>
        Anyone with the link can claim the selected releases.
      </div>

      <label style={s.label}>Select Releases *</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
        {catalog.map((r) => (
          <label key={r.slug} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={slugs.includes(r.slug)}
              onChange={() => toggleSlug(r.slug)}
              style={{ accentColor: "#d4a853" }}
            />
            <span style={{ fontSize: 13, color: "#ccc" }}>
              {r.title}
              <span style={{ color: "#555", marginLeft: 6, fontSize: 11 }}>
                {r.release_type?.toUpperCase()}
              </span>
            </span>
          </label>
        ))}
      </div>

      <label style={s.label}>Link Title (optional)</label>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. Press Gift — Love Hz"
        style={s.input}
      />

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={s.label}>Max Redemptions</label>
          <input
            type="number"
            min="1"
            value={maxRedemptions}
            onChange={(e) => setMaxRedemptions(e.target.value)}
            placeholder="Unlimited"
            style={s.input}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={s.label}>Expires</label>
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            style={s.input}
          />
        </div>
      </div>

      {error && <div style={s.errorBox}>{error}</div>}

      {link && (
        <div style={s.successBox}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Gift link created!</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              readOnly
              value={link}
              style={{ ...s.input, flex: 1, fontSize: 11, color: "#888", margin: 0 }}
              onFocus={(e) => e.target.select()}
            />
            <button type="button" onClick={() => navigator.clipboard?.writeText(link)} style={s.copyBtn}>
              Copy
            </button>
          </div>
        </div>
      )}

      <button type="submit" disabled={loading || !slugs.length} style={{ ...s.btn, marginTop: 12, opacity: loading || !slugs.length ? 0.5 : 1 }}>
        {loading ? "Creating…" : "Create Link"}
      </button>
    </form>
  );
}

// ─── Gifts History ─────────────────────────────────────────────────────────────

function GiftsHistory({ gifts, loading }) {
  if (loading) {
    return (
      <div style={s.card}>
        <div style={s.sectionLabel}>GIFTS SENT</div>
        <div style={{ color: "#555", fontSize: 13 }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={s.card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={s.sectionLabel}>GIFTS SENT</div>
        <div style={{ fontSize: 12, color: "#555" }}>{gifts.length} total</div>
      </div>

      {gifts.length === 0 ? (
        <div style={{ color: "#555", fontSize: 13 }}>No gifts sent yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {/* Table header */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px 80px", gap: 12, padding: "6px 0", borderBottom: "1px solid #1a1a1a", marginBottom: 4 }}>
            {["Release", "Recipient", "Status", "Date"].map((h) => (
              <span key={h} style={{ fontSize: 10, color: "#444", fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>{h}</span>
            ))}
          </div>

          {gifts.map((gift) => {
            const st = statusLabel(gift.status, gift.claimed);
            return (
              <div
                key={gift.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 80px 80px",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom: "1px solid #111",
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "#ddd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {gift.title}
                </div>
                <div style={{ overflow: "hidden" }}>
                  <div style={{ fontSize: 12, color: "#aaa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {gift.recipientEmail}
                  </div>
                  {gift.recipientPhone && (
                    <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{gift.recipientPhone}</div>
                  )}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: st.color, letterSpacing: 0.5 }}>
                  {st.label}
                </div>
                <div style={{ fontSize: 11, color: "#555" }}>{fmt(gift.createdAt)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Admin Page ───────────────────────────────────────────────────────────

export default function AdminGiftsPage() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [supabase] = useState(() => {
    if (typeof window === "undefined") return null;
    return createBrowserClient(
      SUPABASE_URL,
      SUPABASE_PUBLIC_KEY
    );
  });
  const [session, setSession] = useState(undefined);
  const [catalog, setCatalog] = useState([]);
  const [gifts, setGifts] = useState([]);
  const [giftsLoading, setGiftsLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data?.session ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  const loadCatalog = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from("products")
      .select("slug, title, release_type")
      .order("release_date", { ascending: false });
    setCatalog(data ?? []);
  }, [supabase]);

  const loadGifts = useCallback(async () => {
    setGiftsLoading(true);
    try {
      const res = await fetch("/api/gifts/sent", { credentials: "include", cache: "no-store" });
      const data = await res.json();
      setGifts(data.gifts ?? []);
    } catch {
      setGifts([]);
    } finally {
      setGiftsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session || !isAdmin(session)) return;
    loadCatalog();
    loadGifts();
  }, [session, loadCatalog, loadGifts]);

  // Loading state
  if (session === undefined) {
    return (
      <div style={s.page}>
        <div style={{ color: "#555", fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  // Not signed in
  if (!session) {
    return (
      <div style={s.page}>
        <div style={s.gate}>
          <div style={s.gateTitle}>Admin Access</div>
          <div style={s.gateSub}>Sign in with your admin account to continue.</div>
          <button onClick={() => router.push("/login")} style={s.btn}>Sign In</button>
        </div>
      </div>
    );
  }

  // Not admin
  if (!isAdmin(session)) {
    return (
      <div style={s.page}>
        <div style={s.gate}>
          <div style={s.gateTitle}>Unauthorized</div>
          <div style={s.gateSub}>This page is restricted to the 2MRRW admin account.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <div style={s.brand}>2MRRW Admin</div>
          <div style={s.pageTitle}>Gift Management</div>
        </div>
        <button onClick={() => void signOut()} style={s.signOutBtn}>Sign Out</button>
      </div>

      <div style={s.grid}>
        {/* Left column — forms */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <SendGiftForm catalog={catalog} onSent={loadGifts} />
          <GiftLinkForm catalog={catalog} />
        </div>

        {/* Right column — history */}
        <div>
          <GiftsHistory gifts={gifts} loading={giftsLoading} />
        </div>
      </div>
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const s = {
  page: {
    minHeight: "100vh",
    backgroundColor: "#050505",
    color: "#f0f0f0",
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    padding: "32px 24px",
    maxWidth: 1100,
    margin: "0 auto",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 32,
    paddingBottom: 20,
    borderBottom: "1px solid #1a1a1a",
  },
  brand: {
    fontSize: 11,
    color: "#d4a853",
    fontWeight: 800,
    letterSpacing: 3,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: 800,
    letterSpacing: -0.5,
  },
  signOutBtn: {
    background: "transparent",
    border: "1px solid #222",
    borderRadius: 8,
    color: "#555",
    fontSize: 12,
    padding: "7px 14px",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1.4fr",
    gap: 20,
    alignItems: "start",
  },
  card: {
    background: "#0d0d0d",
    border: "1px solid #1a1a1a",
    borderRadius: 16,
    padding: "20px 22px",
  },
  sectionLabel: {
    fontSize: 10,
    color: "#d4a853",
    letterSpacing: 3,
    fontWeight: 800,
    textTransform: "uppercase",
    marginBottom: 16,
  },
  label: {
    display: "block",
    fontSize: 11,
    color: "#666",
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    display: "block",
    width: "100%",
    background: "#111",
    border: "1px solid #1e1e1e",
    borderRadius: 8,
    color: "#e0e0e0",
    fontSize: 13,
    padding: "10px 12px",
    fontFamily: "inherit",
    boxSizing: "border-box",
    outline: "none",
    marginBottom: 0,
  },
  btn: {
    display: "block",
    width: "100%",
    background: "#f0f0f0",
    color: "#000",
    border: "none",
    borderRadius: 10,
    padding: "13px 20px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: -0.2,
  },
  copyBtn: {
    background: "#1a1a1a",
    border: "1px solid #222",
    borderRadius: 7,
    color: "#aaa",
    fontSize: 11,
    fontWeight: 700,
    padding: "7px 12px",
    cursor: "pointer",
    fontFamily: "inherit",
    flexShrink: 0,
  },
  errorBox: {
    background: "#1a0a0a",
    border: "1px solid #3f1515",
    borderRadius: 8,
    color: "#ef4444",
    fontSize: 13,
    padding: "10px 14px",
    marginTop: 10,
  },
  successBox: {
    background: "#0a1a0d",
    border: "1px solid #1a3a20",
    borderRadius: 8,
    color: "#4ade80",
    fontSize: 13,
    padding: "12px 14px",
    marginTop: 10,
  },
  gate: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "60vh",
    gap: 12,
    textAlign: "center",
  },
  gateTitle: {
    fontSize: 24,
    fontWeight: 800,
    letterSpacing: -0.4,
  },
  gateSub: {
    fontSize: 14,
    color: "#666",
  },
};
