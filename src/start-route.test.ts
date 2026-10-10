import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LINK_REPLIES,
  linkFailureReply,
  linkSuccessReply,
  routeStartPayload,
} from './start-route';

const QR_TOKEN = 'ab'.repeat(32); // what a printed QR code carries: 64 hex characters
const LINK_CODE = 'abcdefghjkmnpqrstuvwxyz234567892'; // what the API hands out: 32 of a-z, 0-9

test('a QR token is the customer flow, exactly as it was sent', () => {
  assert.deepEqual(routeStartPayload(QR_TOKEN), { kind: 'qr', token: QR_TOKEN });
});

test('no payload is a plain /start', () => {
  assert.deepEqual(routeStartPayload(undefined), { kind: 'none' });
  assert.deepEqual(routeStartPayload(null), { kind: 'none' });
  assert.deepEqual(routeStartPayload(''), { kind: 'none' });
});

test('link_<code> is account linking', () => {
  assert.deepEqual(routeStartPayload(`link_${LINK_CODE}`), { kind: 'link', code: LINK_CODE });
});

test('a "link_" payload that holds no code is still linking (with no code), never a QR token', () => {
  for (const payload of [
    'link_',
    'link_short',
    'link_UPPERCASE1234567890',
    `link_${'a'.repeat(41)}`,
    'link_abcdefghjkmnpqrs-tuvw',
    `link_${QR_TOKEN}`, // 64 characters: too long for a code
  ]) {
    assert.deepEqual(routeStartPayload(payload), { kind: 'link', code: null }, payload);
  }
});

test('only the exact prefix switches to linking: everything else stays in the customer flow', () => {
  for (const payload of [
    'LINK_abcdefghjkmnpqrstuvw',
    'Link_abcdefghjkmnpqrstuvw',
    'link',
    'linkabcdefghjkmnpqrstuvw',
    'xlink_abcdefghjkmnpqrstuvw',
    'something-else',
    '12345',
  ]) {
    assert.deepEqual(routeStartPayload(payload), { kind: 'qr', token: payload }, payload);
  }
});

test('no real QR token can be taken for a link: tokens are hex, and "l" is not a hex digit', () => {
  for (let i = 0; i < 1000; i++) {
    const token = Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
    assert.equal(routeStartPayload(token).kind, 'qr');
  }
});

test('the success reply names the business when there is one', () => {
  assert.match(linkSuccessReply('Dehkon Bozor'), /Ulandi/);
  assert.match(linkSuccessReply('Dehkon Bozor'), /«Dehkon Bozor»/);
  assert.match(linkSuccessReply(null), /Ulandi/);
  assert.doesNotMatch(linkSuccessReply('   '), /«/);
  assert.doesNotMatch(linkSuccessReply(undefined), /undefined|null/);
});

test('a used, unknown or expired code asks for a new link; anything else asks to try later', () => {
  assert.equal(linkFailureReply(404), LINK_REPLIES.INVALID);
  assert.equal(linkFailureReply(410), LINK_REPLIES.INVALID);
  assert.equal(linkFailureReply(400), LINK_REPLIES.INVALID);
  assert.equal(linkFailureReply(403), LINK_REPLIES.FAILED); // wrong bot key: not the user's fault
  assert.equal(linkFailureReply(500), LINK_REPLIES.FAILED);
  assert.equal(linkFailureReply(503), LINK_REPLIES.FAILED);
  assert.equal(linkFailureReply(undefined), LINK_REPLIES.FAILED); // the API did not answer
});
