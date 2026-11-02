import Link from "next/link";
import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { PersonalityForm } from "@/components/dashboard/PersonalityForm";
import { ProductSourceForm } from "@/components/dashboard/ProductSourceForm";
import { saveChatFeaturesAction, saveHandoffAction, saveVoiceSalesAction, syncNowAction } from "@/app/admin/chatbot-actions";
import { env } from "@/lib/config/env";
import { speechMode } from "@/modules/speech/config";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db/prisma";
import { CONVERSATION_STYLES, TONES } from "@/modules/ai/system-instructions";
import { MAPPING_FIELDS, parseMapping, triggerAutoSyncIfDue } from "@/modules/catalog/product-sync.service";
import { getPrimaryStore, parseJsonArray, parseJsonObject } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "products", label: "Product list" },
  { id: "personality", label: "Personality & greetings" },
  { id: "handoff", label: "Human handoff" },
  { id: "features", label: "Chat box" },
  { id: "voice", label: "Voice & sales" },
] as const;

const inputClass =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[12px] text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none";
const labelClass = "text-[10.5px] font-medium text-stone-500";

function relativeTime(date: Date | null): string {
  if (!date) return "never";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : date.toLocaleDateString("en-BD");
}

export default async function ConfigureChatbotPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { tab: rawTab, saved, error } = await searchParams;
  const tab = TABS.some((entry) => entry.id === rawTab) ? rawTab! : "products";
  const store = await getPrimaryStore();
  if (!store) return <AdminBanner error="No store configured. Run npm run db:seed." />;

  const settings = store.settings;
  const source =
    (await prisma.productSource.findUnique({ where: { storeId: store.id } })) ??
    (await prisma.productSource.create({ data: { storeId: store.id } }));
  triggerAutoSyncIfDue(store.id);

  const [productCount, apiCount] = await Promise.all([
    prisma.product.count({ where: { storeId: store.id, status: "active" } }),
    prisma.product.count({ where: { storeId: store.id, status: "active", sourceType: "api" } }),
  ]);
  const counts = parseJsonObject(source.lastCounts) as Record<string, number>;
  const theme = parseJsonObject(settings?.widgetTheme);
  const welcomeVoice = parseJsonObject(settings?.welcomeVoiceText);
  const recommendationLines = Object.entries(parseJsonObject(settings?.recommendationMap))
    .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]))
    .map(([category, targets]) => `${category}: ${targets.join(", ")}`)
    .join("\n");
  let topics: Array<{ label: string; prompt: string }> = [];
  try {
    topics = JSON.parse(settings?.suggestedTopics || "[]");
  } catch {
    topics = [];
  }

  return (
    <div className="max-w-3xl">
      <AdminBanner error={error} saved={saved} savedMessage="Saved. The chat uses the new settings right away." />
      <h1 className="font-serif text-2xl text-stone-900">Configure chatbot</h1>
      <p className="mt-1 text-[12px] text-stone-500">
        What the assistant knows, how it talks, and when it hands the chat to your team. Policies and FAQs live in{" "}
        <Link href="/admin/knowledge" className="underline underline-offset-2">
          Knowledge
        </Link>
        ; the language model is set on{" "}
        <Link href="/admin/ai" className="underline underline-offset-2">
          AI model
        </Link>
        .
      </p>

      <nav aria-label="Chatbot settings" className="mt-5 flex gap-1 overflow-x-auto border-b border-stone-200">
        {TABS.map((entry) => (
          <Link
            key={entry.id}
            href={`/admin/chatbot?tab=${entry.id}`}
            aria-current={tab === entry.id ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-[12px] font-medium transition ${
              tab === entry.id ? "border-stone-900 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800"
            }`}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {tab === "products" ? (
        <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold text-stone-900">Product list</h2>
              <p className="mt-0.5 text-[11px] text-stone-500">
                The assistant searches, filters and recommends from your live product list: {productCount} active product
                {productCount === 1 ? "" : "s"}
                {apiCount > 0 ? ` (${apiCount} from the API)` : ""}.{" "}
                <Link href="/admin/products" className="underline underline-offset-2">
                  View products
                </Link>
              </p>
            </div>
            {source.mode === "api" ? (
              <div className="rounded-lg bg-stone-50 px-3 py-2 text-[11px] text-stone-600">
                <p>
                  Last sync: <span className="font-semibold text-stone-800">{relativeTime(source.lastSyncAt)}</span>{" "}
                  <span
                    className={`ml-1 rounded-full px-1.5 py-px text-[10px] font-semibold ${
                      source.lastStatus === "ok"
                        ? "bg-emerald-100 text-emerald-700"
                        : source.lastStatus === "error"
                          ? "bg-red-100 text-red-700"
                          : "bg-stone-200 text-stone-600"
                    }`}
                  >
                    {source.lastStatus}
                  </span>
                </p>
                {source.lastStatus === "ok" ? (
                  <p className="mt-0.5">
                    +{counts.created ?? 0} new · {counts.updated ?? 0} updated · {counts.deactivated ?? 0} hidden
                    {counts.skipped ? ` · ${counts.skipped} skipped` : ""}
                  </p>
                ) : null}
                {source.lastError ? <p className="mt-0.5 text-red-600">{source.lastError}</p> : null}
                <form action={syncNowAction} className="mt-1.5">
                  <button type="submit" className="text-[11px] font-semibold text-stone-800 underline underline-offset-2">
                    Sync now
                  </button>
                </form>
              </div>
            ) : null}
          </div>

          <ProductSourceForm
            fields={MAPPING_FIELDS}
            currency={store.currency}
            initial={{
              mode: source.mode === "api" ? "api" : "manual",
              apiUrl: source.apiUrl,
              priceUnit: source.priceUnit === "minor" ? "minor" : "major",
              autoSync: source.autoSync,
              intervalMinutes: source.intervalMinutes,
              mapping: parseMapping(source.mapping) as Record<string, string>,
            }}
          />
          <p className="mt-4 border-t border-stone-100 pt-3 text-[10.5px] leading-relaxed text-stone-400">
            Imported products go into the same product list your store uses; nothing is stored twice. Products missing
            from the API on the next sync are hidden (not deleted) so past orders keep their details. In production, point
            a scheduler at <span className="font-mono">/api/cron/product-sync</span> with your CRON_SECRET for exact
            timing; otherwise syncs run when the site gets traffic.
          </p>
        </section>
      ) : null}

      {tab === "personality" ? (
        <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-[13px] font-semibold text-stone-900">Personality &amp; greetings</h2>
          <PersonalityForm
            tones={TONES}
            styles={CONVERSATION_STYLES}
            initial={{
              assistantName: settings?.assistantName ?? "Shopping assistant",
              tone: settings?.tone ?? "friendly",
              customTone: settings?.customTone ?? "",
              conversationStyle: settings?.conversationStyle ?? "consultative",
              welcomeMessage: settings?.welcomeMessage ?? "",
              productGreeting: settings?.productGreeting ?? "",
              fallbackMessage: settings?.fallbackMessage ?? "",
              systemInstructions: settings?.systemInstructions ?? "",
              topics,
            }}
          />
        </section>
      ) : null}

      {tab === "handoff" ? (
        <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-[13px] font-semibold text-stone-900">Human handoff</h2>
          <p className="mt-0.5 text-[11px] text-stone-500">
            When the assistant can&apos;t help, the chat moves to your{" "}
            <Link href="/admin/inbox" className="underline underline-offset-2">
              Inbox
            </Link>{" "}
            and the assistant stops replying until a team member takes over or hands it back.
          </p>
          <form action={saveHandoffAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-[12px] text-stone-800 sm:col-span-2">
              <input type="checkbox" name="handoffEnabled" defaultChecked={settings?.handoffEnabled ?? true} /> Allow handing chats
              to a person
            </label>
            <div>
              <label htmlFor="handoffAfterMisses" className={labelClass}>
                Hand off after this many unanswered messages in a row (0 = never automatically)
              </label>
              <input
                id="handoffAfterMisses"
                name="handoffAfterMisses"
                type="number"
                min={0}
                max={10}
                defaultValue={settings?.handoffAfterMisses ?? 2}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="handoffKeywords" className={labelClass}>
                Words that immediately ask for a person (comma separated)
              </label>
              <input
                id="handoffKeywords"
                name="handoffKeywords"
                defaultValue={parseJsonArray(settings?.handoffKeywords).join(", ")}
                placeholder="human, agent, manager, মানুষ"
                className={inputClass}
              />
            </div>
            <p className="text-[10.5px] leading-relaxed text-stone-400 sm:col-span-2">
              The assistant also hands off by itself for complaints, damaged or wrong items, and refund approvals.
            </p>
            <div className="sm:col-span-2">
              <button type="submit" className="rounded-lg bg-stone-900 px-3.5 py-2 text-[11.5px] font-semibold text-white hover:bg-stone-800">
                Save handoff rules
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {tab === "features" ? (
        <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-[13px] font-semibold text-stone-900">Chat box</h2>
          <form action={saveChatFeaturesAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex items-start gap-2 text-[12px] text-stone-800">
              <input type="checkbox" name="voiceEnabled" defaultChecked={settings?.voiceEnabled ?? true} className="mt-0.5" />
              <span>
                Voice messages
                <span className="block text-[10.5px] text-stone-500">
                  Speech is turned into text in the browser (Chrome, Edge, Safari). The recording is kept for your team.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[12px] text-stone-800">
              <input type="checkbox" name="attachmentsEnabled" defaultChecked={settings?.attachmentsEnabled ?? true} className="mt-0.5" />
              <span>
                Attachments
                <span className="block text-[10.5px] text-stone-500">Images and PDFs up to 5 MB.</span>
              </span>
            </label>
            <div>
              <label htmlFor="accent" className={labelClass}>
                Accent color
              </label>
              <input
                id="accent"
                name="accent"
                type="color"
                defaultValue={typeof theme.accent === "string" ? theme.accent : "#0f766e"}
                className="mt-1 h-9 w-16 cursor-pointer rounded border border-stone-300 bg-white p-0.5"
              />
            </div>
            <div>
              <label htmlFor="position" className={labelClass}>
                Launcher position
              </label>
              <select id="position" name="position" defaultValue={theme.position === "left" ? "left" : "right"} className={inputClass}>
                <option value="right">Bottom right</option>
                <option value="left">Bottom left</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <button type="submit" className="rounded-lg bg-stone-900 px-3.5 py-2 text-[11.5px] font-semibold text-white hover:bg-stone-800">
                Save chat box
              </button>
            </div>
          </form>
        </section>
      ) : null}
      {tab === "voice" ? (
        <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-[13px] font-semibold text-stone-900">Voice assistant & selling</h2>
          <p className="mt-1 text-[11.5px] text-stone-500">
            Speech:{" "}
            {speechMode() === "server" ? (
              <span className="font-medium text-emerald-700">{env.SPEECH_PROVIDER} (cloud voices, works in every modern browser)</span>
            ) : (
              <span className="font-medium text-amber-700">
                browser (free; listening works in Chrome and Edge, voices depend on the device). Set SPEECH_PROVIDER and
                SPEECH_API_KEY for natural English and Bangla voices.
              </span>
            )}
          </p>
          <form action={saveVoiceSalesAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex items-start gap-2 text-[12px] text-stone-800">
              <input
                type="checkbox"
                name="voiceAssistantEnabled"
                defaultChecked={settings?.voiceAssistantEnabled ?? true}
                className="mt-0.5"
              />
              <span>
                Hands-free voice assistant
                <span className="block text-[10.5px] text-stone-500">
                  A Talk button in the chat: customers speak naturally and the assistant answers out loud, showing products and
                  orders on screen. Needs Voice messages turned on in Chat box.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[12px] text-stone-800">
              <input type="checkbox" name="welcomeVoiceEnabled" defaultChecked={settings?.welcomeVoiceEnabled ?? true} className="mt-0.5" />
              <span>
                Spoken welcome
                <span className="block text-[10.5px] text-stone-500">
                  Greets new visitors a few seconds after they land (once a week at most) and offers the voice assistant. Browsers
                  play sound only after the visitor first clicks or taps the page.
                </span>
              </span>
            </label>
            <div>
              <label htmlFor="welcomeEn" className={labelClass}>
                Welcome line (English)
              </label>
              <textarea
                id="welcomeEn"
                name="welcomeEn"
                rows={3}
                defaultValue={typeof welcomeVoice.en === "string" ? welcomeVoice.en : ""}
                placeholder="Hello, I'm your voice assistant. Let me know how I can help you."
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="welcomeBn" className={labelClass}>
                Welcome line (Bangla)
              </label>
              <textarea
                id="welcomeBn"
                name="welcomeBn"
                rows={3}
                defaultValue={typeof welcomeVoice.bn === "string" ? welcomeVoice.bn : ""}
                placeholder="হ্যালো, আমি আপনার voice assistant। আপনাকে কিভাবে সাহায্য করতে পারি আমাকে জানান।"
                className={inputClass}
              />
            </div>
            <p className="-mt-2 text-[10.5px] text-stone-500 sm:col-span-2">
              Leave empty for the built-in greeting. {"{store}"} and {"{assistant}"} are replaced with your store and assistant names.
            </p>
            <label className="flex items-start gap-2 text-[12px] text-stone-800 sm:col-span-2">
              <input type="checkbox" name="salesPlaybookEnabled" defaultChecked={settings?.salesPlaybookEnabled ?? true} className="mt-0.5" />
              <span>
                Sales playbook
                <span className="block text-[10.5px] text-stone-500">
                  The assistant asks about needs, recommends 1-3 products, handles price objections with cheaper options, suggests
                  one add-on after an item is added, and asks for the order. It never invents discounts or scarcity.
                </span>
              </span>
            </label>
            <div className="sm:col-span-2">
              <label htmlFor="recommendationMap" className={labelClass}>
                Add-on suggestions (one per line: category: categories that go with it)
              </label>
              <textarea
                id="recommendationMap"
                name="recommendationMap"
                rows={4}
                defaultValue={recommendationLines}
                placeholder={"Bags: Accessories\nClothing: Accessories, Bags"}
                className={`${inputClass} font-mono`}
              />
              <p className="mt-1 text-[10.5px] text-stone-500">
                Empty: the assistant suggests a lower-priced item from another category.
              </p>
            </div>
            <div className="sm:col-span-2">
              <button type="submit" className="rounded-lg bg-stone-900 px-3.5 py-2 text-[11.5px] font-semibold text-white hover:bg-stone-800">
                Save voice & sales
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
