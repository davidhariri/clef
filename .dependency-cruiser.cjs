const { readdirSync } = require('node:fs');

const modules = readdirSync('src/server', {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory() && entry.name !== 'platform')
  .map((entry) => entry.name);
const webFeatures = readdirSync('src/web', {
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
    ...webFeatures.map((name) => ({
      name: `web-${name}-private-implementation`,
      severity: 'error',
      from: {
        pathNot: `^src/web/${name}/`,
      },
      to: {
        path: `^src/web/${name}/`,
        pathNot: `^src/web/${name}/index\\.tsx?$`,
      },
    })),
    {
      name: 'web-components-have-no-app-dependencies',
      severity: 'error',
      from: {
        path: '^src/web/components/',
      },
      to: {
        path: '^src/',
        pathNot: '^src/web/components/',
      },
    },
    {
      name: 'web-platform-has-no-features',
      severity: 'error',
      from: {
        path: '^src/web/platform/',
      },
      to: {
        path: '^src/web/',
        pathNot: '^src/web/platform/',
      },
    },
    {
      name: 'clients-only-import-contracts',
      severity: 'error',
      from: {
        path: '^src/(web|client)/',
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
        path: '^src/(web|client)/',
      },
      to: {
        path: 'node_modules/@earendil-works/pi-(durable|ai|codemode)',
      },
    },
    {
      name: 'contracts-are-browser-safe',
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
        path: '^src/(server|web|client)/',
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
        path: `${tests}|^tests/|node_modules/(vitest|@playwright/test)`,
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
