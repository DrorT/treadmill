import {fileURLToPath as investigationFilePath} from 'node:url';
process.chdir(investigationFilePath(new URL('../',import.meta.url)));
import {JDWP,u32,string} from './jdwp-read.mjs';
import {appendFileSync,writeFileSync} from 'node:fs';

// This experiment permits low speed/incline settings only while already paused.
// It never invokes start/resume/ready/go, writes fields, or touches serial I/O.
const setting=process.argv[2];
const target=Number(process.argv[3]);
if(!['speed','incline'].includes(setting))throw Error('Choose speed or incline');
if(setting==='speed'&&(!Number.isFinite(target)||target<1||target>2||!Number.isInteger(target*10)))throw Error('Paused test speed must be 1.0 to 2.0 km/h in 0.1 increments');
if(setting==='incline'&&(!Number.isInteger(target)||target<0||target>1))throw Error('Paused test incline must be 0 or 1');
const methodName=setting==='speed'?'setSpeed':'setIncline';
const argument=setting==='speed'?Math.round(target*10):target;
const j=await new JDWP().connect();
let breakpointRequest=null;
let eventThread=null;
let eventTimeout=null;
const audit={requestedAt:new Date().toISOString(),source:'direct JDWP invocation of app setting method',setting,target,samples:[]};
try{
 async function type(signature){const r=j.reader(await j.command(1,2,string(signature)));if(!r.int())throw Error('Class not loaded: '+signature);r.byte();return r.id(j.sizes.type).toString();}
 async function methods(typeId){const r=j.reader(await j.command(2,5,j.id(typeId,j.sizes.type))),n=r.int(),rows=[];for(let i=0;i<n;i++)rows.push({id:r.id(j.sizes.method).toString(),name:r.str(),signature:r.str(),flags:r.int()});return rows;}
 const serviceType=await type('Lcom/bodi/treadmill/service/RunnerService;');
 const service=(await j.instances(serviceType,1))[0]?.value;if(!service)throw Error('No active RunnerService');
 const baseService=await type('Lcom/bodi/treadmill/service/AbsRunnerService;');
 const runnerField=(await j.fields(baseService)).find(f=>f.name==='mRunner');
 const runner=(await j.values(service,[runnerField])).mRunner.value;
 const runnerType=await type('Lcom/bodi/treadmill/core/impl/BaseRunner;');
 const fields=(await j.fields(runnerType)).filter(f=>['mSpeed','mIncline','mDistance','mDuration','mState','mStatus'].includes(f.name));
 const stateType=await type('Lcom/bodi/treadmill/core/State;');
 const pausedField=(await j.fields(stateType)).find(f=>f.name==='Paused');
 const pr=j.reader(await j.command(2,6,Buffer.concat([j.id(stateType,j.sizes.type),u32(1),j.id(pausedField.id,j.sizes.field)])));pr.int();const pausedState=pr.value().value;
 const serialType=await type('Lcom/bodi/treadmill/core/impl/SerialComm;');
 const serial=(await j.instances(serialType,1))[0]?.value;
 const unitField=(await j.fields(serialType)).find(f=>f.name==='mUnit');
 const unit=(await j.values(serial,[unitField])).mUnit.value;
 const unitType=await type('Lcom/bodi/treadmill/core/Unit;');
 const metricField=(await j.fields(unitType)).find(f=>f.name==='METRIC');
 const ur=j.reader(await j.command(2,6,Buffer.concat([j.id(unitType,j.sizes.type),u32(1),j.id(metricField.id,j.sizes.field)])));ur.int();if(ur.value().value!==unit)throw Error('Metric units required');
 async function sample(){const v=await j.values(runner,fields);return {at:new Date().toISOString(),paused:v.mState.value===pausedState,statusRaw:v.mStatus.value,speedKph:v.mSpeed.value/10,incline:v.mIncline.value,distanceKm:v.mDistance.value,elapsedSeconds:v.mDuration.value/1000};}
 function requirePaused(s){if(!s.paused||s.statusRaw!==7)throw Error('Refusing setting: treadmill is not confirmed paused');}
 audit.before=await sample();requirePaused(audit.before);
 const setter=(await methods(baseService)).find(m=>m.name===methodName&&m.signature==='(I)V');if(!setter)throw Error('Reviewed '+methodName+'(I)V method unavailable');
 const tr=j.reader(await j.command(1,4)),nt=tr.int();const threads=[];for(let i=0;i<nt;i++)threads.push(tr.id(j.sizes.object).toString());
 let main=null;for(const thread of threads){const r=j.reader(await j.command(11,1,j.id(thread,j.sizes.object)));if(r.str()==='main'){main=thread;break;}}
 if(!main)throw Error('Main thread not found');
 const handlerType=await type('Landroid/os/Handler;');
 const dispatch=(await methods(handlerType)).find(m=>m.name==='dispatchMessage'&&m.signature==='(Landroid/os/Message;)V');if(!dispatch)throw Error('Safe invocation point unavailable');
 // One-shot entry breakpoint on only the main thread. The serial worker keeps running.
 // JDWP requires an event-suspended thread for method invocation.
 const location=Buffer.concat([Buffer.from([1]),j.id(handlerType,j.sizes.type),j.id(dispatch.id,j.sizes.method),Buffer.alloc(8)]);
 let resolveEvent,rejectEvent;
 const eventPromise=new Promise((resolve,reject)=>{resolveEvent=resolve;rejectEvent=reject;});
 eventTimeout=setTimeout(()=>rejectEvent(Error('No main-thread dispatch event within 30 seconds')),30000);
 j.onEvent=(set,cmd,payload)=>{
  if(set!==64||cmd!==100)return;
  const r=j.reader(payload),policy=r.byte(),n=r.int();
  if(n!==1)return rejectEvent(Error('Unexpected debugger event count'));
  const kind=r.byte(),request=r.int();
  if(kind!==2||policy!==1)return rejectEvent(Error('Unexpected debugger event'));
  const thread=r.id(j.sizes.object).toString();
  eventThread=thread;clearTimeout(eventTimeout);resolveEvent({thread,request});
 };
 // Apply the thread/location filters before the one-event count filter.
 const eventRequest=Buffer.concat([Buffer.from([2,1]),u32(3),Buffer.from([3]),j.id(main,j.sizes.object),Buffer.from([7]),location,Buffer.from([1]),u32(1)]);
 breakpointRequest=j.reader(await j.sendPacket(15,1,eventRequest)).int();
 console.log(JSON.stringify({event:'awaiting-safe-invocation',before:audit.before}));
 // The caller can run a read-only ADB activity dump to queue a main-thread
 // message if the paused app is idle. This does not require screen input.
 const hit=await eventPromise;if(hit.request!==breakpointRequest||hit.thread!==main)throw Error('Debugger event did not match request');
 const immediatelyBefore=await sample();requirePaused(immediatelyBefore);audit.immediatelyBefore=immediatelyBefore;
 // Only invoke the reviewed setting method; INVOKE_SINGLE_THREADED leaves other threads running.
 const signedValue=Buffer.alloc(4);signedValue.writeInt32BE(argument);
 const invoke=Buffer.concat([j.id(service,j.sizes.object),j.id(main,j.sizes.object),j.id(baseService,j.sizes.type),j.id(setter.id,j.sizes.method),u32(1),Buffer.from('I'),signedValue,u32(1)]);
 const reply=j.reader(await j.sendPacket(9,6,invoke));
 const returned=reply.value(),exception=reply.value();audit.invocation={method:'AbsRunnerService.'+methodName+'(I)V',argument,returned,exception};
 await j.sendPacket(11,3,j.id(main,j.sizes.object));eventThread=null;
 if(exception.value!=='0')throw Error('Setter threw an exception, object '+exception.value);
 for(let i=0;i<6;i++){
  await new Promise(resolve=>setTimeout(resolve,1000));
  const s=await sample();audit.samples.push(s);console.log(JSON.stringify(s));requirePaused(s);
  if(s.elapsedSeconds!==audit.before.elapsedSeconds||s.distanceKm!==audit.before.distanceKm)throw Error('Session counters changed during paused test');
 }
 audit.success=audit.samples.every(s=>setting==='speed'?Math.abs(s.speedKph-target)<0.001&&s.incline===audit.before.incline:s.incline===target&&s.speedKph===audit.before.speedKph);
 if(!audit.success)throw Error('Requested '+setting+' was not confirmed in every readback sample');
 console.log(JSON.stringify({event:'verified',setting,target,paused:true}));
}catch(error){audit.error=error.message;throw error;}
finally{
 if(eventTimeout)clearTimeout(eventTimeout);
 // Dispose also clears the one-shot event and resumes any debugger-suspended thread.
 if(eventThread){try{await j.sendPacket(11,3,j.id(eventThread,j.sizes.object));}catch{}}
 writeFileSync('telemetry/direct-'+setting+'-command-result.json',JSON.stringify(audit,null,2));
 appendFileSync('telemetry/direct-'+setting+'-command-audit.jsonl',JSON.stringify(audit)+'\n');
 await j.close();
}
