// Read-only live profiler. Disconnect the dashboard before borrowing JDWP.
import {performance} from 'node:perf_hooks';
import {JDWP,str} from '../server/jdwp/client.mjs';
import {createReader} from '../server/jdwp/telemetry.mjs';
const port=Number(process.argv[2]);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Pass a current local JDWP forwarding port');
const j=new JDWP();
try{
 await j.connect(port);
 const read=await createReader(j);
 const types=[];
 for(const signature of ['Lcom/bodi/treadmill/service/RunnerService;','Lcom/bodi/treadmill/core/impl/SerialComm;','Lcom/bodi/treadmill/service/CommandHandler;']){
  const r=j.reader(await j.command(1,2,str(signature)));if(!r.int())throw Error('Class unavailable');r.byte();types.push(r.id(j.sizes.type));
 }
 async function measure(legacy){
  const started=performance.now();
  // Reproduce the three heap scans previously performed on EVERY read.
  if(legacy)for(const type of types)await j.instances(type,1);
  const sample=await read();
  return{ms:Math.round((performance.now()-started)*10)/10,state:sample.state,elapsedSeconds:sample.elapsedSeconds,speedKph:sample.speedKph,inclinePercent:sample.inclinePercent};
 }
 const previousPolling=[];for(let i=0;i<3;i++)previousPolling.push(await measure(true));
 const cachedPolling=[];for(let i=0;i<8;i++)cachedPolling.push(await measure(false));
 const average=a=>Math.round(a.reduce((sum,x)=>sum+x.ms,0)/a.length*10)/10;
 console.log(JSON.stringify({readOnly:true,previousPolling,cachedPolling,averagePreviousMs:average(previousPolling),averageCachedMs:average(cachedPolling)},null,2));
}finally{await j.close();}
