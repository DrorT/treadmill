// Local verification only; never prints tokens or issues treadmill commands.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import WebSocket from 'ws';
const config=JSON.parse(readFileSync('data/config.json','utf8'));
const base=`http://127.0.0.1:${config.port}`,action=process.argv[2]??'check';
const login=await fetch(`${base}/api/login`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token:config.token})});
assert.equal(login.status,200,'Local login');
const cookie=login.headers.get('set-cookie').split(';')[0];
const headers={Cookie:cookie,Origin:base,'Content-Type':'application/json'};
async function get(path){const r=await fetch(base+path,{headers});assert.equal(r.status,200,path);return r.json();}
try{
 const status=await get('/api/status');
 if(action==='disconnect'){
  assert.equal(status.telemetry?.state,'Paused','Read-only profiling requires Paused');
  assert.equal(status.capabilities.fresh,true,'Read-only profiling requires fresh telemetry');
  assert.equal(status.watchdog,null,'Do not interrupt an active remote watchdog');
  const r=await fetch(`${base}/api/disconnect`,{method:'POST',headers,body:'{}'});assert.equal(r.status,200);
  console.log(JSON.stringify({action,state:(await r.json()).connection.state}));
 }else if(action==='connect'){
  const r=await fetch(`${base}/api/connect`,{method:'POST',headers,body:'{}'});assert.equal(r.status,200,'Reconnect');
  const s=await r.json();console.log(JSON.stringify({action,connection:s.connection.state,telemetry:s.telemetry}));
 }else if(action==='same-speed'){
  assert.equal(status.telemetry?.state,'Paused','Same-setting check requires Paused');
  assert.equal(status.capabilities.fresh,true,'Same-setting check requires fresh telemetry');
  const speedKph=status.telemetry.speedKph,started=Date.now();
  const r=await fetch(`${base}/api/commands`,{method:'POST',headers,body:JSON.stringify({requestId:randomUUID(),action:{type:'setSpeed',speedKph}})});
  assert.equal(r.status,202);const {commandId}=await r.json();
  let command;
  for(let i=0;i<75;i++){
   await new Promise(resolve=>setTimeout(resolve,200));command=await get(`/api/commands/${commandId}`);
   if(['confirmed','rejected','failed','unknown'].includes(command.state))break;
  }
  assert.equal(command.state,'confirmed','Reapplying the existing paused speed');
  const result=JSON.parse(command.resultJson),after=await get('/api/status');
  assert.equal(after.telemetry.state,'Paused');assert.equal(after.telemetry.speedKph,speedKph);
  assert.equal(after.telemetry.inclinePercent,status.telemetry.inclinePercent);
  assert.equal(after.telemetry.elapsedSeconds,status.telemetry.elapsedSeconds);
  assert.equal(after.telemetry.distanceKm,status.telemetry.distanceKm);
  console.log(JSON.stringify({sameValue:true,speedKph,state:command.state,totalMs:Date.now()-started,result}));
 }else if(action==='check'){
  assert.equal((await fetch(base+'/')).status,200,'Static dashboard');
  assert.equal((await fetch(base+'/api/status')).status,401,'Anonymous API denied');
  assert.equal((await fetch(base+'/api/connect',{method:'POST',headers:{...headers,Origin:'http://unrelated.invalid'},body:'{}'})).status,403,'Cross-origin mutation denied before connecting');
  const publicConfig=await get('/api/config');assert.equal('token' in publicConfig,false,'Secret excluded');
  const history=await get('/api/workouts?limit=2');assert.ok(Array.isArray(history.items),'History list');
  const wsStatus=await new Promise((resolve,reject)=>{
   const ws=new WebSocket(`ws://127.0.0.1:${config.port}/ws`,{headers:{Cookie:cookie,Origin:base}});
   const timer=setTimeout(()=>{ws.terminate();reject(Error('WebSocket deadline'));},3000);
   ws.once('error',e=>{clearTimeout(timer);reject(e);});
   ws.once('message',data=>{clearTimeout(timer);const msg=JSON.parse(data.toString());ws.close();resolve(msg.type);});
  });assert.equal(wsStatus,'status');
  console.log(JSON.stringify({checks:7,passed:true,connection:status.connection.state,telemetry:status.telemetry,historyReturned:history.items.length}));
 }else throw Error('Use check, disconnect, connect or same-speed');
}finally{
 await fetch(`${base}/api/logout`,{method:'POST',headers,body:'{}'});
}
