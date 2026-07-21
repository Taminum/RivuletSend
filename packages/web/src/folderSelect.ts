import type { FolderEntry } from "./fileTransfer";

export interface FolderSelection {
  folderName: string;
  entries: FolderEntry[];
}

// From a <input webkitdirectory> selection: each File carries webkitRelativePath
// like "photos/2024/beach.jpg".
export function selectionFromInputFiles(files: FileList | File[]): FolderSelection {
  const arr = Array.from(files);
  const entries: FolderEntry[] = arr.map((f) => ({
    relativePath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    file: f,
  }));
  const folderName = entries[0]?.relativePath.split("/")[0] || "folder";
  return { folderName, entries };
}

// From a drop: a plain `drop` event flattens folders, so we must walk the
// webkitGetAsEntry() tree recursively. Returns null if no directory was dropped
// (so the caller can treat it as a flat file drop).
export async function selectionFromDrop(dataTransfer: DataTransfer): Promise<FolderSelection | null> {
  const rootEntries = Array.from(dataTransfer.items)
    .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);

  if (!rootEntries.some((e) => e.isDirectory)) return null;

  const entries: FolderEntry[] = [];
  let folderName = "folder";
  for (const entry of rootEntries) {
    if (entry.isDirectory) {
      folderName = entry.name;
      await walkDirectory(entry as FileSystemDirectoryEntry, entry.name, entries);
    } else if (entry.isFile) {
      const file = await fileFromEntry(entry as FileSystemFileEntry);
      entries.push({ relativePath: file.name, file });
    }
  }
  return { folderName, entries };
}

async function walkDirectory(
  dir: FileSystemDirectoryEntry,
  prefix: string,
  out: FolderEntry[],
): Promise<void> {
  const children = await readAllEntries(dir.createReader());
  for (const child of children) {
    const childPath = `${prefix}/${child.name}`;
    if (child.isDirectory) {
      await walkDirectory(child as FileSystemDirectoryEntry, childPath, out);
    } else if (child.isFile) {
      const file = await fileFromEntry(child as FileSystemFileEntry);
      out.push({ relativePath: childPath, file });
    }
  }
  // Empty subfolders yield no children, so they are simply skipped.
}

// readEntries returns at most ~100 entries per call — keep calling until empty.
function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          readBatch();
        }
      }, reject);
    };
    readBatch();
  });
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}
