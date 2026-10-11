import {fileURLToPath as investigationFilePath} from 'node:url';
process.chdir(investigationFilePath(new URL('../',import.meta.url)));
import {readFileSync,writeFileSync} from 'node:fs';

export function decodeFrame(frame){
 if(frame.length!==16||frame[0]!==0xfd||frame[15]!==0xfe)throw Error('Invalid 16-byte frame');
 const checksum=frame.subarray(1,14).reduce((sum,b)=>(sum+b)&255,0);
 if(frame[14]!==checksum)throw Error('Checksum mismatch');
 if(frame[1]!==1)throw Error('Unexpected frame type');
 const status=frame[2]>>>4;
 const states={0:'Normal',1:'Ready',2:'Running',3:'Stopping',4:'UnSafe',5:'Error',6:'Pausing',7:'Paused'};
 return {hex:frame.toString('hex'),statusRaw:status,state:states[status]??'Unknown',statusLowNibble:frame[2]&15,speedKph:frame[3]/10,incline:frame[4],elapsedSeconds:frame.readUInt16BE(5),distanceKm:frame.readUInt16BE(7)/100,caloriesKcal:frame.readUInt16BE(9)/10,pulseBpm:frame[11],errorCode:frame[12],inputCode:frame[13]};
}

if(process.argv[1]?.endsWith('decode-serial.mjs')){
 const path=process.argv[2]??'serial/serial-standalone-capture.bin';
 const data=readFileSync(path),frames=[],rejected=[];
 for(let offset=0;offset+16<=data.length;){
  if(data[offset]!==0xfd){offset++;continue;}
  try{frames.push({...decodeFrame(data.subarray(offset,offset+16)),offset});offset+=16;}
  catch(error){rejected.push({offset,error:error.message});offset++;}
 }
 const result={source:path,bytes:data.length,validFrames:frames.length,rejected,frames};
 writeFileSync(process.argv[3]??'serial/serial-decoded.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
 if(!frames.length)process.exitCode=1;
}
