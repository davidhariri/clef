import type { Database } from '../platform/database.js';
import { type PermissionRule, permissionRuleSchema } from './contract.js';

export class PermissionRepository {
  constructor(private readonly database: Database) {}
  async initialize(): Promise<void> {
    await this.database.exec(
      'CREATE TABLE IF NOT EXISTS clef_permissions (origin TEXT NOT NULL, method TEXT NOT NULL, decision TEXT NOT NULL, PRIMARY KEY(origin, method))',
    );
  }
  async rules(): Promise<PermissionRule[]> {
    return permissionRuleSchema
      .array()
      .parse(
        await this.database.all(
          'SELECT origin, method, decision FROM clef_permissions ORDER BY origin',
        ),
      );
  }
  async save(rule: PermissionRule): Promise<void> {
    await this.database.run(
      'INSERT INTO clef_permissions(origin, method, decision) VALUES (?, ?, ?) ON CONFLICT(origin, method) DO UPDATE SET decision = excluded.decision',
      rule.origin,
      rule.method,
      rule.decision,
    );
  }
  async remove(origin: string): Promise<void> {
    await this.database.run(
      'DELETE FROM clef_permissions WHERE origin = ? AND method = ?',
      origin,
      'GET',
    );
  }
}
