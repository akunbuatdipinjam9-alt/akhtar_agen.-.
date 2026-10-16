'use strict';
                                                                                                                  
const { LEVEL } = require('../../permissions/levels');
const { fetchJson } = require('../net');
const { geocode } = require('../weather').helpers;
const { parts } = require('../time').helpers;

const API = 'https://api.aladhan.com/v1';
const KEYS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

const clean = (t) => String(t || '').replace(/\s*\(.*\)\s*$/, '').trim();
const ddmmyyyy = (iso) => { const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}`; };

async function locationParams(args, signal) {
  if (typeof args.latitude === 'number' && typeof args.longitude === 'number') {
    return { kind: 'coords', params: { latitude: args.latitude, longitude: args.longitude }, label: `${args.latitude}, ${args.longitude}` };
  }
  if (args.city && args.country) {
    return { kind: 'city', params: { city: args.city, country: args.country }, label: `${args.city}, ${args.country}` };
  }
  const q = args.location || args.city;
  if (!q) throw new Error('Provide city + country, latitude + longitude, or location.');
  const [g] = await geocode(q, signal, 1);
  return { kind: 'coords', params: { latitude: g.latitude, longitude: g.longitude }, label: [g.name, g.admin1, g.country].filter(Boolean).join(', ') };
}

function methodOf(args, ctx) {
  return Number.isInteger(args.method) ? args.method : (ctx.settings?.prayer?.method ?? 20);
}

async function timingsFor(dateIso, args, ctx) {
  const loc = await locationParams(args, ctx.signal);
  const q = new URLSearchParams({ ...loc.params, method: String(methodOf(args, ctx)) });
  const endpoint = loc.kind === 'city' ? 'timingsByCity' : 'timings';
  const j = await fetchJson(`${API}/${endpoint}/${ddmmyyyy(dateIso)}?${q}`, { signal: ctx.signal });
  const d = j.data;
  if (!d) throw new Error('AlAdhan returned no data.');
  return {
    location: loc.label,
    date: d.date?.gregorian?.date ? dateIso : dateIso,
    readable_date: d.date?.readable,
    hijri: d.date?.hijri ? `${d.date.hijri.day} ${d.date.hijri.month?.en} ${d.date.hijri.year} H` : null,
    timezone: d.meta?.timezone,
    method: { id: d.meta?.method?.id, name: d.meta?.method?.name },
    timings: Object.fromEntries(KEYS.map((k) => [k, clean(d.timings?.[k])])),
    source: 'AlAdhan (aladhan.com)',
  };
}

function todayIn(tz) {
  const p = parts(new Date(), tz || Intl.DateTimeFormat().resolvedOptions().timeZone);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

const locProps = {
  city: { type: 'string', description: 'City name, e.g. "Depok".' },
  country: { type: 'string', description: 'Country, e.g. "Indonesia".' },
  latitude: { type: 'number' },
  longitude: { type: 'number' },
  location: { type: 'string', description: 'Free-form place name (geocoded) if city/country or coordinates are not known.' },
  method: { type: 'integer', description: 'AlAdhan calculation method id. Default from Settings (20 = Kemenag RI).' },
};
const base = { group: 'prayer', permission: LEVEL.NETWORK, category: 'network.info' };

module.exports = [
  {
    ...base, name: 'prayer.today',
    description: 'Get today\'s prayer times (Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha) for a location.',
    inputSchema: { type: 'object', properties: locProps },
    async execute(args, ctx) {
      const probe = await timingsFor(todayIn().date, args, ctx);
      const local = todayIn(probe.timezone);
      return local.date === probe.date ? probe : timingsFor(local.date, args, ctx);
    },
  },
  {
    ...base, name: 'prayer.date',
    description: 'Get prayer times for a specific date.',
    inputSchema: { type: 'object', properties: { ...locProps, date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'] },
    async execute(args, ctx) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error('date must be YYYY-MM-DD');
      return timingsFor(args.date, args, ctx);
    },
  },
  {
    ...base, name: 'prayer.month',
    description: 'Get the prayer-time calendar for a whole month.',
    inputSchema: {
      type: 'object',
      properties: { ...locProps, year: { type: 'integer', minimum: 1900, maximum: 2200 }, month: { type: 'integer', minimum: 1, maximum: 12 } },
      required: ['year', 'month'],
    },
    async execute(args, ctx) {
      const loc = await locationParams(args, ctx.signal);
      const q = new URLSearchParams({ ...loc.params, method: String(methodOf(args, ctx)) });
      const endpoint = loc.kind === 'city' ? 'calendarByCity' : 'calendar';
      const j = await fetchJson(`${API}/${endpoint}/${args.year}/${args.month}?${q}`, { signal: ctx.signal });
      const rows = (j.data || []).map((d) => ({
        date: d.date?.gregorian?.date, hijri: d.date?.hijri?.date,
        ...Object.fromEntries(KEYS.map((k) => [k, clean(d.timings?.[k])])),
      }));
      return { location: loc.label, method: j.data?.[0]?.meta?.method?.name, timezone: j.data?.[0]?.meta?.timezone, days: rows, source: 'AlAdhan (aladhan.com)' };
    },
  },
  {
    ...base, name: 'prayer.next',
    description: 'Get the next upcoming prayer and how long until it, for a location.',
    inputSchema: { type: 'object', properties: locProps },
    async execute(args, ctx) {
      let today = await timingsFor(todayIn().date, args, ctx);
      const local = todayIn(today.timezone);
      if (local.date !== today.date) today = await timingsFor(local.date, args, ctx);
      const order = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
      let next = order.map((k) => ({ name: k, time: today.timings[k], date: today.date })).find((p) => p.time > local.time);
      if (!next) {
        const tomorrow = await timingsFor(addDays(local.date, 1), args, ctx);
        next = { name: 'Fajr', time: tomorrow.timings.Fajr, date: tomorrow.date };
      }
      const [nh, nm] = next.time.split(':').map(Number);
      const [ch, cm] = local.time.split(':').map(Number);
      let minutes = nh * 60 + nm - (ch * 60 + cm);
      if (next.date !== local.date) minutes += 24 * 60;
      return {
        location: today.location, timezone: today.timezone, now_local: `${local.date} ${local.time}`,
        next_prayer: next.name, at: `${next.date} ${next.time}`, minutes_until: minutes,
        method: today.method, source: today.source,
      };
    },
  },
];
