'use strict';
                                                                        
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { LEVEL } = require('../permissions/levels');
const execFileAsync = promisify(execFile);
const SUPPORTED = new Set(['win32', 'darwin']);

function platform() { return process.platform; }
function supported() { return SUPPORTED.has(platform()); }
function assertSupported() { if (!supported()) throw new Error('Native system controls are supported only on Windows and macOS.'); }
function clamp(v) { const n = Number(v); if (!Number.isFinite(n)) throw new Error('value must be a number from 0 to 100.'); return Math.max(0, Math.min(100, Math.round(n))); }
async function run(command, args, timeout=15000) { return execFileAsync(command, args, { windowsHide:true, timeout, maxBuffer:1024*1024 }); }
async function ps(script) { const { stdout } = await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script]); return stdout.trim(); }
async function osa(script, args=[]) { const { stdout } = await run('osascript',['-e',script,...args]); return stdout.trim(); }

const WIN_AUDIO = String.raw`
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioEndpointVolume { int RegisterControlChangeNotify(IntPtr p); int UnregisterControlChangeNotify(IntPtr p); int GetChannelCount(out uint c); int SetMasterVolumeLevel(float l, Guid g); int SetMasterVolumeLevelScalar(float l, Guid g); int GetMasterVolumeLevel(out float l); int GetMasterVolumeLevelScalar(out float l); int SetChannelVolumeLevel(uint c,float l,Guid g); int SetChannelVolumeLevelScalar(uint c,float l,Guid g); int GetChannelVolumeLevel(uint c,out float l); int GetChannelVolumeLevelScalar(uint c,out float l); int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, Guid g); int GetMute(out bool m); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDeviceEnumerator { int NotImpl1(); int GetDefaultAudioEndpoint(int dataFlow,int role,out IMMDevice dev); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDevice { int Activate(ref Guid iid,int clsCtx,IntPtr p,[MarshalAs(UnmanagedType.IUnknown)] out object o); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
public static class AkhtarAudio { static IAudioEndpointVolume V(){ var e=(IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDevice d; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0,1,out d)); var id=typeof(IAudioEndpointVolume).GUID; object o; Marshal.ThrowExceptionForHR(d.Activate(ref id,23,IntPtr.Zero,out o)); return (IAudioEndpointVolume)o; } public static int Get(){float v; Marshal.ThrowExceptionForHR(V().GetMasterVolumeLevelScalar(out v)); return (int)Math.Round(v*100); } public static bool Muted(){bool m; Marshal.ThrowExceptionForHR(V().GetMute(out m)); return m;} public static void Set(int n){Marshal.ThrowExceptionForHR(V().SetMasterVolumeLevelScalar(Math.Max(0,Math.Min(100,n))/100f,Guid.Empty));} public static void Mute(bool m){Marshal.ThrowExceptionForHR(V().SetMute(m,Guid.Empty));} }
'@`;

async function volumeGet() {
  assertSupported();
  if (platform()==='darwin') return { value:Number(await osa('output volume of (get volume settings)')), muted:(await osa('output muted of (get volume settings)'))==='true' };
  const out=await ps(`${WIN_AUDIO}; Write-Output (([AkhtarAudio]::Get()).ToString() + '|' + ([AkhtarAudio]::Muted()).ToString())`); const [v,m]=out.split('|'); return {value:Number(v),muted:/true/i.test(m)};
}
async function volumeSet(value) { const v=clamp(value); assertSupported(); if(platform()==='darwin') await osa(`set volume output volume ${v}`); else await ps(`${WIN_AUDIO}; [AkhtarAudio]::Set(${v})`); return volumeGet(); }
async function volumeMute(muted) { assertSupported(); if(platform()==='darwin') await osa(`set volume output muted ${muted?'true':'false'}`); else await ps(`${WIN_AUDIO}; [AkhtarAudio]::Mute($${muted?'true':'false'})`); return volumeGet(); }

async function brightnessGet() {
  assertSupported();
  if(platform()==='win32') { const out=await ps(`$b=Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1 -ExpandProperty CurrentBrightness; if($null -eq $b){throw 'No controllable display brightness interface found'}; $b`); return {value:Number(out)}; }
                                                                                                        
  const out=await osa('tell application "System Events" to return 0');
  void out;
  return { value:null, note:'macOS does not expose exact display brightness to AppleScript; use brightness.set/up/down, which operates the hardware brightness keys.' };
}
async function macBrightnessSet(value) {
                                                                                                                               
  const v=clamp(value), steps=Math.round(v/100*16);
  const script=`tell application "System Events"\nrepeat 16 times\nkey code 145\nend repeat\nrepeat ${steps} times\nkey code 144\nend repeat\nend tell`;
  await osa(script); return {value:v, approximate:true, method:'hardware-brightness-keys'};
}
async function brightnessSet(value) { const v=clamp(value); assertSupported(); if(platform()==='darwin') return macBrightnessSet(v); await ps(`$m=Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1; if($null -eq $m){throw 'No controllable display brightness interface found'}; Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{Timeout=1;Brightness=[byte]${v}} | Out-Null`); return brightnessGet(); }
async function brightnessStep(delta) { assertSupported(); if(platform()==='darwin') { const code=delta>0?144:145, count=Math.max(1,Math.round(Math.abs(delta)/6.25)); await osa(`tell application "System Events" to repeat ${count} times\nkey code ${code}\nend repeat`); return {changed:true,direction:delta>0?'up':'down',approximate:true}; } const cur=await brightnessGet(); return brightnessSet(cur.value+delta); }

const readMeta={group:'system',permission:LEVEL.READ,category:'system.read'};
const writeMeta={group:'system',permission:LEVEL.SENSITIVE,category:'system.control',lifetimePermission:true};
const empty={type:'object',properties:{}};
const valueSchema={type:'object',properties:{value:{type:'number',minimum:0,maximum:100}},required:['value']};
const changePreview=(what,args)=>({title:`Change ${what}`,summary:args?.value==null?what:`${args.value}%`,warning:`This changes the real operating-system ${what}.`});
function nativeBeforeAfter(before, after, confirmed, reason, signals=['native_readback']) {
  return { ok:true, confirmed:confirmed===true, signals, reason, checkedAt:Date.now(), before, after };
}

module.exports=[
 {name:'volume.get',...readMeta,description:'Read native system output volume and mute state on Windows or macOS.',inputSchema:empty,async execute(){return {platform:platform(),...(await volumeGet())};}},
 {name:'volume.set',...writeMeta,description:'Set native system output volume from 0 to 100 on Windows or macOS.',inputSchema:valueSchema,preview:a=>changePreview('volume',a),async execute({value}){const before=await volumeGet();const r=await volumeSet(value);const target=clamp(value);return {platform:platform(),changed:true,...r,_beforeAfter:nativeBeforeAfter(before,r,r.value===target,`Volume read-back is ${r.value}%; target was ${target}%.`)};}},
 {name:'volume.up',...writeMeta,description:'Increase native system output volume by a percentage step (default 10).',inputSchema:{type:'object',properties:{step:{type:'number',minimum:1,maximum:100}}},preview:a=>changePreview('volume',{}),async execute({step=10}){const before=await volumeGet();const after=await volumeSet(before.value+step);const target=clamp(before.value+step);return {platform:platform(),changed:true,...after,_beforeAfter:nativeBeforeAfter(before,after,after.value===target,`Volume changed from ${before.value}% to ${after.value}%.`)};}},
 {name:'volume.down',...writeMeta,description:'Decrease native system output volume by a percentage step (default 10).',inputSchema:{type:'object',properties:{step:{type:'number',minimum:1,maximum:100}}},preview:a=>changePreview('volume',{}),async execute({step=10}){const before=await volumeGet();const after=await volumeSet(before.value-step);const target=clamp(before.value-step);return {platform:platform(),changed:true,...after,_beforeAfter:nativeBeforeAfter(before,after,after.value===target,`Volume changed from ${before.value}% to ${after.value}%.`)};}},
 {name:'volume.mute',...writeMeta,description:'Mute or unmute native system audio on Windows or macOS.',inputSchema:{type:'object',properties:{muted:{type:'boolean'}},required:['muted']},preview:a=>({title:a.muted?'Mute system audio':'Unmute system audio',summary:a.muted?'mute':'unmute',warning:'This changes the real operating-system audio state.'}),async execute({muted}){const before=await volumeGet();const after=await volumeMute(muted);return {platform:platform(),changed:true,...after,_beforeAfter:nativeBeforeAfter(before,after,after.muted===muted,`Mute read-back is ${after.muted}; target was ${muted}.`)};}},
 {name:'brightness.get',...readMeta,description:'Read display brightness on Windows. On macOS returns an explanatory result because AppleScript has no stable exact-brightness read API.',inputSchema:empty,async execute(){return {platform:platform(),...(await brightnessGet())};}},
 {name:'brightness.set',...writeMeta,description:'Set display brightness 0-100 on Windows; on macOS uses hardware brightness-key steps and is approximate.',inputSchema:valueSchema,preview:a=>changePreview('display brightness',a),async execute({value}){const before=await brightnessGet();const after=await brightnessSet(value);const target=clamp(value);const confirmed=Number.isFinite(after.value)&&after.approximate!==true?after.value===target:false;return {platform:platform(),changed:true,...after,_beforeAfter:nativeBeforeAfter(before,after,confirmed,confirmed?`Brightness read-back matched ${target}%.`:'Brightness command ran, but exact hardware read-back is unavailable/approximate.',confirmed?['native_readback']:['native_command'])};}},
 {name:'brightness.up',...writeMeta,description:'Increase display brightness (default 10 percentage points; approximate hardware step on macOS).',inputSchema:{type:'object',properties:{step:{type:'number',minimum:1,maximum:100}}},preview:()=>changePreview('display brightness',{}),async execute({step=10}){const before=await brightnessGet();const after=await brightnessStep(Math.abs(step));const confirmed=Number.isFinite(before.value)&&Number.isFinite(after.value)?after.value>=before.value:false;return {platform:platform(),changed:true,...after,_beforeAfter:nativeBeforeAfter(before,after,confirmed,confirmed?'Brightness increase confirmed by read-back.':'Brightness increase sent; exact read-back is unavailable.',confirmed?['native_readback']:['native_command'])};}},
 {name:'brightness.down',...writeMeta,description:'Decrease display brightness (default 10 percentage points; approximate hardware step on macOS).',inputSchema:{type:'object',properties:{step:{type:'number',minimum:1,maximum:100}}},preview:()=>changePreview('display brightness',{}),async execute({step=10}){const before=await brightnessGet();const after=await brightnessStep(-Math.abs(step));const confirmed=Number.isFinite(before.value)&&Number.isFinite(after.value)?after.value<=before.value:false;return {platform:platform(),changed:true,...after,_beforeAfter:nativeBeforeAfter(before,after,confirmed,confirmed?'Brightness decrease confirmed by read-back.':'Brightness decrease sent; exact read-back is unavailable.',confirmed?['native_readback']:['native_command'])};}},
];
