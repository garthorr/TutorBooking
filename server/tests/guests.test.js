import test from 'node:test';
import assert from 'node:assert';
import { normalizeGuestEmails, parseGuestEmails, serializeGuestEmails, MAX_GUESTS } from '../services/guests.js';

test('normalizeGuestEmails', async (t) => {
  await t.test('an absent or empty list means no guests', () => {
    assert.deepStrictEqual(normalizeGuestEmails(undefined).emails, []);
    assert.deepStrictEqual(normalizeGuestEmails(null).emails, []);
    assert.deepStrictEqual(normalizeGuestEmails([]).emails, []);
  });

  await t.test('trims and keeps valid addresses in order', () => {
    const { emails } = normalizeGuestEmails(['  mum@example.com ', 'dad@example.com']);
    assert.deepStrictEqual(emails, ['mum@example.com', 'dad@example.com']);
  });

  await t.test('drops blank rows the form leaves behind', () => {
    const { emails } = normalizeGuestEmails(['mum@example.com', '', '   ']);
    assert.deepStrictEqual(emails, ['mum@example.com']);
  });

  await t.test('drops duplicates case-insensitively', () => {
    const { emails } = normalizeGuestEmails(['Mum@Example.com', 'mum@example.com']);
    assert.deepStrictEqual(emails, ['Mum@Example.com'], 'the first spelling is kept');
  });

  await t.test("drops the student's own address so they are not invited twice", () => {
    const { emails } = normalizeGuestEmails(['STUDENT@example.com', 'mum@example.com'], 'student@example.com');
    assert.deepStrictEqual(emails, ['mum@example.com']);
  });

  await t.test('rejects a malformed address rather than skipping it', () => {
    const { emails, error } = normalizeGuestEmails(['not-an-email']);
    assert.strictEqual(emails, undefined);
    assert.match(error, /not a valid email address/);
  });

  await t.test('rejects a non-string entry', () => {
    assert.ok(normalizeGuestEmails([{ email: 'mum@example.com' }]).error);
    assert.ok(normalizeGuestEmails('mum@example.com').error, 'a bare string is not a list');
  });

  await t.test('caps the list', () => {
    const under = Array.from({ length: MAX_GUESTS }, (_, i) => `g${i}@example.com`);
    assert.strictEqual(normalizeGuestEmails(under).emails.length, MAX_GUESTS);

    const over = Array.from({ length: MAX_GUESTS + 1 }, (_, i) => `g${i}@example.com`);
    assert.match(normalizeGuestEmails(over).error, new RegExp(`at most ${MAX_GUESTS}`));
  });

  await t.test('rejects a huge list without walking all of it', () => {
    const flood = Array.from({ length: 5000 }, () => '');
    assert.ok(normalizeGuestEmails(flood).error, 'blank entries do not buy an unbounded list');
  });

  await t.test('rejects an over-long address and truncates it in the message', () => {
    const long = 'a'.repeat(300) + '@example.com';
    const { error } = normalizeGuestEmails([long]);
    assert.ok(error);
    assert.ok(error.length < 120, 'the whole address is not echoed back');
  });
});

test('guest email storage round-trip', async (t) => {
  await t.test('an empty list stores as NULL, matching pre-existing rows', () => {
    assert.strictEqual(serializeGuestEmails([]), null);
    assert.strictEqual(serializeGuestEmails(undefined), null);
    assert.deepStrictEqual(parseGuestEmails(null), [], 'a row written before the column existed');
  });

  await t.test('a list survives the round trip', () => {
    const emails = ['mum@example.com', 'dad@example.com'];
    assert.deepStrictEqual(parseGuestEmails(serializeGuestEmails(emails)), emails);
  });

  await t.test('a malformed stored value reads back as no guests, not a throw', () => {
    assert.deepStrictEqual(parseGuestEmails('{not json'), []);
    assert.deepStrictEqual(parseGuestEmails('"a string"'), []);
    assert.deepStrictEqual(parseGuestEmails('[1, 2]'), [], 'non-string entries are dropped');
  });
});
