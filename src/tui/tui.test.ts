import { once } from 'node:events';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { testApplication } from '../../tests/installation.js';
import { TestTerminal } from '../../tests/terminal.js';
import { ClefClient } from '../client/index.js';
import { okSchema } from '../server/access/contract.js';
import { fileAccessViewSchema } from '../server/files/contract.js';
import { snapshotSchema } from '../server/messages/contract.js';
import { runTui } from './index.js';

async function testChat(connect = true) {
  const app = await testApplication({
    connect,
  });
  const terminal = new TestTerminal();
  const abort = new AbortController();
  const url = await app.server.listen({
    host: '127.0.0.1',
    port: 0,
  });
  const client = new ClefClient(url, app.localToken);
  const running = runTui(client, terminal, abort.signal);
  return {
    app,
    terminal,
    client,
    async close() {
      abort.abort();
      await running;
      await app.dispose();
    },
  };
}

it('manages directory rules and requires explicit confirmation for global file access', async () => {
  const chat = await testChat();
  const { terminal, client } = chat;
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'clef-tui-files-')));
  const access = () => client.request('/api/files/access', fileAccessViewSchema);
  try {
    await expect.poll(() => terminal.text()).toContain('Ready');
    terminal.type('/settings');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Default model');
    terminal.type('File access');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Add directory');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Directory path');
    terminal.type(directory);
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Directory access');
    terminal.input('\r');
    await expect
      .poll(async () => (await access()).policy.directories)
      .toContainEqual({
        path: directory,
        access: 'read',
      });
    await expect.poll(() => terminal.text()).toContain('Add directory');
    terminal.type(directory);
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Remove rule');
    terminal.type('No access');
    terminal.input('\r');
    await expect
      .poll(async () => (await access()).policy.directories)
      .toContainEqual({
        path: directory,
        access: 'deny',
      });
    await expect.poll(() => terminal.text()).toContain('Add directory');
    terminal.type(directory);
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Remove rule');
    terminal.type('Remove rule');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Remove directory rule?');
    terminal.input('\u001b[B');
    terminal.input(' ');
    await expect
      .poll(async () => (await access()).policy.directories.some((rule) => rule.path === directory))
      .toBe(false);
    await expect.poll(() => terminal.text()).toContain('Add directory');
    terminal.type('Enable global access');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Enable global host file access?');
    expect((await access()).policy.global).toBe(false);
    terminal.input('\u001b');
    await expect.poll(() => terminal.text()).toContain('Add directory');
    expect((await access()).policy.global).toBe(false);
    terminal.type('Enable global access');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Enable global host file access?');
    terminal.input('\u001b[B');
    terminal.input(' ');
    await expect.poll(async () => (await access()).policy.global).toBe(true);
    await expect.poll(() => terminal.text()).toContain('Disable global access');
    terminal.type('Disable global access');
    terminal.input('\r');
    await expect.poll(async () => (await access()).policy.global).toBe(false);
  } finally {
    await chat.close();
    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
});

it('shows file scopes and offers only Deny or This time for deletion', async () => {
  const chat = await testChat();
  const { terminal, client } = chat;
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'clef-tui-approval-')));
  const path = join(directory, 'note.txt');
  await writeFile(path, 'Private note');
  try {
    await expect.poll(() => terminal.text()).toContain('Ready');
    terminal.type(
      `file ${JSON.stringify({
        operation: 'read',
        path,
      })}`,
    );
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Always saves this directory access');
    expect(terminal.text()).toContain(directory);
    expect(terminal.text()).toContain('Read only');
    terminal.input('\u001b[B');
    terminal.input('\u001b[B');
    terminal.input('\r');
    await expect
      .poll(async () => (await client.request('/api/conversation', snapshotSchema)).busy)
      .toBe(false);
    await expect.poll(() => terminal.text()).toContain('Private note');
    terminal.type(
      `file ${JSON.stringify({
        operation: 'delete',
        path,
      })}`,
    );
    terminal.input('\r');
    await expect.poll(() => terminal.visibleLines().join('\n')).toContain('Delete this file?');
    expect(
      terminal.visibleLines().some((line) => line.trim() === 'Always' || line.trim() === 'Never'),
    ).toBe(false);
    expect(terminal.visibleLines().join('\n')).toContain('Deletion cannot be undone');
    terminal.input('\u001b[B');
    terminal.input('\r');
    await expect
      .poll(async () => (await client.request('/api/conversation', snapshotSchema)).busy)
      .toBe(false);
    await expect(readFile(path)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    await chat.close();
    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
});

it('animates six-dot working frames in the composer border and shows the Clef symbol in the header', async () => {
  const chat = await testChat();
  const { terminal } = chat;
  const working = () =>
    terminal.visibleLines().find((line) => /[\u2801-\u283f] Working/.test(line));
  try {
    await expect.poll(() => terminal.text()).toContain('Ready');
    terminal.type('slow reply');
    terminal.input('\r');
    await expect.poll(working).toMatch(/^── [\u2801-\u283f] Working ─/);
    const frame = working();
    await expect.poll(working).not.toBe(frame);
    expect(terminal.visibleLines()[terminal.rows - 5]).toMatch(/Working/);
    expect(terminal.text()).toContain('⌬ Clef ·');
    terminal.resize(24, 18);
    await expect.poll(working).toContain('Working');
    terminal.input('\u001b');
    await expect.poll(working).toBeUndefined();
    await expect.poll(() => terminal.text()).toContain('Ready');
  } finally {
    await chat.close();
  }
});

it('fills user messages across the pane, omits speaker names, and puts model settings in the header', async () => {
  const chat = await testChat();
  const { terminal } = chat;
  try {
    await expect.poll(() => terminal.text()).toContain('Ready');
    const header = terminal.visibleLines().find((line) => line.includes('⌬ Clef ·'));
    expect(header).toContain('test-model · off');
    expect(terminal.visibleLines().slice(-2).join('\n')).not.toContain('test-model');
    terminal.type('A **bold** note.');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Clef heard: A bold note.');
    const lines = terminal.visibleLines();
    expect(
      lines.some((line) =>
        [
          'You',
          'Clef',
          '⌬ Clef',
        ].includes(line.trim()),
      ),
    ).toBe(false);
    const userRow = lines.findIndex((line) => line.trim() === 'A bold note.');
    const replyRow = lines.findIndex((line) => line.includes('Clef heard: A bold note.'));
    const buffer = terminal.screen.buffer.active;
    for (let column = 0; column < terminal.columns; column++) {
      expect(
        buffer
          .getLine(buffer.viewportY + userRow)
          ?.getCell(column)
          ?.getBgColor(),
      ).toBe(8);
      expect(
        buffer
          .getLine(buffer.viewportY + replyRow)
          ?.getCell(column)
          ?.isBgDefault(),
      ).toBe(true);
    }
  } finally {
    await chat.close();
  }
});

it('does not show working animation while the agent waits for approval', async () => {
  const chat = await testChat();
  const { terminal } = chat;
  try {
    await expect.poll(() => terminal.text()).toContain('Ready');
    terminal.type('configure second model');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Approval required');
    expect(terminal.visibleLines().some((line) => /[\u2801-\u283f] Working/.test(line))).toBe(
      false,
    );
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Ready');
    expect(terminal.visibleLines().some((line) => /[\u2801-\u283f] Working/.test(line))).toBe(
      false,
    );
  } finally {
    await chat.close();
  }
});

it('anchors the composer and short conversation at the bottom through replies, resize, and new chat', async () => {
  const chat = await testChat();
  const { terminal } = chat;
  const footerRow = () => terminal.visibleLines().findIndex((line) => line.includes('/ Commands'));
  try {
    await expect.poll(() => footerRow()).toBe(terminal.rows - 1);
    expect(terminal.screen.buffer.active.cursorY).toBe(terminal.rows - 4);
    terminal.type('Hello');
    terminal.input('\r');
    await expect
      .poll(() => terminal.visibleLines().findIndex((line) => line.includes('Clef heard: Hello')))
      .toBe(terminal.rows - 7);
    expect(footerRow()).toBe(terminal.rows - 1);
    terminal.resize(70, 18);
    await expect.poll(() => footerRow()).toBe(terminal.rows - 1);
    expect(terminal.screen.buffer.active.cursorY).toBe(terminal.rows - 4);
    terminal.type('first\nsecond');
    await expect
      .poll(() => terminal.visibleLines().some((line) => line.includes('second')))
      .toBe(true);
    expect(footerRow()).toBe(terminal.rows - 1);
    expect(terminal.screen.buffer.active.cursorY).toBe(terminal.rows - 4);
    terminal.input('\u0003');
    terminal.type('Scrollback remains available. '.repeat(12));
    terminal.input('\r');
    await expect
      .poll(() => terminal.visibleLines().some((line) => line.includes('Clef heard: Scrollback')))
      .toBe(true);
    await expect
      .poll(async () => (await chat.client.request('/api/conversation', snapshotSchema)).busy)
      .toBe(false);
    expect(footerRow()).toBe(terminal.rows - 1);
    expect(terminal.screen.buffer.active.baseY).toBeGreaterThan(0);
    terminal.resize(95, 32);
    await expect.poll(() => footerRow()).toBe(terminal.rows - 1);
    terminal.type('/new');
    terminal.input('\r');
    await expect
      .poll(() => terminal.visibleLines().some((line) => line.includes('Clef heard: Hello')))
      .toBe(false);
    expect(footerRow()).toBe(terminal.rows - 1);
    expect(terminal.screen.buffer.active.cursorY).toBe(terminal.rows - 4);
  } finally {
    await chat.close();
  }
});

it('lists and filters slash commands, opens the selected action, and navigates suggestions with arrows', async () => {
  const chat = await testChat();
  const { terminal } = chat;
  try {
    await expect.poll(() => terminal.text()).toContain('Ready');
    terminal.input('/');
    await expect.poll(() => terminal.text()).toContain('Configure server');
    expect(terminal.text()).toContain('Stop the current reply');
    expect(terminal.text()).toContain('Exit chat; keep server running');
    for (const character of 'sett') terminal.input(character);
    await expect.poll(() => terminal.text()).not.toContain('Stop the current reply');
    expect(terminal.text()).toContain('Configure server');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Default model');
    terminal.input('\u001b');
    await expect.poll(() => terminal.text()).toContain('Ready');
    terminal.input('/');
    await expect.poll(() => terminal.text()).toContain('Exit chat; keep server running');
    terminal.input('\u001b[A');
    terminal.input('\r');
    await expect.poll(() => terminal.stopped).toBe(true);
    expect(
      (
        await chat.app.server.inject({
          url: '/api/status',
          headers: chat.app.headers,
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await chat.close();
  }
});

it('creates main chats and switches only this terminal through inline and searchable history menus', async () => {
  const chat = await testChat();
  const { terminal, client } = chat;
  try {
    await expect.poll(() => terminal.text()).toContain('Ready');
    terminal.type('Road trip to Kyoto');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Clef heard: Road trip to Kyoto');
    const original = (await client.request('/api/conversation', snapshotSchema)).conversation.id;
    terminal.type('/new');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).not.toContain('Clef heard: Road trip to Kyoto');
    terminal.type('Garden plans');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Clef heard: Garden plans');
    const main = (await client.request('/api/conversation', snapshotSchema)).conversation.id;
    expect(main).not.toBe(original);
    for (const character of '/switch Kyoto') terminal.input(character);
    await expect.poll(() => terminal.text()).toContain('✦ Main · Garden plans');
    expect(terminal.text()).toContain('Road trip to Kyoto');
    terminal.input('\u001b[B');
    terminal.input(' ');
    await expect.poll(() => terminal.text()).toContain('Clef heard: Road trip to Kyoto');
    terminal.type('Kyoto update');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Clef heard: Kyoto update');
    expect((await client.request('/api/conversation', snapshotSchema)).conversation.id).toBe(main);
    terminal.type('/switch');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Switch conversation');
    terminal.type('Kyoto');
    await expect.poll(() => terminal.text()).toContain('Search: Kyoto');
    await expect.poll(() => terminal.text()).not.toContain('Searching…');
    expect(terminal.text().indexOf('✦ Main · Garden plans')).toBeLessThan(
      terminal.text().indexOf('Road trip to Kyoto'),
    );
    terminal.input('\u001b[B');
    terminal.input('\u001b[A');
    terminal.input(' ');
    await expect.poll(() => terminal.text()).toContain('Clef heard: Garden plans');
    expect((await client.request('/api/conversation', snapshotSchema)).conversation.id).toBe(main);
  } finally {
    await chat.close();
  }
});

it('completes commands with Tab and dismisses suggestions before stopping a running reply', async () => {
  const chat = await testChat();
  const { terminal, client } = chat;
  try {
    await expect.poll(() => terminal.text()).toContain('Ready');
    for (const character of '/sett') terminal.input(character);
    await expect.poll(() => terminal.text()).toContain('Configure server');
    terminal.input('\t');
    await expect.poll(() => terminal.text()).toContain('/settings');
    expect(terminal.text()).not.toContain('Default model');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Default model');
    terminal.input('\u001b');
    await expect.poll(() => terminal.text()).toContain('Ready');
    terminal.type('slow reply');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Working');
    terminal.input('/');
    await expect.poll(() => terminal.text()).toContain('Stop the current reply');
    terminal.input('\u001b');
    await expect.poll(() => terminal.text()).not.toContain('Stop the current reply');
    expect((await client.request('/api/conversation', snapshotSchema)).busy).toBe(true);
    terminal.input('\u001b');
    await expect
      .poll(async () => (await client.request('/api/conversation', snapshotSchema)).busy)
      .toBe(false);
  } finally {
    await chat.close();
  }
});

it('searches settings lists by typing and selects with Space after arrow navigation', async () => {
  const chat = await testChat();
  const { terminal } = chat;
  try {
    await expect.poll(() => terminal.text()).toContain('Ready');
    terminal.type('/settings');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Default model');
    terminal.type('permission');
    await expect.poll(() => terminal.text()).not.toContain('Default model');
    expect(terminal.text()).toContain('Saved permissions');
    terminal.input('\u001b[B');
    terminal.input(' ');
    await expect.poll(() => terminal.text()).toContain('No saved rules');
  } finally {
    await chat.close();
  }
});

it('chats, opens settings, changes the model, and exits without stopping the server', async () => {
  const app = await testApplication();
  const terminal = new TestTerminal();
  const abort = new AbortController();
  const url = await app.server.listen({
    host: '127.0.0.1',
    port: 0,
  });
  const client = new ClefClient(url, app.headers.authorization.slice(7));
  const running = runTui(client, terminal, abort.signal);
  try {
    await expect.poll(() => terminal.text()).toContain('test-model');
    terminal.type('Hello');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Clef heard: Hello');
    terminal.type('/settings');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Default model');
    expect(terminal.text()).not.toContain('Clef heard: Hello');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Second model');
    terminal.input('\u001b[B');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Thinking level');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Saved');
    terminal.input('\u001b');
    terminal.type('Again');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Clef heard: Again');
    terminal.resize(38, 18);
    await expect.poll(() => terminal.text()).toContain('Again');
    terminal.input('\u0004');
    await running;
    expect(terminal.stopped).toBe(true);
    expect(
      (
        await app.server.inject({
          url: '/api/models',
          headers: app.headers,
        })
      ).json().defaults.modelId,
    ).toBe('second-model');
  } finally {
    abort.abort();
    await running;
    await app.dispose();
  }
});

it('completes provider sign-in in terminal settings without echoing the secret response', async () => {
  const chat = await testChat(false);
  const { terminal } = chat;
  try {
    await expect.poll(() => terminal.text()).toContain('Connect a model provider');
    terminal.input('\u001b[B');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('openai');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Sign in with ChatGPT');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Paste the callback URL');
    terminal.type('test-callback');
    await expect.poll(() => terminal.text()).toContain('•••');
    expect(terminal.output).not.toContain('test-callback');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Saved changes');
    terminal.input('\u001b');
    await expect.poll(() => terminal.text()).toContain('Ready');
    terminal.type('Connected');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Clef heard: Connected');
    expect(terminal.output).not.toContain('test-access');
    expect(terminal.output).not.toContain('test-refresh');
  } finally {
    await chat.close();
  }
});

it('shows exact permission scope, applies only the selected approval, and stops active work', async () => {
  const chat = await testChat();
  const { terminal } = chat;
  try {
    await expect.poll(() => terminal.text()).toContain('Ready');
    terminal.type('configure switch');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('Approval required');
    expect(terminal.text()).toContain('openai/second-model');
    expect(terminal.text()).toContain('Thinking: off');
    expect(terminal.text()).toContain('This time');
    terminal.input('\u001b[B');
    terminal.input('\r');
    await expect
      .poll(() => terminal.text())
      .toContain('Configuration finished on second-model. Applied.');
    await expect.poll(() => terminal.text()).toContain('Ready');
    terminal.type('slow');
    terminal.input('\r');
    await expect.poll(() => terminal.text()).toContain('A slow response');
    terminal.input('\u0003');
    await expect.poll(() => terminal.text()).not.toContain('Working · Esc Stop');
    expect(terminal.stopped).toBe(false);
  } finally {
    await chat.close();
  }
});

it('exits while the server is not responding', async () => {
  let requested = false;
  const server = createServer(() => {
    requested = true;
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test listener.');
  const terminal = new TestTerminal();
  const abort = new AbortController();
  const running = runTui(
    new ClefClient(`http://127.0.0.1:${address.port}`, 'test'),
    terminal,
    abort.signal,
  );
  try {
    await expect.poll(() => requested).toBe(true);
    terminal.input('\u0004');
    await expect.poll(() => terminal.stopped).toBe(true);
    await expect(running).resolves.toBeUndefined();
  } finally {
    abort.abort();
    server.closeAllConnections();
    server.close();
    await running.catch(() => undefined);
  }
});

it('removes terminal control sequences from model text', async () => {
  const chat = await testChat();
  try {
    await expect.poll(() => chat.terminal.text()).toContain('Ready');
    await chat.client.request('/api/conversation/messages', okSchema, {
      text: 'Unsafe \u001b]52;c;c2VjcmV0\u0007 text',
      requestId: crypto.randomUUID(),
    });
    await expect.poll(() => chat.terminal.text()).toContain('Clef heard: Unsafe');
    expect(chat.terminal.output).not.toContain(']52;c;c2VjcmV0');
  } finally {
    await chat.close();
  }
});
