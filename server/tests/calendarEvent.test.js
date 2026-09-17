import test from 'node:test';
import assert from 'node:assert';

// manageUrl reads PUBLIC_BASE_URL at call time, so set it before importing.
process.env.PUBLIC_BASE_URL = 'https://booking.example.com';
const { buildBookingEvent } = await import('../controllers/bookingController.js');

const START = new Date('2099-03-04T15:00:00.000Z');
const END = new Date('2099-03-04T16:00:00.000Z');

const booking = (over = {}) => ({
  id: 'abc123',
  name: 'Avery Chen',
  email: 'avery@example.com',
  notes: '',
  location: 'Lincoln High - 1 Main St',
  schoolId: 'lincoln',
  meetingType: 'physical',
  manageToken: 'tok123',
  guestEmails: [],
  ...over
});

test('buildBookingEvent', async (t) => {
  await t.test('invites the student alone when there are no guests', () => {
    const event = buildBookingEvent(booking(), START, END);
    assert.deepStrictEqual(event.attendees, [{ email: 'avery@example.com' }]);
    assert.ok(!/Guests:/.test(event.description), 'no empty Guests line');
  });

  await t.test('adds guests as attendees after the student', () => {
    const event = buildBookingEvent(
      booking({ guestEmails: ['mum@example.com', 'dad@example.com'] }), START, END);
    assert.deepStrictEqual(event.attendees, [
      { email: 'avery@example.com' },
      { email: 'mum@example.com' },
      { email: 'dad@example.com' }
    ]);
    assert.match(event.description, /Guests: mum@example\.com, dad@example\.com/);
  });

  await t.test('carries the manage link, which is a guest\'s only copy of it', () => {
    const event = buildBookingEvent(booking({ guestEmails: ['mum@example.com'] }), START, END);
    assert.match(event.description, /Reschedule or cancel: https:\/\/booking\.example\.com\/manage\/tok123/);
  });

  await t.test('omits the link rather than writing a broken one', () => {
    const saved = process.env.PUBLIC_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    try {
      const event = buildBookingEvent(booking(), START, END);
      assert.ok(!/Reschedule or cancel/.test(event.description), event.description);
    } finally {
      process.env.PUBLIC_BASE_URL = saved;
    }
  });

  await t.test('omits an empty notes line', () => {
    assert.ok(!/Notes:/.test(buildBookingEvent(booking(), START, END).description));
    assert.match(buildBookingEvent(booking({ notes: 'Algebra' }), START, END).description, /Notes: Algebra/);
  });

  await t.test('still sets location and times for an in-person booking', () => {
    const event = buildBookingEvent(booking(), START, END);
    assert.strictEqual(event.location, 'Lincoln High - 1 Main St');
    assert.strictEqual(event.start.dateTime, START.toISOString());
    assert.strictEqual(event.end.dateTime, END.toISOString());
    assert.strictEqual(event.extendedProperties.private.schoolId, 'lincoln');
    assert.ok(!event.conferenceData);
  });

  await t.test('still requests a Meet link for a google-meet booking', () => {
    const event = buildBookingEvent(booking({ meetingType: 'google-meet', schoolId: '' }), START, END);
    assert.strictEqual(event.conferenceData.createRequest.requestId, 'abc123');
    assert.strictEqual(event.location, undefined);
  });
});
