import { lstatSync, realpathSync, type Stats } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileOperation } from '../permissions/contract.js';
import { HttpError } from '../platform/http.js';

export function contains(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix === '' || (!suffix.startsWith('../') && suffix !== '..' && !isAbsolute(suffix));
}

function directoryIdentity(stat: Stats): string {
  return `${stat.dev}:${stat.ino}`;
}

export function fileVersion(stat: Stats | undefined): string {
  return stat ? `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` : 'absent';
}

export function validateFileTarget(operation: FileOperation, stat: Stats | undefined): void {
  if (operation === 'delete' && !stat?.isFile())
    throw new HttpError(400, 'Only individual ordinary files can be deleted.');
  if (operation === 'read' && !stat?.isFile())
    throw new HttpError(400, 'Select an existing ordinary file.');
  if (operation === 'list' && !stat?.isDirectory())
    throw new HttpError(400, 'Select an existing directory.');
  if (operation === 'write' && stat && !stat.isFile())
    throw new HttpError(400, 'Writes require an ordinary file path, not a directory.');
  if (operation === 'mkdir' && stat) throw new HttpError(400, 'The directory path already exists.');
}

export class FilePaths {
  readonly workspace: string;
  private readonly home: string;
  private readonly code: string;
  private readonly homeIdentity: string;
  private readonly workspaceIdentity: string;
  private readonly blockedIdentities: string[];

  constructor(home: string, workspace: string) {
    this.home = realpathSync.native(home);
    this.workspace = realpathSync.native(workspace);
    this.code = realpathSync.native(fileURLToPath(new URL('../../../', import.meta.url)));
    this.homeIdentity = directoryIdentity(lstatSync(this.home));
    this.workspaceIdentity = directoryIdentity(lstatSync(this.workspace));
    this.blockedIdentities = [
      this.code,
      '/dev',
      '/proc',
      '/sys',
    ].flatMap((path) => {
      const stat = this.stat(path);
      return stat?.isDirectory()
        ? [
            directoryIdentity(stat),
          ]
        : [];
    });
  }

  directory(input: string): string {
    let canonical: string;
    try {
      canonical = realpathSync.native(input);
    } catch {
      throw new HttpError(400, 'Directory not available. Check its path and OS permissions.');
    }
    const target = this.inspect(canonical);
    if (!target.stat?.isDirectory()) throw new HttpError(400, 'Select an existing directory.');
    return target.path;
  }

  private protect(path: string): void {
    if (
      (contains(this.home, path) && !contains(this.workspace, path)) ||
      contains(this.code, path) ||
      [
        '/dev',
        '/proc',
        '/sys',
      ].some((root) => contains(root, path))
    )
      throw new HttpError(
        403,
        'Clef private files, installed code, and virtual filesystems are not accessible.',
      );
  }

  private protectIdentities(ancestors: readonly string[]): void {
    const installation =
      ancestors.includes(this.homeIdentity) && !ancestors.includes(this.workspaceIdentity);
    if (installation || this.blockedIdentities.some((identity) => ancestors.includes(identity)))
      throw new HttpError(
        403,
        'Clef private files, installed code, and virtual filesystems are not accessible.',
      );
  }

  inspect(input: string) {
    if (input.split('/').includes('..'))
      throw new HttpError(400, 'Parent traversal is not allowed.');
    const path = resolve(this.workspace, input);
    this.protect(path);
    const { stat, ancestors } = this.walk(path);
    const canonical = stat
      ? realpathSync.native(path)
      : join(realpathSync.native(dirname(path)), basename(path));
    this.protect(canonical);
    this.protectIdentities(ancestors);
    if (stat && !stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))
      throw new HttpError(403, 'Only ordinary files with one link and directories are supported.');
    const parent = lstatSync(dirname(canonical));
    return {
      path: canonical,
      stat,
      version: fileVersion(stat),
      parentIdentity: directoryIdentity(parent),
      ancestors,
      inWorkspace: ancestors.includes(this.workspaceIdentity),
    };
  }

  private walk(path: string) {
    const root = parse(path).root;
    let current = root;
    let stat: Stats | undefined = lstatSync(root);
    const ancestors = [
      directoryIdentity(stat),
    ];
    for (const component of path.slice(root.length).split('/').filter(Boolean)) {
      current = join(current, component);
      stat = this.stat(current);
      if (stat?.isDirectory()) ancestors.push(directoryIdentity(stat));
      if (!stat && current !== path) throw new HttpError(400, 'The parent directory must exist.');
      if (stat?.isSymbolicLink())
        throw new HttpError(403, 'Symbolic links are not supported. Use the canonical path.');
      if (stat && current !== path && !stat.isDirectory())
        throw new HttpError(400, 'The parent must be a directory.');
    }
    return {
      stat,
      ancestors,
    };
  }

  private stat(path: string): Stats | undefined {
    try {
      return lstatSync(path);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
  }
}
