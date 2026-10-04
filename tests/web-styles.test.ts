import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'postcss';
import { expect, it } from 'vitest';

function styleViolations(path: string, source: string) {
  const violations: string[] = [];
  const palette = path === 'theme.css';
  const bootstrap = path === 'globals.css';
  const scoped = path.endsWith('.module.css');
  if (!palette && !bootstrap && !scoped)
    return [
      'unscoped stylesheet',
    ];

  const root = parse(source);
  root.walkRules((rule) => {
    if (palette && rule.selector !== ':root') violations.push('theme selector');
    if (
      bootstrap &&
      ![
        '*',
        'body',
      ].includes(rule.selector)
    )
      violations.push('global selector');
    if (scoped && rule.selector.includes(':global')) violations.push('global escape');
  });
  if (palette)
    root.walkDecls((declaration) => {
      if (!declaration.prop.startsWith('--') && declaration.prop !== 'color-scheme')
        violations.push('theme declaration');
    });

  return violations;
}

it.each([
  [
    'messages/styles.css',
    '.message { display: flex }',
    'unscoped stylesheet',
  ],
  [
    'globals.css',
    '.message { display: flex }',
    'global selector',
  ],
  [
    'globals.css',
    '@media (width < 40rem) { body .chat { display: flex } }',
    'global selector',
  ],
  [
    'theme.css',
    '.chat { --background: white }',
    'theme selector',
  ],
  [
    'theme.css',
    ':root { padding: 2rem }',
    'theme declaration',
  ],
  [
    'messages/chat.module.css',
    ':global(.chat) { display: flex }',
    'global escape',
  ],
])('rejects misplaced styles in %s', (path, source, violation) => {
  expect(styleViolations(path, source)).toContain(violation);
});

it('allows local component styles and a system palette', () => {
  expect(
    styleViolations('messages/chat.module.css', '.content { color: var(--foreground) }'),
  ).toEqual([]);
  expect(
    styleViolations(
      'theme.css',
      '@media (prefers-color-scheme: dark) { :root { --background: black; color-scheme: dark } }',
    ),
  ).toEqual([]);
});

it('keeps global CSS in the palette and bootstrap, with other styles next to their component', async () => {
  const paths = (
    await readdir('src/web', {
      recursive: true,
    })
  ).filter((path) => path.endsWith('.css'));

  for (const path of paths) {
    expect(styleViolations(path, await readFile(join('src/web', path), 'utf8')), path).toEqual([]);
    if (path.endsWith('.module.css'))
      await access(join('src/web', path.replace('.module.css', '.tsx')));
  }
});
