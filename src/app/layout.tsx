import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "BB Cloud Kitchen | Goat Bone Soups in Mancherial",
  description:
    "Discover BB Cloud Kitchen in Mancherial, Telangana — a specialist menu focused on goat bone soup. Explore the menu and find ordering and delivery information.",
  openGraph: {
    title: "BB Cloud Kitchen | Goat Bone Soups",
    description: "A goat bone soup specialist in Mancherial, Telangana, India.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#1e1c19",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
