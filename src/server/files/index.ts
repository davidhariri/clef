import type { Permissions } from '../permissions/index.js';
import { Files } from './service.js';

export { registerFileRoutes } from './routes.js';
export type { FileInvocation, Files } from './service.js';

export function openFiles(home: string, workspace: string, permissions: Permissions): Files {
  return new Files(home, workspace, permissions);
}
