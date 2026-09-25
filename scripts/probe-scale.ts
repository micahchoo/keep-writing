// A draw over a synthetic vault of N notes, each holding one paragraph with a
// block id. Reports time, content reads and the longest the event loop went
// without a turn. The draw keeps nothing between runs, so every run is cold.
import { drawMany } from '../src/bank';
import type { App, TFile } from 'obsidian';
const count = Number(Bun.argv[2] || 100000);
const prose = 'I remember how the afternoon light made the walls seem warmer than they were when we arrived home together. '.repeat(10);
const files = Array.from({length:count},(_,i)=>({path:`Pieces/${i}.md`,basename:String(i),extension:'md'} as TFile));
let reads=0,bytes=0;
const pos={start:{line:0,col:0,offset:0},end:{line:0,col:0,offset:1000}};
const metadata={frontmatter:{},frontmatterLinks:[],blocks:{p:{id:'p',position:pos}},sections:[{type:'paragraph',id:'p',position:pos}],headings:[]};
const app={vault:{getMarkdownFiles:()=>files,cachedRead:async(file:TFile)=>{reads++;const body=prose+file.basename+' ^p';bytes+=body.length;return body;},getFileByPath:(path:string)=>files[Number(path.split('/')[1]?.replace('.md',''))]??null},metadataCache:{getFileCache:()=>metadata}} as unknown as App;
const ctx={app,bankFolder:'Bank',sittingsFolder:'Sittings',writingFolders:['Pieces'],skipped:new Set<string>()};
async function measure(label:string,run:()=>Promise<unknown>) {
 reads=bytes=0;let last=performance.now(),gap=0;const timer=setInterval(()=>{const now=performance.now();gap=Math.max(gap,now-last);last=now;},1);const start=performance.now();await run();gap=Math.max(gap,performance.now()-last);clearInterval(timer);console.log(JSON.stringify({label,count,ms:Math.round(performance.now()-start),reads,bytes,maxGap:Math.round(gap),heapMB:Math.round(process.memoryUsage().heapUsed/1e6)}));
}
await measure('target',()=>drawMany(ctx,files[0]!,3));
for(let round=0;round<3;round++) await measure(`roaming-${round}`,()=>drawMany(ctx,null,3));
