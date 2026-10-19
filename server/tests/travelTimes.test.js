process.env.TIMEZONE = 'UTC';

import test from 'node:test';
import assert from 'node:assert';
import { saveSchools, saveDriveTimes } from '../schoolsStorage.js';
import { getAvailableSlotsForDay } from '../services/availability.js';
import { addressPlace, eventPlace, createTravelResolver } from '../services/travelTimes.js';

const SCHOOLS = [
  { id: 'shelton', name: 'Shelton School', address: '15720 Hillcrest Rd, Dallas, TX 75248', availability: {} },
  { id: 'stmarks', name: "St. Mark's School of Texas", address: '10600 Preston Rd, Dallas, TX 75230', availability: {} }
];
saveSchools(SCHOOLS);

const realFetch = globalThis.fetch;

// Stands in for the Distance Matrix API. `elementFor(origin, destination)`
// returns each element; every request is recorded in the returned array.
function mockMaps(elementFor) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const params = new URL(url).searchParams;
    const origins = params.get('origins').split('|');
    const destinations = params.get('destinations').split('|');
    calls.push({ origins, destinations });
    return {
      json: async () => ({
        status: 'OK',
        rows: origins.map(o => ({ elements: destinations.map(d => elementFor(o, d)) }))
      })
    };
  };
  return calls;
}

const minutes = m => () => ({ status: 'OK', duration: { value: m * 60 } });
const tagged = place => ({ extendedProperties: { private: { schoolId: place } } });

test.afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GOOGLE_MAPS_API_KEY;
});

test('addressPlace accepts street addresses and rejects virtual locations', () => {
  assert.strictEqual(addressPlace(' 4500 Elm St, Dallas '), 'address:4500 Elm St, Dallas');
  for (const location of ['', null, 'Zoom', 'https://meet.google.com/abc-defg', 'Google Meet', 'Phone call', '214-555-0100']) {
    assert.strictEqual(addressPlace(location), null, `rejects ${location}`);
  }
});

test('eventPlace keeps app events, matches schools, and falls back to the address', () => {
  // App-created events keep what they stored, including '' for phone calls.
  assert.strictEqual(eventPlace({ ...tagged('shelton'), location: '1 Elm St' }, SCHOOLS), null);
  assert.strictEqual(eventPlace({ ...tagged(''), location: 'Phone Call' }, SCHOOLS), null);
  // An app "Other location" booking travels from its address.
  assert.strictEqual(eventPlace({ ...tagged('__CUSTOM__'), location: '9 Oak Ln, Plano' }, SCHOOLS), 'address:9 Oak Ln, Plano');
  // Hand-made events: a school when one matches, otherwise the address.
  assert.strictEqual(eventPlace({ summary: 'Shelton - Jamie' }, SCHOOLS), 'shelton');
  assert.strictEqual(eventPlace({ summary: 'Jamie', location: '4500 Elm St, Dallas' }, SCHOOLS), 'address:4500 Elm St, Dallas');
  assert.strictEqual(eventPlace({ summary: 'Lunch' }, SCHOOLS), null);
});

test('drive time from any address comes from Google Maps, plus walk time', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  const calls = mockMaps(minutes(22));
  const home = 'address:100 Maple Ave, Dallas';
  const resolve = await createTravelResolver([tagged(home)], 'stmarks');

  // 22 min drive + 5 min walk, rounded to the nearest 5.
  assert.strictEqual(resolve(home, 'stmarks', 5), 25);
  assert.strictEqual(resolve('stmarks', home, 5), 25);
  assert.strictEqual(calls.length, 2, 'one lookup each way');
});

test('each address pair is looked up once, then read from the cache', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  const calls = mockMaps(minutes(40));
  const place = 'address:200 Cedar St, Dallas';
  await createTravelResolver([tagged(place)], 'stmarks');
  const again = await createTravelResolver([tagged(place)], 'stmarks');

  assert.strictEqual(calls.length, 2, 'the second request made no lookups');
  assert.strictEqual(again(place, 'stmarks', 5), 45);
});

test('an address Maps cannot find gets the 20-minute default, and is not looked up again', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  const calls = mockMaps(() => ({ status: 'NOT_FOUND' }));
  const place = 'address:Nowhere Rd, Atlantis';
  const resolve = await createTravelResolver([tagged(place)], 'stmarks');
  await createTravelResolver([tagged(place)], 'stmarks');

  assert.strictEqual(resolve(place, 'stmarks', 5), 25, '20 min default + 5 walk');
  assert.strictEqual(calls.length, 2, 'the miss was cached');
});

test('an implausibly long Maps answer is treated as not found', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  mockMaps(minutes(600));
  const place = 'address:Home';
  const resolve = await createTravelResolver([tagged(place)], 'stmarks');
  assert.strictEqual(resolve(place, 'stmarks', 5), 25, '20 min default + 5 walk, not 10 hours');
});

test('when Maps is unreachable the default applies and the lookup is retried later', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; throw new Error('network down'); };
  const place = 'address:300 Birch St, Dallas';
  const resolve = await createTravelResolver([tagged(place)], 'stmarks');
  assert.strictEqual(resolve(place, 'stmarks', 5), 25);

  await createTravelResolver([tagged(place)], 'stmarks');
  assert.strictEqual(attempts, 4, 'nothing was cached, so both directions were tried again');
});

test('without a Maps key, addresses get the 20-minute default', async () => {
  const calls = mockMaps(minutes(5));
  const place = 'address:400 Pine St, Dallas';
  const resolve = await createTravelResolver([tagged(place)], 'stmarks');
  assert.strictEqual(resolve(place, 'stmarks', 10), 30, '20 min default + 10 walk');
  assert.strictEqual(calls.length, 0);
});

test('school to school still uses the drive-time table, and phone slots need no travel', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  const calls = mockMaps(minutes(99));
  saveDriveTimes({ shelton: { stmarks: 25 } });
  const resolve = await createTravelResolver([tagged('shelton')], 'stmarks');

  assert.strictEqual(resolve('shelton', 'stmarks', 5), 30);
  assert.strictEqual(resolve('address:1 Elm St', '', 5), 0);
  assert.strictEqual(calls.length, 0, 'no Maps lookups for school pairs');
});

test('a hand-made session at a home address pushes back the next school slot', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  mockMaps(minutes(25));
  const manual = {
    summary: 'Jamie',
    location: '500 Walnut Hill Ln, Dallas',
    start: { dateTime: '2026-06-10T09:00:00.000Z' },
    end: { dateTime: '2026-06-10T10:00:00.000Z' }
  };
  const events = [{ ...manual, ...tagged(eventPlace(manual, SCHOOLS)) }];
  const getDriveTime = await createTravelResolver(events, 'stmarks');
  const day = new Date('2026-06-10T12:00:00.000Z');
  const slots = getAvailableSlotsForDay(day, [{ start: '10:00', end: '12:00' }], 60, events, 'stmarks', 5, getDriveTime);

  // Session ends 10:00; 25 min drive + 5 min walk means St. Mark's from 10:30.
  assert.strictEqual(slots[0].time, '2026-06-10T10:30:00.000Z');
});
