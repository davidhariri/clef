import { realpathSync, statSync } from 'node:fs';
import { HttpError } from '../platform/http.js';
import type { DirectoryRule, FileAccess, FileOperation } from './contract.js';

type ResolvedRule = DirectoryRule & {
  identity?: string;
};

export function resolveDirectoryRule(rule: DirectoryRule): ResolvedRule {
  try {
    const path = realpathSync.native(rule.path);
    const stat = statSync(path);
    if (!stat.isDirectory())
      throw new HttpError(
        409,
        'File access rules must name directories. Repair the file settings.',
      );
    if (path === '/' && rule.access === 'read-write')
      throw new HttpError(403, 'Only Settings can enable global read/write access.');
    return {
      ...rule,
      path,
      identity: `${stat.dev}:${stat.ino}`,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return rule;
    throw new HttpError(
      403,
      'Cannot resolve directory permissions. Check settings and OS permissions.',
    );
  }
}

export function resolveDirectoryRules(rules: readonly DirectoryRule[]): ResolvedRule[] {
  const directories = rules.map(resolveDirectoryRule);
  if (new Set(directories.map((rule) => rule.identity ?? rule.path)).size !== directories.length)
    throw new HttpError(
      409,
      'Directory rules resolve to the same directory. Repair the file settings.',
    );
  return directories;
}

export function fileDecision(
  policy: FileAccess,
  path: string,
  operation: FileOperation,
  ancestors: readonly string[],
): 'allow' | 'ask' | 'deny' {
  const directories = resolveDirectoryRules(policy.directories);
  const matches = directories.map((rule) => ({
    rule,
    depth: rule.identity
      ? ancestors.lastIndexOf(rule.identity)
      : rule.path === path && (rule.access === 'deny' || operation === 'mkdir')
        ? ancestors.length
        : -1,
  }));
  const rule = matches
    .filter((match) => match.depth >= 0)
    .sort((a, b) => b.depth - a.depth)[0]?.rule;
  if (rule?.access === 'deny') return 'deny';
  const access = rule?.access ?? (policy.global ? 'read-write' : undefined);
  if (!access) return 'ask';
  if (operation === 'read' || operation === 'list' || access === 'read-write') return 'allow';
  return 'ask';
}
