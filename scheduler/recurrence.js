'use strict';
   
                                                                         
                                                                      
                                                                 
                                                        
   
const DOW = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function systemTz() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function parts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  return Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
}

                                                                            
function tzOffsetMinutes(date, timeZone) {
  const p = parts(date, timeZone);
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

                                                                                       
function localToUtc(y, m, d, hh, mm, timeZone) {
  let guessMs = Date.UTC(y, m - 1, d, hh, mm, 0);
  for (let i = 0; i < 2; i++) {
    const offsetMin = tzOffsetMinutes(new Date(guessMs), timeZone);
    guessMs = Date.UTC(y, m - 1, d, hh, mm, 0) - offsetMin * 60000;
  }
  return new Date(guessMs);
}

function addDaysYMD(y, m, d, days) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }           

function parseTime(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
  if (!m) throw new Error(`Invalid time "${time}" — use 24-hour "HH:MM".`);
  const hh = +m[1], mm = +m[2];
  if (hh > 23 || mm > 59) throw new Error(`Invalid time "${time}".`);
  return [hh, mm];
}

   
                                                                                                                                                              
                     
                  
   
function computeNextRun(schedule, from = new Date()) {
  if (schedule.recurrence === 'once') {
    if (!schedule.run_at) throw new Error('"once" schedules need run_at.');
    return new Date(schedule.run_at);
  }
  const tz = schedule.timezone || systemTz();
  const [hh, mm] = parseTime(schedule.time);
  const p = parts(from, tz);
  const y = +p.year, m = +p.month, d = +p.day;

  if (schedule.recurrence === 'daily') {
    let candidate = localToUtc(y, m, d, hh, mm, tz);
    if (candidate.getTime() <= from.getTime()) {
      const n = addDaysYMD(y, m, d, 1);
      candidate = localToUtc(n.y, n.m, n.d, hh, mm, tz);
    }
    return candidate;
  }

  if (schedule.recurrence === 'weekly') {
    const targetDow = DOW.indexOf(String(schedule.day_of_week || '').toLowerCase());
    if (targetDow === -1) throw new Error(`Invalid day_of_week "${schedule.day_of_week}".`);
    const wallDow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    let delta = (targetDow - wallDow + 7) % 7;
    let n = addDaysYMD(y, m, d, delta);
    let candidate = localToUtc(n.y, n.m, n.d, hh, mm, tz);
    if (candidate.getTime() <= from.getTime()) {
      n = addDaysYMD(y, m, d, delta + 7);
      candidate = localToUtc(n.y, n.m, n.d, hh, mm, tz);
    }
    return candidate;
  }

  if (schedule.recurrence === 'monthly') {
    const dom = +schedule.day_of_month;
    if (!(dom >= 1 && dom <= 31)) throw new Error(`Invalid day_of_month "${schedule.day_of_month}".`);
    let targetDay = Math.min(dom, daysInMonth(y, m));
    let candidate = localToUtc(y, m, targetDay, hh, mm, tz);
    if (candidate.getTime() <= from.getTime()) {
      let ny = y, nm = m + 1;
      if (nm > 12) { nm = 1; ny += 1; }
      targetDay = Math.min(dom, daysInMonth(ny, nm));
      candidate = localToUtc(ny, nm, targetDay, hh, mm, tz);
    }
    return candidate;
  }

  throw new Error(`Unknown recurrence "${schedule.recurrence}".`);
}

module.exports = { computeNextRun, systemTz, DOW, localToUtc, addDaysYMD, daysInMonth };
