import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteExpiredThreads } from '../src/mastra/retention.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-02T12:00:00Z');

function memoryWith(ages) {
  let threads = ages.map((age, i) => ({ id: `t${i}`, updatedAt: new Date(NOW - age * DAY).toISOString() }));
  const deleted = [];
  return {
    deleted,
    memory: {
      listThreads: async ({ perPage }) => ({
        threads: [...threads].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt)).slice(0, perPage),
      }),
      deleteThread: async (id) => {
        deleted.push(id);
        threads = threads.filter((t) => t.id !== id);
      },
    },
  };
}

test('deletes threads idle longer than the window, keeps the rest', async () => {
  const { memory, deleted } = memoryWith([31, 29, 45, 1, 30.5]);
  assert.equal(await deleteExpiredThreads(memory, 30, NOW), 3);
  assert.deepEqual(deleted.sort(), ['t0', 't2', 't4']);
});

test('works through more than one page', async () => {
  const { memory, deleted } = memoryWith([...Array(250).fill(40), 2]);
  assert.equal(await deleteExpiredThreads(memory, 30, NOW), 250);
  assert.equal(deleted.length, 250);
});
