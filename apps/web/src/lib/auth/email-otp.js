/**
 * @deprecated Import from `@/auth/authService` instead.
 * Thin re-export layer for backward compatibility.
 */
export {
  sendEmailOtp,
  isOtpRateLimitError,
  formatOtpSendError,
  getOtpCooldownRemainingMs,
  resetOtpEmailIntent,
  normalizeAuthEmail,
} from "@/auth/authService";
