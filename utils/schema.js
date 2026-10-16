'use strict';
   
                                                                          
                                                                       
                                                                  
   
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function matchesType(expected, value) {
  const actual = typeOf(value);
  if (Array.isArray(expected)) return expected.some((t) => matchesType(t, value));
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return actual === expected;
}

function validate(schema, value, at = 'args') {
  const errors = [];
  if (!schema) return errors;
  if (schema.type && !matchesType(schema.type, value)) {
    errors.push(`${at} must be ${Array.isArray(schema.type) ? schema.type.join('|') : schema.type}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at} must be one of: ${schema.enum.join(', ')}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at} is too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at} is too long (max ${schema.maxLength})`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at} must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at} must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at} has too many items (max ${schema.maxItems})`);
    if (schema.items) value.forEach((item, i) => errors.push(...validate(schema.items, item, `${at}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required || []) {
      if (value[key] === undefined || value[key] === null) errors.push(`${at}.${key} is required`);
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (value[key] !== undefined && value[key] !== null) errors.push(...validate(sub, value[key], `${at}.${key}`));
    }
  }
  return errors;
}

function assertValid(schema, value, at) {
  const errors = validate(schema, value, at);
  if (errors.length) throw new Error('Invalid input: ' + errors.join('; '));
  return value;
}

module.exports = { validate, assertValid };
