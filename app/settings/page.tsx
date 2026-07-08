import { buildSettingsSections } from "@/components/settings/settings-sections";
import { SettingsModal } from "@/components/settings/settings-modal";
import { BoardBackdrop } from "@/components/settings/board-backdrop";

export const dynamic = "force-dynamic";

// The real, deep-linkable /settings route. On a SOFT nav the @modal slot intercepts and this never
// renders; this is the HARD-load / direct-link fallback — the modal over a board backdrop, so a
// bookmarked or refreshed /settings still reads as a modal over your board. Closing (no in-app
// history here) pushes /map with this tab's workspace preserved.
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ws?: string }>;
}) {
  const { ws } = await searchParams;
  const sections = await buildSettingsSections(ws);
  return (
    <>
      <BoardBackdrop />
      <SettingsModal sections={sections} intercepted={false} />
    </>
  );
}
