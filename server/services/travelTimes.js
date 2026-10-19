/*
 * Travel time between a calendar event and the school a slot is being offered
 * at.
 *
 * Availability spaces sessions by "place". A place is one of:
 *   - a school id: drive time comes from the admin's drive-time table;
 *   - an address place ("address:<text>"): any other address, e.g. a session
 *     typed into Google Calendar by hand. Drive time comes from Google Maps;
 *   - 'custom': an "Other location" slot, whose address is not known yet;
 *   - '' or missing: no travel (phone and video sessions, personal events).
 *
 * The slot loop in availability.js is synchronous and runs many times per
 * request, so the Maps lookups happen here first. Each answer is cached in the
 * database, so an address pair costs one lookup ever, not one per request.
 */
import dbService from './dbService.js';
import { loadSchools, createDriveTimeResolver, bufferMinutes } from '../schoolsStorage.js';
import { matchSchoolForEvent } from './availability.js';
import { CUSTOM_LOCATION_ID } from '../customLocationConfig.js';

export const ADDRESS_PLACE_PREFIX = 'address:';

// Drive time assumed when an address cannot be looked up: Maps found no route,
// Maps is unreachable, or no API key is configured. Walk time is added on top.
export const UNKNOWN_ADDRESS_MINUTES = 20;

// A vague location ("Home", "Gym") can make Maps pick a namesake hundreds of
// miles away, and its drive time would block the whole day. Treat answers this
// long as Maps not finding the place.
export const MAX_PLAUSIBLE_DRIVE_MINUTES = 120;

// Distance Matrix allows at most 25 origins or 25 destinations per request.
const MAPS_BATCH = 25;
const MAPS_TIMEOUT_MS = 5000;

// Locations that are not somewhere you drive to.
const VIRTUAL_LOCATION = /https?:\/\/|\b(zoom|meet|teams|webex|facetime|skype|phone|call|virtual|online|remote|tbd)\b/i;

// The address place for a free-text location, or null when it is not a
// physical address (blank, a link, "Zoom", a phone number...).
export function addressPlace(location) {
  const text = String(location || '').trim();
  if (!text || !/[a-z]/i.test(text) || VIRTUAL_LOCATION.test(text)) return null;
  return ADDRESS_PLACE_PREFIX + text;
}

/*
 * Where a Google Calendar event takes place, or null to leave it as stored.
 *
 * Events the app created store their school; an "Other location" booking
 * stores a sentinel, and its address is in the event's location. Events typed
 * in by hand store nothing: match them to a school first, so the admin's own
 * drive times apply, and otherwise use their address.
 */
export function eventPlace(event, schools) {
  const stored = event.extendedProperties?.private?.schoolId;
  if (stored === CUSTOM_LOCATION_ID) return addressPlace(event.location);
  if (stored !== undefined) return null;
  const school = matchSchoolForEvent(event, schools);
  if (school) return school.id;
  return addressPlace(event.location);
}

// Looks up drive minutes for every origin → destination pair. One side must be
// a single address; the other is batched. Returns [{ from, to, minutes }] for
// the pairs Maps answered (minutes null when it found no route). Pairs that
// failed for any other reason are left out so they are retried next time.
async function fetchDriveMinutes(origins, destinations, apiKey) {
  const results = [];
  const many = origins.length > 1 ? origins : destinations;
  for (let i = 0; i < many.length; i += MAPS_BATCH) {
    const batch = many.slice(i, i + MAPS_BATCH);
    const from = origins.length > 1 ? batch : origins;
    const to = origins.length > 1 ? destinations : batch;
    const params = new URLSearchParams({
      origins: from.join('|'),
      destinations: to.join('|'),
      mode: 'driving',
      units: 'metric',
      key: apiKey
    });
    let data;
    try {
      const response = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${params}`, {
        signal: AbortSignal.timeout(MAPS_TIMEOUT_MS)
      });
      data = await response.json();
    } catch (err) {
      console.error('Drive time lookup failed:', err.message);
      continue;
    }
    if (data?.status !== 'OK') {
      console.error('Drive time lookup failed:', data?.error_message || data?.status);
      continue;
    }
    from.forEach((origin, r) => {
      to.forEach((destination, c) => {
        const element = data.rows?.[r]?.elements?.[c];
        if (element?.status === 'OK' && element.duration) {
          const minutes = Math.round(element.duration.value / 60);
          results.push({ from: origin, to: destination, minutes: minutes <= MAX_PLAUSIBLE_DRIVE_MINUTES ? minutes : null });
        } else if (element?.status === 'NOT_FOUND' || element?.status === 'ZERO_RESULTS') {
          results.push({ from: origin, to: destination, minutes: null });
        }
      });
    });
  }
  return results;
}

// Drive minutes between each address and the school's address, both ways,
// from the cache where possible and Google Maps otherwise. Returns a Map keyed
// "from\nto".
async function lookupAddressDriveTimes(addresses, schoolAddress) {
  const pairs = addresses.flatMap(a => [[a, schoolAddress], [schoolAddress, a]]);
  const known = dbService.getAddressDriveTimes(pairs);
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return known;

  const toSchool = addresses.filter(a => !known.has(`${a}\n${schoolAddress}`));
  const fromSchool = addresses.filter(a => !known.has(`${schoolAddress}\n${a}`));
  const fetched = [
    ...(toSchool.length ? await fetchDriveMinutes(toSchool, [schoolAddress], apiKey) : []),
    ...(fromSchool.length ? await fetchDriveMinutes([schoolAddress], fromSchool, apiKey) : [])
  ];
  if (fetched.length > 0) {
    dbService.saveAddressDriveTimes(fetched);
    for (const { from, to, minutes } of fetched) known.set(`${from}\n${to}`, minutes);
  }
  return known;
}

/*
 * The getDriveTime(fromPlace, toPlace, walkTime) callback for one request's
 * slot generation. `events` must already carry their places (see eventPlace)
 * and `slotPlace` is the place being booked.
 */
export async function createTravelResolver(events, slotPlace) {
  const schools = loadSchools();
  const schoolDriveTime = createDriveTimeResolver();
  const schoolAddress = id => schools.find(s => s.id === id)?.address?.trim() || null;
  const isAddress = place => typeof place === 'string' && place.startsWith(ADDRESS_PLACE_PREFIX);
  const placeAddress = place => (isAddress(place) ? place.slice(ADDRESS_PLACE_PREFIX.length) : schoolAddress(place));

  const addresses = [...new Set(
    events
      .map(e => e.extendedProperties?.private?.schoolId)
      .filter(isAddress)
      .map(placeAddress)
  )];
  const slotAddress = schoolAddress(slotPlace);
  const minutes = addresses.length > 0 && slotAddress
    ? await lookupAddressDriveTimes(addresses, slotAddress)
    : new Map();

  return (from, to, walkTime = 5) => {
    if (!from || !to || from === to) return 0;
    if (!isAddress(from) && !isAddress(to)) return schoolDriveTime(from, to, walkTime);
    const drive = minutes.get(`${placeAddress(from)}\n${placeAddress(to)}`);
    return bufferMinutes(drive ?? UNKNOWN_ADDRESS_MINUTES, walkTime);
  };
}
