import type { Metadata } from "next";
import { site } from "./site";

export function pageMetadata(
  title: string,
  description: string,
  path: string,
): Metadata {
  return {
    title,
    description,
    ...(site.url ? { alternates: { canonical: `${site.url}${path}` } } : {}),
    ...(site.url
      ? {
          openGraph: {
            title: `${title} | Hisaab`,
            description,
            type: "website",
            siteName: "Hisaab",
            url: `${site.url}${path}`,
            images: [
              {
                url: `${site.url}/images/hisaab-overview.webp`,
                width: 1280,
                height: 900,
                alt: "Hisaab sample business workspace",
              },
            ],
          },
        }
      : {}),
  };
}
