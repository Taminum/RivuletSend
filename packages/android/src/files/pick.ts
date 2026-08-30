import DocumentPicker, {isCancel} from 'react-native-document-picker';

export interface PickedFile {
  // A real file:// path we can positionally read (document-picker copies the SAF
  // content into the app cache, which RNFS can read; content:// URIs it can't).
  path: string;
  name: string;
  size: number;
  mimeType: string;
}

// Let the user pick one file to send. Returns null if they cancel.
export async function pickFileToSend(): Promise<PickedFile | null> {
  try {
    const [res] = await DocumentPicker.pick({copyTo: 'cachesDirectory'});
    const uri = res.fileCopyUri ?? res.uri;
    return {
      path: uri.replace(/^file:\/\//, ''),
      name: res.name ?? 'file',
      size: res.size ?? 0,
      mimeType: res.type ?? 'application/octet-stream',
    };
  } catch (e) {
    if (isCancel(e)) return null;
    throw e;
  }
}
