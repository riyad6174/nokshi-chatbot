import { AdminBanner } from "@/components/dashboard/AdminBanner";
import { AiConnectionForm } from "@/components/dashboard/AiConnectionForm";
import { VoiceSettingsForm } from "@/components/dashboard/VoiceSettingsForm";
import { requireAdmin } from "@/lib/auth/admin";
import { decryptSecret } from "@/lib/crypto/secrets";
import { resolveAiStatus } from "@/modules/ai/config";
import { EFFORT_LEVELS, PROVIDER_PRESETS, getPreset } from "@/modules/ai/presets";
import { realtimeApiKey, realtimeSettings } from "@/modules/realtime/realtime.service";
import { getPrimaryStore } from "@/modules/stores/store.service";

export const dynamic = "force-dynamic";

export default async function AdminAiPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { saved, error } = await searchParams;
  const store = await getPrimaryStore();
  if (!store) return <AdminBanner error="No store configured. Run npm run db:seed." />;

  const status = resolveAiStatus(store.settings);
  const preset = getPreset(status.providerId);
  const live = status.config !== null;
  const voice = realtimeSettings(store);

  return (
    <div className="max-w-3xl">
      <AdminBanner error={error} saved={saved} savedMessage={saved === "voice" ? "Voice settings saved. The next voice call uses them." : "AI connection saved. New messages use it immediately."} />

      <h1 className="font-serif text-2xl text-stone-900">AI model</h1>
      <p className="mt-1 text-[12px] text-stone-500">
        Connect the language model that powers the assistant. Keys are encrypted at rest and never sent to the browser.
      </p>

      <section className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-[10.5px] font-medium uppercase tracking-wide text-stone-500">Status</p>
          <p className={`mt-1 text-[15px] font-semibold ${live ? "text-emerald-700" : "text-amber-700"}`}>
            {live ? "Live AI" : "Demo mode"}
          </p>
          <p className="mt-0.5 text-[10.5px] text-stone-500">
            {live ? "Replies come from the model below." : "Replies use local rules until a model is connected."}
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-[10.5px] font-medium uppercase tracking-wide text-stone-500">Provider</p>
          <p className="mt-1 text-[13px] font-semibold text-stone-900">{preset.label}</p>
          <p className="mt-0.5 truncate font-mono text-[10.5px] text-stone-500">{status.model || "—"}</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-[10.5px] font-medium uppercase tracking-wide text-stone-500">API key</p>
          <p className="mt-1 text-[13px] font-semibold text-stone-900">
            {status.keySource === "none" ? "Not set" : `•••• ${status.keyLast4}`}
          </p>
          <p className="mt-0.5 text-[10.5px] text-stone-500">
            {status.keySource === "dashboard"
              ? "Saved in the dashboard"
              : status.keySource === "environment"
                ? "From AI_API_KEY"
                : "Add one below"}
          </p>
        </div>
      </section>

      <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-[13px] font-semibold text-stone-900">Connection</h2>
        <p className="mt-0.5 text-[10.5px] text-stone-400">
          Test before saving: the test uses the values in the form and doesn&apos;t generate any tokens.
        </p>
        <AiConnectionForm
          presets={PROVIDER_PRESETS}
          effortLevels={EFFORT_LEVELS}
          initial={{
            provider: status.providerId,
            baseUrl: store.settings?.aiBaseUrl || (preset.kind === "anthropic" ? "" : preset.baseUrl),
            model: status.model,
            effort: store.settings?.aiEffort || "medium",
            keySource: status.keySource,
            keyLast4: status.keyLast4,
            keyUnreadable: status.keyUnreadable,
          }}
        />
      </section>

      <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-[13px] font-semibold text-stone-900">Live voice</h2>
        <p className="mt-0.5 text-[10.5px] text-stone-400">
          The voice assistant runs on OpenAI Realtime, separately from the text chat model above. Changes apply to the next call.
        </p>
        <VoiceSettingsForm
          initial={{
            engine: voice.engine,
            model: voice.model,
            voice: voice.voice,
            speed: voice.speed,
            style: voice.style,
            keyLast4: decryptSecret(store.settings?.realtimeApiKeyEncrypted) ? store.settings?.realtimeApiKeyLast4 || "" : "",
            mainKeyUsable: realtimeApiKey({ settings: store.settings ? { ...store.settings, realtimeApiKeyEncrypted: "" } : null }) !== null,
          }}
        />
      </section>

      <section className="mt-5 rounded-xl border border-stone-200 bg-white p-5 text-[11px] leading-relaxed text-stone-600">
        <h2 className="text-[13px] font-semibold text-stone-900">How the model is used</h2>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>The model can only call the 8 store tools (search, product details, policies, cart, checkout check).</li>
          <li>Prices, stock, totals and checkout links always come from your catalog, never from the model.</li>
          <li>Each message is capped at 5 tool rounds. If the provider fails, the customer sees your fallback message.</li>
          <li>The model must support tool (function) calling with streaming.</li>
        </ul>
      </section>
    </div>
  );
}
