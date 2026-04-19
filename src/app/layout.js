import StripeProvider from "./StripeProvider";

export const metadata = {
  title: "Artist Site",
  description: "Music, albums, and merch",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en"><body style={{ margin: 0, background: "#0a0a0a", color: "white" }}>
      <StripeProvider>{children}</StripeProvider>
    </body></html>
  );
}