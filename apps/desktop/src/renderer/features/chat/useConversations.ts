import { useEffect, useRef, useState } from 'react';
import type { Scoped } from '../../../contracts/accounts';
import type { ChatOptions, ChatSnapshot } from '../../../contracts/chat';
import { useAccount } from '../accounts/AccountProvider';

export function useConversations() {
  const { isCurrent, snapshot: account } = useAccount();
  const [snapshot, setSnapshot] = useState<ChatSnapshot>({
    revision: -1,
    chats: [],
  });
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    if (!window.supahelp) return;
    let active = true;
    const receive = (next: Scoped<ChatSnapshot>) => {
      if (active && isCurrent(next.context))
        setSnapshot((current) =>
          next.revision > current.revision ? next : current,
        );
    };
    const unsubscribe = window.supahelp.onChatsChanged(receive);
    void window.supahelp
      .getChats(account.context)
      .then((result) => {
        if (result.ok) receive(result.value);
      })
      .catch(() => {
        if (active)
          setError('Chat could not connect. Restart Supahelp and try again.');
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [isCurrent]);

  const send = async (
    text: string,
    chatId?: string,
    options?: ChatOptions,
    attachments?: string[],
  ) => {
    if (pending.current) return;
    if (!window.supahelp) {
      setError('Open the desktop app to connect your model provider.');
      return;
    }
    pending.current = true;
    setSending(true);
    setError(undefined);
    try {
      const result = await window.supahelp.sendMessage(
        {
          text,
          options,
          attachments,
          ...(chatId ? { chatId } : {}),
        },
        account.context,
      );
      if (!isCurrent(account.context)) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      return result.value;
    } catch {
      setError('Chat could not connect. Restart Supahelp and try again.');
    } finally {
      pending.current = false;
      setSending(false);
    }
  };

  const stop = async (id: string) => {
    try {
      const result = await window.supahelp.stopReply(id, account.context);
      if (!result.ok) setError(result.error);
    } catch {
      setError(
        'The stop request could not be delivered. Restart Supahelp to close the session.',
      );
    }
  };

  const rename = async (
    chatId: string,
    title: string,
    expectedTitle: string,
  ) => {
    const context = account.context;
    const result = await window.supahelp.renameChat({
      chatId,
      title,
      expectedTitle,
      context,
    });
    if (!isCurrent(context)) throw Error('The account or workspace changed.');
    if (!result.ok) throw Error(result.error);
    return result.value;
  };
  return {
    chats: snapshot.chats,
    revision: snapshot.revision,
    sending,
    error,
    send,
    stop,
    rename,
  };
}
