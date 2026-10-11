import test from 'node:test';
import assert from 'node:assert/strict';
import {createReader} from '../server/jdwp/telemetry.mjs';

function fakeJdwp(){
 const classes=new Map(),fieldIds=new Map();let nextType=1,nextField=1;
 const className=t=>[...classes].find(([,id])=>id===t)?.[0];
 const j={sizes:{type:4,field:4,object:4},scans:0,runner:'runner-1',invalid:false,
  id(v){const b=Buffer.alloc(4);b.writeUInt32BE(Number(v));return b;},
  reader:r=>r,
  async command(set,cmd,p){
   if(set===1&&cmd===2){const sig=p.toString('utf8',4);if(!classes.has(sig))classes.set(sig,String(nextType++));return{int:()=>1,byte:()=>1,id:()=>classes.get(sig)};}
   if(set===2&&cmd===6){const count=p.readUInt32BE(4);let i=0;return{int:()=>count,value:()=>({value:fieldIds.get(String(p.readUInt32BE(8+4*i++)))})};}
   throw Error('Unexpected metadata command');
  },
  async fields(t){
   const name=className(t);let fields;
   if(name.includes('AbsRunnerService'))fields=[['mRunner']];
   else if(name.includes('BaseRunner'))fields=['mSpeed','mIncline','mDuration','mDistance','mCalorie','mLaps','mState','mStatus'].map(x=>[x]);
   else if(name.endsWith('/State;'))fields=[['Paused','Lcom/bodi/treadmill/core/State;',8,'paused'],['Running','Lcom/bodi/treadmill/core/State;',8,'running']];
   else if(name.endsWith('/Unit;'))fields=[['METRIC','Lcom/bodi/treadmill/core/Unit;',8,'metric']];
   else if(name.includes('SerialComm'))fields=[['mUnit']];
   else if(name.includes('CommandHandler'))fields=[['mPulse']];
   else throw Error('Unexpected class');
   return fields.map(([name,signature='I',modifiers=0,value])=>{const id=String(nextField++);fieldIds.set(id,value);return{id,name,signature,modifiers};});
  },
  async instances(t){j.scans++;const name=className(t);return[{value:name.includes('RunnerService')?'service':name.includes('SerialComm')?'serial':'handler'}];},
  async values(o,fields){
   if(j.invalid)throw Error('JDWP error 20');
   const values=o==='service'?{mRunner:j.runner}:o==='serial'?{mUnit:'metric'}:o==='handler'?{mPulse:80}:{mSpeed:12,mIncline:1,mDuration:j.runner==='runner-1'?60000:0,mDistance:.02,mCalorie:1,mLaps:0,mState:'paused',mStatus:7};
   return Object.fromEntries(fields.map(f=>[f.name,{value:values[f.name]}]));
  }
 };return j;
}

test('telemetry does not scan heap after initialization',async()=>{
 const j=fakeJdwp(),read=await createReader(j),initialScans=j.scans;
 assert.equal(initialScans,3);assert.equal(read.serviceObject,'service');
 for(let i=0;i<10;i++){const s=await read();assert.equal(s.speedKph,1.2);assert.equal(s.pulseBpm,80);assert.equal(s.unit,'METRIC');}
 assert.equal(j.scans,initialScans);
});
test('cached service still reads a newly replaced runner',async()=>{
 const j=fakeJdwp(),read=await createReader(j);assert.equal((await read()).elapsedSeconds,60);
 j.runner='runner-2';assert.equal((await read()).elapsedSeconds,0);assert.equal(j.scans,3);
});
test('expired references fail for reattach without a heap scan at a breakpoint',async()=>{
 const j=fakeJdwp(),read=await createReader(j);j.invalid=true;
 await assert.rejects(read(),/object expired; reconnect required/);assert.equal(j.scans,3);
});
