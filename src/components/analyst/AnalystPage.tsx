'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Bot, ChevronDown, ChevronRight, Loader2, Send, ShieldCheck, Sparkles, User,
} from 'lucide-react';
import { Badge, Button, Card, DataStateNote, ErrorState, Skeleton } from '@/components/ui/primitives';
import { TrendFigure } from '@/components/charts';
import { useUnits } from '@/components/ui/UnitsProvider';
import { SUPPORTED_PROMPTS } from '@/lib/analyst/prompts';
import type { AnalystAnswer, AnalystResponse } from '@/lib/analyst/types';
import { providerBadge, useAnalystConfig } from './useAnalystConfig';

interface Exchange {
  id: number;
  question: string;
  response: AnalystResponse | null;
  pending: boolean;
  failed: string | null;
}

export function AnalystPage() {
  const { units } = useUnits();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  const { state: configState, error: configError } = useAnalystConfig();

  // Whether a provider is actually configured decides the copy and the controls.
  // An unknown state is never reported as "no provider configured".
  const providerReady = configState?.configured === true;
  const misconfigured = configState?.misconfigured === true;
  const demoMode = configState ? !providerReady && !misconfigured : false;

  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [input, setInput] = useState(initialQuery);
  const [pending, setPending] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const nextId = useRef(1);
  const conversationRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const ask = useCallback(
    async (question: string) => {
      const id = nextId.current++;
      setExchanges(prev => [...prev, { id, question, response: null, pending: true, failed: null }]);
      setPending(true);
      try {
        const res = await fetch('/api/analyst', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: question, notes, system: units }),
        });
        if (!res.ok) throw new Error(`The analyst endpoint answered HTTP ${res.status}.`);
        const data = (await res.json()) as AnalystResponse;
        setExchanges(prev =>
          prev.map(e => (e.id === id ? { ...e, response: data, pending: false } : e))
        );
      } catch (error) {
        setExchanges(prev =>
          prev.map(e =>
            e.id === id
              ? {
                  ...e,
                  pending: false,
                  failed: error instanceof Error ? error.message : 'The question could not be sent.',
                }
              : e
          )
        );
      } finally {
        setPending(false);
      }
    },
    [notes, units]
  );

  // /analyst?q=… prefills and runs the question.
  useEffect(() => {
    if (started.current || !initialQuery.trim()) return;
    started.current = true;
    void ask(initialQuery.trim());
  }, [initialQuery, ask]);

  useEffect(() => {
    // Announce-ready region: keep the newest exchange in view.
    conversationRef.current?.scrollTo({ top: conversationRef.current.scrollHeight, behavior: 'smooth' });
  }, [exchanges]);

  const handleSend = () => {
    const question = input.trim();
    if (!question || pending) return;
    setInput('');
    void ask(question);
  };

  const lastResponse = useMemo(
    () => [...exchanges].reverse().find(e => e.response)?.response ?? null,
    [exchanges]
  );

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] md:text-[32px] font-semibold tracking-tight text-text-primary leading-tight">
            Ask about your health
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Explore patterns in your Apple Health history.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={providerReady ? 'accent' : 'default'} className="text-xs">
            {providerBadge(configState)}
          </Badge>
        </div>
      </header>

      {/* ── State notice ───────────────────────────── */}
      <Card variant="accent" className="p-4" as="section">
        <div className="flex items-start gap-2 text-xs text-primary">
          <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="leading-relaxed space-y-1">
            {configError && (
              <p>
                <strong className="font-medium">Provider state unavailable.</strong> {configError} Nothing is assumed in
                its place: {demoMode ? 'the analyst is answering from your dataset' : 'the state stays unknown until it can be read'}.
              </p>
            )}
            {!configError && !configState && <p>Reading the analyst provider state…</p>}
            {demoMode && (
              <p>
                <strong className="font-medium">Demo analyst.</strong> No AI provider is configured, so nothing is
                generated by a model. Each supported question is answered by a deterministic handler that computes its
                figures from your dataset at request time, and every figure carries its metric, window, aggregation and
                sample count. Questions outside the supported set are reported as unsupported rather than guessed at.
              </p>
            )}
            {misconfigured && (
              <p>
                <strong className="font-medium">{configState?.providerDisplayName} is misconfigured.</strong>{' '}
                {configState?.misconfiguredReason} No request is sent and no answer is produced until the server
                environment is fixed; the analyst does not fall back to demo answers.
              </p>
            )}
            {providerReady && (
              <p>
                <strong className="font-medium">
                  {configState?.providerDisplayName}
                  {configState?.model ? ` · ${configState.model}` : ''}
                </strong>{' '}
                is configured{configState?.endpointIsLoopback ? ' on a loopback endpoint on this machine' : ''}. Your
                question and the selected summaries are sent to {configState?.destination ?? 'the configured endpoint'},
                and the model&rsquo;s reply is validated against the selected context before it is shown.
                {configState?.systemPromptSource === 'custom' ? ' A custom system prompt is in use.' : ''}
              </p>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* ── Conversation ─────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          <div
            ref={conversationRef}
            className="space-y-5 max-h-[60vh] lg:max-h-[70vh] overflow-y-auto pr-1"
            aria-live="polite"
            aria-busy={pending}
            aria-label="Conversation"
          >
            {exchanges.length === 0 && !pending && (
              <Card className="p-6 text-center">
                <Bot size={32} className="mx-auto text-text-secondary mb-3" aria-hidden="true" />
                <p className="text-sm text-text-primary font-medium mb-1">Ask a question about your health data</p>
                <p className="text-xs text-text-secondary mb-4">
                  {providerReady
                    ? `Any question is sent to ${configState?.providerDisplayName}${configState?.model ? ` (${configState.model})` : ''} with a bounded selection of your data. The prompts below are examples.`
                    : `${SUPPORTED_PROMPTS.length} questions are wired to handlers in this build. Pick one below or type it yourself.`}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUPPORTED_PROMPTS.map(q => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => void ask(q)}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs bg-surface-muted text-text-secondary hover:text-text-primary rounded-full transition-colors min-h-[44px]"
                    >
                      <Sparkles size={12} aria-hidden="true" />
                      {q}
                    </button>
                  ))}
                </div>
              </Card>
            )}

            {exchanges.map(ex => (
              <div key={ex.id} className="space-y-3">
                <div className="flex justify-end gap-3">
                  <div className="max-w-[85%] px-4 py-3 rounded-card bg-primary text-primary-text text-sm">
                    {ex.question}
                  </div>
                  <div className="w-8 h-8 rounded-full bg-surface-muted text-text-secondary flex items-center justify-center shrink-0">
                    <User size={15} aria-hidden="true" />
                  </div>
                </div>

                {ex.pending && <AnswerPending />}

                {ex.failed && (
                  <Card className="p-4">
                    <ErrorState
                      title="The question could not be answered"
                      message={`${ex.failed} Nothing was computed and no health data left this machine.`}
                      onRetry={() => void ask(ex.question)}
                    />
                  </Card>
                )}

                {ex.response && <AnswerView response={ex.response} onFollowUp={q => void ask(q)} />}
              </div>
            ))}
          </div>

          {/* ── Composer ─────────────────────────────── */}
          <div className="flex items-end gap-2 p-2 bg-surface border border-border rounded-control">
            <label className="flex-1">
              <span className="sr-only">Ask a question about your health data</span>
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  providerReady
                    ? 'Ask anything about your sleep, recovery, activity…'
                    : 'Ask about your sleep, recovery, activity…'
                }
                className="w-full bg-transparent border-none outline-none px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary"
                maxLength={400}
                aria-describedby="composer-state"
              />
            </label>
            <Button
              variant="primary"
              size="md"
              onClick={handleSend}
              disabled={!input.trim() || pending}
              aria-label={pending ? 'Sending your question' : 'Send your question'}
            >
              {pending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
              <span className="ml-1.5">{pending ? 'Working' : 'Send'}</span>
            </Button>
          </div>
          <p id="composer-state" className="text-[11px] text-text-secondary">
            {pending
              ? providerReady
                ? 'Waiting for the configured provider to answer…'
                : 'Answering from your dataset…'
              : input.trim()
                ? 'Press Send or Enter to ask.'
                : 'Enter a question to enable Send. Questions are limited to 400 characters.'}
          </p>
        </div>

        {/* ── Context panel ────────────────────────── */}
        <Card className="p-5 space-y-4" as="section">
          <button
            type="button"
            onClick={() => setContextOpen(o => !o)}
            aria-expanded={contextOpen}
            aria-controls="analyst-context"
            className="w-full flex items-center justify-between gap-2 text-left min-h-[44px]"
          >
            <span className="text-sm font-semibold text-text-primary">Context and evidence</span>
            {contextOpen ? (
              <ChevronDown size={15} className="text-text-secondary shrink-0" aria-hidden="true" />
            ) : (
              <ChevronRight size={15} className="text-text-secondary shrink-0" aria-hidden="true" />
            )}
          </button>

          <div id="analyst-context" hidden={!contextOpen} className="space-y-4 text-xs text-text-secondary">
            <div>
              <p className="text-text-primary font-medium mb-1">What is sent</p>
              {demoMode || !configState ? (
                <p className="leading-relaxed">
                  Nothing. No provider is configured, so no health context leaves this machine: the question is answered
                  by a server route on the same machine, from the committed dataset.
                </p>
              ) : (
                <div className="leading-relaxed space-y-2">
                  <p>
                    Destination: <span className="text-text-primary">{configState.destination ?? 'not set'}</span>
                    {configState.endpointIsLoopback ? ' (loopback — on this machine)' : ''} · model{' '}
                    <span className="text-text-primary">{configState.model ?? 'not set'}</span>
                  </p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {configState.sendingCategories.map(c => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                  <p>
                    Imported notes, if you attach any, travel inside the same untrusted-data block. The analyst never
                    sends the whole dataset: retrieval selects the summaries a question needs and caps each series.
                  </p>
                </div>
              )}
            </div>

            <div>
              <p className="text-text-primary font-medium mb-1">Who handles this request</p>
              <p className="leading-relaxed">
                {configState == null
                  ? 'Reading the provider configuration…'
                  : demoMode
                    ? 'The demo analyst: a deterministic set of handlers computing from the shared dataset on the server. No provider, no model and no network request are involved.'
                    : configState.misconfigured
                      ? `${configState.providerDisplayName} is configured but unusable (${configState.misconfiguredReason ?? 'invalid configuration'}), so no request is sent and no answer is produced.`
                      : `${configState.providerDisplayName}${configState.model ? ` · ${configState.model}` : ''} at ${configState.destination ?? 'the configured endpoint'}. This is the provider and model that generates the answer you receive.`}
              </p>
            </div>

            <div>
              <label htmlFor="analyst-notes" className="text-text-primary font-medium block mb-1">
                Imported notes (treated as untrusted data)
              </label>
              <textarea
                id="analyst-notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Paste notes from another app. They are never followed as instructions."
                className="w-full bg-surface-muted border border-border rounded-control px-3 py-2 text-xs text-text-primary placeholder:text-text-secondary outline-none focus:ring-2 focus:ring-accent"
              />
              <p className="text-[11px] mt-1 leading-relaxed">
                Notes are length-capped, stripped of control characters and kept as opaque text. They are not parsed,
                not executed and not used to compute any figure.
              </p>
            </div>

            {lastResponse && (
              <div className="space-y-3">
                <div>
                  <p className="text-text-primary font-medium mb-1">Selected for the last question</p>
                  <p className="leading-relaxed">{lastResponse.retrieval.note}</p>
                  {lastResponse.retrieval.metrics.length > 0 && (
                    <ul className="list-none p-0 m-0 mt-2 space-y-1">
                      {lastResponse.retrieval.metrics.map(m => (
                        <li key={`${m.metricId}-${m.window}`} className="flex justify-between gap-2">
                          <span className="text-text-primary">{m.metricId}</span>
                          <span className="tnum text-right">
                            {m.observations} obs · {m.window}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="text-text-primary font-medium mb-1">Provider that handled that answer</p>
                  <p className="leading-relaxed">
                    {lastResponse.providerConfigured
                      ? `${lastResponse.providerDisplayName}${lastResponse.model ? ` · ${lastResponse.model}` : ''}`
                      : 'Demo analyst (deterministic handlers, no model)'}{' '}
                    · destination {lastResponse.retrieval.metrics.length > 0 ? 'the configured endpoint on the server' : 'none'}
                  </p>
                </div>
                <div>
                  <p className="text-text-primary font-medium mb-1">Untrusted notes</p>
                  <p className="leading-relaxed">{lastResponse.untrustedNotes.note}</p>
                </div>
              </div>
            )}

            <DataStateNote>
              Queries are read-only. The service validates and length-caps every question, caps how much of each series
              is selected, and writes no health value to any log.
            </DataStateNote>
          </div>
        </Card>
      </div>

      {/* ── Educational notice ─────────────────────── */}
      <p className="text-[11px] text-text-secondary text-center leading-relaxed max-w-2xl mx-auto">
        This tool interprets your personal health data for informational purposes only. It does not diagnose, treat or
        rule anything out, and it is not a substitute for advice from a qualified healthcare provider. Association does
        not establish causation, and a personal baseline is not a medical reference range.
      </p>
    </div>
  );
}

// ── Pending state ──────────────────────────────────────

function AnswerPending() {
  return (
    <div className="flex gap-3" role="status" aria-live="polite">
      <div className="w-8 h-8 rounded-full bg-accent-tint text-primary flex items-center justify-center shrink-0">
        <Bot size={15} aria-hidden="true" />
      </div>
      <Card className="flex-1 p-4 space-y-3" variant="muted">
        <span className="sr-only">Waiting for the analyst answer</span>
        <Skeleton height={14} width="40%" />
        <Skeleton height={12} width="90%" />
        <Skeleton height={12} width="80%" />
        <Skeleton height={56} />
      </Card>
    </div>
  );
}

// ── Answer ─────────────────────────────────────────────

function AnswerView({ response, onFollowUp }: { response: AnalystResponse; onFollowUp: (q: string) => void }) {
  const answer = response.answer;

  if (!answer) {
    return (
      <div className="flex gap-3">
        <div className="w-8 h-8 rounded-full bg-surface-muted text-text-secondary flex items-center justify-center shrink-0">
          <Bot size={15} aria-hidden="true" />
        </div>
        <Card className="flex-1 p-4" variant="muted">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="warning" className="text-[10px]">
              {STATUS_LABEL[response.status] ?? 'No answer'}
            </Badge>
          </div>
          <p className="text-sm text-text-primary mb-3">{response.message}</p>
          <p className="text-[11px] text-text-secondary mb-2">Supported questions:</p>
          <div className="flex flex-wrap gap-2">
            {response.suggested.map(q => (
              <button
                key={q}
                type="button"
                onClick={() => onFollowUp(q)}
                className="px-3 py-2 text-xs rounded-full bg-surface text-text-secondary hover:text-text-primary transition-colors min-h-[44px]"
              >
                {q}
              </button>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-accent-tint text-primary flex items-center justify-center shrink-0">
        <Bot size={15} aria-hidden="true" />
      </div>
      <Card className="flex-1 p-4 space-y-4" as="article">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="accent" className="text-[10px]">{response.label}</Badge>
          <span className="text-[11px] text-text-secondary">
            {response.providerConfigured ? (
              <>
                generated by <code>{response.model ?? 'the configured model'}</code> via {response.providerDisplayName},
                validated against the selected context
              </>
            ) : (
              <>
                computed by handler <code>{response.handlerId}</code>
              </>
            )}
          </span>
        </div>

        <h2 className="text-base font-semibold text-text-primary">{answer.title}</h2>

        {ANSWER_SECTIONS.map(section => {
          const lines = section.pick(answer);
          if (lines.length === 0) return null;
          return (
            <section key={section.heading}>
              <h3 className="text-[10px] uppercase tracking-wider text-text-secondary mb-1.5">{section.heading}</h3>
              <ul className="list-disc pl-5 space-y-1.5">
                {lines.map((line, i) => (
                  <li key={i} className="text-sm text-text-primary leading-relaxed">{line}</li>
                ))}
              </ul>
            </section>
          );
        })}

        {answer.charts.length > 0 && (
          <div className="space-y-3">
            {answer.charts.slice(0, 2).map(chart => (
              <TrendFigure
                key={`${chart.metricId}-${chart.caption}`}
                metricId={chart.metricId}
                data={chart.points}
                caption={chart.caption}
                height={72}
              />
            ))}
          </div>
        )}

        {answer.evidence.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[10px] uppercase tracking-wider text-text-secondary">Evidence</h3>
            {answer.evidence.map((ev, i) => (
              <div key={`${ev.metricId}-${i}`} className="border border-border rounded-control p-3">
                <div className="flex flex-wrap items-baseline gap-2 mb-1">
                  <Badge variant="default" className="text-[10px]">Metric</Badge>
                  <span className="text-sm font-medium text-text-primary">{ev.metricName}</span>
                </div>
                <dl className="text-[11px] text-text-secondary space-y-0.5">
                  <EvRow label="Window" value={ev.windowLabel} />
                  <EvRow label="Aggregation" value={ev.aggregation} />
                  <EvRow label="Sample count" value={ev.sampleCount} />
                </dl>
                <Link href={ev.href} className="inline-block mt-2 text-xs text-primary hover:underline">
                  Open the underlying chart or records
                </Link>
              </div>
            ))}
          </div>
        )}

        {response.grounding.unmatched.length > 0 && (
          <div className="rounded-control border border-category-attention/40 p-3">
            <p className="text-[11px] text-category-attention leading-relaxed">
              These figures were not found in the selected context: {response.grounding.unmatched.join(', ')}. They are
              shown as the model wrote them rather than removed, so you can see exactly which claims are unverified.
            </p>
          </div>
        )}

        <div className="flex items-start gap-2 pt-1">
          <ShieldCheck size={13} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden="true" />
          <p className="text-[11px] text-text-secondary leading-relaxed">{answer.boundaryNote}</p>
        </div>

        {answer.followUps.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {answer.followUps.map(q => (
              <button
                key={q}
                type="button"
                onClick={() => onFollowUp(q)}
                className="px-3 py-2 text-xs rounded-full bg-surface-muted text-text-secondary hover:text-text-primary transition-colors min-h-[44px]"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  unsupported: 'Not supported',
  misconfigured: 'Provider misconfigured',
  error: 'Provider error',
  ok: 'Answer',
};

const ANSWER_SECTIONS: { heading: string; pick: (a: AnalystAnswer) => string[] }[] = [
  { heading: '1 · Observed measurements', pick: a => a.observed },
  { heading: '2 · Possible interpretation', pick: a => a.interpretation },
  { heading: '3 · Missing context and uncertainty', pick: a => a.uncertainty },
];

function EvRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="tnum text-text-primary text-right">{value}</dd>
    </div>
  );
}
