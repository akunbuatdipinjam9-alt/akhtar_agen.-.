'use strict';
                                                                        
const { LEVEL } = require('../../permissions/levels');

const systemTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function validTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

function requireTz(tz) {
  const zone = tz || systemTz();
  if (!validTz(zone)) throw new Error(`Unknown time zone "${tz}". Use an IANA name like "Asia/Jakarta".`);
  return zone;
}

function parts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'long',
  });
  return Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
}

function tzOffsetMinutes(date, timeZone) {
  const p = parts(date, timeZone);
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

function fmtOffset(min) {
  const sign = min >= 0 ? '+' : '-';
  const a = Math.abs(min);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

function describe(date, timeZone) {
  const p = parts(date, timeZone);
  return {
    timezone: timeZone,
    utc_offset: fmtOffset(tzOffsetMinutes(date, timeZone)),
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}:${p.second}`,
    weekday: p.weekday,
    local_readable: new Intl.DateTimeFormat('id-ID', { timeZone, dateStyle: 'full', timeStyle: 'long' }).format(date),
    iso_utc: date.toISOString(),
    unix: Math.floor(date.getTime() / 1000),
  };
}

                                                                         
function zonedWallTimeToDate(y, mo, d, h, mi, s, timeZone) {
  let guess = Date.UTC(y, mo - 1, d, h, mi, s);
  for (let i = 0; i < 2; i++) guess = Date.UTC(y, mo - 1, d, h, mi, s) - tzOffsetMinutes(new Date(guess), timeZone) * 60000;
  return new Date(guess);
}

function parseInput(time, fromTz) {
  const t = String(time).trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(t)) {
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) throw new Error(`Cannot parse time "${time}"`);
    return d;
  }
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return zonedWallTimeToDate(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), fromTz);
  m = t.match(/^(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/);
  if (m) {
    const today = parts(new Date(), fromTz);
    return zonedWallTimeToDate(+today.year, +today.month, +today.day, +m[1], +m[2], +(m[3] || 0), fromTz);
  }
  throw new Error(`Cannot parse time "${time}". Use "HH:MM", "YYYY-MM-DD HH:MM" or ISO-8601.`);
}

const tzProp = { type: 'string', description: 'IANA time zone, e.g. "Asia/Jakarta". Defaults to the computer\'s zone.' };

module.exports = [
  {
    name: 'time.current', group: 'time', permission: LEVEL.NONE, category: 'none',
    description: 'Get the current local date and time of the user\'s computer, or in another time zone.',
    inputSchema: { type: 'object', properties: { timezone: tzProp } },
    async execute({ timezone }) { return describe(new Date(), requireTz(timezone)); },
  },
  {
    name: 'time.date', group: 'time', permission: LEVEL.NONE, category: 'none',
    description: 'Get today\'s date (with weekday and ISO week number) for the local or given time zone.',
    inputSchema: { type: 'object', properties: { timezone: tzProp } },
    async execute({ timezone }) {
      const tz = requireTz(timezone);
      const d = describe(new Date(), tz);
      const [y, m, day] = d.date.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, day));
      const dayNum = dt.getUTCDay() || 7;
      dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
      const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
      return { date: d.date, weekday: d.weekday, iso_week: week, timezone: tz, readable: d.local_readable.split(' pukul')[0] };
    },
  },
  {
    name: 'time.timezone', group: 'time', permission: LEVEL.NONE, category: 'none',
    description: 'Get the computer\'s configured time zone and its current UTC offset.',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const tz = systemTz();
      return { timezone: tz, utc_offset: fmtOffset(tzOffsetMinutes(new Date(), tz)) };
    },
  },
  {
    name: 'time.convert', group: 'time', permission: LEVEL.NONE, category: 'none',
    description: 'Convert a time from one time zone to another.',
    inputSchema: {
      type: 'object',
      properties: {
        time: { type: 'string', description: '"HH:MM" (today), "YYYY-MM-DD HH:MM", or ISO-8601 with offset.' },
        from_timezone: tzProp,
        to_timezone: { type: 'string', description: 'Target IANA time zone.' },
      },
      required: ['time', 'to_timezone'],
    },
    async execute({ time, from_timezone, to_timezone }) {
      const from = requireTz(from_timezone);
      const to = requireTz(to_timezone);
      const instant = parseInput(time, from);
      return { from: describe(instant, from), to: describe(instant, to) };
    },
  },
];

module.exports.helpers = { describe, tzOffsetMinutes, validTz, systemTz, parts };
