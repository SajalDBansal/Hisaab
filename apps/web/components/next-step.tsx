import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export function NextStep() {
  return (
    <section className="next-step">
      <div className="container next-step-inner">
        <div>
          <p className="eyebrow">A place for every entry</p>
          <h2>Make room for clearer books.</h2>
        </div>
        <Link href="/get-started" className="button button-dark">
          Get started with Hisaab <ArrowUpRight size={18} />
        </Link>
      </div>
    </section>
  );
}
