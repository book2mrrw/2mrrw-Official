"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatPhoneInput, validateEmail, validatePhone } from "@/lib/auth/validation";
import { registerModal, unregisterModal } from "@/state/ui/modalStackStore";

const SPRING = { type: "spring", stiffness: 320, damping: 34 };

export default function GiftBottomSheet({
  open,
  release,
  senderUserId,
  isMobile,
  isAdmin = false,
  onClose,
}) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState(
    "Every day is a gift, gifted to you by tomorrow."
  );
  const [emailError, setEmailError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [sending, setSending] = useState(false);
  const [successEmail, setSuccessEmail] = useState("");
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  const reset = useCallback(() => {
    setEmail("");
    setPhone("");
    setName("");
    setMessage("Every day is a gift, gifted to you by tomorrow.");
    setEmailError("");
    setPhoneError("");
    setSubmitError("");
    setSending(false);
    setSuccessEmail("");
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open || !release) return undefined;
    registerModal("gift-bottom-sheet");
    return () => unregisterModal("gift-bottom-sheet");
  }, [open, release]);

  useEffect(() => {
    if (!successEmail) return undefined;
    const t = setTimeout(() => {
      onClose?.();
    }, 2500);
    return () => clearTimeout(t);
  }, [successEmail, onClose]);

  const emailValid = validateEmail(email).ok;

  const handleBulkGift = async (recipientType) => {
    if (!release?.slug || bulkSending) return;
    setBulkSending(true);
    setBulkResult(null);
    setSubmitError("");
    try {
      const res = await fetch("/api/gifts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          slug: release.slug,
          recipient_type: recipientType,
          message: message.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk gift failed");
      setBulkResult(`Granted to ${data.granted} of ${data.total} recipients`);
    } catch (err) {
      setSubmitError(err.message || "Bulk gift failed");
    } finally {
      setBulkSending(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const check = validateEmail(email);
    if (!check.ok) {
      setEmailError(check.error);
      return;
    }
    setEmailError("");
    let phonePayload = null;
    const phoneTrim = phone.trim();
    if (phoneTrim) {
      const phoneCheck = validatePhone(phoneTrim);
      if (!phoneCheck.ok) {
        setPhoneError(phoneCheck.error);
        return;
      }
      phonePayload = phoneCheck.value;
    }
    setPhoneError("");
    setSubmitError("");
    setSending(true);
    try {
      const res = await fetch("/api/gifts/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          releaseSlug: release?.slug,
          releaseTitle: release?.title,
          releaseType: release?.type || release?.releaseType || "single",
          productId: release?.productId || release?.product_id || null,
          recipientEmail: check.value,
          recipientPhone: phonePayload,
          recipientName: name.trim() || null,
          message: message.trim() || null,
          senderUserId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not send gift");
      setSuccessEmail(check.value);
    } catch (err) {
      setSubmitError(err.message || "Could not send gift");
    } finally {
      setSending(false);
    }
  };

  if (!open || !release) return null;

  const cover = release.cover || release.preview;

  return (
    <AnimatePresence>
      <motion.div
        key="gift-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9500,
          background: "rgba(0,0,0,0.65)",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
        }}
      >
        <motion.form
          key="gift-sheet"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={SPRING}
          onClick={(e) => e.stopPropagation()}
          onSubmit={submit}
          style={{
            width: "100%",
            maxWidth: 480,
            maxHeight: "min(92dvh, 720px)",
            background: "#0d0d0d",
            border: "1px solid #222",
            borderRadius: "16px 16px 0 0",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            role="presentation"
            onClick={onClose}
            style={{
              padding: "10px 0 6px",
              display: "flex",
              justifyContent: "center",
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <div
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                background: "#333",
              }}
            />
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
              padding: "0 20px 12px",
              paddingBottom: "max(12px, env(safe-area-inset-bottom))",
            }}
          >
            <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 20 }}>
              {cover ? (
                <img
                  src={cover}
                  alt=""
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: 10,
                    objectFit: "cover",
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: 10,
                    background: "#1a1a1a",
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#a259ff", letterSpacing: 2, marginBottom: 4 }}>
                  SEND GIFT
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.3 }}>{release.title}</div>
              </div>
            </div>

            {successEmail ? (
              <div style={{ textAlign: "center", padding: "32px 0 48px" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#a259ff" }}>
                  Gift sent to {successEmail}!
                </div>
              </div>
            ) : (
              <>
                <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 6 }}>
                  Recipient email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError("");
                  }}
                  placeholder="fan@email.com"
                  required
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    background: "#111",
                    border: `1px solid ${emailError ? "#ef4444" : "#2a2a2a"}`,
                    color: "white",
                    borderRadius: 10,
                    fontSize: 14,
                    marginBottom: emailError ? 6 : 14,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                {emailError ? (
                  <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 14 }}>{emailError}</div>
                ) : null}

                <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 6 }}>
                  Recipient phone (optional)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(formatPhoneInput(e.target.value));
                    if (phoneError) setPhoneError("");
                  }}
                  placeholder="(469) 203-9473"
                  autoComplete="tel"
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    background: "#111",
                    border: `1px solid ${phoneError ? "#ef4444" : "#2a2a2a"}`,
                    color: "white",
                    borderRadius: 10,
                    fontSize: 14,
                    marginBottom: phoneError ? 6 : 14,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                {phoneError ? (
                  <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 14 }}>{phoneError}</div>
                ) : (
                  <div style={{ fontSize: 10, color: "#444", marginBottom: 14, lineHeight: 1.5 }}>
                    Saved for future SMS delivery — not sent yet.
                  </div>
                )}

                <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 6 }}>
                  Recipient name (optional)
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name"
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    background: "#111",
                    border: "1px solid #2a2a2a",
                    color: "white",
                    borderRadius: 10,
                    fontSize: 14,
                    marginBottom: 14,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />

                <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 6 }}>
                  Message (optional)
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="A note for them…"
                  rows={3}
                  maxLength={280}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    background: "#111",
                    border: "1px solid #2a2a2a",
                    color: "white",
                    borderRadius: 10,
                    fontSize: 14,
                    marginBottom: 14,
                    resize: "vertical",
                    outline: "none",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                  }}
                />

                {submitError ? (
                  <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 12 }}>{submitError}</div>
                ) : null}

                {isAdmin ? (
                  <div className="gift-bulk-section" style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #1a1a1a" }}>
                    <div className="gift-bulk-label" style={{ fontSize: 10, letterSpacing: 2, color: "#666", marginBottom: 10 }}>
                      SEND TO GROUP
                    </div>
                    {["subscribers", "collectors", "all"].map((type) => (
                      <button
                        key={type}
                        type="button"
                        className="gift-bulk-btn"
                        disabled={bulkSending}
                        onClick={() => void handleBulkGift(type)}
                        style={{
                          display: "block",
                          width: "100%",
                          marginBottom: 8,
                          padding: "11px 14px",
                          background: "#111",
                          border: "1px solid #2a2a2a",
                          borderRadius: 10,
                          color: "#ccc",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: bulkSending ? "default" : "pointer",
                          textAlign: "left",
                        }}
                      >
                        {type === "subscribers" && "All Subscribers"}
                        {type === "collectors" && "All Collector Card Owners"}
                        {type === "all" && "Everyone on the Platform"}
                      </button>
                    ))}
                    {bulkResult ? (
                      <div style={{ fontSize: 12, color: "#00ffff", marginTop: 8 }}>{bulkResult}</div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>

          {!successEmail ? (
            <div
              style={{
                flexShrink: 0,
                padding: "12px 20px calc(16px + env(safe-area-inset-bottom))",
                borderTop: "1px solid #1a1a1a",
                background: "#0d0d0d",
              }}
            >
              <button
                type="submit"
                disabled={!emailValid || sending}
                style={{
                  width: "100%",
                  padding: "14px 0",
                  background: "#a259ff",
                  color: "#fff",
                  fontWeight: 800,
                  border: "none",
                  borderRadius: 10,
                  cursor: emailValid && !sending ? "pointer" : "default",
                  opacity: emailValid && !sending ? 1 : 0.45,
                  fontSize: 14,
                }}
              >
                {sending ? "Sending…" : "Send Gift"}
              </button>
            </div>
          ) : null}
        </motion.form>
      </motion.div>
    </AnimatePresence>
  );
}
