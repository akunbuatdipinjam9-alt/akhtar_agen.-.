'use strict';
                                                                        
const { LEVEL } = require('../../permissions/levels');
const { fetchJson } = require('../net');

const WMO = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle', 56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain', 66: 'Light freezing rain', 67: 'Heavy freezing rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
};
const describeCode = (c) => WMO[c] || `Weather code ${c}`;

async function geocode(query, signal, count = 5) {
  const [name, ...rest] = String(query).split(',').map((s) => s.trim()).filter(Boolean);
  if (!name) throw new Error('Location is empty.');
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=${Math.max(count, 5)}&language=id&format=json`;
  const j = await fetchJson(url, { signal });
  let results = j.results || [];
  if (!results.length) throw new Error(`Location "${query}" not found.`);
  if (rest.length) {
    const hint = rest.join(' ').toLowerCase();
    const preferred = results.filter((r) => [r.country, r.admin1, r.admin2, r.country_code].filter(Boolean).some((v) => hint.includes(String(v).toLowerCase()) || String(v).toLowerCase().includes(hint)));
    if (preferred.length) results = [...preferred, ...results.filter((r) => !preferred.includes(r))];
  }
  return results.slice(0, count).map((r) => ({
    name: r.name, admin1: r.admin1 || null, country: r.country || null,
    latitude: r.latitude, longitude: r.longitude, timezone: r.timezone || null, population: r.population || null,
  }));
}

async function resolveLocation(args, signal) {
  if (typeof args.latitude === 'number' && typeof args.longitude === 'number') {
    return { name: args.location || `${args.latitude.toFixed(4)}, ${args.longitude.toFixed(4)}`, latitude: args.latitude, longitude: args.longitude };
  }
  if (!args.location) throw new Error('Provide "location" (city name) or "latitude" + "longitude".');
  const [first] = await geocode(args.location, signal, 1);
  return first;
}

async function forecast(loc, { current = false, hourly = false, days = 1 }, signal) {
  const q = new URLSearchParams({ latitude: loc.latitude, longitude: loc.longitude, timezone: 'auto', forecast_days: String(days) });
  if (current) q.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day');
  if (hourly) q.set('hourly', 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m');
  q.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset');
  return fetchJson(`https://api.open-meteo.com/v1/forecast?${q}`, { signal });
}

function dailyRows(j) {
  const d = j.daily || {};
  return (d.time || []).map((date, i) => ({
    date,
    condition: describeCode(d.weather_code?.[i]),
    weather_code: d.weather_code?.[i],
    temp_min_c: d.temperature_2m_min?.[i],
    temp_max_c: d.temperature_2m_max?.[i],
    precipitation_mm: d.precipitation_sum?.[i],
    precipitation_probability_max: d.precipitation_probability_max?.[i],
    sunrise: d.sunrise?.[i], sunset: d.sunset?.[i],
  }));
}

const locProps = {
  location: { type: 'string', description: 'City or place name, optionally with region/country, e.g. "Sukabumi, Indonesia".' },
  latitude: { type: 'number', description: 'Latitude (use with longitude instead of location).' },
  longitude: { type: 'number', description: 'Longitude.' },
};
const base = { group: 'weather', permission: LEVEL.NETWORK, category: 'network.info' };
const SOURCE = 'Open-Meteo (open-meteo.com)';

module.exports = [
  {
    ...base, name: 'weather.current',
    description: 'Get current weather for a location (temperature, feels-like, humidity, precipitation, wind) plus today\'s min/max.',
    inputSchema: { type: 'object', properties: locProps },
    async execute(args, ctx) {
      const loc = await resolveLocation(args, ctx.signal);
      const j = await forecast(loc, { current: true, days: 1 }, ctx.signal);
      const c = j.current || {};
      const today = dailyRows(j)[0] || {};
      return {
        location: loc, timezone: j.timezone, observed_at: c.time,
        temperature_c: c.temperature_2m, feels_like_c: c.apparent_temperature, humidity_pct: c.relative_humidity_2m,
        precipitation_mm: c.precipitation, weather_code: c.weather_code, condition: describeCode(c.weather_code),
        wind_speed_kmh: c.wind_speed_10m, wind_direction_deg: c.wind_direction_10m, is_day: c.is_day === 1,
        daily_min_c: today.temp_min_c, daily_max_c: today.temp_max_c, source: SOURCE,
      };
    },
  },
  {
    ...base, name: 'weather.hourly',
    description: 'Get an hourly weather forecast for the next N hours (max 168).',
    inputSchema: { type: 'object', properties: { ...locProps, hours: { type: 'integer', minimum: 1, maximum: 168, description: 'Default 24.' } } },
    async execute(args, ctx) {
      const hours = args.hours || 24;
      const loc = await resolveLocation(args, ctx.signal);
      const j = await forecast(loc, { hourly: true, days: Math.min(7, Math.ceil(hours / 24) + 1) }, ctx.signal);
      const h = j.hourly || {};
      const nowIso = (j.current?.time) || new Date().toISOString().slice(0, 13);
      let start = (h.time || []).findIndex((t) => t >= nowIso.slice(0, 13));
      if (start < 0) start = 0;
      const rows = (h.time || []).slice(start, start + hours).map((time, k) => {
        const i = start + k;
        return {
          time, temperature_c: h.temperature_2m?.[i], precipitation_probability: h.precipitation_probability?.[i],
          precipitation_mm: h.precipitation?.[i], condition: describeCode(h.weather_code?.[i]), wind_speed_kmh: h.wind_speed_10m?.[i],
        };
      });
      return { location: loc, timezone: j.timezone, hours: rows, source: SOURCE };
    },
  },
  {
    ...base, name: 'weather.daily',
    description: 'Get a daily forecast (min/max temperature, rain, condition) for 1–16 days.',
    inputSchema: { type: 'object', properties: { ...locProps, days: { type: 'integer', minimum: 1, maximum: 16, description: 'Default 7.' } } },
    async execute(args, ctx) {
      const loc = await resolveLocation(args, ctx.signal);
      const j = await forecast(loc, { days: args.days || 7 }, ctx.signal);
      return { location: loc, timezone: j.timezone, days: dailyRows(j), source: SOURCE };
    },
  },
  {
    ...base, name: 'weather.forecast',
    description: 'Get current conditions together with a multi-day forecast in one call.',
    inputSchema: { type: 'object', properties: { ...locProps, days: { type: 'integer', minimum: 1, maximum: 16, description: 'Default 5.' } } },
    async execute(args, ctx) {
      const loc = await resolveLocation(args, ctx.signal);
      const j = await forecast(loc, { current: true, days: args.days || 5 }, ctx.signal);
      const c = j.current || {};
      return {
        location: loc, timezone: j.timezone,
        current: { temperature_c: c.temperature_2m, feels_like_c: c.apparent_temperature, humidity_pct: c.relative_humidity_2m, condition: describeCode(c.weather_code), wind_speed_kmh: c.wind_speed_10m },
        days: dailyRows(j), source: SOURCE,
      };
    },
  },
  {
    ...base, name: 'weather.location',
    description: 'Look up coordinates for a place name (geocoding). Returns up to 5 candidates.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Place name.' } }, required: ['query'] },
    async execute({ query }, ctx) { return { candidates: await geocode(query, ctx.signal, 5), source: SOURCE }; },
  },
];

module.exports.helpers = { geocode, resolveLocation, describeCode, forecast, dailyRows };
