import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BadgeSpinner, ChangeCue } from './primitives';

const render = (props: Parameters<typeof ChangeCue>[0]) => renderToStaticMarkup(createElement(ChangeCue, props));

describe('ChangeCue', () => {
  it('tells a screen reader the direction against the baseline by default', () => {
    expect(render({ direction: 'below', value: '-1.2K' })).toContain('Lower than baseline: ');
  });

  it('names what the change is measured against when it is not the baseline', () => {
    const html = render({ direction: 'above', value: '+3', percent: '+5.0%', comparedWith: 'yesterday' });
    expect(html).toContain('Higher than yesterday: ');
    expect(html).not.toContain('baseline');
  });

  it('says nothing extra when there is no change', () => {
    expect(render({ direction: 'none', value: '0' })).not.toContain('sr-only');
  });
});

describe('BadgeSpinner', () => {
  it('spins only when motion is allowed, and lifts the icon on a wrapper so the spin does not undo it', () => {
    const html = renderToStaticMarkup(createElement(BadgeSpinner));
    expect(html).toMatch(/^<span class="[^"]*-translate-y-px[^"]*" aria-hidden="true"><svg[^>]*class="[^"]*motion-safe:animate-spin/);
  });
});
