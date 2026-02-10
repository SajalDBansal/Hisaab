import { getImageProps } from "next/image";
import desktopArtwork from "@/public/images/hero-desktop.webp";
import mobileArtwork from "@/public/images/hero-mobile.webp";

export function HeroArtwork() {
  const shared = {
    alt: "Hisaab accounting dashboard showing sample business books",
    sizes: "100vw",
  };
  const { props: mobile } = getImageProps({
    ...shared,
    src: mobileArtwork,
    width: 900,
    height: 1550,
  });
  const { props: desktop } = getImageProps({
    ...shared,
    src: desktopArtwork,
    width: 1920,
    height: 1300,
    loading: "eager",
    fetchPriority: "high",
  });
  return (
    <picture>
      <source
        media="(max-width: 760px)"
        srcSet={mobile.srcSet}
        sizes={shared.sizes}
      />
      {/* Next's optimized sources let the browser download only the matching artwork. */}
      <img {...desktop} alt={shared.alt} className="hero-art" />
    </picture>
  );
}
