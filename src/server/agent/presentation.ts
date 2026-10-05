import { Type } from '@earendil-works/pi-ai';
import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { z } from 'zod';
import { type UiSpec, uiSpecSchema } from '../messages/contract.js';

function requireBoundedSpec(spec: UiSpec): void {
  let bytes = 0;
  const visit = (value: unknown): void => {
    if (value !== null && typeof value === 'object') {
      bytes += 2;
      for (const [key, child] of Object.entries(value)) {
        visit(key);
        bytes += 2;
        visit(child);
      }
    } else {
      bytes += Buffer.byteLength(JSON.stringify(value));
    }
    if (bytes > 32768) throw new Error('The interface exceeds 32 KiB. Use a smaller interface.');
  };
  visit(spec);
}

function requireBinding(element: UiSpec['elements'][string], state: UiSpec['state']): void {
  if (!('value' in element.props || 'checked' in element.props)) return;

  const binding = 'value' in element.props ? element.props.value : element.props.checked;
  const value = state[binding.$bindState.slice(1)];
  const expected = element.type === 'Checkbox' ? 'boolean' : 'string';
  if (typeof value !== expected)
    throw new Error(`Initialize ${binding.$bindState} with a ${expected}.`);
}

function requireTree(spec: UiSpec): void {
  const visited = new Set<string>();
  const remaining = [
    {
      id: spec.root,
      depth: 1,
    },
  ];
  while (remaining.length) {
    const next = remaining.pop();
    if (!next) break;

    const element = spec.elements[next.id];
    if (!element || visited.has(next.id) || next.depth > 8)
      throw new Error('Use a tree with existing, unique children and at most 8 levels.');

    visited.add(next.id);
    requireBinding(element, spec.state);
    if ('children' in element)
      remaining.push(
        ...element.children.map((id) => ({
          id,
          depth: next.depth + 1,
        })),
      );
  }
  if (visited.size !== Object.keys(spec.elements).length)
    throw new Error('Every element must be reachable from the root.');
}

export const presentationExtension = defineExtension({
  name: 'clef-presentation',
  tools: [
    defineTool({
      name: 'present_ui',
      description:
        'Present an inline interface composed from generic components. Choose labels, options, content and layout yourself. Send a complete JSON spec, not code or Markdown. Use at most 64 elements, 8 tree levels, 32 flat state fields and 32 KiB. Initialize every input binding in state with a string, or a boolean for Checkbox. Bind inputs with {"$bindState":"/field"}. Buttons use on.press={action:"submit",params:{intent:"your intent"}}. A click returns the intent and all state values to you in a ui_submission user message. Interpret those answers and use your tools as needed. This tool ends your reply; wait for user input. Do not duplicate the interface in text. It does not execute actions or grant permissions. Never collect passwords, keys or other secrets.',
      parameters: Type.Unsafe<UiSpec>(z.toJSONSchema(uiSpecSchema)),
      replay: 'safe',
      executionMode: 'sequential',
      outputLimits: {
        maxBytes: 1024,
      },
      async execute(input) {
        requireBoundedSpec(input);
        const spec = uiSpecSchema.parse(input);
        requireTree(spec);

        return {
          content: [
            {
              type: 'text',
              text: 'Interface displayed.',
            },
          ],
          details: {
            spec,
          },
          control: {
            terminate: true,
          },
        };
      },
    }),
  ],
});
