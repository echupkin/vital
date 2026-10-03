'use client';

// ── Activity → Maps ─────────────────────────────────────
//
// Any number of maps of where outdoor workouts went, each an area the reader
// framed with its own saved controls. This component owns the list and its
// persistence: a control change shows at once and is saved shortly after (one
// write in flight per map, each naming the revision it was based on), so
// clicking through the metrics does not fire a write per click. A write refused
// as stale reloads the list and says so instead of overwriting the newer copy.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Map as MapIcon, Plus } from 'lucide-react';
import { Button, Card, DataStateNote, EmptyState, ErrorState, LoadingState } from '@/components/ui/primitives';
import { DomainHeader } from '@/components/domain/DomainShared';
import {
  MapRequestError,
  createMapRequest,
  deleteMapRequest,
  fetchMaps,
  reorderMapsRequest,
  updateMapRequest,
} from '@/lib/activity-maps/client';
import { defaultMapSettings, type ActivityMap, type MapSettings } from '@/lib/activity-maps/types';
import type { TileConfig } from '@/lib/activity-maps/tiles';
import { MapAreaDialog, type MapAreaDraft } from './MapAreaDialog';
import { TileConfigProvider } from './TileConfigContext';
import { MapCard } from './MapCard';

const SAVE_DELAY_MS = 600;

interface SaveState {
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  dirty: boolean;
}

export function ActivityMapsPage() {
  const [maps, setMaps] = useState<ActivityMap[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ mode: 'add' } | { mode: 'edit'; id: string; initial: MapAreaDraft } | null>(null);
  const [tiles, setTiles] = useState<TileConfig>({ keys: {} });
  const mapsRef = useRef<ActivityMap[]>([]);
  const saves = useRef(new Map<string, SaveState>());

  const commit = useCallback((next: ActivityMap[]) => {
    mapsRef.current = next;
    setMaps(next);
  }, []);

  const reload = useCallback(async () => {
    try {
      const res = await fetchMaps();
      commit(res.maps);
      setTiles(res.tiles);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'The maps could not be read.');
    }
  }, [commit]);

  useEffect(() => {
    void reload();
    const pending = saves.current;
    return () => {
      for (const s of pending.values()) if (s.timer) clearTimeout(s.timer);
    };
  }, [reload]);

  const patch = useCallback(
    (id: string, change: Partial<ActivityMap>) => commit(mapsRef.current.map(m => (m.id === id ? { ...m, ...change } : m))),
    [commit]
  );

  /** Save a map's current local copy; a change made meanwhile is saved after. */
  const flush = useCallback(
    async (id: string): Promise<void> => {
      const state = saves.current.get(id) ?? { timer: null, inFlight: false, dirty: false };
      saves.current.set(id, state);
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      if (state.inFlight) {
        state.dirty = true;
        return;
      }
      const map = mapsRef.current.find(m => m.id === id);
      if (!map) return;
      state.inFlight = true;
      try {
        const saved = await updateMapRequest(id, { name: map.name, bbox: map.bbox, settings: map.settings }, map.revision);
        patch(id, { revision: saved.revision, updatedAt: saved.updatedAt });
      } catch (error) {
        if (error instanceof MapRequestError && (error.status === 409 || error.status === 404)) {
          setNotice(`${error.message} The maps were reloaded; nothing was overwritten.`);
          state.dirty = false;
          await reload();
        } else {
          setNotice(error instanceof Error ? `This change was not saved: ${error.message}` : 'This change was not saved.');
        }
      } finally {
        state.inFlight = false;
        if (state.dirty) {
          state.dirty = false;
          void flush(id);
        }
      }
    },
    [patch, reload]
  );

  const changeSettings = useCallback(
    (id: string, settings: MapSettings) => {
      patch(id, { settings });
      const state = saves.current.get(id) ?? { timer: null, inFlight: false, dirty: false };
      saves.current.set(id, state);
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => void flush(id), SAVE_DELAY_MS);
    },
    [patch, flush]
  );

  async function saveArea(draft: MapAreaDraft) {
    if (!dialog) return;
    if (dialog.mode === 'add') {
      const created = await createMapRequest({
        name: draft.name,
        bbox: draft.bbox,
        settings: { ...defaultMapSettings(), basemap: draft.basemap },
      });
      commit([...mapsRef.current, created]);
    } else {
      const current = mapsRef.current.find(m => m.id === dialog.id);
      if (current) patch(dialog.id, { name: draft.name, bbox: draft.bbox, settings: { ...current.settings, basemap: draft.basemap } });
      await flush(dialog.id);
    }
    setDialog(null);
  }

  async function move(index: number, delta: -1 | 1) {
    const next = [...mapsRef.current];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    commit(next);
    try {
      const ordered = await reorderMapsRequest(next.map(m => m.id));
      const position = new Map(ordered.map(m => [m.id, m.position]));
      commit(mapsRef.current.map(m => ({ ...m, position: position.get(m.id) ?? m.position })));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The new order was not saved.');
      await reload();
    }
  }

  async function remove(id: string) {
    const state = saves.current.get(id);
    if (state?.timer) clearTimeout(state.timer);
    saves.current.delete(id);
    const map = mapsRef.current.find(m => m.id === id);
    if (!map) return;
    try {
      await deleteMapRequest(id, map.revision);
      commit(mapsRef.current.filter(m => m.id !== id));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The map was not deleted.');
      await reload();
    }
  }

  const addButton = (
    <Button variant="primary" onClick={() => setDialog({ mode: 'add' })}>
      <Plus size={16} className="mr-1.5" aria-hidden="true" />
      Add map
    </Button>
  );

  return (
    <TileConfigProvider value={tiles}>
      <div className="space-y-8">
        <DomainHeader
          title="Activity maps"
          eyebrow="Activity"
          category="activity"
          subtitle="Where your outdoor workouts went. Each map is an area you frame, drawn from the GPS routes your workouts recorded, with the streets you travel most standing out."
        >
          {maps && maps.length > 0 && addButton}
        </DomainHeader>

        {notice && (
          <Card className="flex items-start justify-between gap-3 p-5">
            <DataStateNote tone="attention">{notice}</DataStateNote>
            <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
              Dismiss
            </Button>
          </Card>
        )}

        {loadError ? (
          <Card className="p-6">
            <ErrorState title="The maps could not be loaded" message={loadError} onRetry={() => void reload()} />
          </Card>
        ) : maps === null ? (
          <LoadingState label="Loading maps" />
        ) : maps.length === 0 ? (
          <Card className="p-6">
            <EmptyState
              icon={<MapIcon size={28} aria-hidden="true" />}
              title="No maps yet"
              description="Add a map, find a place, and frame the area you want to see. Every workout that recorded a route through it is drawn, and you can filter by activity and colour the paths by how often you travel them or by heart rate."
              action={addButton}
            />
          </Card>
        ) : (
          <>
            {maps.map((map, i) => (
              <MapCard
                key={map.id}
                map={map}
                onSettings={settings => changeSettings(map.id, settings)}
                onEdit={() => setDialog({ mode: 'edit', id: map.id, initial: { name: map.name, bbox: map.bbox, basemap: map.settings.basemap } })}
                onMoveUp={i > 0 ? () => void move(i, -1) : null}
                onMoveDown={i < maps.length - 1 ? () => void move(i, 1) : null}
                onDelete={() => remove(map.id)}
              />
            ))}
          </>
        )}

        <MapAreaDialog
          open={dialog !== null}
          onClose={() => setDialog(null)}
          initial={dialog?.mode === 'edit' ? dialog.initial : null}
          onSave={saveArea}
        />
      </div>
    </TileConfigProvider>
  );
}
