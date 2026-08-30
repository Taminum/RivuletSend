import DocumentPicker, {isCancel} from 'react-native-document-picker';

export interface PickedFile {
  // A real file:// path we can positionally read (document-picker copies the SAF
  // content into the app cache, which RNFS can read; content:// URIs it can't).
  path: string;
  name: string;
  size: number;
  mimeType: string;
}

// Let the user pick one or more files to send. Returns [] if they cancel.
export async function pickFilesToSend(): Promise<PickedFile[]> {
  try {
    const results = await DocumentPicker.pick({
      allowMultiSelection: true,
      copyTo: 'cachesDirectory',
    });
    return results.map(res => {
      const uri = res.fileCopyUri ?? res.uri;
      return {
        path: uri.replace(/^file:\/\//, ''),
        name: res.name ?? 'file',
        size: res.size ?? 0,
        mimeType: res.type ?? 'application/octet-stream',
      };
    });
  } catch (e) {
    if (isCancel(e)) return [];
    throw e;
  }
}
