import { useMemo, type ReactNode } from 'react';
import Markdown, { type Components, type UrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safePlaybookLink } from '../../../contracts/playbook-markdown';
import { useAccount } from '../accounts/AccountProvider';
import './markdown.css';
import { StoredScreenshot } from './StoredScreenshot';

const remarkPlugins = [remarkGfm];

const IMAGE_SRC = /^playbook-image:[a-zA-Z0-9-]{1,100}$/;

// Module-level so react-markdown sees stable component types. Inline
// functions remount every image on each render (flicker + refetch).
function PlaybookLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  const { snapshot: account } = useAccount();
  return href ? (
    <button
      type="button"
      className="text-left underline underline-offset-2"
      onClick={() =>
        void window.supahelp.openPlaybookLink({
          context: account.context,
          text: href,
        })
      }
    >
      {children}
    </button>
  ) : (
    <span>{children}</span>
  );
}

function makeComponents(book: string): Components {
  return {
    p: ({ children }) => <div className="markdown-paragraph">{children}</div>,
    table: ({ children }) => (
      <div className="overflow-x-auto">
        <table>{children}</table>
      </div>
    ),
    img: ({ src, alt }) =>
      typeof src === 'string' && IMAGE_SRC.test(src) ? (
        <StoredScreenshot
          book={book}
          id={src.slice('playbook-image:'.length)}
        />
      ) : (
        <span className="text-ink-3">
          [Image unavailable{alt ? `: ${alt}` : ''}]
        </span>
      ),
    a: PlaybookLink,
  };
}

const urlTransform: UrlTransform = (url, key) =>
  key === 'src'
    ? IMAGE_SRC.test(url)
      ? url
      : ''
    : (safePlaybookLink(url) ?? '');

export function MarkdownPreview({
  book,
  markdown,
}: {
  book: string;
  markdown: string;
}) {
  const components = useMemo(() => makeComponents(book), [book]);
  return (
    <div className="playbook-markdown" aria-label="Playbook preview">
      <Markdown
        remarkPlugins={remarkPlugins}
        skipHtml
        urlTransform={urlTransform}
        components={components}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
