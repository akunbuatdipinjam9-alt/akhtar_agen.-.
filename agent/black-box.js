'use strict';
                                                                       
function parseData(v) { try { return typeof v === 'string' ? JSON.parse(v) : (v || {}); } catch { return {}; } }
function diagnoseTask(tasks, taskId) {
  const task = tasks.get(taskId); if (!task) throw new Error('Task not found');
  const timeline = tasks.timeline(taskId);
  const errors = timeline.filter(x => x.type === 'tool_error' || x.status === 'error' || /error|failed/i.test(x.type || ''));
  const permission = timeline.filter(x => /permission/i.test(x.type || x.name || x.message || ''));
  const compression = timeline.filter(x => x.type === 'context_compressed');
  const vision = timeline.filter(x => /vision/i.test(x.type || x.name || x.message || ''));
  const last = timeline[timeline.length - 1];
  let cause = 'No obvious failure was recorded.';
  if (task.error) cause = task.error;
  else if (errors.length) cause = errors[errors.length - 1].message || errors[errors.length - 1].result || `${errors[errors.length - 1].name || 'Tool'} failed`;
  else if (task.status === 'stopped') cause = 'The run was stopped before completion.';
  else if (task.status === 'timeout') cause = 'The run reached its time limit.';
  return {
    task: { id: task.id, title: task.title, status: task.status, error: task.error },
    summary: cause,
    counts: { events: timeline.length, errors: errors.length, permissionSignals: permission.length, contextCompressions: compression.length, visionSignals: vision.length },
    lastStep: last ? { kind: last.kind, type: last.type, name: last.name, message: last.message, status: last.status, data: parseData(last.data) } : null,
    evidence: errors.slice(-5).map(x => ({ type: x.type || x.kind, name: x.name, message: x.message, status: x.status, created_at: x.created_at })),
    suggestions: errors.length ? ['Inspect the last failing tool call and its arguments.', 'Retry from a fork after correcting the failing assumption.', 'Use Take Over if the page or UI state needs human guidance.'] : ['Review the final timeline steps.', 'Fork the run to try a different approach without losing the original history.'],
  };
}
module.exports = { diagnoseTask };
