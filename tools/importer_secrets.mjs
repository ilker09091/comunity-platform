import fs from 'node:fs/promises';
import crypto from 'node:crypto';
let input='';for await(const chunk of process.stdin)input+=chunk;if(input.length>16000)throw new Error('Input too large');
try {
 const secret=process.env.IMPORTER_SHARED_SECRET || (await fs.readFile(process.env.IMPORTER_SECRET_FILE,'utf8')).trim();
 if(secret.length<32)throw new Error('Private importer key unavailable');
 const key=crypto.createHash('sha256').update('circle-importer-credentials-v1\0'+secret).digest();
 const value=JSON.parse(input).value;let result;
 if(process.argv[2]==='decrypt') {
  if(!value.startsWith('aesgcm:v1:'))throw new Error('Reconnect the background session');
  const bytes=Buffer.from(value.slice(10),'base64');const cipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAAD(Buffer.from('circle:v1'));cipher.setAuthTag(bytes.subarray(12,28));
  result=Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');
 }else{
  const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from('circle:v1'));
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);result='aesgcm:v1:'+Buffer.concat([nonce,cipher.getAuthTag(),encrypted]).toString('base64');
 }
 process.stdout.write(JSON.stringify({value:result}));
} catch {process.stdout.write(JSON.stringify({error:'SECRET_STORAGE_UNAVAILABLE'}));process.exitCode=1;}
