import { repoRoot } from "@/lib/project";
import { scanFiles } from "@/intel/extractors/files";
import { gitChurn, scoreHotspots, type Hotspot } from "@/lib/hotspots";
import { analyzeDrift, type DriftReport } from "@/lib/drift";

export interface Health {
  files: number;
  hotspots: Hotspot[];
  drift: DriftReport;
}

const IGNORE = /(^|\/)(generated|\.next|\.beacon|node_modules|dist|build|coverage)\//;

export function computeHealth(): Health {
  const root = repoRoot();
  const files = scanFiles(root, { maxFiles: 2500, maxBytes: 400_000 }).filter(
    (f) => !IGNORE.test(f.path),
  );
  const churn = gitChurn(root);
  return {
    files: files.length,
    hotspots: scoreHotspots(files, churn),
    drift: analyzeDrift(files),
  };
}
