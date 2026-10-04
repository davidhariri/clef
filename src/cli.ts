import { runChat } from './client/terminal/index.js';

if (!process.stdin.isTTY || !process.stdout.isTTY)
  throw new Error('Clef chat needs an interactive terminal.');
try {
  await runChat(process.env.CLEF_URL ?? 'http://127.0.0.1:3737');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Cannot connect to Clef.');
  process.exitCode = 1;
}
