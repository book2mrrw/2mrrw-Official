import StripeProvider from "./StripeProvider";
import { AuthProvider } from "@/context/AuthContext";

export const metadata = {
  title: "Artist Site",
  description: "Music, albums, and merch",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en"><body style={{ margin: 0, background: "#0a0a0a", color: "white" }}>
      <AuthProvider>
        <StripeProvider>{children}</StripeProvider>
      </AuthProvider>
    </body></html>
  );
}