import {fileURLToPath as investigationFilePath} from 'node:url';
process.chdir(investigationFilePath(new URL('../',import.meta.url)));
import {JDWP,u32,string} from './jdwp-read.mjs';
import {appendFileSync,writeFileSync} from 'node:fs';

const durationSeconds=Number(process.argv[2]??180);
if(!Number.isFinite(durationSeconds)||durationSeconds<1||durationSeconds>900)throw Error('Duration must be 1 to 900 seconds');
const output=process.argv[3]??'telemetry/live-telemetry.jsonl';
const j=await new JDWP().connect();
try{
 async function type(signature){
  const r=j.reader(await j.command(1,2,string(signature)));
  if(!r.int())throw Error('Class not loaded: '+signature);
  r.byte();return r.id(j.sizes.type).toString();
 }
 const serviceType=await type('Lcom/bodi/treadmill/service/RunnerService;');
 const service=(await j.instances(serviceType,1))[0]?.value;
 if(!service)throw Error('No active treadmill service');
 const baseService=await type('Lcom/bodi/treadmill/service/AbsRunnerService;');
 const runnerField=(await j.fields(baseService)).find(f=>f.name==='mRunner');
 const runner=(await j.values(service,[runnerField])).mRunner.value;
 const runnerType=await type('Lcom/bodi/treadmill/core/impl/BaseRunner;');
 const fields=(await j.fields(runnerType)).filter(f=>['mSpeed','mIncline','mDistance','mDuration','mCalorie','mLaps','mState','mStatus'].includes(f.name));
 const stateType=await type('Lcom/bodi/treadmill/core/State;');
 const stateFields=await j.fields(stateType);
 const constants=stateFields.filter(f=>(f.modifiers&8)&&f.signature==='Lcom/bodi/treadmill/core/State;');
 const r=j.reader(await j.command(2,6,Buffer.concat([j.id(stateType,j.sizes.type),u32(constants.length),...constants.map(f=>j.id(f.id,j.sizes.field))])));
 const stateNames=new Map();const count=r.int();for(let i=0;i<count;i++)stateNames.set(r.value().value,constants[i].name);
 const serialType=await type('Lcom/bodi/treadmill/core/impl/SerialComm;');
 const serial=(await j.instances(serialType,1))[0]?.value;
 let unit=null;
 if(serial){
  const unitField=(await j.fields(serialType)).find(f=>f.name==='mUnit');
  const unitObject=(await j.values(serial,[unitField])).mUnit.value;
  const unitType=await type('Lcom/bodi/treadmill/core/Unit;');
  const unitConstants=(await j.fields(unitType)).filter(f=>(f.modifiers&8)&&f.signature==='Lcom/bodi/treadmill/core/Unit;');
  const ur=j.reader(await j.command(2,6,Buffer.concat([j.id(unitType,j.sizes.type),u32(unitConstants.length),...unitConstants.map(f=>j.id(f.id,j.sizes.field))])));
  const n=ur.int();for(let i=0;i<n;i++)if(ur.value().value===unitObject)unit=unitConstants[i].name;
 }
 const handlerType=await type('Lcom/bodi/treadmill/service/CommandHandler;');
 const handler=(await j.instances(handlerType,1))[0]?.value;
 const pulseField=(await j.fields(handlerType)).find(f=>f.name==='mPulse');
 const started=Date.now();let samples=0;
 console.log(JSON.stringify({event:'ready',source:'live app fields via JDWP',unit,stateNames:[...stateNames.values()],output}));
 while(Date.now()-started<durationSeconds*1000){
  const requestedAt=new Date().toISOString();
  const v=await j.values(runner,fields);
  const sample={requestedAt,sampledAt:new Date().toISOString(),source:'app-internal',unit,state:stateNames.get(v.mState.value)??'unknown',speed:v.mSpeed.value/10,inclineRaw:v.mIncline.value,distance:v.mDistance.value,elapsedSeconds:v.mDuration.value/1000,calories:v.mCalorie.value,laps:v.mLaps.value,statusRaw:v.mStatus.value};
  if(handler&&pulseField)sample.pulseRaw=(await j.values(handler,[pulseField])).mPulse.value;
  appendFileSync(output,JSON.stringify(sample)+'\n');writeFileSync('telemetry/live-telemetry-latest.json',JSON.stringify(sample,null,2));
  console.log(JSON.stringify(sample));samples++;
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 console.log(JSON.stringify({event:'finished',samples,output}));
}finally{await j.close();}
