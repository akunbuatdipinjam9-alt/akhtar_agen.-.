'use strict';
const {buildRegistry}=require('../src/tools'); const {shortlistTools}=require('../src/agent/tool-intelligence'); const {runSoak}=require('../src/agent/soak-runner');
runSoak({iterations:Number(process.env.SOAK_ITERATIONS||1000),registry:buildRegistry(),shortlist:shortlistTools}).then(r=>{console.log(JSON.stringify(r,null,2));process.exitCode=r.ok?0:1});
