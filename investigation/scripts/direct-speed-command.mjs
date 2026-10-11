import {fileURLToPath as investigationFilePath} from 'node:url';
process.chdir(investigationFilePath(new URL('../',import.meta.url)));
const value=process.argv[2];
process.argv[2]='speed';
process.argv[3]=value;
await import('./direct-setting-command.mjs');
