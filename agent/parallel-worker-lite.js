'use strict';
   
                       
  
                                                                               
                                                                                   
                                                                                 
                                                            
   
const os = require('os');

const ROLES = new Set(['researcher', 'analyst', 'coder', 'tester', 'reviewer', 'critic']);

function clampInt(n, lo, hi, fallback) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : fallback;
}

function sanitizeJobs(input) {
  if (!Array.isArray(input)) throw new Error('jobs must be an array.');
  if (input.length < 2) throw new Error('Parallel Worker Lite needs at least 2 independent jobs.');
  if (input.length > 3) throw new Error('Parallel Worker Lite supports at most 3 workers.');
  return input.map((job, index) => {
    const task = String(job?.task || '').trim();
    if (!task) throw new Error(`Worker ${index + 1} is missing task.`);
    const role = ROLES.has(job?.role) ? job.role : 'analyst';
    return {
      id: String(job?.id || `worker-${index + 1}`).slice(0, 60),
      role,
      task: task.slice(0, 12000),
      context: String(job?.context || '').slice(0, 24000),
    };
  });
}

function resourceSnapshot() {
  const total = Math.max(1, os.totalmem());
  const free = Math.max(0, os.freemem());
  const cpus = Math.max(1, os.cpus()?.length || 1);
  const load1 = Number(os.loadavg?.()[0] || 0);
  return {
    totalMemory: total,
    freeMemory: free,
    memoryPressure: Math.max(0, Math.min(1, 1 - (free / total))),
    cpuCount: cpus,
    load1,
    loadRatio: Math.max(0, load1 / cpus),
  };
}

function chooseConcurrency({ requested = 3, configured = 2, enabled = true, snapshot = resourceSnapshot() } = {}) {
  const desired = Math.min(clampInt(requested, 1, 3, 3), clampInt(configured, 1, 3, 2));
  if (!enabled) return { concurrency: 1, fallback: true, reason: 'parallel_workers_disabled', snapshot };
  if (snapshot.memoryPressure >= 0.88) return { concurrency: 1, fallback: desired > 1, reason: 'high_memory_pressure', snapshot };
  if (snapshot.loadRatio >= 1.25) return { concurrency: 1, fallback: desired > 1, reason: 'high_cpu_load', snapshot };
  if (snapshot.memoryPressure >= 0.76 || snapshot.loadRatio >= 0.85) {
    const c = Math.min(2, desired);
    return { concurrency: c, fallback: c < desired, reason: c < desired ? 'resource_pressure' : 'normal', snapshot };
  }
  return { concurrency: desired, fallback: false, reason: 'normal', snapshot };
}

function structuredWorkerSystem(role = 'analyst') {
  return [
    'You are a bounded internal worker in Akhtar Agent Parallel Worker Lite.',
    `Worker role: ${String(role).toUpperCase()}.`,
    'You have NO tools and NO permission to perform side effects. Do not claim you edited files, ran tests, browsed, clicked, or executed commands.',
    'Solve only the assigned subtask. Be independent, concise, and explicit about uncertainty.',
    'If code is requested, draft code/patch ideas only; the primary agent will inspect and apply them.',
    'Return exactly these sections:',
    'SUMMARY: <short result>',
    'FINDINGS:',
    '- <finding>',
    'RISKS_OR_UNCERTAINTIES:',
    '- <risk or none>',
    'RECOMMENDED_NEXT_ACTION:',
    '- <action the primary agent should verify/do>',
  ].join('\n');
}

async function runWorkerPool(jobs, { concurrency = 2, run, onStart, onFinish } = {}) {
  if (typeof run !== 'function') throw new Error('runWorkerPool requires run(job, index).');
  const limit = clampInt(concurrency, 1, 3, 2);
  const results = new Array(jobs.length);
  let next = 0;

  async function lane() {
    while (true) {
      const index = next++;
      if (index >= jobs.length) return;
      const job = jobs[index];
      onStart?.(job, index);
      try {
        const value = await run(job, index);
        results[index] = { id: job.id, role: job.role, ok: true, ...value };
        onFinish?.(job, index, results[index]);
      } catch (error) {
        results[index] = { id: job.id, role: job.role, ok: false, error: String(error?.message || error) };
        onFinish?.(job, index, results[index]);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, () => lane()));
  return results;
}

module.exports = {
  ROLES,
  sanitizeJobs,
  resourceSnapshot,
  chooseConcurrency,
  structuredWorkerSystem,
  runWorkerPool,
};
