"use client";

const ICON_DIM = 22;

const WRAPPER = {
  position: "relative",
  width: ICON_DIM,
  height: ICON_DIM,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  overflow: "hidden",
};

function NavIconSvg({ children }) {
  return (
    <div style={WRAPPER}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        width={ICON_DIM}
        height={ICON_DIM}
      >
        {children}
      </svg>
    </div>
  );
}

function HomeIcon() {
  return (
    <NavIconSvg>
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1V9.5z" />
    </NavIconSvg>
  );
}

function MusicIcon() {
  return (
    <NavIconSvg>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </NavIconSvg>
  );
}

function ShopShirtIcon() {
  return (
    <NavIconSvg>
      <path d="M6.5 4L8 2.5h8L17.5 4 20 5.5V9l-1.5 10h-13L4 9V5.5L6.5 4z" />
      <path d="M9 7.5h6" />
    </NavIconSvg>
  );
}

function ShowsIcon() {
  return (
    <NavIconSvg>
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </NavIconSvg>
  );
}

function CardsIcon() {
  return (
    <NavIconSvg>
      <rect x="3" y="5" width="14" height="16" rx="2" />
      <rect x="7" y="3" width="14" height="16" rx="2" opacity="0.55" />
      <path d="M7 9h10M7 13h7" />
    </NavIconSvg>
  );
}

const ICON_BY_TAB = {
  home: HomeIcon,
  singles: MusicIcon,
  shop: ShopShirtIcon,
  shows: ShowsIcon,
  cards: CardsIcon,
};

/** Mobile bottom nav icons — static SVGs (vault uses VaultNavLockIcon). */
export function MobileNavAnimatedIcon({ tabId }) {
  const Icon = ICON_BY_TAB[tabId];
  if (!Icon) return null;
  return <Icon />;
}
