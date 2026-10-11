'use client';

// ── Settings → Sources → Workout sources ────────────────────────────────
//
// One card per workout source in the pipeline report. A source with a connection
// form (today Hevy) shows the form and its sync status in the same card; any
// other source, and the demo sessions, show the sync line alone. Settings is the
// only page that names a data source.

import { Badge, BadgeSpinner, Card, DataStateNote } from '@/components/ui/primitives';
import type { PipelineStatusReport } from '@/lib/pipeline/types';
import { HevyConnection } from './HevyConnection';
import { hasConnectionForm, workoutSourceLine } from './workout-source';

export interface WorkoutSourcesProps {
  /** Null while the pipeline report is loading. */
  report: PipelineStatusReport | null;
  /** The Settings page's section head, so the headings match the other cards. */
  heading: (kind: 'section' | 'source', title: string) => React.ReactNode;
  onChanged?: (event: 'saved' | 'disconnected') => void;
}

export function WorkoutSources({ report, heading, onChanged }: WorkoutSourcesProps) {
  const sources = report?.workoutSources ?? [];
  const checking = report?.pending?.includes('workouts') ?? false;
  return (
    <div className="space-y-3">
      <div>
        {heading('section', 'Workout sources')}
        <p className="text-xs text-text-secondary leading-relaxed">
          Apple Health records a workout&apos;s type, time and calories only. A workout source adds what was actually
          done — exercises, sets, reps, load and effort — which the routine on the Workouts page needs.
        </p>
      </div>
      {sources.map(source => {
        const line = workoutSourceLine(source);
        return (
          <Card key={source.id} className="p-6" data-workout-source={source.id}>
            {hasConnectionForm(source.id) && source.origin !== 'demo' ? (
              <HevyConnection heading={title => heading('source', title)} syncLine={line} onChanged={onChanged} />
            ) : (
              <>
                {heading('source', source.displayName)}
                <p
                  className={`text-xs ${line.tone === 'warning' ? 'text-category-attention' : 'text-text-secondary'}`}
                >
                  {line.text}
                </p>
              </>
            )}
          </Card>
        );
      })}
      {checking && (
        <Card className="p-6" role="status" aria-live="polite">
          <Badge variant="default" className="text-[10px]">
            <BadgeSpinner />
            Checking…
          </Badge>
          <p className="mt-2 text-xs text-text-secondary">Checking the workout sources and bringing their sessions up to date.</p>
        </Card>
      )}
      {report && !checking && sources.length === 0 && (
        <Card className="p-6">
          <p className="text-xs text-text-secondary">No workout source was checked.</p>
        </Card>
      )}
      <DataStateNote>
        Source connections are kept on the server only. Synced sessions stay in the server&apos;s memory and are never
        written to the database.
      </DataStateNote>
    </div>
  );
}
