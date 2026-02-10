import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { mainLinks, resourceLinks } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-main">
          <div className="footer-brand">
            <Link href="/" className="wordmark">
              hisaab<span>.</span>
            </Link>
            <p>
              Good business starts
              <br />
              with clear books.
            </p>
            <Link className="text-link" href="/get-started">
              Find your starting point <ArrowUpRight size={16} />
            </Link>
          </div>
          <div>
            <h2>Explore</h2>
            {mainLinks.map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ))}
            <Link href="/get-started">Get started</Link>
          </div>
          <div>
            <h2>Behind the books</h2>
            {resourceLinks.map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="footer-bottom">
          <p>Hisaab · Accounting & business management</p>
          <p>Built for the everyday details.</p>
        </div>
      </div>
    </footer>
  );
}
