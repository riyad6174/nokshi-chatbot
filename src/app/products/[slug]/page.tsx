import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { AskAssistantButton } from "@/components/storefront/AskAssistantButton";
import { prisma } from "@/lib/db/prisma";
import { formatMinor } from "@/lib/money";
import { parseOptions, serializeProduct } from "@/modules/catalog/product.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

async function load(slug: string) {
  const store = await getPrimaryStore();
  if (!store) return null;
  const product = await prisma.product.findFirst({
    where: { storeId: store.id, slug: decodeURIComponent(slug), status: "active" },
    include: { variants: { orderBy: { title: "asc" } } },
  });
  return product ? { store, product } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug);
  return data ? { title: `${data.product.name} · ${data.store.name}`, description: data.product.description.slice(0, 150) } : {};
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { store, product: row } = data;
  const product = serializeProduct(row);
  const attributes = Object.entries(parseOptions(row.attributes));

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200/80 bg-sand/90">
        <div className="container-page flex h-16 items-center justify-between">
          <Link href="/" className="font-serif text-xl font-semibold tracking-tight text-stone-900">
            {store.name}
          </Link>
          <Link href="/#shop" className="text-[12.5px] font-medium text-stone-600 hover:text-stone-900">
            ← All products
          </Link>
        </div>
      </header>

      <main className="container-page grid gap-8 py-10 md:grid-cols-2">
        <div className="relative aspect-square overflow-hidden rounded-3xl bg-stone-100 animate-fade-up">
          {product.imageUrl ? (
            <Image src={product.imageUrl} alt={product.name} fill unoptimized sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center font-serif text-6xl text-stone-300">{product.name.charAt(0)}</div>
          )}
        </div>

        <div className="animate-fade-up" style={{ animationDelay: "80ms", animationFillMode: "both" }}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal">
            {product.brand ? `${product.brand} · ` : ""}
            {product.category}
          </p>
          <h1 className="mt-2 font-serif text-4xl leading-tight tracking-tight text-stone-900">{product.name}</h1>
          <p className="mt-3 text-2xl font-semibold text-stone-900">
            {product.variants.length > 1 ? <span className="text-[13px] font-normal text-stone-500">from </span> : null}
            {formatMinor(product.priceMinor, product.currency, "en-BD")}
          </p>
          <p className="mt-5 text-[14px] leading-relaxed text-stone-600">{product.description}</p>

          {product.variants.length > 0 ? (
            <div className="mt-6">
              <p className="text-[11.5px] font-semibold text-stone-800">Options</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {product.variants.map((variant) => (
                  <span
                    key={variant.id}
                    className={`rounded-full border px-3 py-1 text-[12px] ${
                      variant.available ? "border-stone-300 text-stone-700" : "border-stone-200 text-stone-400 line-through"
                    }`}
                  >
                    {variant.title}
                    {variant.priceMinor !== product.priceMinor ? ` · ${formatMinor(variant.priceMinor, product.currency, "en-BD")}` : ""}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {attributes.length > 0 ? (
            <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl bg-white p-4 text-[12.5px]">
              {attributes.map(([key, value]) => (
                <div key={key}>
                  <dt className="text-[10.5px] uppercase tracking-wide text-stone-400">{key.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt>
                  <dd className="text-stone-800">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <AskAssistantButton
            prompt={`Is the ${product.name} right for me?`}
            className="mt-7 w-full rounded-xl bg-teal px-5 py-3 text-[13.5px] font-semibold text-white transition hover:brightness-110 active:scale-[0.99]"
          >
            Ask the assistant about this
          </AskAssistantButton>
          <p className="mt-2 text-center text-[11px] text-stone-500">Add to cart, ask questions, and order right from the chat.</p>
        </div>
      </main>

      <ChatWidget productId={product.id} />
    </div>
  );
}
