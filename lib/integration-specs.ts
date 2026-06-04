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
        "Add Sentry error monitoring to this project, following its existing stack:",
        "- install the Sentry SDK for the project's language/framework",
        `- initialize it at startup with dsn="${config.dsn || "<DSN>"}", a modest traces_sample_rate, and send_default_pii disabled`,
        "- make sure unhandled errors are reported (server + frontend if there is one).",
      ].join("\n");
    case "email":
      return [
        `Wire transactional email (${config.provider || "resend"}) into this project (e.g. invites, password resets):`,
        `- add the ${config.provider || "resend"} SDK; read the API key from env (do NOT hardcode it)`,
        "- implement the send helpers your flows need, with simple templates",
        "- never log the key.",
      ].join("\n");
    case "ai-provider":
      return [
        `Consolidate AI calls onto a single provider (${config.provider || "anthropic"}):`,
        "- route all model calls through one client; read the API key from env",
        "- enforce usage limits / quota before each call",
        "- log token usage for cost tracking.",
      ].join("\n");
    default:
      return `Set up the "${key}" integration in this project.`;
  }
}
