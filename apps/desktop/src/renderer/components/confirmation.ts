export type ConfirmationOptions = {
  title: string;
  description: string;
  action: string;
  cancel?: string;
  danger?: boolean;
};
export type ConfirmationRequest = ConfirmationOptions & { id: number };

export function createConfirmation(
  changed: (request: ConfirmationRequest | undefined) => void,
) {
  let serial = 0;
  let pending:
    | { request: ConfirmationRequest; resolve: (value: boolean) => void }
    | undefined;
  const answer = (request: ConfirmationRequest, accepted: boolean) => {
    if (pending?.request !== request) return;
    const { resolve } = pending;
    pending = undefined;
    changed(undefined);
    resolve(accepted);
  };
  return {
    ask(options: ConfirmationOptions): Promise<boolean> {
      if (pending) return Promise.resolve(false);
      return new Promise((resolve) => {
        const request = { ...options, id: ++serial };
        pending = { request, resolve };
        changed(request);
      });
    },
    answer,
    cancel() {
      if (pending) answer(pending.request, false);
    },
  };
}
