import { type AuthEndpoints, type CatalogRecord } from '../connection-oauth.ts';
import type { ConnectionProvider } from '../connection-providers.ts';
import {
  id,
  operation,
  query,
  remaining,
  string,
  tenant,
  type Operation,
} from './operations.ts';

export function configureSalesforce(
  provider: ConnectionProvider,
  record: CatalogRecord,
) {
  const v = record.values;
  const headers: Record<string, string> = {};
  let endpoints: AuthEndpoints | undefined;

  const login = tenant(v.site, '.my.salesforce.com');
  v.site = login;
  const base = `${v.instance || login}/services/data/v64.0`;
  endpoints = {
    authorize: `${login}/services/oauth2/authorize`,
    token: `${login}/services/oauth2/token`,
    scopes: 'api refresh_token',
  };
  const object = provider.id === 'salesforce' ? 'Account' : 'Case';
  const escape = (value: unknown) =>
    String(value)
      .replaceAll('\\', '\\\\')
      .replaceAll("'", "\\'")
      .replaceAll('%', '\\%')
      .replaceAll('_', '\\_');
  const operations: Operation[] = [
    operation(
      'find_records',
      `Find ${object} records`,
      'GET',
      '/query',
      query,
      {
        query: (a) => ({
          q:
            object === 'Case'
              ? `SELECT Id,CaseNumber,Subject,Status,ContactId,AccountId FROM Case WHERE Subject LIKE '%${escape(a.query)}%' LIMIT 50`
              : `SELECT Id,Name,OwnerId,Type FROM Account WHERE Name LIKE '%${escape(a.query)}%' LIMIT 50`,
        }),
      },
    ),
    operation(
      'get_record',
      `Read a ${object}`,
      'GET',
      `/sobjects/${object}/{id}`,
      id,
    ),
    operation(
      'get_contact',
      'Read a contact',
      'GET',
      '/sobjects/Contact/{id}',
      id,
    ),
    operation(
      'get_owner',
      'Read the account owner',
      'GET',
      '/sobjects/User/{id}',
      id,
    ),
    operation(
      'update_record',
      `Change fields on a ${object}`,
      'PATCH',
      `/sobjects/${object}/{id}`,
      {
        ...id,
        fields: {
          type: 'object',
          minProperties: 1,
          maxProperties: 50,
          additionalProperties: {
            type: ['string', 'number', 'boolean', 'null'],
          },
        },
      },
      { body: (a) => a.fields },
    ),
    operation(
      'log_activity',
      `Log a completed activity on a ${object}`,
      'POST',
      '/sobjects/Task',
      { ...id, subject: string, text: string },
      {
        body: (a) => ({
          WhatId: a.id,
          Subject: a.subject,
          Description: a.text,
          Status: 'Completed',
        }),
      },
    ),
  ];
  if (object === 'Case')
    operations.push(
      operation('get_comments', 'Read case comments', 'GET', '/query', id, {
        query: (a) => {
          if (!/^[a-zA-Z0-9]{15,18}$/.test(String(a.id)))
            throw Error('Invalid case ID.');
          return {
            q: `SELECT Id,CommentBody,IsPublished,CreatedDate FROM CaseComment WHERE ParentId='${a.id}' LIMIT 100`,
          };
        },
      }),
      operation(
        'add_case_comment',
        'Add a case comment with explicit customer visibility',
        'POST',
        '/sobjects/CaseComment',
        {
          ParentId: string,
          CommentBody: string,
          IsPublished: { type: 'boolean' },
        },
      ),
      operation(
        'change_status',
        'Change case status',
        'PATCH',
        '/sobjects/Case/{id}',
        { ...id, Status: string },
        { body: remaining },
      ),
    );

  return { base, headers, operations, endpoints };
}
