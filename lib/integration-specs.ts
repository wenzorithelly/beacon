// Client-safe integration definitions + the setup-prompt builder (no DB import).

export interface IntegrationField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
}

export interface IntegrationSpec {
  key: string;
  name: string;
  category: string;
  description: string;
  fields: IntegrationField[];
}

export const INTEGRATION_SPECS: IntegrationSpec[] = [
  {
    key: "sentry",
    name: "Sentry",
    category: "observability",
    description: "Monitoramento de erros (plano gratuito).",
    fields: [{ key: "dsn", label: "DSN", placeholder: "https://…@sentry.io/…", secret: true }],
  },
  {
    key: "email",
    name: "E-mail transacional",
    category: "comms",
    description: "Convites de membro e reset de senha (Resend / Postmark).",
    fields: [
      { key: "provider", label: "Provedor", placeholder: "resend | postmark" },
      { key: "apiKey", label: "API key", secret: true },
    ],
  },
  {
    key: "ai-provider",
    name: "Provedor de IA (petições)",
    category: "ai",
    description: "Provedor único para geração de petições, com cota por escritório.",
    fields: [
      { key: "provider", label: "Provedor", placeholder: "anthropic | openai" },
      { key: "apiKey", label: "API key", secret: true },
    ],
  },
];

export const INTEGRATION_KEYS: string[] = INTEGRATION_SPECS.map((s) => s.key);

export function integrationSpec(key: string): IntegrationSpec | undefined {
  return INTEGRATION_SPECS.find((s) => s.key === key);
}

/** A paste-ready setup prompt for Claude Code to wire the integration into the backend. */
export function integrationSetupPrompt(key: string, config: Record<string, string>): string {
  switch (key) {
    case "sentry":
      return [
        "Add Sentry error monitoring to the Juriscan backend (FastAPI):",
        "- `pip install \"sentry-sdk[fastapi]\"`",
        `- init \`sentry_sdk\` at startup with dsn="${config.dsn || "<DSN>"}", traces_sample_rate=0.1, send_default_pii=False`,
        "- add the ASGI integration so unhandled errors are reported",
        "- if there's a Next.js frontend, also add @sentry/nextjs with the same DSN.",
      ].join("\n");
    case "email":
      return [
        `Wire transactional email (${config.provider || "resend"}) into the Juriscan backend for member invites and password reset:`,
        `- add the ${config.provider || "resend"} SDK; read the API key from env (do NOT hardcode "${config.apiKey ? "<provided>" : "<API_KEY>"}")`,
        "- implement send_invite(email, token) and send_password_reset(email, token) with simple HTML templates",
        "- never log the key.",
      ].join("\n");
    case "ai-provider":
      return [
        `Consolidate petition generation onto a single AI provider (${config.provider || "anthropic"}):`,
        "- remove the 5-provider switch in generate-petition",
        "- read the API key from env; enforce a per-firm monthly quota before every call",
        "- log token usage per firm for cost tracking.",
      ].join("\n");
    default:
      return `Set up the "${key}" integration in the Juriscan backend.`;
  }
}
