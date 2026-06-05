import { listIntegrations } from "@/lib/integrations";
import { IntegrationCard } from "@/components/integration-card";
import { AiCard } from "@/components/ai-card";
import { ContextCard } from "@/components/context-card";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const integrations = await listIntegrations();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Integrações &amp; config</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Ative integrações, guarde as chaves e copie o prompt de setup para implementar no
        backend.
      </p>
      <div className="mt-6 grid gap-4">
        <AiCard />
        <ContextCard />
        {integrations.map((row) => (
          <IntegrationCard key={row.key} row={row} />
        ))}
      </div>
    </div>
  );
}
