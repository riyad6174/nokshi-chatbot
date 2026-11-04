import Link from "next/link";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { ConfirmSubmitButton } from "@/components/dashboard/ConfirmSubmitButton";
import { applySalesPresetAction, saveSalesConfigAction } from "@/app/admin/sales-actions";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { priceLabel } from "@/lib/money";
import { RECOMMENDATION_KINDS, recommend, type RecommendationKind } from "@/modules/catalog/recommendation.service";
import { formatMap, formatRecipes, formatRelationships } from "@/modules/sales/admin-format";
import { ENGAGEMENT_TRIGGERS, INDUSTRIES, INDUSTRY_LABELS, STRATEGIES, resolveSalesConfig } from "@/modules/sales/config";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

const inputClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[12px] text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none";
const labelClass = "text-[10.5px] font-medium text-stone-500";
const sectionClass = "mt-5 rounded-xl border border-stone-200 bg-white p-5";
const hintClass = "mt-0.5 text-[11px] text-stone-500";

const TRIGGER_LABELS: Record<(typeof ENGAGEMENT_TRIGGERS)[number], string> = {
  search: "After a product search",
  product_view: "On a product page",
  compare: "When comparing products",
  add_to_cart: "After adding to cart",
  cart_idle: "Cart left idle",
  checkout_start: "When checkout starts",
};

const STRATEGY_LABELS: Record<(typeof STRATEGIES)[number], string> = {
  balanced: "Balanced",
  complementary_first: "Complementary first (add-ons, complete solutions)",
  budget_first: "Budget first (cheaper options rank higher)",
  premium_first: "Premium first",
  similar_first: "Similar first (alternatives)",
};

function Check({ name, label, defaultChecked, hint }: { name: string; label: string; defaultChecked: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-[12px] text-stone-700">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5" />
      <span>
        {label}
        {hint ? <span className="block text-[11px] text-stone-500">{hint}</span> : null}
      </span>
    </label>
  );
}

export default async function SalesEngagementPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; preview?: string; kind?: string; need?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const store = await getPrimaryStore();
  if (!store?.settings) return <AdminBanner error="No store configured. Run npm run db:seed." />;
  const config = resolveSalesConfig(store.settings);
  const products = await prisma.product.findMany({
    where: { storeId: store.id, status: "active" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 300,
  });

  const previewKind = (RECOMMENDATION_KINDS as readonly string[]).includes(params.kind ?? "") ? (params.kind as RecommendationKind) : "complementary";
  const preview =
    params.preview && products.some((product) => product.id === params.preview)
      ? await recommend({ storeId: store.id, kind: previewKind, anchorProductIds: [params.preview], config, need: params.need?.slice(0, 200) })
      : null;

  return (
    <div className="max-w-3xl">
      <AdminBanner error={params.error} saved={params.saved} savedMessage="Saved. The assistant uses the new sales settings right away." />
      <h1 className="font-serif text-2xl text-stone-900">AI Sales &amp; Engagement</h1>
      <p className="mt-1 text-[12px] text-stone-500">
        How the assistant sells in your store: its role, what it recommends and why, and when it starts a conversation. Its name,
        tone and greetings are under{" "}
        <Link href="/admin/chatbot?tab=personality" className="underline underline-offset-2">
          Configure chatbot
        </Link>
        . Every product fact still comes from your catalog.
      </p>

      <section className={sectionClass}>
        <h2 className="text-[13px] font-semibold text-stone-900">Industry preset</h2>
        <p className={hintClass}>
          Current: <span className="font-semibold text-stone-800">{INDUSTRY_LABELS[config.industry]}</span>. Applying a preset replaces the
          settings below with ready-made rules for that kind of store; you can then adjust them.
        </p>
        <form action={applySalesPresetAction} className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="presetIndustry" className={labelClass}>
              Industry
            </label>
            <select id="presetIndustry" name="industry" defaultValue={config.industry} className={inputClass}>
              {INDUSTRIES.map((industry) => (
                <option key={industry} value={industry}>
                  {INDUSTRY_LABELS[industry]}
                </option>
              ))}
            </select>
          </div>
          <ConfirmSubmitButton
            confirmMessage="Replace the current sales settings with this preset?"
            className="rounded-lg bg-stone-900 px-3 py-2 text-[12px] font-semibold text-white hover:bg-stone-800"
          >
            Apply preset
          </ConfirmSubmitButton>
        </form>
      </section>

      <form action={saveSalesConfigAction}>
        <input type="hidden" name="industry" value={config.industry} />
        <section className={sectionClass}>
          <h2 className="text-[13px] font-semibold text-stone-900">Assistant role</h2>
          <div className="mt-3 grid gap-4">
            <Check name="enabled" label="Use the sales engine" defaultChecked={config.enabled} hint="Off: the assistant uses only the standard sales playbook." />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="businessType" className={labelClass}>
                  Business type
                </label>
                <input id="businessType" name="businessType" defaultValue={config.businessType} maxLength={120} placeholder="e.g. Organic grocery in Dhaka" className={inputClass} />
              </div>
              <div>
                <label htmlFor="role" className={labelClass}>
                  Acts as
                </label>
                <input id="role" name="role" defaultValue={config.persona.role} maxLength={200} placeholder="a friendly personal stylist" className={inputClass} />
              </div>
            </div>
            <div>
              <label htmlFor="personality" className={labelClass}>
                Personality
              </label>
              <textarea id="personality" name="personality" rows={2} maxLength={600} defaultValue={config.persona.personality} className={inputClass} />
            </div>
            <div>
              <label htmlFor="conversationRules" className={labelClass}>
                Conversation rules (one per line)
              </label>
              <textarea id="conversationRules" name="conversationRules" rows={5} defaultValue={config.conversationRules.join("\n")} className={`${inputClass} font-mono`} />
            </div>
          </div>
        </section>

        <section className={sectionClass}>
          <h2 className="text-[13px] font-semibold text-stone-900">Recommendations</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="strategy" className={labelClass}>
                Strategy
              </label>
              <select id="strategy" name="strategy" defaultValue={config.recommendation.strategy} className={inputClass}>
                {STRATEGIES.map((strategy) => (
                  <option key={strategy} value={strategy}>
                    {STRATEGY_LABELS[strategy]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="maxPerReply" className={labelClass}>
                Products per suggestion (1–6)
              </label>
              <input id="maxPerReply" name="maxPerReply" type="number" min={1} max={6} defaultValue={config.recommendation.maxPerReply} className={inputClass} />
            </div>
            <div>
              <label htmlFor="maxAddOns" className={labelClass}>
                Unasked add-ons per chat (0–10)
              </label>
              <input id="maxAddOns" name="maxAddOns" type="number" min={0} max={10} defaultValue={config.recommendation.maxAddOnsPerConversation} className={inputClass} />
            </div>
          </div>
          <div className="mt-3">
            <Check name="explainReasons" label="Explain why each product is suggested" defaultChecked={config.recommendation.explainReasons} />
          </div>
          <div className="mt-4 grid gap-4">
            <div>
              <label htmlFor="relationships" className={labelClass}>
                Product relationships: <code>From -&gt; To, To | kind | reason</code> (kinds: complementary, complete_the_look, compatible, recipe, bundle)
              </label>
              <textarea id="relationships" name="relationships" rows={6} defaultValue={formatRelationships(config.relationships)} className={`${inputClass} font-mono`} />
              <p className={hintClass}>Terms match category or product names loosely (Shirts matches “Oxford Shirt”). In reasons, {"{from}"} and {"{to}"} become product names.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="recipes" className={labelClass}>
                  Recipes / meal ideas: <code>dish: ingredient, ingredient</code>
                </label>
                <textarea id="recipes" name="recipes" rows={5} defaultValue={formatRecipes(config.recipes)} className={`${inputClass} font-mono`} />
              </div>
              <div>
                <label htmlFor="colorPairings" className={labelClass}>
                  Colour pairings: <code>colour: goes with, goes with</code>
                </label>
                <textarea id="colorPairings" name="colorPairings" rows={5} defaultValue={formatMap(config.colorPairings)} className={`${inputClass} font-mono`} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="compatibilityAttributes" className={labelClass}>
                  Compatibility attributes (comma separated)
                </label>
                <input id="compatibilityAttributes" name="compatibilityAttributes" defaultValue={config.compatibilityAttributes.join(", ")} placeholder="compatible_with, connector, model" className={inputClass} />
                <p className={hintClass}>Product attributes that say what an accessory fits. Accessories that list something else are never suggested.</p>
              </div>
              <div>
                <label htmlFor="synonyms" className={labelClass}>
                  Search synonyms: <code>customer word: catalog word</code>
                </label>
                <textarea id="synonyms" name="synonyms" rows={3} defaultValue={formatMap(config.synonyms)} className={`${inputClass} font-mono`} />
              </div>
            </div>
          </div>
        </section>

        <section className={sectionClass}>
          <h2 className="text-[13px] font-semibold text-stone-900">Proactive engagement</h2>
          <p className={hintClass}>
            The assistant can react to what a shopper does (not only to messages), using real catalog suggestions. It never interrupts
            during checkout when suppressed, never repeats a suggestion, and stops for anyone who asks it to.
          </p>
          <div className="mt-3 grid gap-3">
            <Check name="engagementEnabled" label="Send proactive suggestions" defaultChecked={config.engagement.enabled} />
            <div className="grid gap-2 sm:grid-cols-2">
              {ENGAGEMENT_TRIGGERS.map((trigger) => (
                <div key={trigger} className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 px-3 py-2">
                  <Check name={`trigger_${trigger}`} label={TRIGGER_LABELS[trigger]} defaultChecked={config.engagement.triggers[trigger].enabled} />
                  <label className="flex items-center gap-1 text-[11px] text-stone-500">
                    after
                    <input
                      name={`delay_${trigger}`}
                      type="number"
                      min={0}
                      max={1800}
                      defaultValue={config.engagement.triggers[trigger].delaySeconds}
                      aria-label={`${TRIGGER_LABELS[trigger]} delay in seconds`}
                      className="w-16 rounded border border-stone-300 px-1.5 py-1 text-[11px]"
                    />
                    s
                  </label>
                </div>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="maxPerSession" className={labelClass}>
                  Max proactive messages per visit
                </label>
                <input id="maxPerSession" name="maxPerSession" type="number" min={0} max={20} defaultValue={config.engagement.maxPerSession} className={inputClass} />
              </div>
              <div>
                <label htmlFor="minSecondsBetween" className={labelClass}>
                  Minimum seconds between them
                </label>
                <input id="minSecondsBetween" name="minSecondsBetween" type="number" min={0} max={3600} defaultValue={config.engagement.minSecondsBetween} className={inputClass} />
              </div>
            </div>
            <Check name="suppressDuringCheckout" label="Stay quiet once checkout has started" defaultChecked={config.engagement.suppressDuringCheckout} />
            <Check name="nudgeWhenClosed" label="Show a small nudge next to the chat button when the chat is closed" defaultChecked={config.engagement.nudgeWhenClosed} />
            <div className="grid gap-3">
              {(
                [
                  ["msg_complete_the_look", "Complete-the-look message", config.messages.complete_the_look],
                  ["msg_compatible", "Compatible-accessory message", config.messages.compatible],
                  ["msg_recipe", "Recipe message", config.messages.recipe],
                  ["msg_complementary", "Add-on message", config.messages.complementary],
                  ["msg_cart_idle", "Idle cart message", config.messages.cart_idle],
                  ["msg_checkout_start", "Checkout message (empty = none)", config.messages.checkout_start],
                ] as const
              ).map(([name, label, value]) => (
                <div key={name}>
                  <label htmlFor={name} className={labelClass}>
                    {label} — placeholders {"{product}"}, {"{suggestions}"}, {"{recipe}"}
                  </label>
                  <input id={name} name={name} defaultValue={value} maxLength={240} className={inputClass} />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={sectionClass}>
          <h2 className="text-[13px] font-semibold text-stone-900">Sales goals &amp; handoff</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="checkoutGuidance" className={labelClass}>
                Checkout guidance
              </label>
              <select id="checkoutGuidance" name="checkoutGuidance" defaultValue={config.salesGoals.checkoutGuidance} className={inputClass}>
                <option value="gentle">Gentle: offers the next step</option>
                <option value="direct">Direct: invites the order once they like something</option>
                <option value="off">Off: only when the customer asks</option>
              </select>
            </div>
            <div>
              <label htmlFor="highValueCart" className={labelClass}>
                Offer a person for carts over ({store.currency}, empty = never)
              </label>
              <input
                id="highValueCart"
                name="highValueCart"
                type="number"
                min={0}
                step="1"
                defaultValue={config.handoff.highValueCartMinor != null ? config.handoff.highValueCartMinor / 100 : ""}
                className={inputClass}
              />
            </div>
          </div>
          <div className="mt-3 grid gap-2">
            <Check name="upsell" label="Suggest add-ons after an item is added" defaultChecked={config.salesGoals.upsell} />
            <Check name="freeShippingNudge" label="Mention free delivery when the cart is close" defaultChecked={config.salesGoals.freeShippingNudge} />
            <Check name="offerWhenUndecided" label="Offer a person when the shopper stays undecided" defaultChecked={config.handoff.offerWhenUndecided} />
          </div>
          <div className="mt-3">
            <label htmlFor="goalNotes" className={labelClass}>
              Sales goals for the assistant (optional)
            </label>
            <textarea id="goalNotes" name="goalNotes" rows={2} maxLength={600} defaultValue={config.salesGoals.notes} placeholder="e.g. Promote our new Eid collection when relevant." className={inputClass} />
          </div>
        </section>

        <section className={sectionClass}>
          <h2 className="text-[13px] font-semibold text-stone-900">AI features</h2>
          <div className="mt-3 grid gap-2">
            <Check
              name="attachmentUnderstanding"
              label="Let the AI look at photos and PDFs customers attach"
              defaultChecked={config.features.attachmentUnderstanding}
              hint="Needs a vision-capable model (Claude, GPT-4o, Gemini). Files are sent to your AI provider."
            />
            <Check
              name="semanticSearch"
              label="Semantic search when embeddings are configured"
              defaultChecked={config.features.semanticSearch}
              hint="Uses EMBEDDINGS_* settings on the server; keyword search is always on."
            />
          </div>
        </section>

        <div className="mt-5 flex justify-end">
          <button type="submit" className="rounded-lg bg-stone-900 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-stone-800">
            Save sales settings
          </button>
        </div>
      </form>

      <section className={sectionClass} aria-labelledby="preview-heading">
        <h2 id="preview-heading" className="text-[13px] font-semibold text-stone-900">
          Test recommendations
        </h2>
        <p className={hintClass}>See what the assistant would suggest for a product with the saved settings.</p>
        <form method="get" className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <select name="preview" defaultValue={params.preview ?? ""} aria-label="Product" className={inputClass}>
            <option value="">Choose a product…</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          <select name="kind" defaultValue={previewKind} aria-label="Kind" className={inputClass}>
            {RECOMMENDATION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <input name="need" defaultValue={params.need ?? ""} placeholder="need (optional)" aria-label="Need" className={inputClass} />
          <button type="submit" className="mt-1 rounded-lg border border-stone-300 px-3 py-1.5 text-[12px] font-medium text-stone-800 hover:bg-stone-50">
            Preview
          </button>
        </form>
        {preview ? (
          preview.recommendations.length === 0 ? (
            <p className="mt-3 text-[12px] text-stone-500">No suggestions: add relationships for this product&apos;s category, or check stock.</p>
          ) : (
            <ul className="mt-3 divide-y divide-stone-100 text-[12px]">
              {preview.recipe ? <li className="py-1.5 text-stone-500">Recipe: {preview.recipe}</li> : null}
              {preview.recommendations.map((entry) => (
                <li key={entry.product.id} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span>
                    <span className="font-medium text-stone-900">{entry.product.name}</span>
                    <span className="block text-[11px] text-stone-500">{entry.reason}</span>
                  </span>
                  <span className="shrink-0 text-stone-600">{priceLabel(entry.product.priceMinor, entry.product.currency)}</span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
    </div>
  );
}
