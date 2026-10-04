# Copied UI sources

These components come from [Vercel AI Elements](https://github.com/vercel/ai-elements/tree/6a9d5b1822ffb10bba4bd97175f01edd7d8651cd), commit `6a9d5b1822ffb10bba4bd97175f01edd7d8651cd`.

| Local path | Source path |
| --- | --- |
| `ai-elements/{conversation,message,prompt-input}.tsx` | `packages/elements/src/` |
| `shadcn-ui/components/ui/` | Matching files in `packages/shadcn-ui/components/ui/` |
| `shadcn-ui/lib/utils.ts` | `packages/shadcn-ui/lib/utils.ts` |

AI Elements uses Apache-2.0. Keep `LICENSE-AI-ELEMENTS`. The shadcn components derive from [shadcn/ui](https://github.com/shadcn-ui/ui), which uses MIT. Keep its copyright and permission notice in `LICENSE-SHADCN` too. These notices do not select a license for Clef's own code.

## Local changes

All copied TypeScript files are modified. They have modification notices, local relative imports, and Biome formatting.

- `message.tsx` loads only the code-highlighting plugin. Clef does not load the optional CJK, math, or Mermaid plugins.
- `conversation.tsx` explicitly starts scrolling without waiting for the animation result.
- `dropdown-menu.tsx` defaults the checkbox state to `false` for strict optional-property types.
- `button-group.tsx` and `input-group.tsx` use native fieldsets for groups. Input addons do not add a mouse-only focus action; their controls keep native keyboard access.

Keep Clef's API, state, and security policy outside this directory. The message adapter in `src/web/messages/response.tsx` retains Streamdown's sanitization and URL hardening, omits raw HTML parsing, and renders images as explicit links. The composer accepts text only. These are Clef requirements, not replacements for the upstream components.

## Updating

1. Compare the pinned source with the proposed upstream version.
2. Copy only needed components and dependencies. Keep notices and update this file.
3. Reapply the listed integration changes. Do not copy Clef behavior into upstream files.
4. Run `npm run check`. Check keyboard input, focus return, scrolling, failed sends, Stop, safe Markdown, and system appearance.

Copied sources may retain comments and upstream function complexity. Only the cognitive-complexity rule is disabled here. Other lint rules, TypeScript, import boundaries, and runtime tests still apply. Clef-owned components do not receive this exception.
