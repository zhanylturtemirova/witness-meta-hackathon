import test from 'node:test';
import assert from 'node:assert/strict';
import {HOME_QUESTIONS,homeQuestion} from '../web/domain.js';

test('the home question is concrete, stable for the day, and rotates', () => {
  assert.ok(HOME_QUESTIONS.length >= 4);
  for (const q of HOME_QUESTIONS) {
    assert.equal(typeof q.question, 'string');
    assert.ok(q.question.length > 20);
    assert.equal(typeof q.topic, 'string');
  }
  const day = new Date(2026, 10, 1, 9, 30);
  const same = new Date(2026, 10, 1, 22, 15);
  assert.deepEqual(homeQuestion(0, day), homeQuestion(0, same));
  assert.notDeepEqual(homeQuestion(0, day), homeQuestion(1, day));
  assert.deepEqual(homeQuestion(HOME_QUESTIONS.length, day), homeQuestion(0, day));
  assert.notDeepEqual(homeQuestion(0, day), homeQuestion(0, new Date(2026, 10, 2, 9, 30)));
});
