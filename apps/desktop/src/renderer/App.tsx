import { useEffect, useRef, useState } from 'react';
import type { Conversation } from '../contracts/chat';
import type { CaseNotification } from '../contracts/sync';
import type { PlaybookRecord } from '../contracts/playbooks';
import { useCaseLinks } from './app/useCaseLinks';
import { useDocumentPanel } from './app/useDocumentPanel';
import { Icon, IconButton } from './components/Icon';
import { FindBar } from './components/FindBar';
import { InlineTitle } from './components/InlineTitle';
import { useAccount } from './features/accounts/AccountProvider';
import { CasePanel } from './features/cases/CasePanel';
import { ResolutionReview } from './features/cases/ResolutionReview';
import { ResolveControls } from './features/cases/ResolveControls';
import { SeenBefore } from './features/cases/SeenBefore';
import { looksLikeTicket } from './features/cases/caseDoc';
import { sortCases } from './features/cases/sortCases';
import { STATUS } from './features/cases/status';
import type { Attached, Target } from './features/cases/types';
import { useCases } from './features/cases/useCases';
import type { CaseTools } from './features/chat/ChatView';
import { Home, Thread } from './features/chat/ChatView';
import type { Msg } from './features/chat/types';
import { useConversations } from './features/chat/useConversations';
import { usePreviewConversations } from './features/chat/usePreviewConversations';
import {
  NotificationBell,
  NotificationsPage,
} from './features/collaboration/Notifications';
import { Onboarding } from './features/onboarding/Onboarding';
import { LocalPlaybookDoc } from './features/playbooks/LocalPlaybookDoc';
import { FileApprovalCard } from './features/chat/FileApprovalCard';
import { PlaybookChatCard } from './features/playbooks/PlaybookChatCard';
import { PlaybookDoc } from './features/playbooks/PlaybookDoc';
import { usePlaybooks } from './features/playbooks/usePlaybooks';
import { SettingsView, settingsTitle } from './features/settings/SettingsView';
import type { SettingsPage } from './features/settings/pages';
import { PrivacyReview } from './features/sync/PrivacyReview';
import { SyncStatus } from './features/sync/SyncStatus';
import {
  QuickTour,
  TourClosedNote,
  type TourOutcome,
} from './features/tour/QuickTour';
import { useQuickTour } from './features/tour/useQuickTour';
import { hasCommandKey, shortcutLabel } from './components/shortcuts';
import { Sidebar, type View } from './layout/Sidebar';

export function App() {
  const { snapshot: account, isCurrent } = useAccount();
  const workspace = account.context.context;
  const team = workspace.kind === 'team';
  const workspaceId =
    workspace.kind === 'team' ? workspace.workspaceId : undefined;
  const [syncNotice, setSyncNotice] = useState('');
  const [creatingSharedCase, setCreatingSharedCase] = useState(false);
  const [syncRevision, setSyncRevision] = useState(0);
  const live = useConversations();
  const preview = usePreviewConversations();
  const stored = useCases();
  const documents = usePlaybooks();
  const [creatingPlaybook, setCreatingPlaybook] = useState(false);
  const [createPlaybookError, setCreatePlaybookError] = useState(false);
  const creatingPlaybookRef = useRef(false);
  const {
    chats: allPreviewChats,
    cases: allPreviewCases,
    playbooks: allPlaybooks,
    addToChat,
    addToCase,
    createCase,
    keepChat,
    approve,
  } = preview;
  const previewChats = team ? [] : allPreviewChats;
  const previewCases = team ? [] : allPreviewCases;
  const playbooks = documents.playbooks.map((p) => ({
    id: p.id,
    title: (p.draft ?? p.published)?.title ?? 'Untitled Playbook',
    authorId: 'local',
    published: p.publishedAt ?? '',
    uses: 0,
    what: (p.draft ?? p.published)?.markdown ?? '',
    steps: [],
  }));
  const chats = live.chats.map((chat) => ({
    ...chat,
    messages: [],
    attached: { playbookIds: [] },
  }));
  const cases = sortCases(stored.cases);
  // Real chats where you chose "Keep as chat" (in memory, like the chats).
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const startingChat = useRef(false);
  const [view, setView] = useState<View>(() =>
    account.pendingInvitation
      ? { kind: 'settings', page: account.view ? 'workspace' : 'account' }
      : account.view &&
          account.view.onboarding === undefined &&
          !account.view.organizations.length
        ? { kind: 'settings', page: 'account' }
        : { kind: 'home' },
  );
  const [sidebar, setSidebar] = useState(true);
  const [find, setFind] = useState<{
    scope: HTMLElement;
    token: number;
  } | null>(null);
  const {
    panel,
    panelRef,
    setPanel,
    setPanelRaw,
    playbookGuard,
    leavePlaybook,
    expanded,
    setExpanded,
  } = useDocumentPanel();
  // Like a browser, find closes when you move to another chat or document.
  const viewKey = 'id' in view ? view.id : view.kind;
  useEffect(() => setFind(null), [viewKey, panel?.kind, panel?.id]);
  // Where Esc or the back button returns to from Settings.
  const [beforeSettings, setBeforeSettings] = useState<View>({ kind: 'home' });
  const [previousWorkspace, setPreviousWorkspace] = useState(workspaceId);
  if (previousWorkspace !== workspaceId) {
    setPreviousWorkspace(workspaceId);
    if (account.context.accountId || view.kind !== 'settings')
      setView({ kind: 'home' });
    setBeforeSettings({ kind: 'home' });
    setPanelRaw(null);
    setExpanded(false);
    setSyncNotice('');
    setFind(null);
  }

  const openSettings = async (page: SettingsPage) => {
    if (view.kind !== 'settings' && !(await leavePlaybook())) return;
    setExpanded(false);
    setView((v) => {
      if (v.kind !== 'settings') setBeforeSettings(v);
      return { kind: 'settings', page };
    });
  };
  const closeSettings = () => setView(beforeSettings);
  useEffect(() => {
    if (account.billingReturnId) void openSettings('billing');
  }, [account.billingReturnId]);
  useEffect(() => {
    if (account.pendingInvitation)
      void openSettings(account.view ? 'workspace' : 'account');
  }, [account.pendingInvitation?.id, account.view?.account.id]);
  useEffect(() => {
    if (
      !account.pendingInvitation &&
      account.view &&
      account.view.onboarding === undefined &&
      !account.view.organizations.length
    )
      openSettings('account');
  }, [account.view?.account.id]);
  // Post-sign-up onboarding takes the whole window until the user finishes it.
  const needsOnboarding =
    (account.view?.onboarding === null ||
      account.view?.onboardingCompleted === false) &&
    !account.pendingInvitation;
  const [onboarding, setOnboarding] = useState(needsOnboarding);
  useEffect(() => {
    if (needsOnboarding) setOnboarding(true);
  }, [needsOnboarding]);
  const tour = useQuickTour({
    loaded:
      live.revision >= 0 && stored.revision >= 0 && documents.revision >= 0,
    hasWork:
      live.chats.length > 0 ||
      stored.cases.length > 0 ||
      documents.playbooks.length > 0,
    onHome: view.kind === 'home' && !onboarding && !account.pendingInvitation,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape' && view.kind === 'settings') {
        // Let open menus and focused fields handle Escape first.
        if (
          e.defaultPrevented ||
          document.querySelector('[role=menu], :popover-open')
        )
          return;
        setView(beforeSettings);
        return;
      }
      if (!hasCommandKey(e)) return;
      if (e.key === '\\') {
        e.preventDefault();
        setSidebar((s) => !s);
      } else if (e.key === 'n') {
        e.preventDefault();
        void newChat();
      } else if (e.key === ',') {
        e.preventDefault();
        openSettings('general');
      } else if (e.key === 'f') {
        // The pane holding focus wins, else the first one (the chat).
        const within = (node?: Node | null) =>
          (node instanceof Element
            ? node
            : node?.parentElement
          )?.closest<HTMLElement>('[data-find-scope]');
        // Focused pane, else the pane last clicked (caret), else the first.
        const scope =
          within(document.activeElement) ??
          within(document.getSelection()?.anchorNode) ??
          document.querySelector<HTMLElement>('[data-find-scope]');
        if (!scope) return;
        e.preventDefault();
        setFind((f) => ({ scope, token: (f?.token ?? 0) + 1 }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view.kind, beforeSettings, account.context.generation]);

  const home = async () => {
    if (!(await setPanel(null))) return;
    setView({ kind: 'home' });
  };
  const newChat = home;
  const finishTour = (outcome: TourOutcome) => {
    tour.close(outcome === 'skip');
    if (outcome === 'model') void openSettings('models');
    else if (outcome === 'helpdesk') void openSettings('connections');
    else if (outcome === 'ready')
      void home().then(() =>
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>('main textarea')?.focus(),
        ),
      );
  };
  const openChat = async (id: string) => {
    const caseId =
      previewChats.find((c) => c.id === id)?.attached.caseId ??
      stored.cases.find((c) => c.chatId === id)?.id;
    if (!(await setPanel(caseId ? { kind: 'case', id: caseId } : null))) return;
    setView({ kind: 'chat', id });
  };
  const resumeCaseChat = (caseId: string) =>
    void documents.resumeCase(caseId).then((id) => {
      if (id) setView({ kind: 'chat', id });
    });
  // A case opens beside the chat it was created from, or its own chat.
  const openCase = async (id: string) => {
    const c = cases.find((x) => x.id === id);
    if (!(await setPanel({ kind: 'case', id }))) return;
    // Team cases may not be in the local list yet (just created or synced).
    if (team || (c && !c.example)) resumeCaseChat(id);
    else
      setView(
        c?.chatId ? { kind: 'chat', id: c.chatId } : { kind: 'case', id },
      );
  };
  const queueCaseLink = async (id: string) => {
    if (
      stored.records.some((c) => c.id === id && c.workspaceId === 'personal')
    ) {
      await openCase(id);
      return true;
    }
    const r = await window.supahelp.openCaseLink({
      context: account.context,
      id,
    });
    if (!r.ok) setSyncNotice(r.error);
    return r.ok;
  };
  const openNotifications = async () => {
    if (!(await setPanel(null))) return;
    setView({ kind: 'notifications' });
  };
  // A Playbook notification from another workspace switches there first, then opens once synced.
  // ponytail: pending id lives until that Playbook appears; clear on timeout if it ever lingers.
  const [pendingPlaybook, setPendingPlaybook] = useState<string>();
  useEffect(() => {
    if (
      !pendingPlaybook ||
      !documents.playbooks.some((p) => p.id === pendingPlaybook)
    )
      return;
    setPendingPlaybook(undefined);
    void openPlaybook(pendingPlaybook);
  }, [pendingPlaybook, documents.playbooks]);
  const openNotification = async (e: CaseNotification) => {
    if (!e.category.startsWith('playbook-')) return queueCaseLink(e.documentId);
    const unavailable = () => {
      setSyncNotice(
        'This Playbook is unavailable or you no longer have access.',
      );
      return false;
    };
    if (e.workspaceId && e.workspaceId !== workspaceId) {
      const w = account.view?.workspaces.find((x) => x.id === e.workspaceId);
      if (!w) return unavailable();
      if (!(await leavePlaybook())) return false;
      setPendingPlaybook(e.documentId);
      const r = await window.supahelp.selectWorkspace({
        kind: 'team',
        organizationId: w.organizationId,
        workspaceId: w.id,
      });
      if (r.ok) return true;
      setPendingPlaybook(undefined);
      setSyncNotice(r.error);
      return false;
    }
    if (!documents.playbooks.some((p) => p.id === e.documentId))
      return unavailable();
    await openPlaybook(e.documentId);
    return true;
  };
  const notificationProps = {
    collaboration: stored.collaboration,
    onOpen: openNotification,
    titleOf: (id: string) =>
      cases.find((c) => c.id === id)?.title ??
      playbooks.find((p) => p.id === id)?.title,
  };
  const bell = (
    <NotificationBell {...notificationProps} onViewAll={openNotifications} />
  );
  useCaseLinks({
    setPanel,
    leavePlaybook,
    openSettings,
    resumeCaseChat,
    setSyncNotice,
  });
  const openAttached = (t: Target) =>
    void setPanel(
      'caseId' in t
        ? { kind: 'case', id: t.caseId }
        : { kind: 'playbook', id: t.playbookId },
    );
  const openPlaybook = async (id: string) => {
    if (!(await setPanel({ kind: 'playbook', id }))) return;
    if (view.kind === 'settings') setView(beforeSettings);
    // Like a case, each Playbook has its own chat beside it.
    if (team) return;
    // Called directly so a failure never shows as a document error.
    const context = account.context;
    void window.supahelp
      .resumePlaybook({ context, id })
      .then((r) => {
        if (r.ok && isCurrent(context) && panelRef.current?.id === id)
          setView({ kind: 'chat', id: r.value });
      })
      .catch(() => {});
  };
  const renameItem: React.ComponentProps<
    typeof Sidebar
  >['onRenameItem'] = async (kind, id, title, expectedTitle) => {
    if (kind === 'chat') return live.rename(id, title, expectedTitle);
    if (kind === 'case') return stored.rename(id, title, expectedTitle);
    const book = documents.playbooks.find((p) => p.id === id);
    const content = book?.draft ?? book?.published;
    if (!book || !content) throw Error('This Playbook is unavailable.');
    if (content.title !== expectedTitle)
      throw Error('This title changed. Cancel to load the current title.');
    const result = await window.supahelp.savePlaybookDraft({
      context: account.context,
      id,
      version: book.version,
      content: { ...content, title },
    });
    if (!isCurrent(account.context))
      throw Error('The account or workspace changed.');
    if (!result.ok) throw Error(result.error);
    return result.value.draft?.title ?? title;
  };
  const removeItem: React.ComponentProps<
    typeof Sidebar
  >['onRemoveItem'] = async (kind, id) => {
    const context = account.context;
    const result =
      kind === 'chat'
        ? await window.supahelp.removeChat({ context, chatId: id })
        : kind === 'case'
          ? await window.supahelp.removeCase({ context, caseId: id })
          : await window.supahelp.removePlaybook({
              context,
              id,
              version: documents.playbooks.find((book) => book.id === id)
                ?.version,
            });
    if (!isCurrent(context)) return;
    if (!result.ok) throw Error(result.error);
    setPanelRaw((old) => (old?.kind === kind && old.id === id ? null : old));
    if (kind !== 'playbook') {
      const dismiss = (old: View): View =>
        old.kind === kind && old.id === id ? { kind: 'home' } : old;
      setView(dismiss);
      setBeforeSettings(dismiss);
    }
  };
  const tools = (threadId: string, attached: Attached): CaseTools => ({
    attach: {
      attached,
      cases: allPreviewCases,
      playbooks: allPlaybooks,
      onAttach: async (t) => {
        if ('caseId' in t && !(await setPanel({ kind: 'case', id: t.caseId })))
          return;
        preview.attach(threadId, t);
      },
      onDetach: (t) => preview.detach(threadId, t),
    },
    onUndo: (i) => preview.undo(threadId, i),
    onView: (id, section) => {
      void setPanel({
        kind: 'case',
        id,
        focus: { section, token: Date.now() },
      });
    },
    onResolveChoice: async (i, choice) => {
      if (!(await setPanel(null))) return;
      const id = preview.resolveChoice(threadId, i, choice);
      if (id) setPanel({ kind: 'playbook', id });
    },
    onOpenPlaybook: (id) => setPanel({ kind: 'playbook', id }),
  });

  const chat =
    view.kind === 'chat'
      ? previewChats.find((c) => c.id === view.id)
      : undefined;
  const realChat =
    view.kind === 'chat' ? live.chats.find((c) => c.id === view.id) : undefined;
  const completedChat = useRef<Conversation | undefined>(undefined);
  useEffect(() => {
    const previous = completedChat.current;
    if (!realChat || previous?.id !== realChat.id || realChat.status === 'idle')
      completedChat.current = realChat;
    if (!realChat || realChat.status !== 'idle' || previous?.id !== realChat.id)
      return;
    const saved = new Set(
      previous.messages
        .filter((message) => message.role === 'case')
        .map((message) => message.changeId),
    );
    const update = realChat.messages.findLast(
      (message) =>
        message.role === 'case' &&
        message.section !== 'resolution' &&
        !saved.has(message.changeId),
    );
    if (update?.role === 'case')
      void setPanel({ kind: 'case', id: update.caseId });
  }, [realChat]);
  const kase =
    view.kind === 'case'
      ? previewCases.find((c) => c.id === view.id)
      : undefined;
  const realCase = realChat
    ? stored.cases.find((c) =>
        stored.records
          .find((r) => r.id === c.id)
          ?.chatIds.includes(realChat.id),
      )
    : undefined;
  async function createRealCase() {
    if (!realChat || !(await setPanel(null))) return;
    const id = await stored.create(realChat.id);
    if (id) await setPanel({ kind: 'case', id });
  }
  async function newSharedCase() {
    const context = account.context;
    if (creatingSharedCase || !(await leavePlaybook()) || !isCurrent(context))
      return;
    setCreatingSharedCase(true);
    try {
      const reply = await window.supahelp.createTeamCase(context);
      if (!isCurrent(context)) return;
      if (!reply.ok) setSyncNotice(reply.error);
      else if (
        (await setPanel({ kind: 'case', id: reply.value })) &&
        isCurrent(context)
      ) {
        setSyncNotice('');
        resumeCaseChat(reply.value);
      }
    } catch {
      if (isCurrent(context))
        setSyncNotice('The shared case could not be created.');
    } finally {
      setCreatingSharedCase(false);
    }
  }
  async function newPlaybook() {
    if (creatingPlaybookRef.current || documents.busy) return;
    creatingPlaybookRef.current = true;
    setCreatingPlaybook(true);
    setCreatePlaybookError(false);
    try {
      if (!(await setPanel(null))) return;
      const p = await documents.run('savePlaybookDraft', {
        version: 0,
        content: { title: 'Untitled Playbook', markdown: '' },
      });
      if (p) await openPlaybook(p.id);
      else if (isCurrent(account.context)) setCreatePlaybookError(true);
    } finally {
      creatingPlaybookRef.current = false;
      setCreatingPlaybook(false);
    }
  }
  const offerCase =
    !team &&
    !!realChat &&
    !realCase &&
    realChat.status === 'idle' &&
    !kept.has(realChat.id) &&
    realChat.messages.some((m) => m.role === 'user' && looksLikeTicket(m.text));

  const panelCase =
    panel?.kind === 'case' ? cases.find((c) => c.id === panel.id) : undefined;
  const panelRecord = stored.records.find((r) => r.id === panelCase?.id);
  const review = realChat?.resolutionReview;
  const reviewedDraft =
    realCase && realCase.status !== 'done' && review
      ? documents.resolutions.find(
          (draft) =>
            !draft.committed &&
            draft.caseId === realCase.id &&
            draft.id === review.id &&
            draft.version === review.version,
        )
      : undefined;
  const panelPlaybook =
    panel?.kind === 'playbook'
      ? playbooks.find((p) => p.id === panel.id)
      : undefined;
  const panelProps = {
    expanded,
    onExpand: () => setExpanded((x) => !x),
    onClose: () => {
      void setPanel(null);
    },
  };
  const localPlaybook =
    panel?.kind === 'playbook'
      ? documents.playbooks.find((p) => p.id === panel.id)
      : undefined;
  const lastPlaybook = useRef<PlaybookRecord | undefined>(undefined);
  if (!team && localPlaybook) lastPlaybook.current = localPlaybook;
  const retainedContext = useRef(account.context.generation);
  if (retainedContext.current !== account.context.generation) {
    lastPlaybook.current = undefined;
    retainedContext.current = account.context.generation;
  }
  const removedPlaybook =
    !team &&
    !localPlaybook &&
    panel?.kind === 'playbook' &&
    lastPlaybook.current?.id === panel.id;
  const displayedPlaybook =
    localPlaybook ?? (removedPlaybook ? lastPlaybook.current : undefined);
  const createdPlaybook = panelCase
    ? documents.playbooks.find(
        (p) => (p.sourceCaseId ?? p.draftFrom) === panelCase.id,
      )
    : undefined;
  const panelNode = panelCase ? (
    <CasePanel
      key={`${panelCase.id}/${panelRecord?.securityGeneration ?? 0}`}
      kase={panelCase}
      createdPlaybook={createdPlaybook}
      record={panelRecord}
      actions={panelCase.example ? undefined : stored}
      draftResolution={
        documents.resolutions.find(
          (r) => r.caseId === panelCase.id && !r.committed,
        )?.text
      }
      seenBefore={
        !panelCase.example &&
        (() => {
          const record = stored.records.find((c) => c.id === panelCase.id);
          return (
            record && (
              <SeenBefore
                record={record}
                revision={stored.revision}
                documents={documents}
                chat={
                  realChat && record.chatIds.includes(realChat.id)
                    ? realChat
                    : undefined
                }
                onOpenCase={openCase}
                onOpenPlaybook={openPlaybook}
              />
            )
          );
        })()
      }
      resolveControls={
        panelRecord &&
        (team && panelRecord.ownerId !== account.context.accountId ? (
          <p className="m-0 border-b border-line pb-3 text-meta text-ink-2">
            The case owner can resolve or reopen this shared case.
          </p>
        ) : (
          <ResolveControls
            kase={panelCase}
            chatId={realCase?.id === panelCase.id ? realChat?.id : undefined}
            shared={team}
            documents={documents}
            hasCreatedPlaybook={!!createdPlaybook}
            onOpenPlaybook={openPlaybook}
          />
        ))
      }
      playbookTitle={
        playbooks.find((p) => p.id === panelCase.doc.playbook?.id)?.title
      }
      focus={panel?.kind === 'case' ? panel.focus : undefined}
      {...(panelCase.example && {
        onBringIn: (m: string) => preview.bringIn(panelCase.id, m),
        onHandOff: (m: string) => preview.handOff(panelCase.id, m),
      })}
      onOpenPlaybook={openPlaybook}
      onOpenCase={openCase}
      caseLookup={panelCase.example ? previewCases : cases}
      playbookLookup={
        panelCase.example
          ? allPlaybooks
          : playbooks.filter((p) =>
              documents.playbooks.some(
                (doc) => doc.id === p.id && doc.published,
              ),
            )
      }
      onCopyMarkdown={
        panelCase.example ? undefined : () => stored.markdown(panelCase.id)
      }
      {...panelProps}
    />
  ) : displayedPlaybook ? (
    <LocalPlaybookDoc
      key={`${displayedPlaybook.id}/${displayedPlaybook.securityGeneration ?? 0}`}
      playbook={displayedPlaybook}
      removed={removedPlaybook}
      documents={documents}
      guard={playbookGuard}
      {...panelProps}
    />
  ) : panelPlaybook ? (
    <PlaybookDoc
      key={panelPlaybook.id}
      playbook={panelPlaybook}
      onPublish={() => preview.publish(panelPlaybook.id)}
      onDiscard={() => preview.discardDraft(panelPlaybook.id)}
      onAddScreenshot={() => preview.addScreenshot(panelPlaybook.id)}
      onToggleShot={(step, key) =>
        preview.toggleShot(panelPlaybook.id, step, key)
      }
      {...panelProps}
    />
  ) : null;

  const count = (keys: (keyof typeof STATUS)[]) =>
    cases.filter((c) => keys.includes(c.status)).length;

  const title = kase?.title ?? chat?.title ?? realChat?.title;

  if (onboarding) return <Onboarding onDone={() => setOnboarding(false)} />;

  return (
    <div className="flex h-full">
      {sidebar && (
        <Sidebar
          chats={chats.filter((c) => !c.playbookId)}
          cases={cases}
          playbooks={playbooks}
          draftCaseIds={
            new Set(
              documents.resolutions
                .filter((r) => !r.committed)
                .map((r) => r.caseId),
            )
          }
          draftPlaybookIds={
            new Set(documents.playbooks.filter((p) => p.draft).map((p) => p.id))
          }
          openPlaybook={panel?.kind === 'playbook' ? panel.id : undefined}
          onContextChange={leavePlaybook}
          creatingPlaybook={creatingPlaybook}
          playbookBusy={documents.busy}
          createPlaybookError={createPlaybookError}
          onNewPlaybook={newPlaybook}
          onNewCase={team ? newSharedCase : createRealCase}
          creatingCase={team ? creatingSharedCase : stored.creating}
          newCaseHint={
            team
              ? undefined
              : !realChat || realChat.playbookId
                ? 'Open a chat to create a case from it.'
                : realCase
                  ? 'This chat already has a case.'
                  : realChat.status !== 'idle'
                    ? 'Wait for the reply to finish.'
                    : undefined
          }
          notifications={bell}
          syncStatus={
            team && (
              <SyncStatus
                key={account.context.generation}
                revision={documents.revision}
                onSynced={() => setSyncRevision((n) => n + 1)}
              />
            )
          }
          onOpenPlaybook={openPlaybook}
          onRenameItem={renameItem}
          onRemoveItem={removeItem}
          view={view}
          onHome={newChat}
          team={team}
          onOpenChat={openChat}
          onOpenCase={openCase}
          onCollapse={() => setSidebar(false)}
          onOpenSettings={openSettings}
          onQuickTour={tour.start}
        />
      )}

      <main className="relative flex min-w-0 flex-1 bg-canvas">
        {!(expanded && panelNode) && (
          <section
            className="relative flex min-w-0 flex-1 flex-col"
            data-find-scope={
              realChat || chat ? 'chat' : kase ? 'case' : undefined
            }
          >
            <header
              className={`drag flex h-[52px] flex-none items-center gap-1.5 ${panelNode && view.kind !== 'settings' ? 'pr-3.5' : 'pr-[calc(14px+var(--bar-right))]'} ${sidebar ? 'pl-3.5' : 'pl-[var(--bar-left)]'}`}
            >
              {!sidebar && (
                <>
                  <IconButton
                    name="panel"
                    label={`Show sidebar (${shortcutLabel('\\')})`}
                    onClick={() => setSidebar(true)}
                  />
                  <IconButton
                    name="edit"
                    label={`${team ? 'New personal chat' : 'New chat'} (${shortcutLabel('N')})`}
                    onClick={newChat}
                  />
                  {bell}
                </>
              )}
              {view.kind === 'settings' ? (
                <>
                  <IconButton
                    name="back"
                    label="Back (Esc)"
                    onClick={closeSettings}
                  />
                  <span className="truncate text-ink-3">
                    Settings ›{' '}
                    <span className="font-medium text-ink">
                      {settingsTitle(view.page)}
                    </span>
                  </span>
                </>
              ) : (
                <span
                  className={`ml-1 min-w-0 ${title ? 'font-medium text-ink' : 'text-ink-3'}`}
                >
                  {realChat ? (
                    <InlineTitle
                      key={`${account.context.generation}:${realChat.id}`}
                      label="Chat title"
                      value={realChat.title}
                      onSave={(title, expectedTitle) =>
                        live.rename(realChat.id, title, expectedTitle)
                      }
                    />
                  ) : (
                    title
                  )}
                </span>
              )}
              <span className="flex-1" />
              {!sidebar && view.kind !== 'settings' && (
                <button
                  type="button"
                  className="no-drag cursor-pointer rounded-item px-3 py-1.5 text-meta text-ink-2 hover:bg-hover disabled:opacity-60"
                  disabled={creatingPlaybook || documents.busy}
                  onClick={newPlaybook}
                >
                  {creatingPlaybook ? 'Creating Playbook…' : 'New Playbook'}
                </button>
              )}
              {(kase || chat?.attached.caseId) && (
                <button
                  type="button"
                  className="no-drag inline-flex items-center gap-1.5 rounded-item px-3 py-1.5 text-[12.5px] font-medium text-ink-2 hover:bg-hover"
                >
                  <Icon name="ext" size={14} />
                  Open in Zendesk
                </button>
              )}
            </header>

            {!sidebar && createPlaybookError && (
              <p role="alert" className="mx-6 text-meta text-ink-2">
                {documents.error ??
                  'Could not create Playbook. Please try again.'}
              </p>
            )}
            {syncNotice && (
              <p role="status" className="mx-6 text-meta text-ink-2">
                {syncNotice}
                {account.pendingCaseLink && (
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() =>
                      void queueCaseLink(account.pendingCaseLink!.target)
                    }
                  >
                    Try opening again
                  </button>
                )}
              </p>
            )}
            {view.kind === 'settings' && (
              <SettingsView
                page={view.page}
                onPage={(page) => setView({ kind: 'settings', page })}
                onOpenWorkspace={home}
              />
            )}
            {team && view.kind !== 'settings' && (
              <div className="mx-6 max-h-[35vh] shrink-0 overflow-y-auto empty:hidden">
                <PrivacyReview
                  key={account.context.generation}
                  revision={documents.revision + syncRevision}
                />
              </div>
            )}
            {view.kind === 'notifications' && (
              <NotificationsPage
                {...notificationProps}
                onSettings={() => openSettings('notifications')}
              />
            )}
            {view.kind === 'home' && (
              <Home
                key={account.context.generation}
                needsYou={count(['appr', 'unk'])}
                inProgress={count(['run', 'inv'])}
                waiting={count(['wcust', 'weng'])}
                sending={live.sending || documents.busy}
                error={live.error ?? stored.error ?? documents.error}
                cases={stored.cases}
                playbooks={playbooks.filter(
                  (p) =>
                    documents.playbooks.find((d) => d.id === p.id)?.published,
                )}
                onOpenAttached={openAttached}
                onOpenModels={() => openSettings('models')}
                notice={stored.opening ? 'Opening saved cases…' : undefined}
                onSend={async (text, options, attachments, attached) => {
                  if (startingChat.current) return false;
                  startingChat.current = true;
                  try {
                    let prepared: string | undefined;
                    if (attached?.caseId || attached?.playbookIds.length) {
                      prepared = await documents.run('createChat', {
                        text,
                        caseId: attached.caseId,
                        playbookIds: attached.playbookIds,
                      });
                      if (!prepared) return false;
                    }
                    const id = await live.send(
                      text,
                      prepared,
                      options,
                      attachments,
                    );
                    if (!isCurrent(account.context)) return false;
                    if (id) setView({ kind: 'chat', id });
                    else if (prepared) {
                      if (attached?.caseId)
                        await documents.run('detachCase', {
                          chatId: prepared,
                          caseId: attached.caseId,
                        });
                      await window.supahelp.removeChat({
                        context: account.context,
                        chatId: prepared,
                      });
                    }
                    return !!id;
                  } finally {
                    startingChat.current = false;
                  }
                }}
              />
            )}
            {realChat && (
              <Thread
                documentControls={
                  <>
                    {realCase && reviewedDraft && (
                      <ResolutionReview
                        key={`${reviewedDraft.id}/${reviewedDraft.version}`}
                        kase={realCase}
                        draft={reviewedDraft}
                        chat={realChat}
                        documents={documents}
                      />
                    )}
                    {realChat.fileApproval && (
                      <FileApprovalCard
                        key={realChat.fileApproval.requestId}
                        approval={realChat.fileApproval}
                        chatId={realChat.id}
                      />
                    )}
                    {realChat.playbookAction && (
                      <PlaybookChatCard
                        key={realChat.playbookAction.requestId}
                        action={realChat.playbookAction}
                        chatId={realChat.id}
                        busy={realChat.status !== 'idle'}
                        onOpen={(id) => setPanel({ kind: 'playbook', id })}
                      />
                    )}
                  </>
                }
                onOpenAttached={openAttached}
                menu={{
                  attached: {
                    caseId: realCase?.id,
                    playbookIds: realChat.playbookIds ?? [],
                  },
                  cases: realCase ? [realCase] : stored.cases,
                  playbooks: playbooks.filter(
                    (p) =>
                      documents.playbooks.find((d) => d.id === p.id)?.published,
                  ),
                  onAttach: (t) => {
                    if ('caseId' in t) {
                      if (realCase) return;
                      void documents
                        .run('attachCase', {
                          chatId: realChat.id,
                          caseId: t.caseId,
                        })
                        .then(() => setPanel({ kind: 'case', id: t.caseId }));
                      return;
                    }
                    const ids = realChat.playbookIds ?? [];
                    void documents.run('setChatPlaybooks', {
                      chatId: realChat.id,
                      playbookIds: ids.includes(t.playbookId)
                        ? ids.filter((id) => id !== t.playbookId)
                        : [...ids, t.playbookId],
                    });
                  },
                  onDetach: (t) => {
                    if ('caseId' in t) {
                      void documents.run('detachCase', {
                        chatId: realChat.id,
                        caseId: t.caseId,
                      });
                    } else {
                      void documents.run('setChatPlaybooks', {
                        chatId: realChat.id,
                        playbookIds: (realChat.playbookIds ?? []).filter(
                          (id) => id !== t.playbookId,
                        ),
                      });
                    }
                  },
                }}
                key={realChat.id}
                chatId={realChat.id}
                messages={[
                  ...realChat.messages
                    .filter(
                      (message) =>
                        message.role !== 'case' ||
                        stored.records.some(
                          (record) => record.id === message.caseId,
                        ),
                    )
                    .map(
                      (message): Msg =>
                        message.role === 'case'
                          ? {
                              ...message,
                              kind: 'case-change',
                              note:
                                stored.undoNotes[message.changeId] ??
                                message.note,
                              pending: stored.undoing.has(message.changeId),
                            }
                          : {
                              kind: message.role === 'user' ? 'you' : 'ai',
                              text: message.text,
                            },
                    ),
                  ...(offerCase ? [{ kind: 'suggest' } as const] : []),
                ]}
                onCreateCase={createRealCase}
                creatingCase={stored.creating}
                attachedCase={realCase}
                attachedPlaybooks={playbooks.filter((p) =>
                  realChat.playbookIds?.includes(p.id),
                )}
                caseChanges={{
                  undo: (caseId, changeId) => {
                    void stored.undo(caseId, changeId);
                  },
                  view: (caseId, section) => {
                    void setPanel({
                      kind: 'case',
                      id: caseId,
                      focus: { section, token: Date.now() },
                    });
                  },
                }}
                onKeepChat={() => setKept((k) => new Set(k).add(realChat.id))}
                onSend={(text, options, attachments) =>
                  live
                    .send(text, realChat.id, options, attachments)
                    .then((id) => !!id)
                }
                busy={realChat.status !== 'idle'}
                stopping={realChat.status === 'stopping'}
                step={realChat.step}
                onStop={() => {
                  void live.stop(realChat.id);
                }}
                error={
                  realChat.error ??
                  live.error ??
                  stored.error ??
                  documents.error
                }
                onOpenModels={() => openSettings('models')}
                notice={
                  realChat.notice ??
                  (stored.opening ? 'Opening saved cases…' : undefined)
                }
                options={realChat.options}
                preview={false}
              />
            )}
            {chat && (
              <Thread
                onOpenAttached={openAttached}
                key={chat.id}
                messages={chat.messages}
                onSend={(t) => addToChat(chat.id, t)}
                cases={tools(chat.id, chat.attached)}
                onCreateCase={async () => {
                  if (await setPanel(null))
                    setPanel({ kind: 'case', id: createCase(chat) });
                }}
                onKeepChat={() => keepChat(chat)}
              />
            )}
            {kase && (
              <Thread
                onOpenAttached={openAttached}
                key={kase.id}
                messages={kase.messages}
                approved={!!kase.approved}
                cases={tools(kase.id, kase.attached)}
                onSend={(t) => addToCase(kase.id, t)}
                onApprove={() => approve(kase.id)}
              />
            )}
          </section>
        )}
        {view.kind !== 'settings' && panelNode}
        {find?.scope.isConnected && (
          <FindBar
            key={find.scope.dataset.findScope}
            scope={find.scope}
            focusToken={find.token}
            onClose={() => setFind(null)}
          />
        )}
      </main>
      {tour.open && !account.pendingInvitation && (
        <QuickTour
          name={account.view?.account.name.split(' ')[0] ?? ''}
          onClose={finishTour}
        />
      )}
      {tour.note && (
        <TourClosedNote onReplay={tour.start} onDismiss={tour.dismissNote} />
      )}
    </div>
  );
}
