import { notFound } from "next/navigation";
import { Clock } from "lucide-react";
import { readSharedBoard } from "@/lib/share-store";
import { SharedBoardView } from "@/components/share/shared-board-view";
import { SharedPlanView } from "@/components/share/shared-plan-view";

// The PUBLIC read-only board view. Opened by anyone with the link (no local Beacon needed) — it
// reads the snapshot row by token from the deploy's Neon DB and renders it entirely client-side
// from the snapshot. Under PUBLIC mode app/layout.tsx renders bare children, so this page owns its
// own full-screen chrome. noindex so unguessable tokens never get crawled.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Shared board · Beacon",
  robots: { index: false, follow: false },
};

export default async function SharedBoardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // A missing DB env (e.g. opened on a local install) throws inside readSharedBoard — treat any
  // failure as "not found" rather than 500ing the public page.
  let result: Awaited<ReturnType<typeof readSharedBoard>> = null;
  try {
    result = await readSharedBoard(token);
  } catch {
    result = null;
  }

  if (!result) notFound();
  if (result.expired) return <ExpiredView />;
  return result.snapshot.kind === "plan" ? (
    <SharedPlanView snapshot={result.snapshot} />
  ) : (
    <SharedBoardView snapshot={result.snapshot} />
  );
}

function ExpiredView() {
  return (
    <div className="flex h-dvh items-center justify-center bg-background px-6 text-center">
      <div className="max-w-sm">
        <Clock className="mx-auto mb-3 size-8 text-muted-foreground/40" />
        <h1 className="mb-1.5 text-base font-semibold text-foreground">This link has expired</h1>
        <p className="text-sm text-muted-foreground">
          Shared boards are available for 7 days. Ask whoever shared it to generate a new link from
          their Beacon.
        </p>
      </div>
    </div>
  );
}
