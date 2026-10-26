import test from 'node:test';
import assert from 'node:assert/strict';
import { choose } from '../intro.mjs';

test('random draw selects one of the other three films', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.equal(choose(list, 'b', () => 0), 'a');
  assert.equal(choose(list, 'b', () => 1), 'c');
  assert.equal(choose(list, 'b', () => 2), 'd');
});

test('single film remains selectable', () => {
  assert.equal(choose(['only'], 'only', () => 0), 'only');
});
