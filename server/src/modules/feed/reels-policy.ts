/** Server-only tuning. All inputs are bounded and weights normalized. */
export function reelsPolicy(env:NodeJS.ProcessEnv=process.env) {
 const number=(name:string,fallback:number,max:number)=>{const n=Number(env[name]??fallback);if(!Number.isFinite(n)||n<0||n>max)throw new Error(`Invalid ${name}`);return n;};
 const weights={recency:number('REELS_WEIGHT_RECENCY',.15,100),engagement:number('REELS_WEIGHT_ENGAGEMENT',.15,100),quality:number('REELS_WEIGHT_QUALITY',.2,100),creator:number('REELS_WEIGHT_CREATOR',.25,100),content:number('REELS_WEIGHT_CONTENT',.15,100),exploration:number('REELS_WEIGHT_EXPLORATION',.1,100)};
 const total=Object.values(weights).reduce((a,b)=>a+b,0);if(!total)throw new Error('Reels ranking needs a positive weight');
 for(const k of Object.keys(weights) as (keyof typeof weights)[])weights[k]/=total;
 return {version:2,weights,exposureSeconds:number('REELS_COOLDOWN_EXPOSURE_SECONDS',1800,604800),watchSeconds:number('REELS_COOLDOWN_WATCH_SECONDS',21600,2592000),engagementSeconds:number('REELS_COOLDOWN_ENGAGEMENT_SECONDS',86400,2592000),maxEntries:Math.max(1000,Math.floor(number('REELS_SESSION_MAX_ENTRIES',20000,100000))),diagnostics:env.NODE_ENV==='development'&&env.REELS_DIAGNOSTICS==='true'};
}
export const meaningfulThreshold=(duration:number)=>Math.max(250,Math.min(8000,duration<4000?duration*.5:Math.max(2000,duration*.1)));
export const completionRatio=(duration:number)=>duration<2000?.95:duration>60000?.9:.85;
