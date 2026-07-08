import { buildSettingsSections } from "@/components/settings/settings-sections";
import { SettingsModal } from "@/components/settings/settings-modal";

export const dynamic = "force-dynamic";

// Intercepts a SOFT navigation to /settings (from the nav pill, or the desktop shell's
// beacon:shell-navigate → router.push) and renders it as a modal in the @modal slot OVER the board
// the user was on — the underlying page (children slot) is preserved. Closing calls router.back().
// A hard load / refresh of /settings skips interception and hits app/settings/page.tsx instead.
export default async function InterceptedSettings({
  searchParams,
}: {
  searchParams: Promise<{ ws?: string }>;
}) {
  const { ws } = await searchParams;
  const sections = await buildSettingsSections(ws);
  return <SettingsModal sections={sections} intercepted />;
}
