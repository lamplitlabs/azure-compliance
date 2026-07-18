import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const siteUrl = "https://azure-compliance.bitesinbyte.com";
const siteName = "Azure Compliance Matrix";
const siteTitle = "Azure Services Compliance Matrix | Bites In Byte";
const siteDescription =
  "Interactive compliance coverage matrix for 210+ Azure services. Search, filter, and explore compliance certifications across 17 frameworks including ISO 27001, SOC 2, HIPAA, PCI DSS, HITRUST, and CSA STAR for Azure and Azure Government.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: siteTitle,
    template: "%s | Azure Compliance Matrix",
  },
  description: siteDescription,
  keywords: [
    "Azure compliance",
    "Azure compliance matrix",
    "Azure certifications",
    "ISO 27001",
    "SOC 2",
    "SOC 1",
    "HIPAA",
    "PCI DSS",
    "HITRUST",
    "CSA STAR",
    "FedRAMP",
    "Azure Government",
    "cloud compliance",
    "compliance certifications",
    "Azure services",
    "Microsoft Azure security",
    "regulatory compliance",
    "compliance framework",
  ],
  authors: [{ name: "Bites In Byte", url: "https://bitesinbyte.com" }],
  creator: "Bites In Byte",
  publisher: "Bites In Byte",
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    type: "website",
    url: siteUrl,
    siteName,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
  },
  alternates: {
    canonical: siteUrl,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: siteName,
  url: siteUrl,
  description: siteDescription,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Any",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  creator: {
    "@type": "Organization",
    name: "Bites In Byte",
    url: "https://bitesinbyte.com",
  },
  about: {
    "@type": "Thing",
    name: "Azure Cloud Compliance",
    description:
      "Compliance certifications and regulatory frameworks for Microsoft Azure services",
  },
  keywords:
    "Azure compliance, ISO 27001, SOC 2, HIPAA, PCI DSS, HITRUST, CSA STAR, Azure Government",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <Header />
          <main className="mt-14 flex flex-1 flex-col">{children}</main>
          <Footer />
        </ThemeProvider>
      </body>
    </html>
  );
}
