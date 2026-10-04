import { spawn } from 'node:child_process';
import { stripTerminalSequences } from '@earendil-works/pi-tui';
import { expect, test } from '../../tests/browser.js';

test('terminal signs in without echoing the password and shares web conversations', async ({
  page,
  clef,
}) => {
  await clef.setup();
  const terminal = spawn(
    'python3',
    [
      'tests/terminal_driver.py',
      process.execPath,
      '--import',
      'tsx',
      'src/cli.ts',
    ],
    {
      env: {
        ...process.env,
        CLEF_URL: clef.url,
        TERM: 'xterm-256color',
      },
    },
  );
  let output = '';
  terminal.stdout.on('data', (data: Buffer) => {
    output += data.toString();
  });
  terminal.stderr.on('data', (data: Buffer) => {
    output += data.toString();
  });
  const exited = new Promise<void>((resolve) => terminal.once('exit', () => resolve()));
  try {
    await expect.poll(() => stripTerminalSequences(output)).toContain('Username:');
    terminal.stdin.write('david\r');
    await expect.poll(() => stripTerminalSequences(output)).toContain('Password:');
    terminal.stdin.write('a long test password\r');
    await expect.poll(() => stripTerminalSequences(output)).toContain('Message Clef');
    terminal.stdin.write('Hello from the terminal\r');
    await expect
      .poll(() => stripTerminalSequences(output))
      .toContain('Clef heard: Hello from the terminal');
    expect(output).not.toContain('a long test password');
    await page.goto(clef.url);
    await expect(
      page.getByRole('article', {
        name: 'Clef reply',
      }),
    ).toContainText('Hello from the terminal');
  } finally {
    terminal.stdin.write('\u0003');
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          terminal.kill('SIGTERM');
          resolve();
        }, 3000);
        timeout.unref();
      }),
    ]);
  }
});
