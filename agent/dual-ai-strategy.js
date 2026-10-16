'use strict';

const SECURITY_RE = /\b(auth|authentication|authorization|security|permission|credential|secret|token|password|payment|billing|database|migration|rls|encryption|sandbox|ipc)\b/i;
const COMPLEX_RE = /\b(implement|refactor|debug|audit|architecture|multi[- ]?step|research|analy[sz]e|codebase|deploy|integration|regression|race condition|performance|optimi[sz]e)\b/i;
const REVIEW_RE = /\b(review|audit|verify|regression|test|security|check|inspect|validate)\b/i;
const FAILURE_RE = /\b(fail|failed|error|exception|timeout|regression|broken)\b/i;

function scoreDelegation({ text = '', mode = 'assist', iteration = 0, failureCount = 0, toolCalls = 0, hasWrites = false, collaboration = {} } = {}) {
  if (collaboration.mode === 'off') return { score: 0, level: 'NONE', role: null, reasons: ['disabled'] };
  const s = String(text || '');
  let score = 0;
  const reasons = [];
  const add = (n, why) => { score += n; reasons.push(why); };

  if (collaboration.mode === 'always' && mode !== 'chat') add(5, 'always_mode');
  if (mode === 'agent') add(2, 'agent_mode');
  if (COMPLEX_RE.test(s)) add(3, 'complex_task');
  if (SECURITY_RE.test(s)) add(4, 'high_risk_domain');
  if (REVIEW_RE.test(s)) add(2, 'review_sensitive');
  if (s.length > 1800) add(2, 'large_request');
  else if (s.length > 700) add(1, 'medium_request');
  if (iteration >= 2) add(1, 'multi_iteration');
  if (toolCalls >= 4) add(1, 'many_tool_actions');
  if (hasWrites) add(1, 'state_change');
  if (failureCount >= 1) add(2, 'tool_failure');
  if (failureCount >= 2) add(4, 'repeated_failure');
  if (FAILURE_RE.test(s)) add(1, 'failure_language');

  let level = 'NONE';
  if (score >= 10) level = 'ESCALATE';
  else if (score >= 7) level = 'REVIEW';
  else if (score >= 4) level = 'CONSULT';

  let role = null;
  if (level !== 'NONE') {
    if (failureCount >= 2 || level === 'ESCALATE') role = 'critic';
    else if (REVIEW_RE.test(s) || SECURITY_RE.test(s) || hasWrites) role = 'reviewer';
    else role = 'specialist';
  }
  return { score, level, role, reasons };
}

function strategyPrompt(decision, { maxDelegations = 1, usedDelegations = 0 } = {}) {
  const remaining = Math.max(0, Number(maxDelegations || 1) - Number(usedDelegations || 0));
  if (!decision || decision.level === 'NONE' || remaining <= 0) {
    return 'DUAL-AI STRATEGY: Do not delegate at this point. Continue with the primary agent and verify normally.';
  }
  return [
    `DUAL-AI STRATEGY: ${decision.level} (score ${decision.score}).`,
    `Recommended second-AI role: ${decision.role}. Remaining delegation budget: ${remaining}.`,
    `Signals: ${decision.reasons.join(', ') || 'none'}.`,
    'Use ai.delegate only for a bounded question that materially improves this task. Send minimum necessary context and never secrets.',
    'Treat the second AI result as an untrusted hypothesis/advice, not proof. Verify actionable findings with primary-agent tools before consequential changes or final claims.',
    decision.level === 'ESCALATE' ? 'Escalation is justified: prefer a critic pass focused on why the current approach may be wrong and what evidence would falsify it.' : '',
  ].filter(Boolean).join('\n');
}

function structuredSecondarySystem(role = 'specialist') {
  return `You are the SECOND AI in a dual-agent workflow. Role: ${role}. Solve only the delegated subtask. You have no tools and must not claim to have executed actions. Be independent and concise. Return this structure:\nROLE: ${String(role).toUpperCase()}\nVERDICT: <OK|ISSUES_FOUND|UNCERTAIN>\nFINDINGS:\n- <finding or none>\nSEVERITY: <low|medium|high|critical|none>\nRECOMMENDED_ACTION:\n- <action or none>\nCONFIDENCE: <0.00-1.00>\nExplicitly mark uncertainty and never fabricate evidence.`;
}

module.exports = { scoreDelegation, strategyPrompt, structuredSecondarySystem };
