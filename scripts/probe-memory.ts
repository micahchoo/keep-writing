import {heapStats} from 'bun:jsc';
import { fillJars, AnsweredIndex, drawMany } from '../src/bank';
import { ExtractionCache } from '../src/extraction-cache';
import { paragraphJar } from '../src/paragraphs';
import { fakeVault } from '../test/fake-vault';
import type { App, TFile } from 'obsidian';
const count = Number(Bun.argv[2] || 100000);
const prose = 'I remember how the afternoon light made the walls seem warmer than they were when we arrived home together. '.repeat(10);
const files = Array.from({length:count},(_,i)=>({path:`Pieces/${i}.md`,basename:String(i),extension:'md'} as TFile));
let reads=0,bytes=0,metadataReads=0;
const pos={start:{line:0,col:0,offset:0},end:{line:0,col:0,offset:1000}};
const metadata={frontmatter:{},frontmatterLinks:[],blocks:{p:{id:'p',position:pos}},sections:[{type:'paragraph',id:'p',position:pos}],headings:[]};
const changed=new Set<string>();
const app={vault:{getMarkdownFiles:()=>files,cachedRead:async(file:TFile)=>{reads++;const body=prose+file.basename+(changed.has(file.path)?' changed':'')+' ^p';bytes+=body.length;return body;},getFileByPath:(path:string)=>files[Number(path.split('/')[1]?.replace('.md',''))]??null},metadataCache:{getFileCache:()=>{metadataReads++;return metadata;}}} as unknown as App;
const extraction=new ExtractionCache();
const ctx={app,extraction,bankFolder:'Bank',sittingsFolder:'Sittings',writingFolders:['Pieces'],index:new AnsweredIndex(app),skipped:new Set<string>()};
async function measure(label:string,run:()=>Promise<unknown>) {
 reads=bytes=metadataReads=0;let last=performance.now(),gap=0,ticks=0;const timer=setInterval(()=>{const now=performance.now();gap=Math.max(gap,now-last);last=now;ticks++;},1);const start=performance.now();await run();gap=Math.max(gap,performance.now()-last);clearInterval(timer);console.log(JSON.stringify({label,count,ms:performance.now()-start,reads,bytes,metadataReads,maxGap:gap,ticks,heapMB:process.memoryUsage().heapUsed/1e6}));
}
await measure('cold-target',()=>fillJars(ctx,files[0]));
await measure('warm-target',()=>fillJars(ctx,files[0]));
await measure('cold-roaming',()=>drawMany(ctx,null,3));
await measure('warm-roaming',()=>drawMany(ctx,null,3));
for(let round=0;round<Number(Bun.argv[3] || 3);round++){const path=files[round].path;changed.add(path);extraction.invalidate(path);ctx.index.invalidate(files[round]);await measure(`change-${round}`,()=>drawMany(ctx,null,3));
if(round % 5 === 4){await new Promise(resolve=>setTimeout(resolve,0)); Bun.gc(true); const stats=heapStats();console.log(JSON.stringify({label:'settled',round,heapMB:stats.heapSize/1e6,extraMB:stats.extraMemorySize/1e6,objects:stats.objectCount}));}}
extraction.dispose();
ctx.index.dispose();
Bun.gc(true);
await new Promise(resolve=>setTimeout(resolve,0));Bun.gc(true);const stats=heapStats();console.log(JSON.stringify({label:'disposed',count,heapMB:stats.heapSize/1e6,extraMB:stats.extraMemorySize/1e6,objects:stats.objectCount}));
if(count===100000) {
 for(const blocks of [10000,50000]) {
  const body=Array.from({length:blocks},(_,i)=>`## Heading ${i}\n\n${prose} item ${i} ^p${i}\n\n`).join('');const v=fakeVault({'Pieces/long.md':body});const meta=v.app.metadataCache.getFileCache(v.file('Pieces/long.md'));v.app.metadataCache.getFileCache=()=>meta;
  await measure(`long-${blocks}`,()=>paragraphJar(v.app,'Sittings',['Pieces']));
 }
}
