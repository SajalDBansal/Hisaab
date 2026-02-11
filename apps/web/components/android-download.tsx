import { Download, Smartphone } from "lucide-react";
import type { DownloadManifest } from "../lib/download-manifest";
import styles from "./android-download.module.css";

export function AndroidDownload({
  release,
}: {
  release: DownloadManifest | null;
}) {
  return (
    <section className={styles.release} aria-labelledby="android-heading">
      <div className={styles.heading}>
        <Smartphone size={28} strokeWidth={1.5} aria-hidden="true" />
        <div>
          <p className="eyebrow">Android APK</p>
          <h2 id="android-heading">
            {release ? "Hisaab for Android" : "Android download unavailable"}
          </h2>
        </div>
      </div>
      {release ? (
        <>
          <div className={styles.summary}>
            <p>Install Hisaab directly on your Android device.</p>
            <a className="button button-dark" href={release.android.url}>
              <Download size={18} aria-hidden="true" /> Download Android APK
            </a>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>Version</dt>
              <dd>{release.version}</dd>
            </div>
            <div>
              <dt>Build</dt>
              <dd>{release.buildNumber}</dd>
            </div>
            <div>
              <dt>Published</dt>
              <dd>
                <time dateTime={release.publishedAt}>
                  {new Intl.DateTimeFormat("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(new Date(release.publishedAt))}{" "}
                  (UTC)
                </time>
              </dd>
            </div>
            <div>
              <dt>File size</dt>
              <dd>
                {new Intl.NumberFormat("en-GB", {
                  maximumFractionDigits: 1,
                }).format(release.android.sizeBytes / 1_048_576)}{" "}
                MiB
              </dd>
            </div>
          </dl>
          <details className={styles.integrity}>
            <summary>File details & SHA-256 checksum</summary>
            <dl>
              <div>
                <dt>Android package</dt>
                <dd>
                  <code>{release.android.packageName}</code>
                </dd>
              </div>
              <div>
                <dt>Size in bytes</dt>
                <dd>{release.android.sizeBytes}</dd>
              </div>
              <div>
                <dt>SHA-256</dt>
                <dd>
                  <code>{release.android.sha256}</code>
                </dd>
              </div>
            </dl>
            <p>
              The checksum can be compared with your downloaded file. It does
              not verify the app&apos;s signing certificate.
            </p>
          </details>
        </>
      ) : (
        <p className={styles.unavailable}>
          We cannot confirm an Android release right now. Please check back
          later or continue with Hisaab in your browser.
        </p>
      )}
    </section>
  );
}
