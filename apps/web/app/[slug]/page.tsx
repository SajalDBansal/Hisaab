import { notFound } from "next/navigation";
import { ArticlePage } from "@/components/article-page";
import { handbookPages } from "@/content/handbook";
import { pageMetadata } from "@/lib/metadata";

export function generateStaticParams() {
  return handbookPages.map((page) => ({ slug: page.slug }));
}

type PageProps = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const page = handbookPages.find((item) => item.slug === slug);
  if (!page) notFound();
  return pageMetadata(page.title, page.description, `/${page.slug}`);
}

export default async function HandbookPage({ params }: PageProps) {
  const { slug } = await params;
  const page = handbookPages.find((item) => item.slug === slug);
  if (!page) notFound();
  return <ArticlePage page={page} />;
}
