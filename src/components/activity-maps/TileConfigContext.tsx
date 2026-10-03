'use client';

// The tile configuration the server reported with the maps, for every map on
// the page (and the dialog). No keys until it arrives.

import { createContext, useContext } from 'react';
import type { TileConfig } from '@/lib/activity-maps/tiles';

const TileConfigContext = createContext<TileConfig>({ keys: {} });

export const TileConfigProvider = TileConfigContext.Provider;

export function useTileConfig(): TileConfig {
  return useContext(TileConfigContext);
}
