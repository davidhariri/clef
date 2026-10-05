import { isUtf8 } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  opendirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { HttpError } from '../platform/http.js';
import { fileVersion } from './paths.js';

export const maximumFileBytes = 65536;

export function readText(path: string, version: string, offset: number) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || fileVersion(stat) !== version)
      throw new HttpError(409, 'The file changed. Retry the read.');
    const buffer = Buffer.alloc(maximumFileBytes);
    const count = readSync(fd, buffer, 0, buffer.length, offset);
    if (fileVersion(fstatSync(fd)) !== version)
      throw new HttpError(409, 'The file changed during the read. Retry.');
    let bytes = buffer.subarray(0, count);
    if (!isUtf8(bytes)) {
      if (count < maximumFileBytes || offset + count >= stat.size)
        throw new HttpError(400, 'The file is not UTF-8 text at this offset.');
      let length = bytes.length;
      while (length > bytes.length - 3 && length > 0 && !isUtf8(bytes.subarray(0, length)))
        length--;
      bytes = bytes.subarray(0, length);
      if (!isUtf8(bytes) || bytes.length === 0)
        throw new HttpError(400, 'The file is not UTF-8 text at this offset.');
    }
    return {
      path,
      text: bytes.toString('utf8'),
      nextOffset: offset + bytes.length,
      more: offset + bytes.length < stat.size,
    };
  } finally {
    closeSync(fd);
  }
}

export function listDirectory(path: string) {
  const directory = opendirSync(path, {
    bufferSize: 32,
  });
  const entries: {
    name: string;
    kind: string;
  }[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const entry = directory.readSync();
      if (!entry)
        return {
          path,
          entries,
          more: false,
        };
      const item = {
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'unsupported',
      };
      bytes += Buffer.byteLength(JSON.stringify(item));
      if (entries.length === 200 || bytes > maximumFileBytes)
        return {
          path,
          entries,
          more: true,
        };
      entries.push(item);
    }
  } finally {
    directory.closeSync();
  }
}

export function syncParent(path: string): void {
  const directory = openSync(dirname(path), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

export function writeText(path: string, content: string) {
  if (Buffer.byteLength(content) > maximumFileBytes)
    throw new HttpError(400, 'Writes are limited to 64 KiB.');
  const temporary = join(dirname(path), `.clef-${randomUUID()}.tmp`);
  const fd = openSync(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
    renameSync(temporary, path);
    syncParent(path);
  } finally {
    closeSync(fd);
    rmSync(temporary, {
      force: true,
    });
  }
  return {
    path,
    writtenBytes: Buffer.byteLength(content),
  };
}
