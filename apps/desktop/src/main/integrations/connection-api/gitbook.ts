import { type CatalogRecord } from '../connection-oauth.ts';
import {
  asQuery,
  id,
  operation,
  query,
  string,
  type Operation,
} from './operations.ts';

export function configureGitbook(record: CatalogRecord) {
  const v = record.values;
  const headers: Record<string, string> = {};
  const base = 'https://api.gitbook.com/v1';
  headers.Authorization = `Bearer ${v.key}`;
  if (!/^[\w-]{1,150}$/.test(v.spaceId)) throw Error('Enter a space ID.');
  const operations: Operation[] = [
    operation(
      'find_pages',
      'Search the selected playbook space',
      'GET',
      `/spaces/${v.spaceId}/search`,
      query,
      { query: asQuery },
    ),
    operation(
      'list_pages',
      'List pages in the selected space',
      'GET',
      `/spaces/${v.spaceId}/content`,
    ),
    operation(
      'read_page',
      'Read page content in the selected space',
      'GET',
      `/spaces/${v.spaceId}/content/page/{id}`,
      id,
    ),
    operation(
      'start_change_request',
      'Open a change request to draft edits in the selected space',
      'POST',
      `/spaces/${v.spaceId}/change-requests`,
      { subject: string },
    ),
    operation(
      'edit_page',
      'Replace a page’s Markdown inside a change request',
      'POST',
      `/spaces/${v.spaceId}/change-requests/{id}/content`,
      { ...id, page: string, markdown: string },
      {
        body: (a) => ({
          changes: [
            {
              operation: 'update_page',
              page: a.page,
              document: { markdown: a.markdown },
            },
          ],
        }),
      },
    ),
    operation(
      'add_page',
      'Add a Markdown page inside a change request',
      'POST',
      `/spaces/${v.spaceId}/change-requests/{id}/content`,
      { ...id, markdown: string },
      {
        body: (a) => ({
          changes: [
            {
              operation: 'insert_page',
              document: { markdown: a.markdown },
            },
          ],
        }),
      },
    ),
    operation(
      'merge_change_request',
      'Publish a change request to the live space',
      'POST',
      `/spaces/${v.spaceId}/change-requests/{id}/merge`,
      id,
      { body: () => ({}) },
    ),
    operation(
      'comment_on_page',
      'Comment on a page in the selected space',
      'POST',
      `/spaces/${v.spaceId}/comments`,
      { page: string, markdown: string },
      { body: (a) => ({ page: a.page, body: { markdown: a.markdown } }) },
    ),
  ];

  return { base, headers, operations, endpoints: undefined };
}
