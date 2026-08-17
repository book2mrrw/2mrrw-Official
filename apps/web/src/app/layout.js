import "./globals.css";
import StripeProvider from "./StripeProvider";
import { AuthProvider } from "@/context/AuthContext";
import { AuthGateProvider } from "@/context/AuthGateContext";
import AppAuthRoot from "@/components/auth/AppAuthRoot";
import { AudioProvider } from "@/context/AudioContext";
import GlobalAudioPlayerBar from "@/components/audio/GlobalAudioPlayerBar";
import SessionRecoveryRoot from "@/components/system/SessionRecoveryRoot";
import PostHogInit from "@/components/system/PostHogInit";
import BlackscreenTraceBootstrap from "@/components/system/BlackscreenTraceBootstrap";
import PlaybackNetworkHints from "@/components/system/PlaybackNetworkHints";
import GlobalMediaControllerMount from "@/components/system/GlobalMediaControllerMount";
import { MediaErrorBoundary } from "@/system/errors";

const R2 = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export const metadata = {
  title: "2MRRW",
  description: "Official music from 2MRRW — stream, collect, and experience every release.",
  manifest: "/manifest.json",
  themeColor: "#0a0a0a",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "2MRRW",
  },
  openGraph: {
    title: "2MRRW",
    description: "Official music from 2MRRW — stream, collect, and experience every release.",
    url: "https://www.2mrrw.com",
    siteName: "2MRRW",
    images: [{ url: `${R2}/images/mixtapes-and-eps/love-hz-vol-1/lovehz.jpg`, width: 1500, height: 1500, alt: "Love Hz Vol. 1 — 2MRRW" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "2MRRW",
    description: "Official music from 2MRRW — stream, collect, and experience every release.",
    images: [`${R2}/images/mixtapes-and-eps/love-hz-vol-1/lovehz.jpg`],
  },
  icons: {
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <PlaybackNetworkHints />
      </head>
      <body style={{ margin: 0, background: "#0a0a0a", color: "white" }}>
        <script
          dangerouslySetInnerHTML={{
            __html: `if("serviceWorker"in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){});});}`,
          }}
        />
        <PostHogInit />
        <AuthProvider>
          <BlackscreenTraceBootstrap />
          <AudioProvider>
            <GlobalMediaControllerMount />
            <AppAuthRoot>
              <AuthGateProvider>
                <SessionRecoveryRoot>
                  <StripeProvider>
                    <MediaErrorBoundary assetId="app-layout" mediaType="layout">
                      {children}
                    </MediaErrorBoundary>
                  </StripeProvider>
                </SessionRecoveryRoot>
              </AuthGateProvider>
            </AppAuthRoot>
            <GlobalAudioPlayerBar />
          </AudioProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
