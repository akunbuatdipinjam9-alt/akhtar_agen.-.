'use strict';
   
                                                                           
                                                                         
                                                                             
                                                                          
                                                                  
                                                                              
   
const NOTE = `Verification discipline (do not skip):
- A tool call that didn't throw is not proof of success. Read results carefully.
- After editing code: run the project's build/tests (terminal.run) before saying you're done, when a build/test exists.
- After a terminal command: check exit_code and the output, don't assume success from "no error".
- If you cannot verify something, say so plainly instead of reporting completion.
- Mark todo items "failed" (with a reason) rather than "completed" when verification fails.`;

function summarizeToolResult(name, result) {
  if (name === 'terminal.run') return `exit_code=${result.exit_code} timed_out=${!!result.timed_out}`;
  if (name?.startsWith('file.write') || name === 'file.create' || name === 'file.edit') return `verified=${!!result?.verified}`;
  return undefined;
}

module.exports = { VERIFICATION_NOTE: NOTE, summarizeToolResult };
