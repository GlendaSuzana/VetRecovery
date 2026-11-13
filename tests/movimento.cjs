const assert = require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
(async()=>{
 const {MotionSession,motionValue}=await import(pathToFileURL(path.resolve(__dirname,'../movimento.js')));
 assert.equal(motionValue(false),0);assert.equal(motionValue('1'),1);
 for(const bad of [null,undefined,'',2,'true',{},NaN])assert.equal(motionValue(bad),null);
 const session=new MotionSession();
 session.add(0,0,'esp32');session.add(1,2000,'esp32');session.add(1,4000,'esp32');session.add(1,6000,'esp32');
 assert.equal(session.events,1);assert.equal(session.currentMs,4000);
 assert.equal(session.add(1,6000,'esp32').duplicate,true);
 assert.equal(session.events,1);
 session.add(0,8000,'esp32');
 assert.deepEqual(session.lastEvent,{durationMs:6000,partial:false});
 assert.equal(session.frequency,7.5);
 session.add(1,10000,'esp32');assert.equal(session.events,2);
 session.add(1,30000,'esp32');assert.equal(session.events,2);assert.equal(session.currentMs,0);
 assert.equal(session.partial,true);session.add(0,32000,'esp32');assert.deepEqual(session.lastEvent,{durationMs:2000,partial:true});
 session.add(1,100,'esp32');assert.equal(session.events,2);assert.equal(session.partial,true); // reinício
 session.add(null,200,'esp32');assert.equal(session.previous,null);
 const late=new MotionSession();late.add(1,1000,'esp32');late.add(1,3000,'esp32');late.add(0,5000,'esp32');
 assert.equal(late.events,0);assert.deepEqual(late.lastEvent,{durationMs:4000,partial:true});
 late.interrupt();late.add(1,9000,'esp32');assert.equal(late.events,0);
 const switchClock=new MotionSession();switchClock.add(0,0,'browser');switchClock.add(1,2000,'esp32');assert.equal(switchClock.events,0);
 console.log('PASS: binário, transições, duração, frequência, amostras repetidas, leitura inicial ativa, reinício, lacunas e dados inválidos.');
})().catch(e=>{console.error(e);process.exitCode=1});
