'use client';

// ── Settings → Sources ──────────────────────────────────────────────────────
//
// Every connection: the Health Auto Export card, the Oura card, Workout sources
// (Hevy), then Map sources. The first-run gate opens this tab, so a saved first
// connection takes the reader on to the app.

import { useRouter, useSearchParams } from 'next/navigation';
import { Dumbbell, Plug } from 'lucide-react';
import { useSetupFailure } from '@/components/data/setup-mode';
import { Card } from '@/components/ui/primitives';
import { HaeConnection } from './HaeConnection';
import { nextStepAfterChange } from './hae-card';
import { MapProvidersCard } from './MapProviders';
import { OuraConnection } from './OuraConnection';
import { SectionHead } from './SectionHead';
import { usePipelineReport } from './usePipelineReport';
import type { PipelinePart } from '@/lib/pipeline/types';
import { WorkoutSources } from './WorkoutSources';

const WORKOUTS_ONLY: PipelinePart[] = ['workouts'];

export function SourcesTab() {
  const router = useRouter();
  const ouraNotice = useSearchParams().get('oura');
  const settingUp = useSetupFailure() !== null;
  // Only the workout sources: the Hevy card never waits on the dataset load.
  const { report, refreshQuietly } = usePipelineReport({ parts: WORKOUTS_ONLY });

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <HaeConnection
          heading={title => <SectionHead icon={<Plug size={18} className="text-text-secondary" />} title={title} />}
          onChanged={event => {
            // First run: a saved connection takes the reader on to the app with a full page load,
            // so the server decides afresh whether the data can be read. (A client-side refresh
            // racing a client-side navigation leaves the old "no source" state on screen.) If the
            // data still cannot be read the gate sends them straight back here, with the real reason.
            if (nextStepAfterChange(event, settingUp) === 'open-app') window.location.assign('/');
            else router.refresh();
          }}
        />
      </Card>

      <Card className="p-6">
        <OuraConnection
          heading={title => <SectionHead icon={<Plug size={18} className="text-text-secondary" />} title={title} />}
          noticeParam={ouraNotice}
          onChanged={() => router.refresh()}
        />
      </Card>

      <WorkoutSources
        report={report}
        heading={(kind, title) =>
          kind === 'section' ? (
            <SectionHead icon={<Dumbbell size={18} className="text-text-secondary" />} title={title} />
          ) : (
            <SectionHead icon={<Plug size={18} className="text-text-secondary" />} title={title} />
          )
        }
        onChanged={() => {
          router.refresh();
          void refreshQuietly();
        }}
      />

      <Card className="p-6">
        <MapProvidersCard heading={(icon, title) => <SectionHead icon={icon} title={title} />} />
      </Card>
    </div>
  );
}
