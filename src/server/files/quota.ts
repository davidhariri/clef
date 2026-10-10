import { lstatSync, opendirSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError } from '../platform/http.js';

const maximumWorkspaceBytes = 64 * 1024 * 1024;
const maximumWorkspaceEntries = 10000;

type Usage = {
  bytes: number;
  entries: number;
  directories: string[];
};

function countDirectory(path: string, usage: Usage): void {
  const directory = opendirSync(path, {
    bufferSize: 32,
  });
  try {
    for (;;) {
      const entry = directory.readSync();
      if (!entry) return;
      usage.entries++;
      const child = join(path, entry.name);
      const stat = lstatSync(child);
      if (stat.isDirectory()) usage.directories.push(child);
      if (stat.isFile()) usage.bytes += stat.size;
      if (usage.entries > maximumWorkspaceEntries || usage.bytes > maximumWorkspaceBytes)
        throw new HttpError(
          400,
          'Workspace quota exceeded: 64 MiB or 10000 entries. Remove files before adding more.',
        );
    }
  } finally {
    directory.closeSync();
  }
}

export function checkWorkspaceQuota(root: string, addedBytes: number, newEntry: boolean): void {
  const usage: Usage = {
    bytes: addedBytes,
    entries: newEntry ? 1 : 0,
    directories: [
      root,
    ],
  };
  for (;;) {
    const path = usage.directories.pop();
    if (!path) return;
    countDirectory(path, usage);
  }
}
