import {fileURLToPath as investigationFilePath} from 'node:url';
process.chdir(investigationFilePath(new URL('../',import.meta.url)));
import {readFileSync,writeFileSync} from 'node:fs';
const input=process.argv[2]??'telemetry/moving-telemetry.jsonl';
const rows=readFileSync(input,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
const transitions=[];
for(const row of rows){
 if(transitions.at(-1)?.state!==row.state)transitions.push({at:row.sampledAt,state:row.state,elapsedSeconds:row.elapsedSeconds,distanceKm:row.distance});
}
const running=rows.filter(r=>r.state==='Running');
const latencies=rows.map(r=>Date.parse(r.sampledAt)-Date.parse(r.requestedAt)).sort((a,b)=>a-b);
const pausedGroups=[];
for(const row of rows){
 if(row.state!=='Paused')continue;
 let group=pausedGroups.at(-1);
 if(!group||rows.indexOf(row)!==group.lastIndex+1){group={firstIndex:rows.indexOf(row),lastIndex:rows.indexOf(row),rows:[]};pausedGroups.push(group);}
 group.rows.push(row);group.lastIndex=rows.indexOf(row);
}
const summary={
 input,totalSamples:rows.length,first:rows[0],last:rows.at(-1),transitions,
 runningSamples:running.length,
 runningElapsedRange:running.length?[running[0].elapsedSeconds,running.at(-1).elapsedSeconds]:null,
 runningDistanceRangeKm:running.length?[running[0].distance,running.at(-1).distance]:null,
 distinctSpeedValues:[...new Set(rows.map(r=>r.speed))],
 distinctInclineValues:[...new Set(rows.map(r=>r.inclineRaw))],
 requestLatencyMs:{median:latencies[Math.floor(latencies.length/2)],max:latencies.at(-1)},
 pausedPeriods:pausedGroups.map(g=>({samples:g.rows.length,from:g.rows[0].sampledAt,to:g.rows.at(-1).sampledAt,elapsedStable:g.rows.every(r=>r.elapsedSeconds===g.rows[0].elapsedSeconds),distanceStable:g.rows.every(r=>r.distance===g.rows[0].distance)}))
};
writeFileSync('telemetry/telemetry-validation.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
