import {u32,str} from './client.mjs';
export async function createReader(j){
 async function type(sig){const r=j.reader(await j.command(1,2,str(sig)));if(!r.int())throw Error('Required treadmill class unavailable');r.byte();return r.id(j.sizes.type);}
 async function staticValues(t,fs){const r=j.reader(await j.command(2,6,Buffer.concat([j.id(t,j.sizes.type),u32(fs.length),...fs.map(f=>j.id(f.id,j.sizes.field))])));const n=r.int(),out=new Map();for(let i=0;i<n;i++)out.set(fs[i].name,r.value().value);return out;}
 const serviceT=await type('Lcom/bodi/treadmill/service/RunnerService;'), service=(await j.instances(serviceT,1))[0]?.value;if(!service)throw Error('Treadmill app service is not active');
 const absT=await type('Lcom/bodi/treadmill/service/AbsRunnerService;'),runnerField=(await j.fields(absT)).find(f=>f.name==='mRunner');
 const runnerT=await type('Lcom/bodi/treadmill/core/impl/BaseRunner;'),stateT=await type('Lcom/bodi/treadmill/core/State;'),states=(await j.fields(stateT)).filter(f=>(f.modifiers&8)&&f.signature==='Lcom/bodi/treadmill/core/State;'),stateIds=await staticValues(stateT,states),stateNames=new Map([...stateIds].map(([k,v])=>[v,k]));
 const serialT=await type('Lcom/bodi/treadmill/core/impl/SerialComm;'),unitT=await type('Lcom/bodi/treadmill/core/Unit;'),unitFields=(await j.fields(unitT)).filter(f=>(f.modifiers&8)&&f.signature==='Lcom/bodi/treadmill/core/Unit;'),units=await staticValues(unitT,unitFields);
 const handlerT=await type('Lcom/bodi/treadmill/service/CommandHandler;');
 const fields=(await j.fields(runnerT)).filter(f=>['mSpeed','mIncline','mDuration','mDistance','mCalorie','mLaps','mState','mStatus'].includes(f.name)),unitField=(await j.fields(serialT)).find(f=>f.name==='mUnit'),pulseField=(await j.fields(handlerT)).find(f=>f.name==='mPulse');
 // ReferenceType.Instances scans the Android heap and may stop app threads.
 // Resolve stable process objects once, never inside routine polling or while
 // the main thread is suspended at a setter breakpoint. The runner itself can
 // be replaced between sessions: continue reading mRunner on every sample.
 let serviceObject=service;
 let serialObject=(await j.instances(serialT,1))[0]?.value;
 let handlerObject=(await j.instances(handlerT,1))[0]?.value;
 if(!serialObject||!handlerObject)throw Error('Treadmill telemetry objects unavailable');
 async function sample(){
  const runner=(await j.values(serviceObject,[runnerField])).mRunner.value;
  if(!runner||runner==='0')throw Error('No active workout runner');
  const v=await j.values(runner,fields);
  const unitObj=(await j.values(serialObject,[unitField])).mUnit.value;
  let unit=null;for(const [name,id] of units)if(id===unitObj)unit=name;
  const n=(await j.values(handlerObject,[pulseField])).mPulse.value;
  return{unit,state:stateNames.get(v.mState.value)??null,statusRaw:v.mStatus.value,speedKph:v.mSpeed.value/10,inclinePercent:v.mIncline.value,elapsedSeconds:v.mDuration.value/1000,distanceKm:v.mDistance.value,caloriesKcal:v.mCalorie.value,laps:v.mLaps.value,pulseBpm:n>0?n:null};
 }
 const read=async()=>{
  try{return await sample();}
  catch(error){
   // Collected/replaced objects require a clean adapter reattach. Do not heap
   // scan here: this reader also runs while a setter has suspended main.
   if(error.message==='JDWP error 20')throw Error('Treadmill telemetry object expired; reconnect required');
   throw error;
  }
 };
 Object.defineProperty(read,'serviceObject',{get:()=>serviceObject});
 return read;
}
export async function outgoingLogin(j){
 const type=async(sig)=>{const r=j.reader(await j.command(1,2,str(sig)));if(!r.int())throw Error('Serial buffer inspection class unavailable');r.byte();return r.id(j.sizes.type);};
 const field=async(o,t,n)=>{const f=(await j.fields(t)).find(x=>x.name===n);if(!f)throw Error('Serial buffer field unavailable');return(await j.values(o,[f]))[n].value;};
 const serialT=await type('Lcom/bodi/treadmill/core/impl/SerialComm;'),serial=(await j.instances(serialT,1))[0]?.value;if(!serial)throw Error('Serial connection is not active');const task=await field(serial,serialT,'mValueTask'),taskT=await type('Lcom/bodi/treadmill/core/impl/SerialComm$ValueTask;'),protocol=await field(task,taskT,'valueProtocol'),protocolT=await type('Lcom/bodi/treadmill/core/impl/BaseProtocol;'),buffer=await field(protocol,protocolT,'buffer'),byteBufferT=await type('Ljava/nio/ByteBuffer;'),array=await field(buffer,byteBufferT,'hb'),length=j.reader(await j.command(13,1,j.id(array,j.sizes.object))).int();if(length<16)throw Error('Outgoing UART buffer is incomplete');const r=j.reader(await j.command(13,2,Buffer.concat([j.id(array,j.sizes.object),u32(0),u32(16)]))),tag=r.byte(),n=r.int();if(tag!==66||n<16)throw Error('Unexpected outgoing UART buffer');const b=r.b.subarray(r.p,r.p+16),sum=b.subarray(1,14).reduce((a,x)=>(a+x)&255,0);if(b[0]!==0xfd||b[1]!==1||b[15]!==0xfe||b[12]!==1||b[13]!==0||b[14]!==sum||b.subarray(2,12).some(x=>x!==0))throw Error('Unsupported or pending outgoing UART configuration; refusing control');return true;
}
