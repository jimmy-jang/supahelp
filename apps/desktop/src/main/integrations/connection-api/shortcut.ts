import { type CatalogRecord } from '../connection-oauth.ts';
import {
  asQuery,
  id,
  operation,
  query,
  string,
  text,
  type Operation,
} from './operations.ts';

export function configureShortcut(record: CatalogRecord) {
  const v = record.values;
  const headers: Record<string, string> = {};
  const base = 'https://api.app.shortcut.com/api/v3';
  headers['Shortcut-Token'] = v.key;
  const operations: Operation[] = [
    operation(
      'find_stories',
      'Search stories',
      'GET',
      '/search/stories',
      query,
      { query: asQuery },
    ),
    operation('get_story', 'Read a story', 'GET', '/stories/{id}', id),
    operation(
      'get_comments',
      'Read story comments',
      'GET',
      '/stories/{id}/comments',
      id,
    ),
    operation(
      'get_workflows',
      'Read available workflows and statuses',
      'GET',
      '/workflows',
    ),
    operation('get_projects', 'Read available projects', 'GET', '/projects'),
    operation('create_story', 'Create a story', 'POST', '/stories', {
      name: string,
      story_type: { enum: ['bug', 'feature', 'chore'] },
      workflow_state_id: { type: 'integer' },
      description: string,
    }),
    operation(
      'add_comment',
      'Add a story comment',
      'POST',
      '/stories/{id}/comments',
      text,
      { body: (a) => ({ text: a.text }) },
    ),
  ];

  return { base, headers, operations, endpoints: undefined };
}
