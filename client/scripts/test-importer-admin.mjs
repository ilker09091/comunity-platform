import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM,VirtualConsole} from "jsdom";

// Execute the actual shipped interface on deployed origins, with isolated API responses.
// No production data, download results or login credentials are created by this check.
const html=await readFile(new URL('../public/fiktok-importer.html',import.meta.url),'utf8');
for(const origin of ['https://circle.example','http://192.0.2.20:3100']) {
 const requests=[],errors=[];
 const dom=new JSDOM(html,{url:origin+'/fiktok-importer.html',runScripts:'dangerously',virtualConsole:new VirtualConsole().on('jsdomError',e=>errors.push(e)),beforeParse(w){
  w.fetch=async(url,options)=>{
   requests.push({url,options});const body=JSON.parse(options.body);
   const result=body.path==='configuration'?{managed:true,database:{host:'db',port:5432,database:'circle',username:'circle',ssl:false,passwordConfigured:true},circleUrl:origin,storageDriver:'local',storageDirectory:'/app/storage/media',serverPort:3002}:body.path==='startup'?{supported:false,enabled:true}:body.path==='automation/state'?{workerAlive:true,credentials:{connected:false},schedules:[],batches:[],browser:{running:false}}:body.path==='videos?account=%40creator&mode=profile&limit=20'?{videos:[],nextCursor:null}:{videos:[],nextCursor:null};
   return {ok:true,status:200,json:async()=>({result})};
  };
 }});
 try {
  await new Promise(resolve=>setTimeout(resolve,50));
  const w=dom.window;
  assert.equal(w.document.getElementById('db-host').value,'db');
  assert.equal(w.document.getElementById('db-host').disabled,true);
  assert.equal(w.document.getElementById('db-apply').hidden,true);
  assert.equal(w.document.getElementById('circle-login-link').href,origin+'/login');
  assert.equal(w.document.getElementById('startup-enabled').closest('label').hidden,true);
  assert.ok(requests.length>=3,'Interface must load real adapter configuration and worker state');
  for(const request of requests){assert.equal(request.url,origin+'/api/backend/api/admin/importer/request');assert.equal(request.options.method,'POST');assert.equal(request.options.credentials,'include');assert.ok(!request.url.includes('localhost'));assert.ok(!request.options.headers.Authorization);}
  const request=w.eval('request');const config=w.eval('readConfig()');
  await request(config,'videos?account=%40creator&mode=profile&limit=20');
  assert.equal(JSON.parse(requests.at(-1).options.body).method,'GET');
  w.fetch=async()=>({ok:false,status:503,json:async()=>({code:'IMPORTER_CONFIGURATION',message:'Sunucudaki importer servisini güncelleyin.'})});
  await assert.rejects(request(config,'health'),e=>e.code==='IMPORTER_CONFIGURATION'&&!e.message.includes('localhost'));
  w.fetch=async()=>{throw new w.TypeError('network unavailable')};
  await assert.rejects(request(config,'health'),e=>e.code==='NETWORK'&&!e.message.includes('localhost'));
  assert.deepEqual(errors,[]);
  console.log('PASS deployed admin routing, auto configuration, source request and server errors:',origin);
 }finally{dom.window.close();}
}
