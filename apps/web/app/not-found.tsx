import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";

export default function NotFound() {
  return (
    <div className="container not-found">
      <p className="eyebrow">404 / Page not found</p>
      <h1>This page is not in the books.</h1>
      <p>
        The address may have changed. Return home or find an answer in Help.
      </p>
      <div className="hero-actions">
        <Link className="button button-dark" href="/">
          <ArrowLeft size={18} /> Back to Hisaab
        </Link>
        <Link className="button button-light" href="/help">
          <Search size={18} /> Help centre
        </Link>
      </div>
    </div>
  );
}
