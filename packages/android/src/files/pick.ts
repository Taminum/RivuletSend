import DocumentPicker, {isCancel, types} from 'react-native-document-picker';

export interface PickedFile {
  // A real file:// path we can positionally read (document-picker copies the SAF
  // content into the app cache, which blob-util can read; content:// URIs it can't).
  path: string;
  name: string;
  size: number;
  mimeType: string;
}

// Turn a file:// URI into a plain filesystem path. The copied-file URI is
// percent-encoded (spaces → %20, cyrillic → %D0…), so it must be decoded or the
// on-disk read fails for any file whose name isn't pure ASCII-without-spaces.
function uriToPath(uri: string): string {
  const stripped = uri.replace(/^file:\/\//, '');
  try {
    return decodeURIComponent(stripped);
  } catch {
    return stripped;
  }
}

// Let the user pick one or more files to send. Returns [] if they cancel.
// `allFiles` so the system picker offers everything (not just media); the user
// can still reach internal storage via the picker's ☰ menu (see below).
export async function pickFilesToSend(): Promise<PickedFile[]> {
  try {
    const results = await DocumentPicker.pick({
      allowMultiSelection: true,
      type: [types.allFiles],
      copyTo: 'cachesDirectory',
    });
    return results.map(res => ({
      path: uriToPath(res.fileCopyUri ?? res.uri),
      name: res.name ?? 'file',
      size: res.size ?? 0,
      mimeType: res.type ?? 'application/octet-stream',
    }));
  } catch (e) {
    if (isCancel(e)) return [];
    throw e;
  }
}
