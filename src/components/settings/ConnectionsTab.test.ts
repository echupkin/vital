// ── Settings → Connections: stage status rendering ───────────────────────────

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StageDot, StageLabel } from './ConnectionsTab';

const label = (status: Parameters<typeof StageLabel>[0]['status']) => renderToStaticMarkup(createElement(StageLabel, { status }));
const dot = (status: Parameters<typeof StageDot>[0]['status']) => renderToStaticMarkup(createElement(StageDot, { status }));

describe('stage status', () => {
  it('says Checking…, with a spinner, while a check runs in the background', () => {
    const html = label('checking');
    expect(html).toContain('Checking…');
    expect(html).not.toContain('Unknown');
    expect(html).toContain('motion-safe:animate-spin');
    expect(dot('checking')).toContain('motion-safe:animate-pulse');
  });

  it('keeps every other status still', () => {
    for (const status of ['healthy', 'degraded', 'unknown', 'unconfigured'] as const) {
      expect(label(status)).not.toContain('animate-');
      expect(dot(status)).not.toContain('animate-');
    }
    expect(label('unknown')).toContain('Unknown');
  });
});
