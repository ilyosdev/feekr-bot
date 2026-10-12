import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRating, parseYesNo } from './typed-answers';

test('"Ha" in Latin, Cyrillic and Russian, in any case, with what people add around it', () => {
  for (const text of ['Ha', 'ha', 'HA', ' ha ', 'Ha.', 'Ha!', 'Ha ✅', 'xa', 'Ҳа', 'Ха', 'Да', 'да!', 'Yes']) {
    assert.equal(parseYesNo(text), true, text);
  }
});

test('"Yo\'q" with every apostrophe, without one, in Cyrillic and Russian', () => {
  for (const text of ["Yo'q", 'yoʻq', 'Yo‘q', 'yo’q', 'yo`q', 'Yoq', 'YOQ', 'yuq', "Yo'q ❌", 'Йўқ', 'йуқ', 'йук', 'Йоқ', 'Нет', 'нет.', 'No']) {
    assert.equal(parseYesNo(text), false, text);
  }
});

test('anything else is not a yes or a no', () => {
  for (const text of ['', ' ', 'balki', 'ha yoq', 'hammasi yaxshi', 'bilmadim', '1', 'haa', 'yoqdi', '✅']) {
    assert.equal(parseYesNo(text), null, text);
  }
});

test('a rating is a whole number from 1 to 10', () => {
  for (let n = 1; n <= 10; n += 1) assert.equal(parseRating(String(n)), n);
  assert.equal(parseRating(' 9 '), 9);
  assert.equal(parseRating('9.'), 9);
  assert.equal(parseRating('10!'), 10);
  assert.equal(parseRating('07'), 7);
});

test('anything else is not a rating', () => {
  for (const text of ['', '0', '11', '100', '-3', '9.5', '9,5', '9/10', '9 ball', "to'qqiz", 'a9', '1 0']) {
    assert.equal(parseRating(text), null, text);
  }
});
