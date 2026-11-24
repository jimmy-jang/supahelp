import { useEffect, useRef, useState } from 'react';
import type {
  PlaybookContent,
  PlaybookRecord,
  ScreenshotPreview,
} from '../../../contracts/playbooks';
import type { useConfirmation } from '../../components/ConfirmationProvider';
import type { usePlaybooks } from './usePlaybooks';

export function usePlaybookEditor(
  p: PlaybookRecord,
  documents: ReturnType<typeof usePlaybooks>,
  removed: boolean,
  guard: React.RefObject<() => Promise<boolean>>,
  confirm: ReturnType<typeof useConfirmation>,
) {
  const saved = p.draft ??
    p.published ?? { title: 'Untitled Playbook', markdown: '' };
  const [content, setContent] = useState<PlaybookContent>(saved);
  const [titleDraft, setTitleDraft] = useState<string>();
  const [editing, setEditing] = useState(!!p.draft);
  const [review, setReview] = useState<{ shot: ScreenshotPreview }>();
  const [base, setBase] = useState({ version: p.version, content: saved });
  const saving = useRef(false);
  const titleDirty = titleDraft !== undefined && titleDraft !== content.title;
  const dirty =
    titleDirty || JSON.stringify(content) !== JSON.stringify(base.content);
  const busy = documents.busy;
  const conflict = removed || p.version > base.version;
  useEffect(() => {
    if (!dirty && !saving.current && p.version > base.version) {
      setContent(saved);
      setBase({ version: p.version, content: saved });
      setEditing(!!p.draft);
    }
  }, [p.version, dirty, base.version]);
  const leaveState = useRef({
    content,
    titleDraft,
    review,
    version: p.version,
    busy,
  });
  leaveState.current = {
    content,
    titleDraft,
    review,
    version: p.version,
    busy,
  };
  const unchanged = (before: typeof leaveState.current) => {
    const now = leaveState.current;
    return (
      before.content === now.content &&
      before.titleDraft === now.titleDraft &&
      before.review === now.review &&
      before.version === now.version &&
      before.busy === now.busy
    );
  };
  const checkLeave = useRef<() => Promise<boolean>>(async () => true);
  const guardHandler = useRef(() => checkLeave.current());
  checkLeave.current = async () => {
    if (busy) return false;
    const state = leaveState.current;
    if (
      (dirty || review) &&
      !(await confirm({
        title: 'Discard unsaved Playbook edits?',
        description:
          'Your unsaved changes will be lost. Saved drafts and published versions will stay as they are.',
        cancel: 'Keep editing',
        action: 'Discard changes',
        danger: true,
      }))
    )
      return false;
    if (!unchanged(state)) return false;
    if (review) documents.cancel();
    return true;
  };
  guard.current = guardHandler.current;
  useEffect(() => {
    guard.current = guardHandler.current;
    return () => {
      if (guard.current === guardHandler.current)
        guard.current = async () => true;
    };
  }, [guard]);
  useEffect(() => {
    if (!dirty && !busy && !review) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty, busy, review]);
  const save = async (candidate = content) => {
    if (busy || conflict || saving.current) return;
    saving.current = true;
    try {
      const result = await documents.run('savePlaybookDraft', {
        id: p.id,
        version: base.version,
        content: candidate,
      });
      if (result) {
        const next = result.draft ?? result.published ?? content;
        setContent(next);
        setBase({ version: result.version, content: next });
        setTitleDraft(undefined);
        setEditing(true);
        return next.title;
      }
    } finally {
      saving.current = false;
    }
  };

  return {
    saved,
    content,
    setContent,
    titleDraft,
    setTitleDraft,
    editing,
    setEditing,
    review,
    setReview,
    base,
    setBase,
    titleDirty,
    dirty,
    busy,
    conflict,
    leaveState,
    unchanged,
    save,
  };
}
