import Image from "next/image";
import Link from "next/link";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { AskAssistantButton } from "@/components/storefront/AskAssistantButton";
import { formatMinor } from "@/lib/money";
import { searchProducts } from "@/modules/catalog/product.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

export default async function StorefrontPage() {
  const store = await getPrimaryStore();

  if (!store) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-lg rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
          <h1 className="font-serif text-2xl text-stone-900">Store not configured</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">
            Create the demo store and catalog first. From the project root run:
          </p>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-stone-900 px-4 py-3 text-xs text-stone-100">
            npm run db:push{"\n"}npm run db:seed
          </pre>
          <p className="mt-3 text-xs text-stone-500">
            Then reload this page. The admin dashboard is at{" "}
            <Link href="/admin/login" className="underline">
              /admin/login
            </Link>
            .
          </p>
        </div>
      </main>
    );
  }

  const products = await searchProducts({
    storeId: store.id,
    limit: 12,
    includeUnavailable: true,
  });

  return (
    <div className="min-h-screen">
      <div className="bg-ink px-4 py-2 text-center text-[11px] tracking-wide text-stone-200">
        Free delivery on orders over BDT 3,000 · 7-day returns · Secure checkout
      </div>

      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-sand/90 backdrop-blur">
        <div className="container-page flex h-16 items-center justify-between gap-4">
          <Link href="/" className="font-serif text-xl font-semibold tracking-tight text-stone-900">
            Nokshi Bazaar
          </Link>
          <nav className="hidden items-center gap-6 text-[12.5px] font-medium text-stone-600 md:flex" aria-label="Main">
            <a href="#shop" className="transition hover:text-stone-900">
              Shop
            </a>
            <a href="#how-it-works" className="transition hover:text-stone-900">
              How it works
            </a>
            <a href="#policies" className="transition hover:text-stone-900">
              Delivery &amp; returns
            </a>
          </nav>
          <AskAssistantButton
            prompt="I need help choosing a gift. What do you recommend?"
            className="rounded-full bg-teal px-4 py-2 text-[12px] font-semibold text-white transition hover:brightness-110"
          >
            Ask the assistant
          </AskAssistantButton>
        </div>
      </header>

      <main>
        <section className="container-page grid items-center gap-10 py-14 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-teal/20 bg-teal/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-teal">
              AI shopping assistant
            </p>
            <h1 className="mt-5 max-w-xl font-serif text-4xl leading-[1.05] tracking-tight text-stone-900 sm:text-5xl lg:text-6xl">
              Find the right thing, without the endless scroll.
            </h1>
            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-stone-600">
              Ask in English or Bangla. The assistant searches our real catalog, explains the details,
              builds your cart, and hands you to our secure checkout. No invented prices. No mystery
              products.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href="#shop"
                className="rounded-full bg-stone-900 px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-stone-800"
              >
                Browse the shop
              </a>
              <AskAssistantButton
                prompt="Suggest a backpack under 3,000 taka"
                className="rounded-full border border-stone-300 bg-white px-5 py-2.5 text-[13px] font-semibold text-stone-800 transition hover:border-stone-400"
              >
                Try the chat
              </AskAssistantButton>
            </div>
            <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-[11.5px] text-stone-500">
              <div>
                <dt className="font-semibold text-stone-800">Real catalog</dt>
                <dd>Live prices and stock</dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-800">English &amp; Bangla</dt>
                <dd>Ask the way you speak</dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-800">Trusted checkout</dt>
                <dd>Payment stays on the store</dd>
              </div>
            </dl>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-teal/5" aria-hidden="true" />
            <div className="relative overflow-hidden rounded-[1.75rem] border border-stone-200 bg-white shadow-panel">
              <div className="relative aspect-[4/3] w-full bg-stone-100">
                <Image
                  src="/products/backpack.svg"
                  alt="Urban Trek Backpack"
                  fill
                  priority
                  unoptimized
                  sizes="(min-width: 1024px) 480px, 90vw"
                  className="object-cover"
                />
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-stone-100 px-5 py-4">
                <div>
                  <p className="text-[13px] font-semibold text-stone-900">Urban Trek Backpack</p>
                  <p className="text-[11.5px] text-stone-500">24L · Water resistant · 2 colours</p>
                </div>
                <p className="text-[13px] font-semibold text-stone-900">BDT 2,500.00</p>
              </div>
              <div className="border-t border-stone-100 bg-sand/60 px-5 py-4">
                <div className="rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-[12.5px] leading-relaxed text-stone-600 shadow-sm">
                  &ldquo;I need a backpack for university under 3,000 taka. Which one should I pick?&rdquo;
                </div>
                <div className="mt-2 ml-auto w-fit rounded-2xl rounded-br-md bg-teal px-3.5 py-2.5 text-[12.5px] font-medium text-white">
                  The Urban Trek is a good fit — padded 15&quot; sleeve, 24L, and BDT 2,500.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="shop" className="border-y border-stone-200 bg-white/60 py-14">
          <div className="container-page">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal">The collection</p>
                <h2 className="mt-1.5 font-serif text-3xl tracking-tight text-stone-900">Picked for everyday life</h2>
              </div>
              <p className="max-w-sm text-[12.5px] leading-relaxed text-stone-500">
                Every product below is in the assistant&apos;s catalog. Ask about materials, variants, or
                what fits your budget.
              </p>
            </div>

            {products.length === 0 ? (
              <div className="mt-8 rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-sm text-stone-600">
                No active products yet. Add products in the{" "}
                <Link href="/admin/products" className="underline">
                  admin dashboard
                </Link>{" "}
                or run <code className="rounded bg-stone-100 px-1">npm run db:seed</code>.
              </div>
            ) : (
              <div className="mt-8 grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-3">
                {products.map((product) => {
                  const colours = product.variants.map((variant) => variant.title).filter(Boolean);
                  return (
                    <article
                      key={product.id}
                      className="group relative flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <div className="relative aspect-square w-full overflow-hidden bg-stone-100">
                        {product.imageUrl ? (
                          <Image
                            src={product.imageUrl}
                            alt={product.name}
                            fill
                            unoptimized
                            sizes="(min-width: 1024px) 340px, 45vw"
                            className="object-cover transition duration-300 group-hover:scale-[1.03] motion-reduce:transition-none"
                          />
                        ) : null}
                        {!product.available ? (
                          <span className="absolute left-3 top-3 rounded-full bg-stone-900/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                            Sold out
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-1 flex-col p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">
                          {product.category}
                        </p>
                        <h3 className="mt-1 font-serif text-lg leading-tight text-stone-900">
                          <Link href={`/products/${product.slug}`} className="after:absolute after:inset-0 hover:underline">
                            {product.name}
                          </Link>
                        </h3>
                        <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-stone-500">
                          {product.description}
                        </p>
                        <div className="mt-auto pt-4">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-[13px] font-semibold text-stone-900">
                              {formatMinor(product.priceMinor, product.currency, "en-BD")}
                            </p>
                            <p className="truncate text-[10.5px] text-stone-400">
                              {colours.length > 1 ? `${colours.length} variants` : colours[0] ?? ""}
                            </p>
                          </div>
                          <AskAssistantButton
                            prompt={`Tell me more about the ${product.name}`}
                            className="relative z-10 mt-2.5 w-full rounded-lg border border-stone-200 py-2 text-[11.5px] font-semibold text-stone-700 transition hover:border-teal/40 hover:text-teal"
                          >
                            Ask about this
                          </AskAssistantButton>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section id="how-it-works" className="container-page py-16">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal">How it works</p>
            <h2 className="mt-1.5 font-serif text-3xl tracking-tight text-stone-900">
              A shop assistant that stays on script
            </h2>
            <p className="mt-3 text-[13.5px] leading-relaxed text-stone-600">
              The assistant can only answer from our catalog and approved policies. Prices, stock, totals,
              and checkout links come from the server — never from free-form model text.
            </p>
          </div>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              {
                title: "Ask a real question",
                body: "Budgets, materials, delivery timelines, return rules, or a mixed English–Bangla request.",
              },
              {
                title: "Build the cart in chat",
                body: "Add a variant, change quantities, or remove a line. The server recalculates every total.",
              },
              {
                title: "Finish on secure checkout",
                body: "The assistant validates the cart and opens the store's checkout. Payment never happens in chat.",
              },
            ].map((step, index) => (
              <li key={step.title} className="rounded-2xl border border-stone-200 bg-white p-5">
                <p className="font-serif text-2xl text-teal/70">0{index + 1}</p>
                <h3 className="mt-2 text-[14px] font-semibold text-stone-900">{step.title}</h3>
                <p className="mt-1.5 text-[12px] leading-relaxed text-stone-500">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="policies" className="border-t border-stone-200 bg-stone-900 py-14 text-stone-200">
          <div className="container-page grid gap-8 md:grid-cols-3">
            <div>
              <h2 className="font-serif text-2xl text-white">Good to know</h2>
              <p className="mt-2 text-[12.5px] leading-relaxed text-stone-400">
                Ask the assistant about any policy. It answers from approved documents and says so when it
                does not have an answer.
              </p>
            </div>
            <div className="space-y-4 text-[12.5px] leading-relaxed text-stone-300">
              <div>
                <p className="font-semibold text-white">Delivery</p>
                <p>2–3 business days inside Dhaka, 3–5 days outside. Free over BDT 3,000.</p>
              </div>
              <div>
                <p className="font-semibold text-white">Returns</p>
                <p>7-day returns on unused items with tags. Hygiene items are excluded unless defective.</p>
              </div>
            </div>
            <div className="space-y-4 text-[12.5px] leading-relaxed text-stone-300">
              <div>
                <p className="font-semibold text-white">Payment</p>
                <p>bKash, Nagad, Visa, Mastercard, and cash on delivery up to BDT 10,000.</p>
              </div>
              <div>
                <p className="font-semibold text-white">Support</p>
                <p>Saturday–Thursday, 10 AM–7 PM. support@nokshibazaar.example</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-stone-200 bg-sand">
        <div className="container-page flex flex-col items-start justify-between gap-3 py-6 text-[11.5px] text-stone-500 sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} Nokshi Bazaar. Demo storefront for the AI shopping assistant MVP.</p>
          <div className="flex items-center gap-4">
            <Link href="/admin/login" className="transition hover:text-stone-800">
              Admin
            </Link>
            <span aria-hidden="true">·</span>
            <span>Prices revalidated at checkout</span>
          </div>
        </div>
      </footer>

      <ChatWidget />
    </div>
  );
}
