import ReactNativeBlobUtil from 'react-native-blob-util';

const fs = ReactNativeBlobUtil.fs;

// Received files are streamed to a private temp file first (always writable),
// then published into the public Downloads collection via MediaStore on finish —
// the only way to land in Downloads under Android 10+ scoped storage without a
// storage permission. If publishing fails, the temp file stays and its path is
// returned so the caller can still offer it via the share sheet.

export interface ReceiveSink {
  tempPath: string;
  appendBase64(b64: string): Promise<void>;
  // Publish to Downloads; returns a user-facing location (content URI or path).
  finish(name: string, mimeType: string): Promise<string>;
  discard(): Promise<void>;
}

export async function createReceiveSink(id: string): Promise<ReceiveSink> {
  const tempPath = `${fs.dirs.CacheDir}/recv-${id}`;
  // Start clean — a stale temp from a previous failed run would corrupt output.
  if (await fs.exists(tempPath)) await fs.unlink(tempPath);
  await fs.writeFile(tempPath, '', 'base64');

  return {
    tempPath,
    async appendBase64(b64: string) {
      await fs.appendFile(tempPath, b64, 'base64');
    },
    async finish(name: string, mimeType: string) {
      try {
        const uri = await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
          {name, parentFolder: '', mimeType: mimeType || 'application/octet-stream'},
          'Download',
          tempPath,
        );
        await fs.unlink(tempPath).catch(() => {});
        return uri;
      } catch {
        // Couldn't publish — keep the temp copy so the file isn't lost.
        return tempPath;
      }
    },
    async discard() {
      await fs.unlink(tempPath).catch(() => {});
    },
  };
}
