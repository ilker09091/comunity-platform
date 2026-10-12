import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
import {JSDOM} from 'jsdom';
const root=fileURLToPath(new URL('../',import.meta.url)),temp=await mkdtemp(join(root,'.reels-v2-tests-'));
const dom=new JSDOM(`<main id="root"><div id="video"></div><div id="background"></div><div class="reel-actions" id="rail"><button>Like</button></div><div class="reel-comments" id="comments"></div><div class="reel-caption expanded" id="caption"></div><div data-player-controls id="controls"></div><textarea id="input"></textarea><div id="scroll" style="overflow-y:auto"></div></main>`,{url:'https://circle.example/reels',pretendToBeVisual:true});
globalThis.window=dom.window;globalThis.sessionStorage=window.sessionStorage;
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
try{
 for(const name of ['reel-gestures','reel-queue','reel-watch']){const source=await readFile(join(root,'src/lib',name+'.ts'),'utf8');await writeFile(join(temp,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);}
 const {bindReelGestures}=await import(pathToFileURL(join(temp,'reel-gestures.mjs'))),queue=await import(pathToFileURL(join(temp,'reel-queue.mjs')));
 const document=window.document,host=document.getElementById('root'),calls=[];
 const scroll=document.getElementById('scroll');Object.defineProperty(scroll,'scrollHeight',{value:900});Object.defineProperty(scroll,'clientHeight',{value:100});
 let blocked=false,drag=0;
 const cleanup=bindReelGestures(host,{go:d=>calls.push(d),blocked:()=>blocked,drag:d=>drag=d,swiped:()=>{},mute:()=>{}});
 const wheel=(node,delta=70,extra={})=>node.dispatchEvent(new window.WheelEvent('wheel',{deltaY:delta,bubbles:true,cancelable:true,...extra}));
 for(const id of ['video','background','rail','root']){await new Promise(r=>setTimeout(r,220));wheel(document.getElementById(id));assert.equal(calls.at(-1),1);}
 assert.equal(calls.length,4);pass('wheel navigation owns video, blank stage, action-rail surroundings and the entire workspace');
 for(let i=0;i<8;i++){await new Promise(r=>setTimeout(r,30));wheel(host);}assert.equal(calls.length,4);pass('continuous wheel momentum produces one transition despite repeated events');
 await new Promise(r=>setTimeout(r,220));wheel(host,-4,{deltaMode:1});assert.equal(calls.at(-1),-1);pass('line-mode wheel-up navigates backwards');
 const before=calls.length;
 for(const id of ['comments','caption','controls','input','scroll'])wheel(document.getElementById(id));
 wheel(host,80,{ctrlKey:true});wheel(host,5,{deltaX:100});assert.equal(calls.length,before);pass('comments, expanded text, controls, inputs, native scroll containers and trackpad pinch/horizontal gestures retain ownership');
 blocked=true;wheel(host);blocked=false;
 const details=document.createElement('details');details.open=true;host.append(details);wheel(host);details.remove();assert.equal(calls.length,before);pass('modal/bottom-sheet and open-dropdown state suspend navigation');
 const touch=(node,type,points)=>{const e=new window.Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:points.map(([x,y])=>({clientX:x,clientY:y}))});node.dispatchEvent(e);};
 touch(host,'touchstart',[[100,600]]);touch(host,'touchmove',[[100,100]]);touch(host,'touchend',[]);assert.equal(calls.at(-1),1);assert.equal(drag,0);pass('mobile swipe works on workspace background outside the video');
 const count=calls.length;touch(host,'touchstart',[[100,600]]);touch(host,'touchmove',[[100,400],[200,400]]);touch(host,'touchend',[]);assert.equal(calls.length,count);pass('multi-touch cancels navigation and keeps pinch gestures separate');
 document.getElementById('input').dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));assert.equal(calls.length,count);
 window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowUp'}));assert.equal(calls.at(-1),-1);
 window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowUp',repeat:true}));assert.equal(calls.length,count+1);pass('keyboard navigation excludes text focus and held-key repeats');
 cleanup();await new Promise(r=>setTimeout(r,220));wheel(host);assert.equal(calls.length,count+1);pass('unmount removes all gesture listeners');
 assert.equal(queue.nextReelCursor({items:[],hasMore:true,nextCursor:'a'},[],undefined),undefined);
 assert.equal(queue.nextReelCursor({items:[1],hasMore:true,nextCursor:'a'},[{nextCursor:'a'},{nextCursor:'b'},{nextCursor:'a'}],'b'),undefined);
 assert.equal(queue.nextReelCursor({items:[1],hasMore:true,nextCursor:'c'},[{nextCursor:'a'},{nextCursor:'c'}],'a'),'c');
 assert.equal(queue.nextReelCursor({items:[1],hasMore:false,sessionEnded:true,sessionId:'session'},[],undefined),'renew:session');pass('empty pages, repeated cursors and bounded-session renewal cannot spin pagination');
 queue.writeReelRestore('alice',{sessionId:'session',cursor:'cursor',selected:'session:2:18:post',index:3});assert.equal(queue.readReelRestore('alice').selected,'session:2:18:post');assert.equal(queue.readReelRestore('bob'),undefined);queue.writeReelRestore('alice',undefined);assert.equal(queue.readReelRestore('alice'),undefined);pass('refresh restores the active occurrence and page cursor with account-scoped session state');
 const {ReelWatchObserver}=await import(pathToFileURL(join(temp,'reel-watch.mjs'))),events=[];
 const observer=new ReelWatchObserver(e=>events.push(e));const sample=t=>({currentTime:t,duration:1,paused:false,seeking:false});observer.observe('playing',sample(0),0);observer.observe('tick',sample(.25),250);observer.observe('tick',sample(.5),500);observer.observe('tick',sample(.75),750);observer.observe('tick',sample(.05),1050);assert.equal(events.filter(e=>e.type==='VIDEO_COMPLETE').length,1);assert.equal(events.filter(e=>e.type==='VIDEO_REPLAY').length,1);pass('very short native loops interpolate completion across the wrap without a new exposure or queue entry');
 console.log(`${checks} Reels V2 integration checks passed with simulated DOM gestures; native browser checks are separate.`);
}finally{dom.window.close();await rm(temp,{recursive:true,force:true});}
