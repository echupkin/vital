'use client';

// ── Conversation selector (SPEC §8) ─────────────────────
//
// The list of conversations beside the analyst: newest activity first, each with
// its title and when it was last active. Selecting one loads its turns; "New
// conversation" starts an empty one.
//
// Every conversation here came from the server (see useConversations), so the
// history survives a refresh, a different browser and a different device.
//
// When the server reports that nothing is being saved, this says so plainly —
// it never shows a saved-looking list that would not survive a refresh.
//
// Mobile: the list collapses behind a toggle. Every control is a real button,
// reachable by keyboard, with a 44 px minimum touch target, and only the
// project's existing design tokens are used.

import { useEffect, useRef, useState } from 'react';
import { Check, MessageSquarePlus, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { Badge, Button, Card, Dialog } from '@/components/ui/primitives';
import type { ConversationAvailability, ConversationSummary } from '@/lib/analyst/conversation-types';

export interface ConversationSelectorProps {
  availability: ConversationAvailability;
  conversations: ConversationSummary[];
  activeId: number | null;
  loading: boolean;
  error: string | null;
  onSelect: (id: number | null) => void;
  onCreate: () => void;
  onRename: (id: number, title: string) => void;
  onDelete: (id: number) => void;
  onRefresh: () => void;
}

/** A stable, deterministic "when" — UTC so the server and the client agree. */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown time';
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${day}, ${time}`;
}

export function ConversationSelector({
  availability,
  conversations,
  activeId,
  loading,
  error,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onRefresh,
}: ConversationSelectorProps) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState<ConversationSummary | null>(null);
  const draftRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId !== null) draftRef.current?.focus();
  }, [editingId]);

  const startRename = (conversation: ConversationSummary) => {
    setEditingId(conversation.id);
    setDraft(conversation.title);
  };

  const commitRename = () => {
    if (editingId === null) return;
    const title = draft.trim();
    if (title.length > 0) onRename(editingId, title);
    setEditingId(null);
  };

  return (
    <Card className="p-3 space-y-3" as="section">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-text-primary min-h-[44px]">
          Conversations
          <Badge variant="default" className="text-[10px]">{conversations.length}</Badge>
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh the conversation list"
            className="w-11 h-11 flex items-center justify-center rounded-control text-text-secondary hover:text-text-primary transition-colors"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
          {/* The collapse control on small screens, where the list is not a column. */}
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            aria-controls="analyst-conversations"
            aria-label={open ? 'Hide the conversation list' : 'Show the conversation list'}
            className="lg:hidden w-11 h-11 flex items-center justify-center rounded-control text-text-secondary hover:text-text-primary transition-colors"
          >
            {open ? <Check size={15} aria-hidden="true" /> : <MessageSquarePlus size={15} aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div id="analyst-conversations" hidden={!open} className="space-y-3 lg:!block">
        {!availability.available && (
          <p className="text-[11px] text-text-secondary leading-relaxed">
            <strong className="font-medium text-text-primary">Not being saved.</strong>{' '}
            {availability.reason ??
              'No database is configured, so these conversations live in this browser tab only and will not survive a refresh.'}
          </p>
        )}

        {error && <p className="text-[11px] text-category-attention leading-relaxed">{error}</p>}

        <Button variant="primary" size="sm" onClick={onCreate} className="w-full min-h-[44px]">
          <MessageSquarePlus size={14} className="mr-1.5" aria-hidden="true" />
          New conversation
        </Button>

        {conversations.length === 0 ? (
          <p className="text-[11px] text-text-secondary leading-relaxed">
            {availability.available ? 'No conversations yet. Ask a question to start one.' : 'Nothing to list.'}
          </p>
        ) : (
          <ul className="list-none p-0 m-0 space-y-1 max-h-[40vh] lg:max-h-[60vh] overflow-y-auto">
            {conversations.map(conversation => {
              const active = conversation.id === activeId;
              const editing = conversation.id === editingId;
              return (
                <li key={conversation.id}>
                  {editing ? (
                    <div className="flex items-center gap-1">
                      <label className="flex-1">
                        <span className="sr-only">New title for {conversation.title}</span>
                        <input
                          ref={draftRef}
                          value={draft}
                          onChange={e => setDraft(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitRename();
                            }
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          maxLength={120}
                          className="w-full bg-surface-muted border border-border rounded-control px-2 py-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-accent min-h-[44px]"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={commitRename}
                        aria-label={`Save the new title for ${conversation.title}`}
                        className="w-11 h-11 flex items-center justify-center rounded-control text-primary"
                      >
                        <Check size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        aria-label={`Cancel renaming ${conversation.title}`}
                        className="w-11 h-11 flex items-center justify-center rounded-control text-text-secondary"
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <div
                      className={`flex items-stretch gap-1 rounded-control ${
                        active ? 'bg-accent-tint' : 'bg-surface-muted'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(conversation.id)}
                        aria-current={active ? 'true' : undefined}
                        className="flex-1 min-w-0 text-left px-3 py-2 min-h-[44px]"
                      >
                        <span className="block text-xs text-text-primary truncate">{conversation.title}</span>
                        <span className="block text-[10px] text-text-secondary truncate tnum">
                          {conversation.messageCount} {conversation.messageCount === 1 ? 'turn' : 'turns'} · {formatWhen(conversation.updatedAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => startRename(conversation)}
                        aria-label={`Rename ${conversation.title}`}
                        className="w-11 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <Pencil size={13} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(conversation)}
                        aria-label={`Delete ${conversation.title}`}
                        className="w-11 flex items-center justify-center text-text-secondary hover:text-category-attention transition-colors"
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Delete this conversation?"
      >
        <p className="text-sm text-text-primary leading-relaxed mb-4">
          {confirming ? `“${confirming.title}”` : 'This conversation'} and all of its messages will be removed from
          the database. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirming(null)}>Keep it</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirming) onDelete(confirming.id);
              setConfirming(null);
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}