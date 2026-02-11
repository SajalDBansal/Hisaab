import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight } from "lucide-react";
import { AndroidDownload } from "@/components/android-download";
import { PageHeading } from "@/components/page-heading";
import { getAndroidRelease } from "@/lib/downloads";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";
import styles from "./downloads.module.css";

export const metadata = pageMetadata(
  "Downloads",
  "Check Android download availability, release details and installation notes for Hisaab, or open the web app.",
  "/downloads",
);

export default async function DownloadsPage() {
  await connection();
  const release = await getAndroidRelease();
  return (
    <div className={`container ${styles.page}`}>
      <PageHeading
        eyebrow="Downloads"
        title="Hisaab for Android"
        description="Your books, ready for the working day. Check the Android release or open your workspace in a browser."
      />
      <AndroidDownload release={release} />
      <section className="support-band" aria-labelledby="browser-heading">
        <div>
          <h2 id="browser-heading">Prefer your browser?</h2>
          <p>
            Open the Hisaab web app on desktop, Android, iPhone or iPad. This
            page does not offer an iOS download.
          </p>
        </div>
        {site.appUrl ? (
          <a className="button button-light" href={site.appUrl}>
            Open Hisaab web app <ArrowUpRight size={18} aria-hidden="true" />
          </a>
        ) : (
          <Link className="button button-light" href="/get-started">
            Find your workspace <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
        )}
      </section>
      <section className="support-band" aria-labelledby="install-heading">
        <div>
          <h2 id="install-heading">Before you install</h2>
          <p>
            APK files are for Android only. Android may ask you to allow
            installation from your browser. Allow it only for a download you
            trust, then turn that permission off after installing. Keep device
            security checks enabled.
          </p>
          <p>
            Android checks an APK&apos;s signature during installation. Updates
            must use a compatible signing certificate. This page does not verify
            that certificate; a checksum is a file integrity check. If Android
            rejects an update, contact support before uninstalling or clearing
            app data.
          </p>
          <Link className="text-link" href="/contact">
            Installation support <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}
