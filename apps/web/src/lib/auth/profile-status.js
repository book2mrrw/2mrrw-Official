import { isCollectorCardOwner } from "@/lib/music-access";

/** Display identity and section access come from the same account snapshot.
 * Badge text is presentation; it must never be used as an access permission.
 */
export function resolveProfileStatus({ currentUser, accountState = {}, circleSubmissions = [], accountCircleByline } = {}) {
  if (!currentUser) return { userStatus: null, collectorCardOwner: false, hasInnerCircleAccess: false };
  const snapshotUserId = accountState?.user?.id;
  const account = snapshotUserId && snapshotUserId !== currentUser.id ? {} : (accountState || {});
  const collectorCardOwner = isCollectorCardOwner(account);
  const hasInnerCircleAccess = Boolean(
    account.permissions?.innerCircle || account.permissions?.admin ||
    account.subscriberActive || collectorCardOwner
  );
  if (collectorCardOwner) {
    return {
      userStatus: { label: "COLLECTOR CARD OWNER", color: "#ff6b35", glow: "rgba(255,107,53,0.5)" },
      collectorCardOwner,
      hasInnerCircleAccess,
    };
  }
  const submissions = (circleSubmissions || []).filter(
    (s) => s.by === accountCircleByline || s.by === currentUser.name
  ).length;
  const userStatus = submissions >= 3
    ? { label: "VISIONARY", color: "#00ffff", glow: "rgba(0,255,255,0.5)" }
    : { label: "EARLY SUPPORTER", color: "#aaa", glow: "rgba(170,170,170,0.3)" };
  return { userStatus, collectorCardOwner, hasInnerCircleAccess };
}
