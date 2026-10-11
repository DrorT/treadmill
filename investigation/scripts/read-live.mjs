import {fileURLToPath as investigationFilePath} from 'node:url';
process.chdir(investigationFilePath(new URL('../',import.meta.url)));
import {JDWP} from './jdwp-read.mjs';
import {writeFileSync,appendFileSync} from 'node:fs';

const j=await new JDWP().connect();
try {
 const classes=await j.classes();
 const byId=new Map(classes.map(c=>[c.id,c]));
 const metadata=new Map();
 async function fields(type){
  if(metadata.has(type))return metadata.get(type);
  const c=byId.get(type);
  if(!c?.signature.startsWith('Lcom/bodi/treadmill/'))return [];
  const own=(await j.fields(type)).filter(f=>!(f.modifiers&8));
  const r=j.reader(await j.command(3,1,j.id(type,j.sizes.type)));
  const parent=r.id(j.sizes.type).toString();
  const all=[...own,...await fields(parent)];metadata.set(type,all);return all;
 }
 async function object(id){
  const r=j.reader(await j.command(9,1,j.id(id,j.sizes.object)));r.byte();const type=r.id(j.sizes.type).toString();
  const f=await fields(type);return {object:id,type:byId.get(type)?.signature,values:await j.values(id,f)};
 }
 const serviceType=classes.find(c=>c.signature==='Lcom/bodi/treadmill/service/RunnerService;');
 const serviceInstances=await j.instances(serviceType.id,1);
 if(!serviceInstances.length)throw Error('No active RunnerService');
 const service=await object(serviceInstances[0].value);
 const runner=await object(service.values.mRunner.value);
 const children={};
 for(const [name,v] of Object.entries(runner.values)){
  if(v.tag==='L'&&v.value!=='0'&&/param|state|config|unit|data|mode/i.test(name))children[name]=await object(v.value);
 }
 const raw={sampledAt:new Date().toISOString(),source:'JDWP app object fields',service,runner,children};
 writeFileSync('telemetry/live-internal-state.json',JSON.stringify(raw,null,2));
 console.log(JSON.stringify(raw,null,2));
}finally{await j.close();}
