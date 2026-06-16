"use client";

import { useMemo, useState } from "react";
import {
  ChevronRight,
  File,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import {
  buildFileTree,
  type FileLeafInput,
  type FileStatus,
  type TreeFile,
  type TreeNode,
} from "@/lib/file-tree";
import { cn } from "@/lib/utils";

// The single visual file tree used everywhere Beacon shows a list of files: the Files-canvas
// "edited this session" panel, the /plan footprint, and the session recap. It is purely
// presentational — give it the flat `files` and it builds + renders the directory tree
// (lib/file-tree). Clicking a file calls `onSelect`; the default opens it in the user's editor.

const STATUS_TEXT: Record<FileStatus, string> = {
  added: "text-emerald-400",
  modified: "text-amber-300",
  deleted: "text-rose-400 line-through",
};
const STATUS_DOT: Record<FileStatus, string> = {
  added: "bg-emerald-400",
  modified: "bg-amber-300",
  deleted: "bg-rose-400",
};

function FileIcon({ name, className }: { name: string; className?: string }) {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext))
    return <FileCode2 className={className} />;
  if (ext === "json") return <FileJson className={className} />;
  if (["md", "mdx", "txt", "css", "scss"].includes(ext)) return <FileText className={className} />;
  return <File className={className} />;
}

function openInEditor(path: string) {
  fetch(`/api/open?path=${encodeURIComponent(path)}`).catch(() => {});
}

function TreeRows({
  nodes,
  depth,
  collapsed,
  onToggle,
  onSelect,
}: {
  nodes: TreeNode[];
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (file: TreeFile) => void;
}) {
  return (
    <ul className={cn(depth > 0 && "ml-[7px] border-l border-white/10 pl-1.5")}>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <li key={`d:${node.path}`}>
            <button
              type="button"
              onClick={() => onToggle(node.path)}
              title={node.path}
              className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
            >
              <ChevronRight
                className={cn(
                  "size-3 shrink-0 transition-transform",
                  !collapsed.has(node.path) && "rotate-90",
                )}
              />
              {collapsed.has(node.path) ? (
                <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate text-[11px] font-medium">{node.name}</span>
            </button>
            {!collapsed.has(node.path) && (
              <TreeRows
                nodes={node.children}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            )}
          </li>
        ) : (
          <li key={`f:${node.path}`}>
            <button
              type="button"
              onClick={() => onSelect(node)}
              title={node.path}
              className="flex w-full items-center gap-1.5 rounded py-1 pl-[18px] pr-1.5 text-left transition-colors hover:bg-white/[0.06]"
            >
              <FileIcon
                name={node.name}
                className={cn(
                  "size-3.5 shrink-0",
                  node.status ? STATUS_TEXT[node.status] : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "truncate text-[11px]",
                  node.status ? STATUS_TEXT[node.status] : "text-foreground/90",
                )}
              >
                {node.name}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                {node.meta && <span className="text-[9px] text-teal-300/80">{node.meta}</span>}
                {node.status && (
                  <span className={cn("size-1.5 rounded-full", STATUS_DOT[node.status])} />
                )}
              </span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

export function FileTree({
  files,
  onSelect,
  collapse = true,
  emptyLabel,
  className,
}: {
  files: FileLeafInput[];
  /** File click handler. Defaults to opening the file in the configured editor. */
  onSelect?: (path: string) => void;
  /** Collapse single-child folder chains (VS Code style). Default true. */
  collapse?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  const tree = useMemo(() => buildFileTree(files, { collapseSingleChildFolders: collapse }), [
    files,
    collapse,
  ]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  if (!tree.length) {
    return emptyLabel ? (
      <p className={cn("px-2 py-1 text-[11px] text-muted-foreground", className)}>{emptyLabel}</p>
    ) : null;
  }

  return (
    <div className={className}>
      <TreeRows
        nodes={tree}
        depth={0}
        collapsed={collapsed}
        onToggle={toggle}
        onSelect={(file) => (onSelect ? onSelect(file.path) : openInEditor(file.path))}
      />
    </div>
  );
}
