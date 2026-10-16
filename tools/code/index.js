'use strict';
                                                   
const fs = require('node:fs/promises');
const path = require('node:path');
const { LEVEL } = require('../../permissions/levels');
const { resolveInWorkspace, relPath, isGitInternal } = require('../filesystem/pathguard');

                                                                                         
                                                                                        
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const samePath = (a, b) => (process.platform === 'win32' || process.platform === 'darwin') ? a.toLowerCase() === b.toLowerCase() : a === b;

const PRESETS = Object.freeze({
  light: {
    compact: true,
    simplify: true,
    stringArray: true,
    stringArrayThreshold: 0.45,
    stringArrayEncoding: [],
    rotateStringArray: true,
    shuffleStringArray: true,
    splitStrings: false,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    numbersToExpressions: false,
    renameGlobals: false,
    selfDefending: false,
  },
  balanced: {
    compact: true,
    simplify: true,
    stringArray: true,
    stringArrayThreshold: 0.75,
    stringArrayEncoding: ['base64'],
    rotateStringArray: true,
    shuffleStringArray: true,
    splitStrings: true,
    splitStringsChunkLength: 8,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.35,
    deadCodeInjection: false,
    numbersToExpressions: true,
    renameGlobals: false,
    selfDefending: false,
  },
  aggressive: {
    compact: true,
    simplify: true,
    stringArray: true,
    stringArrayThreshold: 1,
    stringArrayEncoding: ['base64'],
    rotateStringArray: true,
    shuffleStringArray: true,
    splitStrings: true,
    splitStringsChunkLength: 5,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.2,
    numbersToExpressions: true,
    renameGlobals: false,
    selfDefending: true,
  },
});

function getObfuscator() {
  try { return require('javascript-obfuscator'); }
  catch (e) {
    const err = new Error('javascript-obfuscator is not installed. Run npm install for this Akhtar Agent build, then retry.');
    err.cause = e;
    throw err;
  }
}

function assertJsFile(file) {
  if (!/\.(?:cjs|mjs|js)$/i.test(file)) throw new Error('code.obfuscate supports JavaScript files only (.js, .cjs, .mjs).');
}

function outputPathFor(inputAbs, outputArg, root) {
  if (outputArg) return resolveInWorkspace(root, outputArg);
  const ext = path.extname(inputAbs);
  const base = path.basename(inputAbs, ext);
  return path.join(path.dirname(inputAbs), `${base}.obfuscated${ext}`);
}

module.exports = [
  {
    group: 'code',
    name: 'code.obfuscate',
    description: 'Obfuscate one JavaScript file with javascript-obfuscator. Writes to a separate *.obfuscated.js file by default; never touches node_modules.',
    permission: LEVEL.WRITE,
    category: 'code.write',
    requiresWorkspace: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, description: 'Workspace-relative .js/.cjs/.mjs input file.' },
        output: { type: 'string', minLength: 1, description: 'Optional workspace-relative output path. Defaults beside the source as *.obfuscated.<ext>.' },
        mode: { type: 'string', enum: ['light', 'balanced', 'aggressive'], description: 'Obfuscation preset. Default: balanced.' },
      },
      required: ['path'],
    },
    async preview({ path: input, output, mode = 'balanced' }, ctx) {
      const root = ctx.workspace.root_path;
      const inputAbs = resolveInWorkspace(root, input);
      assertJsFile(inputAbs);
      const outputAbs = outputPathFor(inputAbs, output, root);
      assertJsFile(outputAbs);
      if (samePath(outputAbs, inputAbs)) throw new Error('Refusing to overwrite the source file. Choose a different output path.');
      return {
        title: 'Obfuscate JavaScript',
        summary: `${relPath(root, inputAbs)} -> ${relPath(root, outputAbs)} (${mode})`,
        path: relPath(root, outputAbs),
        warning: mode === 'aggressive' ? 'Aggressive obfuscation can reduce performance or break code that depends on source shape. Verify the generated file.' : undefined,
      };
    },
    async execute({ path: input, output, mode = 'balanced' }, ctx) {
      const root = ctx.workspace.root_path;
      const inputAbs = resolveInWorkspace(root, input);
      assertJsFile(inputAbs);
      if (inputAbs.split(path.sep).includes('node_modules')) throw new Error('Refusing to obfuscate files inside node_modules.');
      const outputAbs = outputPathFor(inputAbs, output, root);
      assertJsFile(outputAbs);
                                                                                               
      if (samePath(outputAbs, inputAbs)) throw new Error('Refusing to overwrite the source file. Choose a different output path.');
      if (outputAbs.split(path.sep).includes('node_modules')) throw new Error('Refusing to write obfuscated output inside node_modules.');
      if (isGitInternal(root, outputAbs)) throw new Error('Writing inside .git is not allowed.');
      const st = await fs.stat(inputAbs);
      if (!st.isFile()) throw new Error('Input is not a file.');
      if (st.size > MAX_INPUT_BYTES) throw new Error(`Input is too large to obfuscate safely (${st.size} bytes, max ${MAX_INPUT_BYTES}).`);

      const source = await fs.readFile(inputAbs, 'utf8');
                                                                                   
      let before = null;
      try { before = await fs.readFile(outputAbs); } catch { /* new file */ }
      ctx.checkpoints?.record(ctx, { action: 'write', path: outputAbs, before });
      const JavaScriptObfuscator = getObfuscator();
      const result = JavaScriptObfuscator.obfuscate(source, { ...PRESETS[mode] });
      const code = result.getObfuscatedCode();
      await fs.mkdir(path.dirname(outputAbs), { recursive: true });
      await fs.writeFile(outputAbs, code, 'utf8');
      const verify = await fs.stat(outputAbs);
      return {
        obfuscated: true,
        mode,
        input: relPath(root, inputAbs),
        output: relPath(root, outputAbs),
        input_bytes: Buffer.byteLength(source),
        output_bytes: verify.size,
        source_preserved: true,
      };
    },
  },
];
