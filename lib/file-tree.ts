// Pure, framework-free builder that turns a flat list of repo-relative file paths into a nested
// directory tree. Shared by every surface that displays files as a tree — the Files-canvas
// "edited this session" panel, the /plan footprint, and the session recap — so the visual
// <FileTree> component never has to know where the paths came from. Deterministic and
// unit-testable: no React, no Date, no filesystem.

export type FileStatus = "added" | "modified" | "deleted";

// One file the caller wants placed in the tree. `status` drives the change color/badge and
// `meta` is a short right-aligned label (e.g. "5×" edit count or "+12 −3" diff stat).
export interface FileLeafInput {
  path: string;
  status?: FileStatus;
  meta?: string;
}

export interface TreeFile {
  kind: "file";
  name: string;
  path: string;
  status?: FileStatus;
  meta?: string;
}

export interface TreeFolder {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}

export type TreeNode = TreeFile | TreeFolder;

export interface BuildOptions {
  // VS Code style: a folder whose only child is another folder is merged into it
  // ("src" + "lib" → "src/lib"), so deep single-use chains don't waste vertical space.
  collapseSingleChildFolders?: boolean;
}

// Internal mutable shape while building; converted to the public TreeNode at the end.
interface FolderBuilder {
  name: string;
  path: string;
  folders: Map<string, FolderBuilder>;
  files: Map<string, TreeFile>;
}

function emptyFolder(name: string, path: string): FolderBuilder {
  return { name, path, folders: new Map(), files: new Map() };
}

// folders before files, then case-insensitive alpha within each group.
function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function finalize(folder: FolderBuilder, collapse: boolean): TreeNode[] {
  const out: TreeNode[] = [];
  for (const sub of folder.folders.values()) out.push(collapseFolder(sub, collapse));
  for (const file of folder.files.values()) out.push(file);
  return out.sort(compareNodes);
}

function collapseFolder(folder: FolderBuilder, collapse: boolean): TreeFolder {
  let name = folder.name;
  let cur = folder;
  // Merge straight chains of single folder-only children into one node.
  while (collapse && cur.files.size === 0 && cur.folders.size === 1) {
    const only = cur.folders.values().next().value as FolderBuilder;
    name = `${name}/${only.name}`;
    cur = only;
  }
  return { kind: "folder", name, path: cur.path, children: finalize(cur, collapse) };
}

export function buildFileTree(inputs: FileLeafInput[], opts: BuildOptions = {}): TreeNode[] {
  const collapse = opts.collapseSingleChildFolders ?? true;
  const root = emptyFolder("", "");

  for (const input of inputs) {
    const normalized = input.path.split("\\").join("/").trim().replace(/^\/+/, "").replace(/\/+$/, "");
    if (!normalized) continue;
    const segments = normalized.split("/").filter(Boolean);
    if (!segments.length) continue;

    let folder = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      const path = folder.path ? `${folder.path}/${seg}` : seg;
      let next = folder.folders.get(seg);
      if (!next) {
        next = emptyFolder(seg, path);
        folder.folders.set(seg, next);
      }
      folder = next;
    }

    const fileName = segments[segments.length - 1];
    // Last entry wins on a duplicate path (matches the touched-files merge semantics).
    folder.files.set(fileName, {
      kind: "file",
      name: fileName,
      path: normalized,
      status: input.status,
      meta: input.meta,
    });
  }

  return finalize(root, collapse);
}
