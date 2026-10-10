const { readdirSync } = require('node:fs');

const modules = readdirSync('src/server', {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory() && entry.name !== 'platform')
  .map((entry) => entry.name);
const tuiFeatures = readdirSync('src/tui', {
  withFileTypes: true,
})
  .filter(
    (entry) =>
      entry.isDirectory() &&
      ![
        'components',
        'platform',
      ].includes(entry.name),
  )
  .map((entry) => entry.name);
const tests = '\\.(test|e2e\\.spec)\\.ts$';

module.exports = {
  forbidden: [
    {
      name: 'no-cycles',
      severity: 'error',
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: 'no-unresolved-imports',
      severity: 'error',
      from: {},
      to: {
        couldNotResolve: true,
      },
    },
    {
      name: 'no-undeclared-packages',
      severity: 'error',
      from: {},
      to: {
        dependencyTypes: [
          'npm-no-pkg',
        ],
      },
    },
    ...modules.map((name) => ({
      name: `${name}-private-implementation`,
      severity: 'error',
      from: {
        pathNot: `^src/server/${name}/`,
      },
      to: {
        path: `^src/server/${name}/`,
        pathNot: `^src/server/${name}/(index|contract)\\.ts$`,
      },
    })),
    ...tuiFeatures.map((name) => ({
      name: `tui-${name}-private-implementation`,
      severity: 'error',
      from: {
        pathNot: `^src/tui/${name}/`,
      },
      to: {
        path: `^src/tui/${name}/`,
        pathNot: `^src/tui/${name}/index\\.ts$`,
      },
    })),
    {
      name: 'tui-components-have-no-app-dependencies',
      severity: 'error',
      from: {
        path: '^src/tui/components/',
      },
      to: {
        path: '^src/',
        pathNot: '^src/tui/components/',
      },
    },
    {
      name: 'tui-platform-has-no-features',
      severity: 'error',
      from: {
        path: '^src/tui/platform/',
      },
      to: {
        path: '^src/tui/',
        pathNot: '^src/tui/platform/',
      },
    },
    {
      name: 'clients-only-import-contracts',
      severity: 'error',
      from: {
        path: '^src/(tui|client)/',
      },
      to: {
        path: '^src/server/',
        pathNot: '^src/server/[^/]+/contract\\.ts$',
      },
    },
    {
      name: 'clients-never-import-the-harness',
      severity: 'error',
      from: {
        path: '^src/(tui|client)/',
      },
      to: {
        path: 'node_modules/@earendil-works/pi-(durable|ai|codemode)',
      },
    },
    {
      name: 'server-has-no-clients',
      severity: 'error',
      from: {
        path: '^src/server/',
      },
      to: {
        path: '^src/(tui|client)/|node_modules/@earendil-works/pi-tui',
      },
    },
    {
      name: 'contracts-are-client-safe',
      severity: 'error',
      from: {
        path: '^src/server/[^/]+/contract\\.ts$',
      },
      to: {
        path: '^src/',
        pathNot: '^src/server/[^/]+/contract\\.ts$',
      },
    },
    {
      name: 'contracts-have-no-server-packages',
      severity: 'error',
      from: {
        path: '^src/server/[^/]+/contract\\.ts$',
      },
      to: {
        path: 'node_modules/',
        pathNot: 'node_modules/zod/',
      },
    },
    {
      name: 'contracts-have-no-node-runtime',
      severity: 'error',
      from: {
        path: '^src/server/[^/]+/contract\\.ts$',
      },
      to: {
        dependencyTypes: [
          'core',
        ],
      },
    },
    {
      name: 'platform-has-no-features',
      severity: 'error',
      from: {
        path: '^src/server/platform/',
      },
      to: {
        path: '^src/(server|tui|client)/',
        pathNot: '^src/server/platform/',
      },
    },
    {
      name: 'features-do-not-import-the-composition-root',
      severity: 'error',
      from: {
        path: '^src/server/[^/]+/',
      },
      to: {
        path: '^src/server/(app|main)\\.ts$',
      },
    },
    {
      name: 'database-access-stays-in-repositories',
      severity: 'error',
      from: {
        path: '^src/server/',
        pathNot: `^src/server/(app|main)\\.ts$|/(index|repository)\\.ts$|^src/server/platform/|${tests}`,
      },
      to: {
        path: '^src/server/platform/database\\.ts$',
      },
    },
    {
      name: 'sqlite-driver-has-one-owner',
      severity: 'error',
      from: {
        path: '^src/',
        pathNot: `^src/server/platform/database\\.ts$|${tests}`,
      },
      to: {
        path: '^(node:)?sqlite$|node_modules/@earendil-works/pi-durable/dist/storage/sqlite/node\\.js$',
      },
    },
    {
      name: 'no-host-code-execution',
      severity: 'error',
      from: {
        path: '^src/',
        pathNot: tests,
      },
      to: {
        path: '^(node:)?vm$',
      },
    },
    {
      name: 'no-host-process-execution',
      severity: 'error',
      from: {
        path: '^src/',
        pathNot: `^src/server/lifecycle/supervisor\\.ts$|${tests}`,
      },
      to: {
        path: '^(node:)?child_process$',
      },
    },
    {
      name: 'no-production-test-dependencies',
      severity: 'error',
      from: {
        path: '^src/',
        pathNot: tests,
      },
      to: {
        path: `${tests}|^tests/|node_modules/(vitest|@playwright/test|@xterm/headless)`,
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: [
        'exports',
      ],
      conditionNames: [
        'import',
        'node',
        'default',
      ],
    },
  },
};
