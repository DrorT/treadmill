import {fileURLToPath as investigationFilePath} from 'node:url';
process.chdir(investigationFilePath(new URL('../',import.meta.url)));
import {JDWP,u32,string} from './jdwp-read.mjs';
import {writeFileSync} from 'node:fs';
const j=await new JDWP().connect();
try{
 async function type(signature){const r=j.reader(await j.command(1,2,string(signature)));if(!r.int())throw Error('Missing class '+signature);r.byte();return r.id(j.sizes.type).toString();}
 async function field(object,typeId,name){const f=(await j.fields(typeId)).find(f=>f.name===name);if(!f)throw Error('Missing field '+name);return (await j.values(object,[f]))[name].value;}
 async function bytes(array,max){const lr=j.reader(await j.command(13,1,j.id(array,j.sizes.object)));const length=lr.int();const r=j.reader(await j.command(13,2,Buffer.concat([j.id(array,j.sizes.object),u32(0),u32(Math.min(length,max))])));const tag=r.byte(),n=r.int();if(tag!==66)throw Error('Expected byte array');return r.b.subarray(r.p,r.p+n);}
 const serialType=await type('Lcom/bodi/treadmill/core/impl/SerialComm;');
 const serial=(await j.instances(serialType,1))[0]?.value;if(!serial)throw Error('No active serial connection');
 const task=await field(serial,serialType,'mValueTask');
 const protocol=await field(task,await type('Lcom/bodi/treadmill/core/impl/SerialComm$ValueTask;'),'valueProtocol');
 const buffer=await field(protocol,await type('Lcom/bodi/treadmill/core/impl/BaseProtocol;'),'buffer');
 const array=await field(buffer,await type('Ljava/nio/ByteBuffer;'),'hb');
 const outgoing=Buffer.from(await bytes(array,16));
 if(outgoing.length!==16||outgoing[0]!==0xfd||outgoing[15]!==0xfe)throw Error('Unexpected outgoing frame');
 // Require the current idle poll format. Never replay pending commands/keys.
 if(outgoing[1]!==1||[...outgoing.subarray(2,12),outgoing[13]].some(b=>b!==0))throw Error('Outgoing frame has a pending command; refusing replay');
 outgoing[14]=outgoing.subarray(1,14).reduce((a,b)=>(a+b)&255,0);
 const receive=await field(serial,serialType,'mReceiveTask');
 const incomingArray=await field(receive,await type('Lcom/bodi/treadmill/core/impl/SerialComm$ReceiveTask;'),'mBuffer');
 const incoming=Buffer.from(await bytes(incomingArray,32));
 const snapshot={at:new Date().toISOString(),port:'/dev/ttyAS2',baud:19200,outgoingPollHex:outgoing.toString('hex'),incomingBufferHex:incoming.toString('hex')};
 writeFileSync('serial/serial-buffer-snapshot.json',JSON.stringify(snapshot,null,2));
 writeFileSync('serial/serial-poll.bin',outgoing);
 writeFileSync('serial/serial-app-buffer.bin',incoming);
 console.log(JSON.stringify(snapshot,null,2));
}finally{await j.close();}
