'use strict';
const { LEVEL } = require('../../permissions/levels');
const base={group:'islamic_events',category:'notifications.islamic'};
module.exports=[
 {...base,name:'islamic_reminder.enable',description:'Enable background Islamic Hijri event notifications. Requires one explicit user approval; after approval the preference persists until disabled.',permission:LEVEL.SENSITIVE,inputSchema:{type:'object',properties:{mode:{type:'string',enum:['important','all']}}},execute:(a,ctx)=>ctx.islamicEventReminder.enable(a)},
 {...base,name:'islamic_reminder.disable',description:'Disable Islamic Hijri event notifications.',permission:LEVEL.NONE,inputSchema:{type:'object',properties:{}},execute:(_,ctx)=>ctx.islamicEventReminder.disable()},
 {...base,name:'islamic_reminder.status',description:'Show Islamic event reminder status.',permission:LEVEL.NONE,inputSchema:{type:'object',properties:{}},execute:(_,ctx)=>ctx.islamicEventReminder.status()},
 {...base,name:'islamic_reminder.check',description:'Check today (or a date) against the Hijri calendar and return any configured Islamic event. Does not treat calculated Hijri dates as an official local rukyat declaration.',permission:LEVEL.NETWORK,inputSchema:{type:'object',properties:{date:{type:'string',description:'Optional YYYY-MM-DD'}}},execute:(a,ctx)=>ctx.islamicEventReminder.check({date:a.date,force:true,signal:ctx.signal})},
];
