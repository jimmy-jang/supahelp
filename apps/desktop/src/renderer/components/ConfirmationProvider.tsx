import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from './Button';
import { Modal } from './Modal';
import {
  createConfirmation,
  type ConfirmationOptions,
  type ConfirmationRequest,
} from './confirmation';

const ConfirmationContext = createContext<
  ((options: ConfirmationOptions) => Promise<boolean>) | null
>(null);

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmationRequest>();
  const [controller] = useState(() => createConfirmation(setRequest));
  const mounted = useRef(true);
  const confirm = useCallback(
    (options: ConfirmationOptions) =>
      mounted.current ? controller.ask(options) : Promise.resolve(false),
    [controller],
  );
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = window.supahelp?.onCloseRequested?.(async (id) => {
      const accepted = await confirm({
        title: 'Discard unsaved edits and close?',
        description:
          'Unsaved text and pending checks will be discarded. Saved records will stay as they are.',
        cancel: 'Keep editing',
        action: 'Discard and close',
        danger: true,
      });
      window.supahelp.respondToClose(id, accepted);
    });
    return () => {
      mounted.current = false;
      unsubscribe?.();
      controller.cancel();
    };
  }, [controller, confirm]);
  return (
    <ConfirmationContext value={confirm}>
      {children}
      {request && (
        <Modal
          key={request.id}
          title={request.title}
          description={request.description}
          confirmation
          onCancel={() => controller.answer(request, false)}
        >
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button
              kind="secondary"
              autoFocus
              onClick={() => controller.answer(request, false)}
            >
              {request.cancel ?? 'Cancel'}
            </Button>
            <Button
              kind={request.danger ? 'danger' : 'primary'}
              onClick={() => controller.answer(request, true)}
            >
              {request.action}
            </Button>
          </div>
        </Modal>
      )}
    </ConfirmationContext>
  );
}

export function useConfirmation() {
  const confirm = useContext(ConfirmationContext);
  if (!confirm) throw Error('ConfirmationProvider is missing.');
  return confirm;
}
