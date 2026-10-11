import {fileURLToPath as investigationFilePath} from 'node:url';
process.chdir(investigationFilePath(new URL('../',import.meta.url)));
import { readFileSync, writeFileSync } from 'node:fs';

const strings = [];
for (const path of ['app/classes.dex', 'app/classes2.dex']) {
  const data = readFileSync(path);
  const count = data.readUInt32LE(56);
  const table = data.readUInt32LE(60);
  for (let i = 0; i < count; i++) {
    let offset = data.readUInt32LE(table + i * 4);
    while (data[offset++] & 128) {}
    const end = data.indexOf(0, offset);
    strings.push(data.toString('utf8', offset, end));
  }
}
writeFileSync('app/dex-strings.json', JSON.stringify(strings, null, 2));
const matches = strings.filter(s => /ttyAS|serialport|serial_port|Lcom\/bodi\/.*(Serial|Protocol|Command|Record|Service|Speed|Incline)|baud|setSpeed|setIncline|sendCommand/i.test(s));
console.log(matches.join('\n'));
