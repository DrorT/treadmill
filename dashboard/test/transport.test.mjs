import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {JDWP,u32} from '../server/jdwp/client.mjs';
const cwd=process.cwd();mkdirSync(join(cwd,'test-results'),{recursive:true});
const fixtureDir=mkdtempSync(join(cwd,'test-results','transport-'));
process.chdir(fixtureDir);
const {AdbJdwpTransport}=await import('../server/transports/adb-jdwp.mjs');
const {db}=await import('../server/store.mjs');
const {Coordinator}=await import('../server/coordinator.mjs');
after(()=>{db.close();process.chdir(cwd);});
const value=()=>({unit:'METRIC',state:'Paused',statusRaw:7,speedKph:1.2,inclinePercent:1,elapsedSeconds:163,distanceKm:.05,caloriesKcal:2,pulseBpm:null,laps:0});

test('explicit disconnect does not reconnect on a pending poll failure',async()=>{
 const t=new AdbJdwpTransport();t.intentionalDisconnect=false;
 let rejectRead;const started=new Promise(resolve=>{
  t.reader=()=>new Promise((_,reject)=>{rejectRead=reject;resolve();});
 });
 t.jdwp={close:async()=>rejectRead(Error('JDWP disconnected'))};
 t.startPolling();await started;await t.disconnect();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(t.connection.state,'disconnected');assert.equal(t.reconnectTimer,null);assert.equal(t.timer,null);
});
test('a read completed after disconnect cannot publish a stale sample',async()=>{
 const t=new AdbJdwpTransport();t.intentionalDisconnect=false;
 let finish;t.reader=()=>new Promise(resolve=>{finish=resolve;});t.jdwp={close:async()=>{}};
 let events=0;t.on('telemetry',()=>events++);const pending=t.readTelemetry();
 await t.disconnect();finish(value());assert.equal(await pending,null);
 assert.equal(events,0);assert.equal(t.connection.state,'disconnected');
});
test('an old read cannot clear the read lock of a replacement connection',async()=>{
 const t=new AdbJdwpTransport();t.intentionalDisconnect=false;
 let oldFinish;t.reader=()=>new Promise(resolve=>{oldFinish=resolve;});t.jdwp={close:async()=>{}};
 const oldRead=t.readTelemetry();await t.disconnect();
 t.intentionalDisconnect=false;t.epoch='replacement';t.jdwp={close:async()=>{}};
 let newFinish;t.reader=()=>new Promise(resolve=>{newFinish=resolve;});const newRead=t.readTelemetry();const newLock=t.reading;
 oldFinish(value());await oldRead;assert.equal(t.reading,newLock);
 newFinish(value());await newRead;assert.equal(t.reading,false);await t.disconnect();
});
test('setting invocation uses the cached service without scanning the heap',async()=>{
 const t=new AdbJdwpTransport(),j=new JDWP();t.intentionalDisconnect=false;t.jdwp=j;
 j.sizes={type:4,object:4,method:4,field:4};let changed=false,invocations=0;
 j.instances=()=>{throw Error('Heap scan during setter');};
 t.settingMetadata=async()=>({main:'1',handler:'2',dispatch:{id:'3'},abs:'4',speed:{id:'5'},incline:{id:'6'}});
 t.reader=async()=>({...value(),speedKph:changed?1.3:1.2});t.reader.serviceObject='42';
 j.send=async(set,cmd)=>{
  if(set===15&&cmd===1){queueMicrotask(()=>j.onEvent(64,100,Buffer.concat([Buffer.from([1]),u32(1),Buffer.from([2]),u32(123),j.id('1',4)])));return u32(123);}
  if(set===9&&cmd===6){changed=true;invocations++;return Buffer.concat([Buffer.from('VL'),j.id('0',4)]);}
  return Buffer.alloc(0);
 };
 await t.readTelemetry();const receipt=await t.setSetting('setSpeed',1.3);
 assert.equal(invocations,1);assert.equal(receipt.transportReceipt.confirmed,true);assert.equal(t.sample.speedKph,1.3);
 assert.equal(t.settingBusy,false);j.close=async()=>{};await t.disconnect();
});
test('watchdog adapter converts milliseconds to bounded shell seconds',async()=>{
 const t=new AdbJdwpTransport(),calls=[];t.serial='test-device';t.adb=async args=>calls.push(args);
 await t.armStopWatchdog({operationId:'11111111-1111-4111-8111-111111111111',delayMs:8000});
 assert.equal(calls[0].at(-1),'8');
 await assert.rejects(t.armStopWatchdog({operationId:'11111111-1111-4111-8111-111111111111',delayMs:120001}),/Invalid watchdog/);
});
test('a failed readback after possible delivery is unknown, not rejected',async()=>{
 const t=new AdbJdwpTransport();
 t.setSetting=async()=>{throw Object.assign(Error('Telemetry object expired'),{deliveryUncertain:true});};
 const c=new Coordinator(t,()=>{});c.latest={...value(),sampledAt:new Date().toISOString(),machineId:'fixture'};
 const result=await c.submit('22222222-2222-4222-8222-222222222222',{type:'setSpeed',speedKph:1.3});
 while(c.running)await new Promise(resolve=>setImmediate(resolve));
 const row=db.prepare('SELECT state,resultJson FROM commands WHERE id=?').get(result.id);
 assert.equal(row.state,'unknown');assert.match(row.resultJson,/expired/);
});
