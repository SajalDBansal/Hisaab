export const publicUrl = (value: string | undefined) => {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
};

// Site routes are rooted at /; app destinations may include their own path.
export function siteOrigin(value: string | undefined) {
  const parsed = publicUrl(value);
  if (!parsed) return null;
  const url = new URL(parsed);
  return url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
}

// Public build-time configuration only; this site never reads business credentials.
export const site = {
  name: "Hisaab",
  description:
    "Accounting and business management for the way your business works. Sales, stock, payments and clear books, together.",
  url: siteOrigin(process.env.NEXT_PUBLIC_SITE_URL),
  appUrl: publicUrl(process.env.NEXT_PUBLIC_APP_URL),
  supportEmail: /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "",
  )
    ? process.env.NEXT_PUBLIC_SUPPORT_EMAIL!
    : null,
};

export const mainLinks = [
  { href: "/features", label: "Features" },
  { href: "/system", label: "How it works" },
  { href: "/accounting-principles", label: "The books" },
  { href: "/help", label: "Help" },
  { href: "/downloads", label: "Downloads" },
];

export const resourceLinks = [
  { href: "/architecture", label: "Architecture" },
  { href: "/security", label: "Security" },
  { href: "/privacy", label: "Privacy" },
  { href: "/about", label: "About Hisaab" },
  { href: "/contact", label: "Contact" },
];

export const publicRoutes = [
  "/",
  "/features",
  "/help",
  "/system",
  "/architecture",
  "/accounting-principles",
  "/privacy",
  "/security",
  "/about",
  "/contact",
  "/get-started",
  "/downloads",
];
