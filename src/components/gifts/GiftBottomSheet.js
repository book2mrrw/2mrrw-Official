"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { validateEmail } from "@/lib/auth/validation";

const SPRING = { type: "spring", stiffness: 320, damping: 34 };

export default function GiftBottomSheet({
  open,
  release,
  senderUserId,
  isMobile,
  onClose,
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState(
    "Every day is a gift, gifted to you by tomorrow."
  );
  const [emailError, setEmailError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [sending, setSending] = useState(false);
  const [successEmail, setSuccessEmail] = useState("");

  const reset = useCallback(() => {
    setEmail("");
    setName("");
    setMessage("");
    setEmailError("");
    setSubmitError("");
    setSending(false);
    setSuccessEmail("");
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => {
    if (!successEmail) return undefined;
    const t = setTimeout(() => {
      onClose?.();
    }, 2500);
    return () => clearTimeout(t);
  }, [successEmail, onClose]);

  const emailValid = validateEmail(email).ok;

  const submit = async (e) => {
    e.preventDefault();
    const check = validateEmail(email);
    if (!check.ok) {
      setEmailError(check.error);
      return;
    }
    setEmailError("");
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
          releaseType: release?.type || release?.releaseType,
          recipientEmail: check.value,
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
