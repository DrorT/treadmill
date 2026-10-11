import {fileURLToPath as investigationFilePath} from 'node:url';
process.chdir(investigationFilePath(new URL('../',import.meta.url)));
import net from 'node:net';
import {writeFileSync} from 'node:fs';

export const u32 = n => { const b=Buffer.alloc(4); b.writeUInt32BE(n); return b; };
export const string = s => { const b=Buffer.from(s); return Buffer.concat([u32(b.length),b]); };
export class Reader {
  constructor(b,sizes){this.b=b;this.p=0;this.sizes=sizes;}
  byte(){return this.b[this.p++];}
  int(){const n=this.b.readInt32BE(this.p);this.p+=4;return n;}
  id(n){let v=0n;for(let i=0;i<n;i++)v=(v<<8n)|BigInt(this.byte());return v;}
  str(){const n=this.int();const s=this.b.toString('utf8',this.p,this.p+n);this.p+=n;return s;}
  value(){const tag=String.fromCharCode(this.byte());let value;
    if('L[stglc'.includes(tag))value=this.id(this.sizes.object).toString();
    else if(tag==='I')value=this.int();
    else if(tag==='Z'||tag==='B')value=this.byte();
    else if(tag==='F'){value=this.b.readFloatBE(this.p);this.p+=4;}
    else if(tag==='D'){value=this.b.readDoubleBE(this.p);this.p+=8;}
    else if(tag==='J'){value=this.b.readBigInt64BE(this.p).toString();this.p+=8;}
    else if(tag==='S'||tag==='C'){value=this.b.readInt16BE(this.p);this.p+=2;}
    else if(tag==='V')value=null;
    else throw Error('Unsupported tag '+tag);
    return {tag,value};
  }
}
export class JDWP {
  constructor(){this.seq=1;this.pending=new Map();this.buffer=Buffer.alloc(0);}
  async connect(port=8700){
    this.socket=net.connect(port,'127.0.0.1');
    await new Promise((resolve,reject)=>{this.socket.once('connect',resolve);this.socket.once('error',reject);});
    await new Promise((resolve,reject)=>{
      let first=Buffer.alloc(0);
      const receive=b=>{first=Buffer.concat([first,b]);if(first.length>=14){this.socket.off('data',receive);if(first.subarray(0,14).toString()!=='JDWP-Handshake'){reject(Error('Handshake failed'));return;}this.buffer=first.subarray(14);resolve();}};
      this.socket.on('data',receive);this.socket.write('JDWP-Handshake');
    });
    this.socket.on('data',b=>{this.buffer=Buffer.concat([this.buffer,b]);this.parse();});
    this.socket.on('error',e=>{for(const p of this.pending.values())p.reject(e);});
    this.parse();
    const r=new Reader(await this.command(1,7));
    this.sizes={field:r.int(),method:r.int(),object:r.int(),type:r.int(),frame:r.int()};
    return this;
  }
  parse(){while(this.buffer.length>=11){const len=this.buffer.readUInt32BE(0);if(this.buffer.length<len)return;const b=this.buffer.subarray(0,len);this.buffer=this.buffer.subarray(len);if(b[8]&128){const id=b.readUInt32BE(4),p=this.pending.get(id);if(p){clearTimeout(p.timer);this.pending.delete(id);const error=b.readUInt16BE(9);error?p.reject(Error('JDWP error '+error)):p.resolve(b.subarray(11));}}else if(this.onEvent){this.onEvent(b[9],b[10],b.subarray(11));}}}
  command(set,cmd,payload=Buffer.alloc(0)){
    // Only metadata and value reads plus clean detach are allowed.
    const allowed=new Set(['1:2','1:3','1:4','1:6','1:7','1:17','2:4','2:5','2:6','2:16','3:1','9:1','9:2','10:1','11:1','13:1','13:2']);
    if(!allowed.has(`${set}:${cmd}`))throw Error('Command outside read-only allowlist');
    return this.sendPacket(set,cmd,payload);
  }
  sendPacket(set,cmd,payload=Buffer.alloc(0)){
    const id=this.seq++,b=Buffer.alloc(11);b.writeUInt32BE(11+payload.length);b.writeUInt32BE(id,4);b[9]=set;b[10]=cmd;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('JDWP request timed out'));},10000);this.pending.set(id,{resolve,reject,timer});this.socket.write(Buffer.concat([b,payload]));});
  }
  id(value,size){let v=BigInt(value),b=Buffer.alloc(size);for(let i=size-1;i>=0;i--){b[i]=Number(v&255n);v>>=8n;}return b;}
  reader(b){return new Reader(b,this.sizes);}
  async classes(){const r=this.reader(await this.command(1,3)),n=r.int(),rows=[];for(let i=0;i<n;i++)rows.push({tag:r.byte(),id:r.id(this.sizes.type).toString(),signature:r.str(),status:r.int()});return rows;}
  async fields(type){const r=this.reader(await this.command(2,4,this.id(type,this.sizes.type))),n=r.int(),rows=[];for(let i=0;i<n;i++)rows.push({id:r.id(this.sizes.field).toString(),name:r.str(),signature:r.str(),modifiers:r.int()});return rows;}
  async instances(type,max=3){const r=this.reader(await this.command(2,16,Buffer.concat([this.id(type,this.sizes.type),u32(max)]))),n=r.int(),rows=[];for(let i=0;i<n;i++)rows.push(r.value());return rows;}
  async values(object,fields){const r=this.reader(await this.command(9,2,Buffer.concat([this.id(object,this.sizes.object),u32(fields.length),...fields.map(f=>this.id(f.id,this.sizes.field))]))),n=r.int(),values={};for(let i=0;i<n;i++)values[fields[i].name]=r.value();return values;}
  async close(){try{await this.command(1,6);}finally{this.socket.destroy();}}
}

if(process.argv[1]?.endsWith('jdwp-read.mjs')){
 const j=await new JDWP().connect();
 try{
  const classes=(await j.classes()).filter(c=>c.signature.startsWith('Lcom/bodi/treadmill/'));
  writeFileSync('telemetry/jdwp-classes.json',JSON.stringify(classes,null,2));
  const selected=classes.filter(c=>/service\/(AbsRunnerService|RunnerService|CommandHandler);|core\/.*(SerialComm|ValueProtocol|ParamProtocol);|bean\/|model\//.test(c.signature));
  const result=[];
  for(const c of selected){const fields=await j.fields(c.id);const instances=await j.instances(c.id);const values=[];for(const o of instances)values.push({object:o.value,fields:await j.values(o.value,fields.filter(f=>!(f.modifiers&8)))});result.push({...c,fields,instances:values});}
  writeFileSync('telemetry/jdwp-state.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
 }finally{await j.close();}
}
