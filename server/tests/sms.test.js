import test from 'node:test';
import assert from 'node:assert';

// emailService reads TIMEZONE once at module load and smsReminderBody formats
// through it. Static imports are hoisted above this assignment, so the module
// under test is pulled in afterwards, by hand.
process.env.TIMEZONE = 'UTC';
const {
  normalizeUsPhone, isSmsEnabled, sendSms,
  smsReminderBody, smsConfirmationBody, smsRescheduleBody, smsCancellationBody,
  sendBookingConfirmationSms, sendBookingRescheduleSms, sendBookingCancellationSms
} = await import('../services/smsService.js');

/*
 * tests/setup.js sets no Twilio vars, so isSmsEnabled() is false throughout the
 * suite and nothing here can reach the real API. The send tests below set them
 * for one call, restore afterwards, and stub globalThis.fetch as well — belt
 * and braces, because a test that texted a real phone would be found out late.
 */
async function withTwilio(fn) {
  process.env.TWILIO_ACCOUNT_SID = 'ACtestsid';
  process.env.TWILIO_AUTH_TOKEN = 'test-token';
  process.env.TWILIO_FROM_NUMBER = '+15550001111';
  try {
    return await fn();
  } finally {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
  }
}

async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test('normalizeUsPhone', async (t) => {
  // The stored phone is free text typed by a student, so the accepted spellings
  // matter as much as the rejected ones.
  const accepts = [
    ['(555) 234-5678', '+15552345678', "the form's own placeholder format"],
    ['555.234.5678', '+15552345678', 'separators are irrelevant'],
    ['+1 555 234 5678', '+15552345678', 'already E.164, spaced'],
    ['15552345678', '+15552345678', '11 digits with the country code'],
    ['  555-234-5678  ', '+15552345678', 'surrounding whitespace']
  ];
  for (const [input, expected, why] of accepts) {
    await t.test(`accepts ${JSON.stringify(input)} — ${why}`, () => {
      assert.strictEqual(normalizeUsPhone(input), expected);
    });
  }

  const rejects = [
    ['+44 7700 900000', 'non-US, never coerced to +1'],
    ['555-5678', '7 digits, no area code'],
    ['(155) 234-5678', 'area code cannot start with 1'],
    ['(055) 234-5678', 'area code cannot start with 0'],
    ['555-134-5678', 'exchange code cannot start with 1'],
    ['555-034-5678', 'exchange code cannot start with 0'],
    ['555-234-5678 ext 2', 'the extension makes the digit count wrong'],
    ['', 'phone is an optional field'],
    ['   ', 'whitespace only'],
    ['not a phone', 'no digits at all'],
    [null, 'absent'],
    [undefined, 'absent'],
    [5552345678, 'a number, not a string']
  ];
  for (const [input, why] of rejects) {
    await t.test(`rejects ${JSON.stringify(input)} — ${why}`, () => {
      assert.strictEqual(normalizeUsPhone(input), null);
    });
  }
});

test('isSmsEnabled needs all three variables', async () => {
  assert.strictEqual(isSmsEnabled(), false, 'nothing configured in the test suite');
  await withTwilio(() => {
    assert.strictEqual(isSmsEnabled(), true);
    delete process.env.TWILIO_FROM_NUMBER;
    assert.strictEqual(isSmsEnabled(), false, 'a sending number is not optional');
  });
});

test('smsReminderBody', async (t) => {
  const booking = {
    time: '2026-06-10T15:00:00.000Z',
    client_timezone: 'UTC',
    manage_token: 'tok123'
  };

  await t.test('includes the business, the lead label, the time and the manage link', () => {
    process.env.PUBLIC_BASE_URL = 'https://example.com';
    try {
      assert.strictEqual(
        smsReminderBody(booking, 'in 1 hour', 'Acme Tutoring'),
        'Reminder: your Acme Tutoring session is in 1 hour, at 3:00 PM UTC. https://example.com/manage/tok123'
      );
    } finally {
      delete process.env.PUBLIC_BASE_URL;
    }
  });

  await t.test('omits the link rather than texting the word "null"', () => {
    const body = smsReminderBody(booking, 'in 1 hour', 'Acme Tutoring');
    assert.strictEqual(body, 'Reminder: your Acme Tutoring session is in 1 hour, at 3:00 PM UTC.');
    assert.ok(!body.includes('null'));
  });

  await t.test('reads as English with no business name set', () => {
    assert.strictEqual(
      smsReminderBody(booking, 'in 1 hour', ''),
      'Reminder: your session is in 1 hour, at 3:00 PM UTC.'
    );
  });

  await t.test('falls back to the server timezone when the client has none', () => {
    const body = smsReminderBody({ ...booking, client_timezone: null }, 'in 1 hour', 'Acme');
    assert.ok(body.includes('3:00 PM UTC'), body);
  });
});

test('sendSms', async (t) => {
  await t.test('is a no-op when Twilio is not configured', async () => {
    let called = false;
    await withFetch(() => { called = true; }, async () => {
      assert.strictEqual(await sendSms('+15552345678', 'hi'), false);
    });
    assert.strictEqual(called, false, 'must not reach the network while disabled');
  });

  await t.test('refuses a falsy recipient', async () => {
    await withTwilio(async () => {
      let called = false;
      await withFetch(() => { called = true; }, async () => {
        assert.strictEqual(await sendSms('', 'hi'), false);
      });
      assert.strictEqual(called, false);
    });
  });

  await t.test('posts the request Twilio expects', async () => {
    await withTwilio(async () => {
      let seen = null;
      const ok = await withFetch(async (url, init) => {
        seen = { url, init };
        return { ok: true, status: 201, json: async () => ({ sid: 'SM123' }) };
      }, () => sendSms('+15552345678', 'Reminder: your session is in 1 hour.'));

      assert.strictEqual(ok, true);
      assert.strictEqual(seen.url, 'https://api.twilio.com/2010-04-01/Accounts/ACtestsid/Messages.json');
      assert.strictEqual(seen.init.method, 'POST');
      assert.strictEqual(
        seen.init.headers.Authorization,
        `Basic ${Buffer.from('ACtestsid:test-token').toString('base64')}`
      );
      assert.strictEqual(seen.init.headers['Content-Type'], 'application/x-www-form-urlencoded');

      const body = new URLSearchParams(seen.init.body.toString());
      assert.strictEqual(body.get('To'), '+15552345678');
      assert.strictEqual(body.get('From'), '+15550001111');
      assert.strictEqual(body.get('Body'), 'Reminder: your session is in 1 hour.');
    });
  });

  await t.test('returns false on a rejected send without throwing', async () => {
    await withTwilio(async () => {
      const result = await withFetch(async () => ({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        // 21606 is the one worth recognising: a From number the account does
        // not own.
        json: async () => ({ code: 21606, message: 'The From number is not a valid phone number' })
      }), () => sendSms('+15552345678', 'hi'));
      assert.strictEqual(result, false);
    });
  });

  await t.test('returns false when the request itself fails', async () => {
    await withTwilio(async () => {
      const result = await withFetch(async () => { throw new Error('network down'); },
        () => sendSms('+15552345678', 'hi'));
      assert.strictEqual(result, false, 'one bad send must not kill the reminder tick');
    });
  });
});


test('smsConfirmationBody', async (t) => {
  // The camelCase shape the controller has in hand when a booking is created,
  // rather than the snake_case row the reminder job reads back.
  const fresh = {
    time: '2026-06-10T15:00:00.000Z',
    timezone: 'UTC',
    manageToken: 'tok123'
  };

  await t.test('spells out the date, because the session may be weeks away', () => {
    process.env.PUBLIC_BASE_URL = 'https://example.com';
    try {
      assert.strictEqual(
        smsConfirmationBody(fresh, 'Acme Tutoring'),
        'Confirmed: your Acme Tutoring session is Wed, Jun 10 at 3:00 PM UTC. https://example.com/manage/tok123'
      );
    } finally {
      delete process.env.PUBLIC_BASE_URL;
    }
  });

  await t.test('reads a snake_case row identically', () => {
    const row = { time: fresh.time, client_timezone: 'UTC', manage_token: 'tok123' };
    assert.strictEqual(smsConfirmationBody(row, 'Acme Tutoring'), smsConfirmationBody(fresh, 'Acme Tutoring'));
  });

  await t.test('omits the link rather than texting the word "null"', () => {
    const body = smsConfirmationBody(fresh, 'Acme Tutoring');
    assert.ok(!body.includes('null'), body);
    assert.ok(body.endsWith('UTC.'), body);
  });

  await t.test('both texts stay inside one Twilio segment for a realistic booking', () => {
    // A real manage token is crypto.randomBytes(16).toString('hex') — 32 chars,
    // not the short one used above — and the link is most of the message, so
    // this is the assertion that actually guards the billing boundary.
    process.env.PUBLIC_BASE_URL = 'https://booking.riveratutoring.com';
    const realistic = { ...fresh, manageToken: '94317474077c69a3d2de05b4956d414e' };
    try {
      for (const body of [
        smsConfirmationBody(realistic, 'Rivera Tutoring'),
        smsReminderBody(realistic, 'in 1 hour', 'Rivera Tutoring'),
        smsRescheduleBody(realistic, 'Rivera Tutoring'),
        smsCancellationBody(realistic, 'Rivera Tutoring')
      ]) {
        assert.ok(body.length <= 160, `${body.length} chars would bill two segments: ${body}`);
      }
    } finally {
      delete process.env.PUBLIC_BASE_URL;
    }
  });
});

test('sendBookingConfirmationSms', async (t) => {
  const booking = {
    time: '2026-06-10T15:00:00.000Z',
    timezone: 'UTC',
    manageToken: 'tok123',
    phone: '(555) 234-5678',
    smsConsent: true
  };

  await t.test('texts an opted-in student with a textable number', async () => {
    await withTwilio(async () => {
      let seen = null;
      const ok = await withFetch(async (url, init) => {
        seen = Object.fromEntries(new URLSearchParams(init.body.toString()));
        return { ok: true, status: 201, json: async () => ({ sid: 'SM1' }) };
      }, () => sendBookingConfirmationSms(booking, 'Acme Tutoring'));

      assert.strictEqual(ok, true);
      assert.strictEqual(seen.To, '+15552345678');
      assert.ok(seen.Body.startsWith('Confirmed: your Acme Tutoring session'), seen.Body);
    });
  });

  await t.test('every normal reason not to send is a silent skip', async () => {
    const skips = [
      [{ ...booking, smsConsent: false }, 'no opt-in'],
      [{ ...booking, phone: '' }, 'no phone'],
      [{ ...booking, phone: '+44 7700 900000' }, 'not a US number'],
      [{ ...booking, phone: '555-5678' }, 'not a whole number']
    ];
    await withTwilio(async () => {
      for (const [b, why] of skips) {
        let called = false;
        await withFetch(() => { called = true; }, async () => {
          assert.strictEqual(await sendBookingConfirmationSms(b, 'Acme'), false, why);
        });
        assert.strictEqual(called, false, `${why} must not reach Twilio`);
      }
    });
  });

  await t.test('a Twilio failure resolves false rather than throwing', async () => {
    // The controller calls this without awaiting, so a throw here would become
    // an unhandled rejection on an otherwise successful booking.
    await withTwilio(async () => {
      const result = await withFetch(async () => { throw new Error('network down'); },
        () => sendBookingConfirmationSms(booking, 'Acme'));
      assert.strictEqual(result, false);
    });
  });
});


test('smsRescheduleBody and smsCancellationBody', async (t) => {
  const booking = { time: '2026-06-10T15:00:00.000Z', timezone: 'UTC', manageToken: 'tok123' };

  await t.test('a reschedule keeps the manage link, so it can be moved again', () => {
    process.env.PUBLIC_BASE_URL = 'https://example.com';
    try {
      assert.strictEqual(
        smsRescheduleBody(booking, 'Acme Tutoring'),
        'Rescheduled: your Acme Tutoring session is now Wed, Jun 10 at 3:00 PM UTC. https://example.com/manage/tok123'
      );
    } finally {
      delete process.env.PUBLIC_BASE_URL;
    }
  });

  await t.test('a cancellation offers the booking page, not a dead manage link', () => {
    process.env.PUBLIC_BASE_URL = 'https://example.com/';
    try {
      // Note the trailing slash on the base above: it must not double up.
      assert.strictEqual(
        smsCancellationBody(booking, 'Acme Tutoring'),
        'Cancelled: your Acme Tutoring session on Wed, Jun 10 at 3:00 PM UTC. Book again: https://example.com'
      );
    } finally {
      delete process.env.PUBLIC_BASE_URL;
    }
  });

  await t.test('neither texts the word "null" without PUBLIC_BASE_URL', () => {
    for (const body of [smsRescheduleBody(booking, 'Acme'), smsCancellationBody(booking, 'Acme')]) {
      assert.ok(!body.includes('null'), body);
      assert.ok(body.endsWith('UTC.'), body);
    }
  });

  await t.test('both read a snake_case row identically', () => {
    const row = { time: booking.time, client_timezone: 'UTC', manage_token: 'tok123' };
    assert.strictEqual(smsRescheduleBody(row, 'Acme'), smsRescheduleBody(booking, 'Acme'));
    assert.strictEqual(smsCancellationBody(row, 'Acme'), smsCancellationBody(booking, 'Acme'));
  });
});

test('sendBookingRescheduleSms and sendBookingCancellationSms', async (t) => {
  // A row as performCancel and performReschedule hand it over.
  const row = {
    time: '2026-06-10T15:00:00.000Z', client_timezone: 'UTC', manage_token: 'tok123',
    phone: '(555) 234-5678', sms_consent: 1
  };

  await t.test('each sends its own wording', async () => {
    await withTwilio(async () => {
      for (const [send, opener] of [
        [sendBookingRescheduleSms, 'Rescheduled:'],
        [sendBookingCancellationSms, 'Cancelled:']
      ]) {
        let seen = null;
        const ok = await withFetch(async (url, init) => {
          seen = Object.fromEntries(new URLSearchParams(init.body.toString()));
          return { ok: true, status: 201, json: async () => ({ sid: 'SM1' }) };
        }, () => send(row, 'Acme Tutoring'));
        assert.strictEqual(ok, true);
        assert.strictEqual(seen.To, '+15552345678');
        assert.ok(seen.Body.startsWith(opener), seen.Body);
      }
    });
  });

  await t.test('consent still gates both, so an unticked box is never texted', async () => {
    await withTwilio(async () => {
      for (const send of [sendBookingRescheduleSms, sendBookingCancellationSms]) {
        let called = false;
        await withFetch(() => { called = true; }, async () => {
          assert.strictEqual(await send({ ...row, sms_consent: 0 }, 'Acme'), false);
        });
        assert.strictEqual(called, false);
      }
    });
  });

  await t.test('a Twilio failure resolves false rather than throwing', async () => {
    // Both are called without awaiting, so a throw would surface as an
    // unhandled rejection on an otherwise successful cancel or reschedule.
    await withTwilio(async () => {
      for (const send of [sendBookingRescheduleSms, sendBookingCancellationSms]) {
        const result = await withFetch(async () => { throw new Error('network down'); },
          () => send(row, 'Acme'));
        assert.strictEqual(result, false);
      }
    });
  });
});
