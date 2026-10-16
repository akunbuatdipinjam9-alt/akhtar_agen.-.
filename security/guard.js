'use strict';
   
                                                       
  
                                                                                    
                                                                                   
  
                
                                          
                                           
                                                           
                                                                                 
                                                                
  
                                                                                   
   

const path = require('path');

const POLICY_VERSION = 'guard-v2.0.0';
const MAX_NESTED_SCAN = 4;
const MAX_TEXT_SCAN = 512 * 1024;

const norm = (v) => String(v ?? '').toLowerCase().replace(/\\/g, '/').trim();
const base = (v) => path.basename(String(v ?? '')).toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/i, '');
const uniq = (xs) => [...new Set(xs.filter(Boolean))];
const safeSlice = (s, n = MAX_TEXT_SCAN) => String(s ?? '').slice(0, n);

                                                                                 
                                                                                
const HARD_BLOCK_PROGRAMS = new Map([
  ['diskpart', 'disk/partition administration'],
  ['fdisk', 'disk/partition administration'],
  ['parted', 'disk/partition administration'],
  ['format', 'filesystem formatting'],
  ['mkfs', 'filesystem formatting'],
  ['wipefs', 'filesystem signature destruction'],
  ['dd', 'raw disk writing'],
  ['bcdedit', 'boot configuration modification'],
  ['vssadmin', 'shadow-copy administration'],
  ['sudo', 'privilege escalation'],
  ['su', 'privilege escalation'],
  ['doas', 'privilege escalation'],
  ['runas', 'privilege escalation'],
  ['pkexec', 'privilege escalation'],
  ['useradd', 'account administration'],
  ['userdel', 'account administration'],
  ['usermod', 'account administration'],
  ['passwd', 'credential/account modification'],
  ['schtasks', 'system persistence/scheduled-task administration'],
  ['crontab', 'system persistence/scheduled-task administration'],
  ['systemctl', 'system service administration'],
  ['launchctl', 'system service administration'],
  ['regsvr32', 'system component registration'],
  ['rundll32', 'arbitrary system DLL execution'],
  ['mshta', 'script/HTML application execution'],
  ['wscript', 'Windows script execution'],
  ['cscript', 'Windows script execution'],
]);

const ROOT_TARGET = /^(?:\/|\/\*|~|~\/|[a-z]:\/?|[a-z]:\/\*|%userprofile%|\$home)$/i;
const SYSTEM_TARGET = /^(?:\/(?:bin|boot|etc|lib|lib64|sbin|usr|var|sys|proc|root)(?:\/|$)|[a-z]:\/(?:windows|program files|programdata)(?:\/|$))/i;

const SECURITY_SERVICE_RE = /(?:windefend|securityhealthservice|sense|mpssvc|wscsvc|defender|antimalware|firewall)/i;
const PERSISTENCE_REG_RE = /(?:\\|\/)(?:run|runonce|winlogon|image file execution options|services)(?:\\|\/|$)/i;

function decodePowerShellEncoded(value) {
  const raw = String(value || '').replace(/^['"]|['"]$/g, '');
  if (!raw || !/^[A-Za-z0-9+/=]+$/.test(raw) || raw.length > 200000) return '';
  try {
    const b = Buffer.from(raw, 'base64');
    if (!b.length) return '';
                                                                                    
                                            
    const utf16 = b.toString('utf16le').replace(/\0/g, '');
    const utf8 = b.toString('utf8').replace(/\0/g, '');
    return /[\x20-\x7e]{4}/.test(utf16) ? utf16 : utf8;
  } catch { return ''; }
}

function simpleTokenize(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  const out = [];
  let cur = '', quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < s.length) cur += s[++i];
      else cur += c;
    } else if (c === '"' || c === "'") quote = c;
    else if (/\s/.test(c)) { if (cur) { out.push(cur); cur = ''; } }
    else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function scanEmbeddedCommand(text, depth, seen) {
  if (depth > MAX_NESTED_SCAN) return ['nested command depth exceeded'];
  const normalized = safeSlice(text, 64000).trim();
  if (!normalized || seen.has(normalized)) return [];
  seen.add(normalized);
  return scanCommand(simpleTokenize(normalized), { depth, seen });
}

function scanCommand(argv, internal = {}) {
  if (!Array.isArray(argv) || argv.length === 0) return [];
  const depth = internal.depth || 0;
  const seen = internal.seen || new Set();
  const hazards = [];
  const prog = base(argv[0]);
  const args = argv.slice(1).map((v) => String(v ?? ''));
  const low = args.map(norm);
  const joined = low.join(' ');

  if (HARD_BLOCK_PROGRAMS.has(prog)) {
    hazards.push(`blocked program: ${prog} (${HARD_BLOCK_PROGRAMS.get(prog)})`);
  }

                                                                                   
                                         
  if (prog === 'reg') {
    const verb = low.find((a) => ['add', 'delete', 'import', 'restore', 'load', 'unload'].includes(a));
    if (verb) {
      hazards.push('registry modification');
      if (PERSISTENCE_REG_RE.test(joined)) hazards.push('registry persistence/security modification');
    }
  }

  if (['netsh', 'iptables', 'nft', 'ufw'].includes(prog)) hazards.push('firewall/network security modification');

  if (prog === 'sc' && low.some((a) => ['stop', 'delete', 'config', 'create', 'failure'].includes(a))) {
    hazards.push(SECURITY_SERVICE_RE.test(joined) ? 'security-service tampering' : 'system service modification');
  }

  if (['rm', 'del', 'erase', 'rmdir', 'rd'].includes(prog)) {
    const destructive = low.some((a) => /^-[a-z]*[rf][a-z]*$/i.test(a) || ['/s', '/q', '--recursive', '--force'].includes(a));
    const targets = low.filter((a) => !a.startsWith('-') && !/^\/[sq]$/i.test(a));
    if (destructive && targets.some((a) => ROOT_TARGET.test(a) || SYSTEM_TARGET.test(a))) {
      hazards.push('destructive delete of root/home/system location');
    }
  }

                                                                                
  if (prog === 'powershell' || prog === 'pwsh') {
    if (/set-mppreference/.test(joined) && /disablerealtimemonitoring/.test(joined)) hazards.push('attempt to disable antivirus protection');
    if (/add-mppreference/.test(joined) && /exclusion(path|process|extension)/.test(joined)) hazards.push('attempt to add antivirus exclusion');
    if (/set-netfirewallprofile/.test(joined) && /enabled\s+(?:false|0)/.test(joined)) hazards.push('attempt to disable firewall protection');
    if (/stop-service|set-service/.test(joined) && SECURITY_SERVICE_RE.test(joined)) hazards.push('security-service tampering');

    for (let i = 0; i < args.length; i++) {
      const flag = norm(args[i]);
      if (['-encodedcommand', '-enc', '-e'].includes(flag) && args[i + 1]) {
        const decoded = decodePowerShellEncoded(args[i + 1]);
        if (!decoded) hazards.push('unreadable PowerShell encoded command');
        else hazards.push(...scanCode(decoded, { path: 'guard-inline.ps1', executable: true, _depth: depth + 1, _seen: seen }));
      }
      if (['-command', '-c'].includes(flag) && args[i + 1]) {
        hazards.push(...scanCode(args.slice(i + 1).join(' '), { path: 'guard-inline.ps1', executable: true, _depth: depth + 1, _seen: seen }));
      }
    }
  }

                                                                                   
                                                                                     
  if (['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'cmd'].includes(prog)) {
    for (let i = 0; i < args.length; i++) {
      const flag = norm(args[i]);
      if ((prog === 'cmd' && ['/c', '/k'].includes(flag)) || (prog !== 'cmd' && ['-c', '-lc'].includes(flag))) {
        hazards.push(...scanEmbeddedCommand(args.slice(i + 1).join(' '), depth + 1, seen));
        break;
      }
    }
  }

                                                                         
  if (['node', 'python', 'python3', 'py', 'ruby', 'php'].includes(prog)) {
    for (let i = 0; i < args.length; i++) {
      const flag = norm(args[i]);
      if (['-e', '--eval', '-c'].includes(flag) && args[i + 1]) {
        hazards.push(...scanCode(args.slice(i + 1).join(' '), { path: `guard-inline.${prog === 'node' ? 'js' : 'txt'}`, executable: true, _depth: depth + 1, _seen: seen }));
        break;
      }
    }
  }

  if (/delete\s+shadows|shadowcopy.*delete/.test(joined)) hazards.push('shadow-copy deletion');

  return uniq(hazards);
}

const CODE_RULES = [
  { label: 'attempt to disable Windows antivirus protection', test: (s) => /set-mppreference[\s\S]{0,300}-disablerealtimemonitoring[\s\S]{0,100}(?:\$?true|1)/i.test(s) },
  { label: 'attempt to add Windows antivirus exclusion', test: (s) => /add-mppreference[\s\S]{0,300}-exclusion(?:path|process|extension)/i.test(s) },
  { label: 'attempt to disable Windows firewall', test: (s) => /set-netfirewallprofile[\s\S]{0,260}-enabled[\s\S]{0,40}(?:false|0)|netsh[\s\S]{0,100}firewall[\s\S]{0,100}(?:off|disable)/i.test(s) },
  { label: 'security-service tampering', test: (s) => /(?:stop-service|set-service|sc(?:\.exe)?\s+(?:stop|delete|config))[\s\S]{0,220}(?:windefend|securityhealthservice|sense|mpssvc|wscsvc|defender|antimalware)/i.test(s) },
  { label: 'shadow-copy deletion', test: (s) => /vssadmin(?:\.exe)?\s+delete\s+shadows|wmic[\s\S]{0,120}shadowcopy[\s\S]{0,80}delete/i.test(s) },
  { label: 'boot configuration tampering', test: (s) => /\bbcdedit(?:\.exe)?\b[\s\S]{0,180}\/(?:set|delete|deletevalue|import)/i.test(s) },
  { label: 'raw disk/filesystem destruction', test: (s) => /\b(?:mkfs(?:\.[a-z0-9]+)?|wipefs)\b|\bdd\b[\s\S]{0,160}\bof\s*=\s*\/dev\//i.test(s) },
  { label: 'destructive root/system deletion', test: (s) => /\brm\s+(?:-[a-z]*[rf][a-z]*\s+)+(?:\/|~)(?:\s|$)|\b(?:rmdir|rd)\s+\/s\s+\/q\s+(?:[a-z]:\\|%userprofile%)/i.test(s) },
  { label: 'Windows registry persistence/modification', test: (s) => /\breg(?:\.exe)?\s+(?:add|delete|import|restore|load)\s+["']?(?:hk(?:lm|cu)|hkey_)/i.test(s) },
  { label: 'privilege-escalation command embedded in generated code', test: (s) => /(?:^|[;&|\n\r]\s*)\b(?:sudo|pkexec|runas|doas)(?:\.exe)?\s+/im.test(s) },
  { label: 'scheduled-task persistence', test: (s) => /\bschtasks(?:\.exe)?\b[\s\S]{0,120}\/(?:create|change|delete)\b|\bcrontab\b\s+(?:-[er]|[^\n\r]+)/i.test(s) },
  { label: 'system service persistence/modification', test: (s) => /\b(?:systemctl|launchctl)\b[\s\S]{0,160}\b(?:enable|disable|mask|unmask|start|stop|load|unload)\b/i.test(s) },
];

const DOC_FILE = /\.(?:md|markdown|mdx|txt|rst|adoc|asciidoc)$/i;

function scanCode(text, options = {}) {
  const src = safeSlice(text);
  const filePath = options.path;
  if (!src.trim()) return [];
  if (!options.executable && filePath && DOC_FILE.test(String(filePath))) return [];
  const hazards = [];
  for (const rule of CODE_RULES) {
                                                                 
    try { if (rule.test(src)) hazards.push(rule.label); }
    catch { hazards.push(`guard rule failure: ${rule.label}`); }
  }

                                                                                    
                                                                                       
  const seen = options._seen || new Set();
  const depth = options._depth || 0;
  if (depth <= MAX_NESTED_SCAN) {
    const commandLineRe = /^\s*(?:sudo|doas|pkexec|runas|diskpart|fdisk|parted|format|mkfs|wipefs|dd|bcdedit|vssadmin|schtasks|crontab|systemctl|launchctl|reg(?:\.exe)?|netsh|sc(?:\.exe)?|powershell|pwsh)\b[^\n\r]*/gim;
    for (const m of src.matchAll(commandLineRe)) {
      hazards.push(...scanEmbeddedCommand(m[0], depth + 1, seen));
    }
  }
  return uniq(hazards);
}

   
                                                                              
                                                              
   
function evaluateTool(toolName, args = {}) {
  const hazards = [];
  const name = String(toolName || '');
  try {
    if (['file.write', 'file.create', 'file.edit'].includes(name)) {
      const text = [args?.content, args?.new_str].filter((v) => v != null).join('\n');
      hazards.push(...scanCode(text, { path: args?.path }));
    } else if (name === 'terminal.run' && args?.command) {
      hazards.push(...scanCommand(simpleTokenize(String(args.command))));
    } else if (name === 'mcp.call') {
                                                                                    
                                                                                      
      const payload = args?.arguments ?? args?.args ?? args?.input ?? {};
      const stack = [payload];
      let inspected = 0;
      while (stack.length && inspected++ < 200) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object') continue;
        for (const [k, v] of Object.entries(cur)) {
          if (v && typeof v === 'object') stack.push(v);
          if (typeof v !== 'string') continue;
          if (/^(?:command|cmd|shell|script|powershell|code)$/i.test(k)) {
            hazards.push(...scanCommand(simpleTokenize(v)));
            hazards.push(...scanCode(v, { path: 'mcp-inline.txt', executable: true }));
          }
        }
      }
    }
  } catch (e) {
    hazards.push(`guard inspection failure: ${e?.message || 'unknown error'}`);
  }
  return { policy: POLICY_VERSION, decision: hazards.length ? 'BLOCK' : 'ALLOW', hazards: uniq(hazards) };
}

const api = { POLICY_VERSION, scanCode, scanCommand, evaluateTool };
Object.freeze(api);
module.exports = api;
