import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { expect, it, vi } from 'vitest';
import { testInstallation } from '../../../tests/installation.js';
import { openAgent } from './index.js';

it('keeps an active reply on its model and uses saved settings for the next input', async () => {
  const installation = await testInstallation();
  const provider = fauxProvider({
    provider: 'test',
    models: [
      {
        id: 'first',
        reasoning: true,
      },
      {
        id: 'second',
        reasoning: true,
      },
    ],
    tokensPerSecond: 100,
  });
  provider.setResponses([
    fauxAssistantMessage('A slow reply. '.repeat(1000)),
    (context, options, _state, model) =>
      fauxAssistantMessage(
        JSON.stringify({
          model: model.id,
          thinking: options?.reasoning,
          inputs: context.messages
            .filter((message) => message.role === 'user')
            .map((message) => message.content),
        }),
      ),
  ]);
  const models = createModels();
  models.setProvider(provider.provider);
  const agent = await openAgent(installation.database, models);
  const first = {
    provider: 'test',
    modelId: 'first',
    thinkingLevel: 'off',
  } as const;
  const second = {
    provider: 'test',
    modelId: 'second',
    thinkingLevel: 'high',
  } as const;
  try {
    const conversation = await agent.open(first);
    await agent.send('Remember me', crypto.randomUUID(), first);
    await vi.waitFor(async () =>
      expect((await agent.snapshot()).messages.at(-1)?.text).toContain('A slow'),
    );
    await expect(agent.send('Not yet', crypto.randomUUID(), second)).rejects.toThrow();
    expect((await agent.snapshot()).conversation.model).toEqual(first);
    await agent.stop();

    await agent.send('Continue', crypto.randomUUID(), second);
    await vi.waitFor(async () => expect((await agent.snapshot()).busy).toBe(false));
    const snapshot = await agent.snapshot();
    expect(snapshot.conversation.id).toBe(conversation.id);
    expect(snapshot.conversation.model).toEqual(second);
    expect(JSON.parse(snapshot.messages.at(-1)?.text ?? '')).toEqual({
      model: 'second',
      thinking: 'high',
      inputs: [
        'Remember me',
        'Continue',
      ],
    });
  } finally {
    await agent.close();
    await installation.dispose();
  }
});
