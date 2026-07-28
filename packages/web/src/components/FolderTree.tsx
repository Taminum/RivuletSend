import { useState } from "react";
import { FileIcon, FolderIcon } from "../icons";
import { formatBytes } from "../format";
import type { FolderTransfer } from "../transfers";

// Read-only nested view of a folder transfer's manifest. The file list arrives
// up front (before any bytes), so the whole structure renders immediately;
// per-file status comes from filesDone since the sender streams in manifest
// order (index < filesDone == that file is already done). No selection here —
// selective per-file fetch is a separate protocol change, out of scope.

interface Node {
  name: string;
  size: number; // file: own size
  index?: number; // file: manifest order index
  children: Map<string, Node>;
}

function buildTree(entries: { relativePath: string; size: number }[], folderName: string): Node {
  const root: Node = { name: folderName, size: 0, children: new Map() };
  entries.forEach((e, index) => {
    let segs = e.relativePath.split("/").filter(Boolean);
    if (segs.length > 1 && segs[0] === folderName) segs = segs.slice(1); // drop the root folder name
    let node = root;
    segs.forEach((seg, i) => {
      let child = node.children.get(seg);
      if (!child) {
        child = { name: seg, size: 0, children: new Map() };
        node.children.set(seg, child);
      }
      if (i === segs.length - 1) {
        child.size = e.size;
        child.index = index;
      }
      node = child;
    });
  });
  return root;
}

function sortNodes(a: Node, b: Node): number {
  const aDir = a.children.size > 0;
  const bDir = b.children.size > 0;
  if (aDir !== bDir) return aDir ? -1 : 1; // directories first
  return a.name.localeCompare(b.name);
}

function fileStatus(index: number | undefined, filesDone: number): "done" | "active" | "pending" | null {
  if (index == null) return null;
  if (index < filesDone) return "done";
  if (index === filesDone) return "active";
  return "pending";
}

function Dir({ node, depth, filesDone }: { node: Node; depth: number; filesDone: number }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <div
        className="ft-row ft-dir"
        style={{ paddingLeft: depth * 16 + 4 }}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`ft-chevron ${open ? "open" : ""}`}>▸</span>
        <FolderIcon size={14} className="file-icon" />
        <span className="ft-name">{node.name}</span>
      </div>
      {open && <Level node={node} depth={depth + 1} filesDone={filesDone} />}
    </>
  );
}

function FileRow({ node, depth, filesDone }: { node: Node; depth: number; filesDone: number }) {
  const st = fileStatus(node.index, filesDone);
  return (
    <div className={`ft-row ft-file ${st ?? ""}`} style={{ paddingLeft: depth * 16 + 22 }}>
      <FileIcon size={13} className="file-icon" />
      <span className="ft-name">{node.name}</span>
      <span className="ft-size">{formatBytes(node.size)}</span>
      {st === "done" && <span className="ft-status ok">✓</span>}
      {st === "active" && <span className="ft-status active">•</span>}
    </div>
  );
}

function Level({ node, depth, filesDone }: { node: Node; depth: number; filesDone: number }) {
  const children = [...node.children.values()].sort(sortNodes);
  return (
    <>
      {children.map((c) =>
        c.children.size > 0 ? (
          <Dir key={c.name} node={c} depth={depth} filesDone={filesDone} />
        ) : (
          <FileRow key={c.name} node={c} depth={depth} filesDone={filesDone} />
        ),
      )}
    </>
  );
}

export function FolderTree({ folder }: { folder: FolderTransfer }) {
  if (!folder.entries?.length) return null;
  const root = buildTree(folder.entries, folder.folderName);
  return (
    <div className="ft-tree">
      <Level node={root} depth={0} filesDone={folder.filesDone} />
    </div>
  );
}
