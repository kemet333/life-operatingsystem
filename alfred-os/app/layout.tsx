import type { Metadata } from "next";
import "./globals.css";
import "./jarvis.css";

export const metadata: Metadata = {
  title: "life.operatingsystem",
  description: "Tu sistema personal, con Alfred a tu lado.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" style={{colorScheme:"dark",background:"#090a0c"}}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
