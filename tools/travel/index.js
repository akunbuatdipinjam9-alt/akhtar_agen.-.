'use strict';
   
                         
  
                                                                       
                                                                        
                                                    
   
const { LEVEL } = require('../../permissions/levels');
const { fetchJson } = require('../net');
const { helpers: weatherHelpers } = require('../weather');
const { calculateRoutes } = require('../../main/map-navigation');

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const CATEGORY_FILTERS = {
  food: [
    ['amenity', 'restaurant'], ['amenity', 'cafe'], ['amenity', 'fast_food'], ['amenity', 'food_court'],
  ],
  souvenir: [
    ['shop', 'souvenir'], ['shop', 'gift'], ['shop', 'craft'], ['craft', '*'],
  ],
  attraction: [
    ['tourism', 'attraction'], ['tourism', 'museum'], ['tourism', 'viewpoint'], ['historic', '*'], ['leisure', 'park'],
  ],
  rest: [
    ['highway', 'rest_area'], ['amenity', 'toilets'], ['amenity', 'parking'], ['amenity', 'cafe'], ['amenity', 'restaurant'],
  ],
  fuel: [
    ['amenity', 'fuel'], ['shop', 'convenience'],
  ],
};

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function poiCoordinates(element) {
  if (Number.isFinite(element.lat) && Number.isFinite(element.lon)) return { latitude: element.lat, longitude: element.lon };
  if (Number.isFinite(element.center?.lat) && Number.isFinite(element.center?.lon)) return { latitude: element.center.lat, longitude: element.center.lon };
  return null;
}

function normalizePoi(element, category) {
  const tags = element.tags || {};
  const coords = poiCoordinates(element);
  if (!coords) return null;
  const fallbackType = cleanText(tags.amenity) || cleanText(tags.shop) || cleanText(tags.tourism) || cleanText(tags.historic) || cleanText(tags.leisure) || cleanText(tags.craft) || category;
  const name = cleanText(tags.name) || cleanText(tags['name:id']) || cleanText(tags.brand) || null;
  return {
    id: `${element.type || 'node'}-${element.id}`,
    name: name || `${fallbackType || category} tanpa nama`,
    category,
    type: fallbackType,
    cuisine: cleanText(tags.cuisine),
    opening_hours: cleanText(tags.opening_hours),
    website: cleanText(tags.website) || cleanText(tags['contact:website']),
    phone: cleanText(tags.phone) || cleanText(tags['contact:phone']),
    address: [tags['addr:street'], tags['addr:housenumber'], tags['addr:city']].filter(Boolean).join(' ') || null,
    ...coords,
    source: 'OpenStreetMap/Overpass',
  };
}

function buildOverpassQuery(latitude, longitude, radius, category) {
  const filters = CATEGORY_FILTERS[category];
  if (!filters) throw new Error(`Unknown travel category "${category}".`);
  const parts = [];
  for (const [key, value] of filters) {
    const expr = value === '*' ? `["${key}"]` : `["${key}"="${value}"]`;
    parts.push(`nwr(around:${radius},${latitude},${longitude})${expr};`);
  }
  return `[out:json][timeout:20];(${parts.join('')});out center tags;`;
}

async function overpass(query, signal) {
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const url = `${endpoint}?data=${encodeURIComponent(query)}`;
      return await fetchJson(url, { signal, timeoutMs: 25000 });
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
    }
  }
  throw lastError || new Error('Overpass request failed.');
}

async function searchNearby({ latitude, longitude, radius = 5000, category = 'food', limit = 8 }, signal) {
  const query = buildOverpassQuery(latitude, longitude, radius, category);
  const data = await overpass(query, signal);
  const seen = new Set();
  const rows = [];
  for (const element of data.elements || []) {
    const poi = normalizePoi(element, category);
    if (!poi) continue;
                                                                       
    const key = `${poi.name.toLowerCase()}|${poi.latitude.toFixed(4)}|${poi.longitude.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(poi);
  }
  rows.sort((a, b) => {
    const aNamed = /tanpa nama$/i.test(a.name) ? 1 : 0;
    const bNamed = /tanpa nama$/i.test(b.name) ? 1 : 0;
    return aNamed - bNamed || a.name.localeCompare(b.name, 'id');
  });
  return rows.slice(0, limit);
}

function routeSamples(geometry, count = 2) {
  if (!Array.isArray(geometry) || geometry.length < 3 || count <= 0) return [];
  const fractions = count === 1 ? [0.5] : Array.from({ length: count }, (_, i) => (i + 1) / (count + 1));
  return fractions.map((fraction) => geometry[Math.min(geometry.length - 2, Math.max(1, Math.round((geometry.length - 1) * fraction)))]);
}

async function destinationWeather(location, days, signal) {
  const data = await weatherHelpers.forecast(location, { current: true, days }, signal);
  const current = data.current || {};
  return {
    timezone: data.timezone || location.timezone || null,
    current: {
      temperature_c: current.temperature_2m,
      feels_like_c: current.apparent_temperature,
      humidity_pct: current.relative_humidity_2m,
      condition: weatherHelpers.describeCode(current.weather_code),
      precipitation_mm: current.precipitation,
      wind_speed_kmh: current.wind_speed_10m,
    },
    days: weatherHelpers.dailyRows(data),
    source: 'Open-Meteo',
  };
}

async function resolvePlace(query, signal) {
  const [place] = await weatherHelpers.geocode(query, signal, 1);
  return place;
}

async function safePart(label, fn) {
  try { return { value: await fn(), warning: null }; }
  catch (error) { return { value: [], warning: `${label}: ${error.message}` }; }
}

function compactRoute(route) {
  return {
    distance_km: route.distance_km,
    duration_min: route.duration_min,
    traffic_realtime: false,
    major_steps: (route.steps || []).filter((step) => step.name || step.distance_m > 3000).slice(0, 16),
  };
}

async function buildGuide(args, ctx) {
  const origin = await resolvePlace(args.origin, ctx.signal);
  const destination = await resolvePlace(args.destination, ctx.signal);
  const [route] = await calculateRoutes(origin, destination, { alternatives: false, signal: ctx.signal });
  const radius = Math.max(1000, Math.min(15000, args.radius_m || 6000));
  const poiLimit = Math.max(1, Math.min(12, args.poi_limit || 6));
  const interests = Array.isArray(args.interests) && args.interests.length
    ? args.interests
    : ['food', 'souvenir', 'attraction'];

  const weather = args.include_weather === false
    ? { value: null, warning: null }
    : await safePart('Cuaca tujuan tidak tersedia', () => destinationWeather(destination, Math.max(1, Math.min(7, args.weather_days || 3)), ctx.signal));

  const nearby = {};
  const warnings = [];
  for (const category of interests) {
    const result = await safePart(`Data ${category} tidak tersedia`, () => searchNearby({
      latitude: destination.latitude,
      longitude: destination.longitude,
      radius,
      category,
      limit: poiLimit,
    }, ctx.signal));
    nearby[category] = result.value;
    if (result.warning) warnings.push(result.warning);
  }

  const stopCategories = Array.isArray(args.stop_categories) && args.stop_categories.length
    ? args.stop_categories
    : ['rest', 'food', 'fuel'];
  const samples = routeSamples(route.geometry, Math.max(0, Math.min(3, args.route_stop_zones ?? 2)));
  const routeStops = [];
  for (let i = 0; i < samples.length; i++) {
    const zone = { zone: i + 1, approximate_progress_pct: Math.round(((i + 1) / (samples.length + 1)) * 100), center: samples[i], places: [] };
    for (const category of stopCategories) {
      const result = await safePart(`Titik singgah ${category} zona ${i + 1} tidak tersedia`, () => searchNearby({
        latitude: samples[i].latitude,
        longitude: samples[i].longitude,
        radius: Math.min(5000, radius),
        category,
        limit: 3,
      }, ctx.signal));
      zone.places.push(...result.value);
      if (result.warning) warnings.push(result.warning);
    }
    const dedup = new Map();
    for (const poi of zone.places) if (!dedup.has(poi.id)) dedup.set(poi.id, poi);
    zone.places = [...dedup.values()].slice(0, 8);
    routeStops.push(zone);
  }

  if (weather.warning) warnings.push(weather.warning);

  if (args.show_on_map !== false) {
    ctx.app.getWindow?.()?.webContents.send('map:event', { type: 'routes', routes: [route], from: origin, to: destination });
    const markerPois = [
      ...(nearby.food || []).slice(0, 3),
      ...(nearby.souvenir || []).slice(0, 3),
      ...(nearby.attraction || []).slice(0, 3),
      ...routeStops.flatMap((z) => z.places.slice(0, 2)),
    ];
    ctx.app.getWindow?.()?.webContents.send('map:event', { type: 'marker_clear' });
    for (const poi of markerPois) {
      ctx.app.getWindow?.()?.webContents.send('map:event', {
        type: 'marker_add',
        marker: { id: `travel-${poi.id}`, latitude: poi.latitude, longitude: poi.longitude, label: `${poi.name} · ${poi.type || poi.category}` },
      });
    }
  }

  return {
    origin,
    destination,
    route: compactRoute(route),
    weather: weather.value,
    nearby,
    route_stops: routeStops,
    preferences: {
      travel_style: args.travel_style || 'balanced',
      interests,
      notes: cleanText(args.notes),
    },
    caveats: [
      'ETA memakai estimasi OSRM dan bukan data macet real-time.',
      'Tempat berasal dari OpenStreetMap/Overpass; rating, kualitas rasa, stok oleh-oleh, dan status buka real-time tidak tersedia kecuali ada data eksplisit.',
      'Untuk keputusan penting, verifikasi jam buka, harga, kondisi jalan, dan ulasan terbaru sebelum berangkat.',
    ],
    warnings,
    sources: ['OpenStreetMap/Overpass', 'OSRM', ...(weather.value ? ['Open-Meteo'] : [])],
  };
}

const base = {
  group: 'travel',
  permission: LEVEL.NETWORK,
  category: 'network.travel',
  toolIntelligence: { risk: 'low', sideEffects: false, verification: ['map.routes', 'weather.forecast'] },
};

module.exports = [
  {
    ...base,
    name: 'travel.guide',
    description: 'Build an AI travel-guide data pack for a trip: route/ETA, destination weather, food, souvenir shops, attractions and optional stop zones along the drive. Use this for requests like “guide me from Jakarta to Bandung and tell me what to eat/buy”. Can also draw the route and POIs on the in-app map. Ratings and live traffic are not invented.',
    inputSchema: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Starting city/place, e.g. Jakarta.' },
        destination: { type: 'string', description: 'Destination city/place.' },
        travel_style: { type: 'string', enum: ['budget', 'balanced', 'comfort', 'family', 'foodie', 'adventure'], description: 'Preference used by the AI when presenting the structured results.' },
        interests: { type: 'array', items: { type: 'string', enum: ['food', 'souvenir', 'attraction'] }, maxItems: 3 },
        stop_categories: { type: 'array', items: { type: 'string', enum: ['rest', 'food', 'fuel'] }, maxItems: 3 },
        radius_m: { type: 'integer', minimum: 1000, maximum: 15000, description: 'POI search radius around the destination. Default 6000 m.' },
        poi_limit: { type: 'integer', minimum: 1, maximum: 12, description: 'Max POIs per destination category. Default 6.' },
        route_stop_zones: { type: 'integer', minimum: 0, maximum: 3, description: 'How many approximate mid-route stop zones to discover. Default 2.' },
        include_weather: { type: 'boolean' },
        weather_days: { type: 'integer', minimum: 1, maximum: 7 },
        show_on_map: { type: 'boolean', description: 'Draw the route and selected POIs in the app map. Default true.' },
        notes: { type: 'string', maxLength: 800, description: 'Extra needs such as halal food, kids, wheelchair, avoiding tolls, etc. These are presentation preferences; route engine currently remains normal driving.' },
      },
      required: ['origin', 'destination'],
    },
    timeoutMs: 90000,
    retryable: false,
    async execute(args, ctx) { return buildGuide(args, ctx); },
  },
  {
    ...base,
    name: 'travel.search_nearby',
    description: 'Find travel-relevant places near a city/place: food, souvenir/gift shops, attractions, rest facilities or fuel/convenience. Uses OpenStreetMap/Overpass and does not provide ratings.',
    inputSchema: {
      type: 'object',
      properties: {
        location: { type: 'string' },
        category: { type: 'string', enum: ['food', 'souvenir', 'attraction', 'rest', 'fuel'] },
        radius_m: { type: 'integer', minimum: 500, maximum: 20000 },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
        show_on_map: { type: 'boolean' },
      },
      required: ['location', 'category'],
    },
    timeoutMs: 45000,
    retryable: false,
    async execute(args, ctx) {
      const loc = await resolvePlace(args.location, ctx.signal);
      const places = await searchNearby({ latitude: loc.latitude, longitude: loc.longitude, radius: args.radius_m || 5000, category: args.category, limit: args.limit || 10 }, ctx.signal);
      if (args.show_on_map !== false) {
        ctx.app.getWindow?.()?.webContents.send('map:event', { type: 'marker_clear' });
        for (const poi of places) ctx.app.getWindow?.()?.webContents.send('map:event', { type: 'marker_add', marker: { id: `travel-${poi.id}`, latitude: poi.latitude, longitude: poi.longitude, label: `${poi.name} · ${poi.type || poi.category}` } });
        ctx.app.getWindow?.()?.webContents.send('map:event', { type: 'open', point: loc, zoom: 13 });
      }
      return {
        location: loc,
        category: args.category,
        places,
        source: 'OpenStreetMap/Overpass',
        caveat: 'No rating or live-open guarantee. Verify reviews, prices and opening hours before visiting.',
      };
    },
  },
  {
    ...base,
    name: 'travel.route_stops',
    description: 'Find approximate food/rest/fuel options in one to three zones along a driving route. Useful for long road trips when the user asks where to stop on the way.',
    inputSchema: {
      type: 'object',
      properties: {
        origin: { type: 'string' },
        destination: { type: 'string' },
        categories: { type: 'array', items: { type: 'string', enum: ['rest', 'food', 'fuel'] }, maxItems: 3 },
        zones: { type: 'integer', minimum: 1, maximum: 3 },
        radius_m: { type: 'integer', minimum: 1000, maximum: 6000 },
      },
      required: ['origin', 'destination'],
    },
    timeoutMs: 75000,
    retryable: false,
    async execute(args, ctx) {
      const origin = await resolvePlace(args.origin, ctx.signal);
      const destination = await resolvePlace(args.destination, ctx.signal);
      const [route] = await calculateRoutes(origin, destination, { alternatives: false, signal: ctx.signal });
      const samples = routeSamples(route.geometry, args.zones || 2);
      const categories = args.categories?.length ? args.categories : ['rest', 'food', 'fuel'];
      const zones = [];
      for (let i = 0; i < samples.length; i++) {
        const places = [];
        for (const category of categories) {
          try { places.push(...await searchNearby({ ...samples[i], radius: args.radius_m || 4000, category, limit: 4 }, ctx.signal)); }
          catch { /* partial results are better than failing the whole route-stop request */ }
        }
        const unique = [...new Map(places.map((p) => [p.id, p])).values()].slice(0, 10);
        zones.push({ zone: i + 1, approximate_progress_pct: Math.round(((i + 1) / (samples.length + 1)) * 100), center: samples[i], places: unique });
      }
      return { origin, destination, route: compactRoute(route), zones, caveat: 'Stop zones are approximate and not live-traffic aware.' };
    },
  },
];

module.exports.helpers = { buildOverpassQuery, normalizePoi, routeSamples, searchNearby, compactRoute };
