'use strict';
                                         
const LEVEL = Object.freeze({
  NONE: 'NONE',
  READ: 'READ',
  WRITE: 'WRITE',
  NETWORK: 'NETWORK',
  SENSITIVE: 'SENSITIVE',
  CRITICAL: 'CRITICAL',
  BLOCKED: 'BLOCKED',
});
module.exports = { LEVEL };
