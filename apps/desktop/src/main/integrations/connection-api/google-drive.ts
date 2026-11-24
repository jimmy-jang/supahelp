import { type AuthEndpoints, type CatalogRecord } from '../connection-oauth.ts';
import {
  id,
  operation,
  query,
  scope,
  string,
  type Operation,
} from './operations.ts';

export function configureGoogleDrive(record: CatalogRecord) {
  const headers: Record<string, string> = {};
  let endpoints: AuthEndpoints | undefined;
  const base = 'https://www.googleapis.com';
  endpoints = {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    // ponytail: drive.file edits only files Supahelp created or the user
    // opened with it; editing any file needs the restricted `drive` scope,
    // which requires Google's security assessment for our OAuth app.
    scopes: scope(
      record,
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
    ),
    extra: { access_type: 'offline', prompt: 'consent' },
  };
  const operations: Operation[] = [
    operation(
      'find_files',
      'Find readable Drive files',
      'GET',
      '/drive/v3/files',
      query,
      {
        query: (a) => ({
          q: `trashed = false and fullText contains '${String(a.query).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`,
          fields: 'files(id,name,mimeType,webViewLink),nextPageToken',
          pageSize: '50',
        }),
      },
    ),
    operation(
      'read_file',
      'Read a file’s metadata',
      'GET',
      '/drive/v3/files/{id}',
      id,
      {
        query: () => ({
          fields: 'id,name,mimeType,description,webViewLink',
        }),
      },
    ),
    operation(
      'read_google_doc',
      'Read Google Docs text',
      'GET',
      '/drive/v3/files/{id}/export',
      id,
      { query: () => ({ mimeType: 'text/plain' }) },
    ),
    operation(
      'read_text_file',
      'Read the content of a text file',
      'GET',
      '/drive/v3/files/{id}',
      id,
      { query: () => ({ alt: 'media' }) },
    ),
    operation(
      'create_google_doc',
      'Create a Google Doc from plain text',
      'POST',
      '/upload/drive/v3/files',
      { name: string, text: string },
      {
        query: () => ({
          uploadType: 'multipart',
          fields: 'id,name,webViewLink',
        }),
        raw: (a) => {
          const boundary = `supahelp-${crypto.randomUUID()}`;
          const meta = JSON.stringify({
            name: a.name,
            mimeType: 'application/vnd.google-apps.document',
          });
          return {
            type: `multipart/related; boundary=${boundary}`,
            body: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${String(a.text)}\r\n--${boundary}--`,
          };
        },
      },
    ),
    operation(
      'replace_google_doc_text',
      'Replace a Google Doc’s content with plain text',
      'PATCH',
      '/upload/drive/v3/files/{id}',
      { ...id, text: string },
      {
        query: () => ({
          uploadType: 'media',
          fields: 'id,name,webViewLink',
        }),
        raw: (a) => ({
          type: 'text/plain; charset=UTF-8',
          body: String(a.text),
        }),
      },
    ),
  ];

  return { base, headers, operations, endpoints };
}
