import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createHmac,randomUUID } from 'node:crypto';
import { mkdir,writeFile,rename } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { appConfig } from '../../config/app.config.js';
import { AppException,ErrorCode } from '../../common/errors/app.exception.js';
import { AuditService,type RequestContext } from '../platform/audit.service.js';
import type { ImporterRequestDto,ImporterReplyDto } from './dto/importer.dto.js';

@Injectable()
export class AdminImporterService implements OnModuleInit {
  constructor(@InjectDataSource() private readonly db:DataSource,@Inject(appConfig.KEY) private readonly config:ConfigType<typeof appConfig>,private readonly audit:AuditService) {}
  private key() {return process.env.IMPORTER_SHARED_SECRET || createHmac('sha256',this.config.auth.jwtRefreshSecret).update('circle-importer-bridge-v1').digest('hex');}
  async onModuleInit() {
    // Shared private control volume: worker receives only a derived bridge key, not JWT signing secrets.
    const path=process.env.IMPORTER_SECRET_FILE || (this.config.nodeEnv==='test'?resolve(tmpdir(),'circle-importer-test-key'):resolve('storage/importer-control/key'));
    await mkdir(dirname(path),{recursive:true,mode:0o700});
    const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,this.key(),{mode:0o600});await rename(temporary,path);
  }
  async request(ctx:RequestContext,accessToken:string,dto:ImporterRequestDto):Promise<ImporterReplyDto> {
    const part=dto.path.split('?')[0];
    const get=/^(health|configuration|startup|automation\/state|browser\/(status|frame)|videos|batches\/[a-f0-9]{32}|imports\/[a-f0-9]{32})$/;
    const post=/^(imports|personal-feed|batches|batches\/control|automation\/(schedule|connect|stop-all)|browser\/(login|input|close)|database\/test)$/;
    if(!(dto.method==='GET'?get:post).test(part)||dto.path.includes('#')||dto.path.includes('\\')||dto.path.includes('..'))throw AppException.badRequest(ErrorCode.BAD_REQUEST,'Unsupported importer operation');
    if(JSON.stringify(dto.data??{}).length>(part==='personal-feed'?262144:16384))throw AppException.badRequest(ErrorCode.BAD_REQUEST,'Importer request too large');
    if(part==='configuration')return {result:{managed:true,database:{host:this.config.db.host,port:this.config.db.port,username:this.config.db.username,database:this.config.db.database,ssl:this.config.db.ssl,passwordConfigured:!!this.config.db.password},circleUrl:this.config.corsOrigins[0]??this.config.publicBaseUrl,serverPort:this.config.port,storageDriver:this.config.media.driver,storageDirectory:this.config.media.localDir}};
    if(part==='startup')return {result:{supported:false,enabled:true,managed:true,message:'Sunucudaki importer servisi restart politikasıyla otomatik başlar.'}};
    if(part==='database/test') {
      await this.db.query('SELECT 1');
      const required=['users','sessions','posts','media','post_media'];
      const rows=await this.db.query('SELECT name,to_regclass(name) IS NOT NULL AS present FROM unnest($1::text[]) name',[required]) as {name:string;present:boolean}[];
      const missingTables=rows.filter(r=>!r.present).map(r=>r.name),pending=await this.db.showMigrations();
      return {result:{ok:!missingTables.length&&!pending,schema:{compatible:!missingTables.length&&!pending,missingTables,missingMigrations:pending?['Pending Circle migrations']:[],missingPrivileges:[]},message:'Circle’ın etkin PostgreSQL bağlantısı doğrulandı. Importer aynı API ve medya storage’ını kullanır.'}};
    }
    let origin:URL;
    try {origin=new URL(process.env.IMPORTER_ORIGIN??'http://127.0.0.1:4317');} catch {throw new AppException(503,ErrorCode.IMPORTER_CONFIGURATION,'IMPORTER_ORIGIN must be a private worker HTTP(S) origin');}
    if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw new AppException(503,ErrorCode.IMPORTER_CONFIGURATION,'IMPORTER_ORIGIN must be a private worker HTTP(S) origin');
    let response:Response;
    try {
      response=await fetch(new URL('/api/backend/importer/'+dto.path,origin),{method:dto.method,redirect:'error',signal:AbortSignal.timeout(170000),headers:{'Content-Type':'application/json','X-Social-Client':'web','X-Importer-Key':this.key(),'X-Circle-Access':accessToken,'X-Circle-User':ctx.actor.id},body:dto.method==='POST'?JSON.stringify(dto.data??{}):undefined});
    } catch {throw new AppException(503,ErrorCode.IMPORTER_UNAVAILABLE,'Fiktok arka plan servisine ulaşılamıyor. Sunucuda importer servisini başlatın ve IMPORTER_ORIGIN ayarını kontrol edin.');}
    const payload=await response.json().catch(()=>null) as Record<string,unknown>|null;
    if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new AppException(502,ErrorCode.IMPORTER_INVALID_RESPONSE,'Importer geçerli JSON döndürmedi.');
    if(!response.ok) {
      const sourceCode=String(payload.code??'IMPORTER_ERROR');
      if(sourceCode==='INVALID_HOST'||sourceCode==='INVALID_ORIGIN')throw new AppException(503,ErrorCode.IMPORTER_CONFIGURATION,'Fiktok worker farklı proje veya eski sürümden çalışıyor. Doğru projenin tools/start-importer.ps1 dosyasını çalıştırın; deploy’da api ve importer servislerinin aynı kontrol volume’ünü kullandığını doğrulayın.');
      const code=sourceCode==='TIKTOK_LOGIN_REQUIRED'?ErrorCode.TIKTOK_LOGIN_REQUIRED:ErrorCode.IMPORTER_SOURCE_ERROR;
      // A source-account error must never clear the user's Circle session in the web gateway.
      const status=response.status===401||response.status===403?422:response.status;
      throw new AppException(status,code,String(payload.message??'Importer işlemi başarısız.'),[{field:'importerCode',message:sourceCode}]);
    }
    if(dto.method==='POST' && !part.startsWith('browser/'))await this.audit.record(this.db,ctx,{action:'importer.'+part.replaceAll('/','.'),targetType:'SYSTEM',metadata:{operation:part}});
    return {result:payload};
  }
}
