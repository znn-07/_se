'use strict';

function assertString(value, name = 'value') {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string`);
  }
}

function reverseString(text) {
  assertString(text, 'text');
  return [...text].reverse().join('');
}

function isPalindrome(text) {
  assertString(text, 'text');
  const normalized = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  return normalized === [...normalized].reverse().join('');
}

function capitalizeWords(text) {
  assertString(text, 'text');
  return text.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function formatThousands(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('value must be a finite number');
  }
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function randomInt(min, max) {
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    throw new TypeError('min and max must be integers');
  }
  if (min > max) {
    throw new RangeError('min must be less than or equal to max');
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('value must be a finite number');
  }
  if (typeof min !== 'number' || typeof max !== 'number') {
    throw new TypeError('min and max must be numbers');
  }
  if (min > max) {
    throw new RangeError('min must be less than or equal to max');
  }
  return Math.min(Math.max(value, min), max);
}

module.exports = {
  reverseString,
  isPalindrome,
  capitalizeWords,
  formatThousands,
  randomInt,
  clamp,
};
