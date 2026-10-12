/** Cursor/identity helpers used by the actual infinite queue and integration tests. */
export type ReelRestore={sessionId:string;cursor?:string;selected?:string;index:number};
export function readReelRestore(viewer:string):ReelRestore|undefined {
 try{if(typeof window==='undefined')return;const x=JSON.parse(sessionStorage.getItem('circle:reels:'+viewer)??'null');if(x&&typeof x.sessionId==='string'&&typeof x.index==='number'&&(!x.cursor||typeof x.cursor==='string'))return x;}catch{}
}
export function writeReelRestore(viewer:string,state:ReelRestore|undefined) {try{if(state)sessionStorage.setItem('circle:reels:'+viewer,JSON.stringify(state));else sessionStorage.removeItem('circle:reels:'+viewer);}catch{}}
export function nextReelCursor(page:{hasMore:boolean;items:unknown[];nextCursor?:string|null;sessionEnded?:boolean;sessionId?:string},pages:{nextCursor?:string|null}[],last?:string) {
 if(!page.hasMore&&page.sessionEnded&&page.items.length&&page.sessionId)return 'renew:'+page.sessionId;
 if(!page.hasMore||!page.items.length||!page.nextCursor||page.nextCursor===last||pages.slice(0,-1).some(p=>p.nextCursor===page.nextCursor))return;
 return page.nextCursor;
}
