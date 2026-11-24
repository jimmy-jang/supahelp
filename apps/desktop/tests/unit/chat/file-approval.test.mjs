import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChatService } from '../../../src/main/features/chat/service.ts';

const request = { tool: 'Edit', path: 'src/a.ts', before: 'a', after: 'b' };

function setup() {
  let chats;
  chats = new ChatService(
    {
      open: (_options, chatId) => ({
        close() {},
        async *reply() {
          const approved = await chats.requestFileApproval(chatId, request);
          yield { type: 'text', text: approved ? 'approved' : 'declined' };
        },
      }),
    },
    () => {},
  );
  return chats;
}
const chat = (chats, id) => chats.snapshot().chats.find((c) => c.id === id);
async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw Error('timed out');
}

for (const approved of [true, false])
  test(`a ${approved ? 'approved' : 'declined'} file change resumes the reply and clears the card`, async () => {
    const chats = setup();
    const id = chats.send({ text: 'fix it' });
    await until(() => chat(chats, id).fileApproval);
    const card = chat(chats, id).fileApproval;
    assert.equal(card.path, 'src/a.ts');
    assert.equal(chat(chats, id).status, 'running');
    assert.throws(
      () => chats.answerFileApproval(id, 'other', true),
      /approval-ended/,
    );
    chats.answerFileApproval(id, card.requestId, approved);
    await until(() => chat(chats, id).status === 'idle');
    assert.equal(chat(chats, id).fileApproval, undefined);
    assert.equal(
      chat(chats, id).messages.at(-1).text,
      approved ? 'approved' : 'declined',
    );
  });

test('stopping the reply declines a pending change and ends the request', async () => {
  const chats = setup();
  const id = chats.send({ text: 'fix it' });
  await until(() => chat(chats, id).fileApproval);
  const { requestId } = chat(chats, id).fileApproval;
  chats.stop(id);
  await until(() => chat(chats, id).status === 'idle');
  assert.equal(chat(chats, id).fileApproval, undefined);
  assert.throws(
    () => chats.answerFileApproval(id, requestId, true),
    /approval-ended/,
  );
});
