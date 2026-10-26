/** Account reads cannot prove inbox control. Recovery is explicit and atomic in ownership-recovery. */
export async function reconcileEmailBoundRights(_admin, user) {
  return { changed: false, repairedGifts: 0, copiedGuestRights: 0,
    verificationRequired: Boolean(user?.id && !user.isGuest), recoveryPath: "/account/recover" };
}
