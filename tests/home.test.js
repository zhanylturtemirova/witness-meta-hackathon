import test from 'node:test';
import assert from 'node:assert/strict';
import {HOME_QUESTIONS,homeQuestion,HOME_STARTER_QUESTION,homeStarterEntry,homeEntryReady,homeGenerationInput,homeAvoidQuestions} from '../web/domain.js';

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

test('the home starter shows immediately without a model request', () => {
  assert.equal(HOME_STARTER_QUESTION, "What's a small moment from today you'd like to remember?");
  const entry = homeStarterEntry();
  assert.equal(entry.question, HOME_STARTER_QUESTION);
  assert.equal(entry.provider, null);
  assert.equal(entry.topic, 'small-moment');
  assert.equal(homeEntryReady(entry), true);
  assert.equal(homeEntryReady(null), false);
  assert.equal(homeEntryReady({question: '  '}), false);
});

test('another question asks the interviewer and avoids recent questions', () => {
  const entry = {question: HOME_STARTER_QUESTION};
  const input = homeGenerationInput(entry, ['What did you cook today?', '  ', 42, 'what did you COOK today?']);
  assert.equal(input.mode, 'opening');
  assert.equal(input.topicId, 'small-moment');
  assert.deepEqual(input.answers, []);
  assert.deepEqual(input.avoidQuestions, ['What did you cook today?', HOME_STARTER_QUESTION]);
  assert.deepEqual(homeAvoidQuestions(null, []), []);
  const many = Array.from({length: 30}, (_, i) => 'Question ' + i);
  assert.equal(homeAvoidQuestions(null, many).length, 20);
});
