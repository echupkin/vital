'use client';

// What a map is drawn on: the provider, its tile style, and Light / Dark / Auto
// for a style that has both renderings (Auto follows the loaded theme). Every
// provider is listed and can be chosen; one whose key is not configured is
// marked, and the map says its tiles are requested without a key and may not load.

import {
  MAP_PROVIDERS,
  hasDarkVariant,
  mapProvider,
  providerDefault,
  type BasemapChoice,
  type MapAppearance,
} from '@/lib/activity-maps/providers';
import { SegmentedControl, Select } from '@/components/ui/primitives';
import { useTileConfig } from './TileConfigContext';
import { providerReady } from './basemaps';

const APPEARANCE_OPTIONS: { value: MapAppearance; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function BasemapPicker({ value, onChange }: { value: BasemapChoice; onChange: (next: BasemapChoice) => void }) {
  const tiles = useTileConfig();
  const provider = mapProvider(value.provider);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Map provider" className="inline-flex flex-wrap gap-0.5 rounded-control bg-surface-muted p-0.5">
        {MAP_PROVIDERS.map(p => {
          const active = p.id === value.provider;
          const ready = providerReady(p, tiles.keys);
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={ready ? p.description : `${p.description} No API key is configured (${p.key?.envVar}).`}
              onClick={() => !active && onChange(providerDefault(p.id))}
              className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-medium transition-colors ${
                active ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {p.label}
              {!ready && (
                <span className="rounded-full border border-category-attention px-1.5 text-[10px] font-normal leading-4 text-category-attention">
                  No API key
                </span>
              )}
            </button>
          );
        })}
      </div>
      {provider.styles.length > 1 && (
        <Select
          aria-label={`${provider.label} style`}
          value={value.style}
          options={provider.styles.map(s => ({ value: s.id, label: s.label }))}
          onChange={style => onChange({ ...value, style, appearance: value.appearance })}
          className="!min-h-[36px] !py-1.5 text-xs"
        />
      )}
      {hasDarkVariant(value) && (
        <SegmentedControl
          ariaLabel="Light or dark map"
          options={APPEARANCE_OPTIONS}
          value={value.appearance}
          onChange={v => onChange({ ...value, appearance: v as MapAppearance })}
        />
      )}
    </div>
  );
}
