'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  reverseString,
  isPalindrome,
  capitalizeWords,
  formatThousands,
  randomInt,
  clamp,
} = require('../index.js');

test('reverseString reverses text and keeps unicode intact', () => {
  assert.equal(reverseString('hello'), 'olleh');
  assert.equal(reverseString('abc'), 'cba');
  assert.equal(reverseString('你好'), '好你');
  assert.equal(reverseString(''), '');
  assert.throws(() => reverseString(123), TypeError);
});

test('isPalindrome ignores case, spaces and punctuation', () => {
  assert.equal(isPalindrome('racecar'), true);
  assert.equal(isPalindrome('A man, a plan, a canal: Panama'), true);
  assert.equal(isPalindrome('hello'), false);
  assert.equal(isPalindrome(''), true);
  assert.throws(() => isPalindrome(null), TypeError);
});

test('capitalizeWords capitalizes every word', () => {
  assert.equal(capitalizeWords('hello world'), 'Hello World');
  assert.equal(capitalizeWords('hELLO wORLD'), 'Hello World');
  assert.equal(capitalizeWords('  multiple   spaces  '), '  Multiple   Spaces  ');
  assert.throws(() => capitalizeWords(42), TypeError);
});

test('formatThousands adds thousand separators', () => {
  assert.equal(formatThousands(1000), '1,000');
  assert.equal(formatThousands(1234567), '1,234,567');
  assert.equal(formatThousands(-9876543.21), '-9,876,543.21');
  assert.equal(formatThousands(999), '999');
  assert.throws(() => formatThousands(NaN), TypeError);
  assert.throws(() => formatThousands('1000'), TypeError);
});

test('randomInt stays within the inclusive range', () => {
  for (let i = 0; i < 1000; i += 1) {
    const value = randomInt(1, 6);
    assert.ok(value >= 1 && value <= 6);
    assert.ok(Number.isInteger(value));
  }
  assert.equal(randomInt(5, 5), 5);
  assert.throws(() => randomInt(1.5, 3), TypeError);
  assert.throws(() => randomInt(10, 1), RangeError);
});

test('clamp limits a number to the given range', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(42, 0, 10), 10);
  assert.throws(() => clamp(Infinity, 0, 10), TypeError);
  assert.throws(() => clamp(5, 10, 0), RangeError);
});
