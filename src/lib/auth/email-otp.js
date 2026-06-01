/**
 * @deprecated Import from `@/auth/authService` instead.
 * Thin re-export layer for backward compatibility.
 */
export {
  sendEmailOtp,
  isOtpRateLimitError,
  formatOtpSendError,
  getOtpCooldownRemainingMs,
} from "@/auth/authService";
