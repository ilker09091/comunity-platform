import type { INestApplication } from '@nestjs/common';
import {createServer,type Server} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DataSource} from 'typeorm';
import {Api,createTestApp,resetDatabase,type TestUser} from './setup/test-app.js';

describe('Fiktok admin relay (real auth and PostgreSQL, isolated worker fixture)',()=>{
 let app:INestApplication,api:Api,worker:Server,folder:string,admin:TestUser,member:TestUser,mod:TestUser;
 const calls:{path:string;token:string;key:string;user:string;data:any}[]=[];
 beforeAll(async()=>{
  folder=await mkdtemp(join(tmpdir(),'circle-importer-admin-'));
  process.env.IMPORTER_SECRET_FILE=join(folder,'key');
  worker=createServer(async(req,res)=>{
   let raw='';for await(const chunk of req)raw+=chunk;
   calls.push({path:req.url!,token:String(req.headers['x-circle-access']??''),key:String(req.headers['x-importer-key']??''),user:String(req.headers['x-circle-user']??''),data:raw?JSON.parse(raw):null});
   res.setHeader('Content-Type','application/json');
   if(req.url?.includes('mode=source-auth')){res.statusCode=401;res.end(JSON.stringify({code:'TIKTOK_LOGIN_REQUIRED',message:'Source login required'}));return;}
   if(req.url?.includes('mode=legacy')){res.statusCode=403;res.end(JSON.stringify({code:'INVALID_HOST',message:'Aracı http://localhost:4317 adresinden açın.'}));return;}
   if(req.url?.includes('mode=unavailable')){res.statusCode=422;res.end(JSON.stringify({code:'TIKTOK_LOGIN_REQUIRED',message:'Source login required'}));return;}
   res.end(JSON.stringify({ok:true,features:['automation'],videos:[],nextCursor:null}));
  });
  await new Promise<void>(resolve=>worker.listen(0,'127.0.0.1',resolve));
  process.env.IMPORTER_ORIGIN='http://127.0.0.1:'+(worker.address() as any).port;
  app=await createTestApp();api=new Api(app);
 });
 beforeEach(async()=>{await resetDatabase(app);calls.length=0;admin=await api.register('import_admin');member=await api.register('member');mod=await api.register('mod');await api.setRole(admin,'ADMIN');await api.setRole(mod,'MODERATOR');});
 afterAll(async()=>{await app.close();await new Promise<void>(resolve=>worker.close(()=>resolve()));delete process.env.IMPORTER_ORIGIN;delete process.env.IMPORTER_SECRET_FILE;await rm(folder,{recursive:true,force:true});});
 const request=(body:object,user?:TestUser)=>api.post('/admin/importer/request',body,user);
 it('requires a current administrator session, never manual importer tokens',async()=>{
  const body={method:'GET',path:'health'};
  await request(body).expect(401);await request(body,member).expect(403);await request(body,mod).expect(403);expect(calls).toHaveLength(0);
  await request(body,admin).expect(200);expect(calls[0].token).toBe(admin.token);expect(calls[0].user).toBe(admin.id);
  expect(calls[0].key).toBe((await readFile(join(folder,'key'),'utf8')).trim());
 });
 it('autofills active database/storage settings and genuinely checks the existing database',async()=>{
  const result=await request({method:'GET',path:'configuration'},admin).expect(200);
  expect(result.body.result.managed).toBe(true);expect(result.body.result.database.database).toMatch(/_test$/);
  expect(result.body.result.database.password).toBeUndefined();expect(calls).toHaveLength(0);
  const tested=await request({method:'POST',path:'database/test',data:{}},admin).expect(200);expect(tested.body.result.schema.compatible).toBe(true);
 });
 it('blocks arbitrary endpoints, URL traversal, database edits and local host startup controls',async()=>{
  for(const path of ['https://example.invalid','../configuration','videos/../../health','database/apply','startup'])await request({method:'POST',path,data:{}},admin).expect(400);
  await request({method:'DELETE',path:'health'},admin).expect(400);expect(calls).toHaveLength(0);
 });
 it('relays exact source queries and scheduling with a server-controlled Circle identity',async()=>{
  await request({method:'GET',path:'videos?mode=profile&account=%40creator&limit=20'},admin).expect(200);
  expect(calls[0].path).toBe('/api/backend/importer/videos?mode=profile&account=%40creator&limit=20');
  await request({method:'POST',path:'automation/schedule',data:{enabled:true,limit:20,intervalMinutes:30,dailyLimit:100}},admin).expect(200);
  expect(calls[1].data.intervalMinutes).toBe(30);
  const rows=await app.get(DataSource).query("SELECT metadata FROM admin_audit_logs WHERE action='importer.automation.schedule'");
  expect(rows[0].metadata).toEqual({operation:'automation/schedule'});expect(JSON.stringify(rows)).not.toContain(admin.token);
 });
 it('keeps source credential/permission errors explicit rather than returning fake videos',async()=>{
  const response=await request({method:'GET',path:'videos?mode=unavailable'},admin).expect(422);expect(response.body.code).toBe('TIKTOK_LOGIN_REQUIRED');
  expect(response.body.result).toBeUndefined();
 });
 it('keeps a source login error separate from Circle authentication and diagnoses an old worker',async()=>{
  const source=await request({method:'GET',path:'videos?mode=source-auth'},admin).expect(422);
  expect(source.body.code).toBe('TIKTOK_LOGIN_REQUIRED');
  const legacy=await request({method:'GET',path:'videos?mode=legacy'},admin).expect(503);
  expect(legacy.body.code).toBe('IMPORTER_CONFIGURATION');expect(legacy.body.message).not.toContain('localhost');
  await request({method:'GET',path:'health'},admin).expect(200);
 });
 it.runIf(process.env.TEST_IMPORTER_WORKER==='1')('reaches the actual private deployed Python worker through Nest without a localhost Host header',async()=>{
  const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as any).port;
  await new Promise<void>(resolve=>probe.close(()=>resolve()));
  const original=process.env.IMPORTER_ORIGIN;
  process.env.IMPORTER_ORIGIN='http://127.0.0.1:'+port;
  const child=spawn(process.env.PYTHON??'python',['tools/tiktok_importer.py'],{cwd:join(process.cwd(),'..'),windowsHide:true,env:{...process.env,IMPORTER_PORT:String(port),IMPORTER_BIND:'127.0.0.1',IMPORTER_DEPLOYED:'1',IMPORTER_STATE_DIR:join(folder,'real-worker-state'),IMPORTER_SECRET_FILE:join(folder,'key'),PYTHONUTF8:'1'}});
  let output='';child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk});
  const exited=once(child,'exit');
  try {
   for(let attempt=0;attempt<80;attempt++){
    if(child.exitCode!==null)throw new Error('Worker startup failed: '+output);
    try {await fetch(process.env.IMPORTER_ORIGIN+'/api/backend/importer/health');break;} catch {await new Promise(resolve=>setTimeout(resolve,100));}
   }
   const direct=await fetch(process.env.IMPORTER_ORIGIN+'/api/backend/importer/health');expect(direct.status).toBe(403);
   const health=await request({method:'GET',path:'health'},admin).expect(200);
   expect(health.body.result.features).toContain('admin-relay');
   const browser=await request({method:'GET',path:'browser/status'},admin).expect(200);
   expect(browser.body.result.loginWindowOpen).toBe(false);
   const state=await request({method:'GET',path:'browser/frame'},admin).expect(200);
   expect(state.body.result.frame).toBeNull();
  }finally{process.env.IMPORTER_ORIGIN=original;child.kill();await exited;}
 });
 it('refuses importing immediately after administrator privileges are revoked',async()=>{
  await api.setRole(admin,'USER');await request({method:'POST',path:'batches',data:{videoIds:['123']}},admin).expect(403);expect(calls).toHaveLength(0);
 });
});
