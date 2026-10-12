/** Own gestures only within the Reels workspace; intentional scrolling keeps native ownership. */
export function bindReelGestures(root:HTMLElement,options:{go:(delta:1|-1)=>void;blocked:()=>boolean;drag:(dy:number)=>void;swiped:()=>void;mute:()=>void}) {
 const win=root.ownerDocument.defaultView!;
 const document=root.ownerDocument;
 const exclusion='input,textarea,select,[contenteditable="true"],[role="slider"],[data-player-controls],.reel-comments,.reel-caption.expanded,.dropdown-menu,[data-reels-scroll],dialog,[role="dialog"],[inert]';
 const owns=(target:EventTarget|null,touch=false)=>{
  const el=target instanceof win.Element?target:root;
  if(options.blocked()||document.querySelector('dialog[open],details[open],[role="dialog"]')||!win.getSelection()?.isCollapsed)return false;
  if(el.closest(exclusion))return false;
  if(touch&&el.closest('a,button,summary')&&!el.closest('.reel-play-surface'))return false;
  for(let node=el;node&&node!==root;node=node.parentElement!){
   const style=win.getComputedStyle(node);
   if(/auto|scroll/.test(style.overflowY)&&node.scrollHeight>node.clientHeight+1)return false;
  }
  return true;
 };
 let sum=0,consumed=false,lastWheel=0,touch:{x:number;y:number;time:number;dy:number;dx:number}|null=null;
 const wheel=(e:WheelEvent)=>{
  if(e.ctrlKey||e.metaKey||!e.deltaY||Math.abs(e.deltaX)>Math.abs(e.deltaY)||!owns(e.target))return;
  if(e.cancelable)e.preventDefault();
  const now=win.performance.now();if(now-lastWheel>200){sum=0;consumed=false;}lastWheel=now;
  if(consumed)return;
  const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?root.clientHeight||600:1);
  if(Math.sign(delta)!==Math.sign(sum))sum=0;
  sum+=delta;if(Math.abs(sum)>=55){consumed=true;options.go(sum>0?1:-1);}
 };
 const reset=()=>{touch=null;options.drag(0);};
 const start=(e:TouchEvent)=>{
  reset();if(e.touches.length!==1||!owns(e.target,true))return;
  touch={x:e.touches[0].clientX,y:e.touches[0].clientY,time:win.performance.now(),dy:0,dx:0};
 };
 const move=(e:TouchEvent)=>{
  if(!touch)return;if(e.touches.length!==1||!owns(e.target,true)){reset();return;}
  touch.dx=e.touches[0].clientX-touch.x;touch.dy=e.touches[0].clientY-touch.y;
  if(Math.abs(touch.dx)>Math.abs(touch.dy)+20){reset();return;}
  if(Math.abs(touch.dy)>12){if(e.cancelable)e.preventDefault();options.drag(touch.dy);}
 };
 const end=()=>{
  if(!touch)return;const {dy,time}=touch;reset();
  if(Math.abs(dy)>Math.max(60,(root.clientHeight||600)*.16)||Math.abs(dy)>40&&Math.abs(dy)/Math.max(1,win.performance.now()-time)>.45){options.go(dy<0?1:-1);options.swiped();}
 };
 const key=(e:KeyboardEvent)=>{
  if(e.defaultPrevented||e.repeat||e.altKey||e.ctrlKey||e.metaKey||!owns(e.target))return;
  if(e.target instanceof win.Element&&e.target!==document.body&&!root.contains(e.target))return;
  if(['ArrowDown','PageDown','j'].includes(e.key)){e.preventDefault();options.go(1);}
  else if(['ArrowUp','PageUp','k'].includes(e.key)){e.preventDefault();options.go(-1);}
  else if(e.key==='m')options.mute();
 };
 root.addEventListener('wheel',wheel,{passive:false});root.addEventListener('touchstart',start,{passive:true});root.addEventListener('touchmove',move,{passive:false});root.addEventListener('touchend',end);root.addEventListener('touchcancel',reset);win.addEventListener('keydown',key);
 return ()=>{root.removeEventListener('wheel',wheel);root.removeEventListener('touchstart',start);root.removeEventListener('touchmove',move);root.removeEventListener('touchend',end);root.removeEventListener('touchcancel',reset);win.removeEventListener('keydown',key);reset();};
}
