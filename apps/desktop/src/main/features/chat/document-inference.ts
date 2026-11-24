import type {
  ModelSelection,
  ModelsSettings,
  ProviderId,
} from '../../../contracts/chat';
import type { ClaudeCode } from '../../integrations/claude-code';
import type { Codex } from '../../integrations/codex';
import { isModelSelection } from '../../platform/model-settings.ts';

export class DocumentInference {
  private maskingChecks = new Map<AbortController, ProviderId>();
  private claude: ClaudeCode;
  private codex: Codex;
  private settings: () => Promise<ModelsSettings>;
  private accountContext?: {
    generation(): number;
    canUse(capability: string): Promise<boolean>;
  };
  constructor(
    claude: ClaudeCode,
    codex: Codex,
    settings: () => Promise<ModelsSettings>,
    accountContext?: {
      generation(): number;
      canUse(capability: string): Promise<boolean>;
    },
  ) {
    this.claude = claude;
    this.codex = codex;
    this.settings = settings;
    this.accountContext = accountContext;
  }
  cancel(provider?: ProviderId) {
    for (const [controller, owner] of this.maskingChecks)
      if (!provider || owner === provider) controller.abort();
  }

  async draftDocument(
    kind: 'resolution' | 'playbook',
    data: unknown,
    selection: ModelSelection,
    signal: AbortSignal,
  ): Promise<unknown> {
    const prompt = JSON.stringify({ kind, data });
    if (prompt.length > 256000) throw Error('document-draft-too-large');
    let text: string;
    try {
      text = await this.isolatedText(
        prompt,
        selection,
        signal,
        'document-draft',
      );
    } catch (error) {
      if (signal.aborted) throw Error('document-draft-canceled');
      if (error instanceof DOMException && error.name === 'TimeoutError')
        throw Error('document-draft-timeout');
      if (error instanceof Error && error.message === 'document-draft-invalid')
        throw error;
      throw Error('document-draft-failed');
    }
    // Models often wrap the JSON in a ```json fence or a sentence despite "JSON only".
    const start = text.indexOf('{'),
      end = text.lastIndexOf('}');
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // Shape only: draft text may contain case details.
      console.warn('[document-draft] unreadable reply', {
        kind,
        length: text.length,
        start,
        end,
      });
      throw Error('document-draft-invalid');
    }
  }

  private async isolatedText(
    prompt: string,
    selection: ModelSelection,
    signal: AbortSignal,
    purpose: 'document-draft',
  ) {
    if (!isModelSelection(selection)) throw Error('case-masking-failed');
    const selected = { ...selection },
      controller = new AbortController();
    const current = AbortSignal.any([
      signal,
      controller.signal,
      AbortSignal.timeout(300000),
    ]);
    const origin = this.accountContext?.generation();
    this.maskingChecks.set(controller, selected.provider);
    const guard = async () => {
      current.throwIfAborted();
      if (this.accountContext) {
        if (origin !== this.accountContext.generation())
          throw Error('case-masking-failed');
        const allowed = await this.accountContext.canUse(
          `model:${selected.provider}`,
        );
        if (origin !== this.accountContext.generation())
          throw Error('case-masking-failed');
        if (!allowed) throw Error('document-draft-failed');
      }
      current.throwIfAborted();
    };
    try {
      await guard();
      const catalog = await this.settings();
      await guard();
      if (
        !catalog.models.some(
          (m) => m.provider === selected.provider && m.model === selected.model,
        ) ||
        !catalog.providers.some(
          (p) => p.id === selected.provider && p.state === 'ready',
        )
      )
        throw Error('document-draft-failed');
      const provider =
        selected.provider === 'claude' ? this.claude : this.codex;
      const session = provider.open(selected.model, {}, [], purpose);
      const close = () => {
        try {
          session.close();
        } catch {
          controller.abort();
        }
      };
      current.addEventListener('abort', close, { once: true });
      try {
        let output = '';
        await guard();
        for await (const item of session.reply(prompt, current)) {
          await guard();
          if (item.type === 'text') {
            output += item.text;
            if (output.length > 256000) throw Error('document-draft-invalid');
          }
        }
        await guard();
        return output;
      } finally {
        current.removeEventListener('abort', close);
        close();
        current.throwIfAborted();
      }
    } finally {
      this.maskingChecks.delete(controller);
    }
  }
}
