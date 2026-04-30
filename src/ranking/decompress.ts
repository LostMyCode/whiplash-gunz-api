import fs from 'node:fs';
import type { Readable } from 'node:stream';
import { Decompress } from 'fzstd';

export async function decompressZstdStreamToFile(
  inputStream: Readable | AsyncIterable<Uint8Array>,
  outputPath: string,
): Promise<void> {
  const fd = fs.openSync(outputPath, 'w');

  try {
    const decompressor = new Decompress((chunk: Uint8Array) => {
      fs.writeSync(fd, chunk);
    });

    for await (const chunk of inputStream) {
      decompressor.push(chunk, false);
    }

    decompressor.push(new Uint8Array(0), true);
  } finally {
    fs.closeSync(fd);
  }
}
