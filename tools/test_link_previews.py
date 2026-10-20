"""Link previews as WhatsApp/Telegram/X see them: Open Graph tags in <head> and reachable images.
Runs the built API and Next against the isolated QA database (127.0.0.1:55433).
"""
import os, re, struct, subprocess, tempfile, time, urllib.request, zlib, json
from pathlib import Path
import test_calls_browser as qa

qa.DB='circle_link_preview_test'
qa.OUT=qa.ROOT/'.tools/link-previews'
ROOT, BASE, API, OUT=qa.ROOT,qa.BASE,qa.API,qa.OUT
AGENTS={'whatsapp':'WhatsApp/2.24.1.6 A','telegram':'TelegramBot (like TwitterBot)','x':'Twitterbot/1.0'}

def png(width=1200,height=800):
    chunk=lambda kind,data:struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    rows=b''.join(b'\x00'+bytes(v for x in range(width) for v in (x*255//width,90,y*255//height)) for y in range(height))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')

def request(url,method='GET',body=None,headers=None,cookies=None):
    data=None;headers=dict(headers or {})
    if isinstance(body,dict):data=json.dumps(body).encode();headers['Content-Type']='application/json'
    elif body is not None:data=body
    if cookies:headers['Cookie']=cookies
    req=urllib.request.Request(url,data=data,method=method,headers=headers)
    with urllib.request.urlopen(req,timeout=30) as r:return r.status,{k.title():v for k,v in r.headers.items()},r.read()

def meta(html):
    tags={}
    for prop,content in re.findall(r'<meta (?:property|name)="([^"]+)" content="([^"]*)"',html):tags.setdefault(prop,content)
    title=re.search(r'<title>([^<]*)</title>',html)
    tags['<title>']=title.group(1) if title else None
    return tags

def run():
    OUT.mkdir(exist_ok=True)
    sql=lambda query,database=qa.DB:qa.sql(query,database)
    if not sql(f"SELECT 1 FROM pg_database WHERE datname='{qa.DB}'",'postgres'):sql(f'CREATE DATABASE {qa.DB}','postgres')
    env={**os.environ,'NODE_ENV':'production','PORT':'3014','DB_HOST':'127.0.0.1','DB_PORT':'55433','DB_USERNAME':'postgres','DB_PASSWORD':'','DB_NAME':qa.DB,
         'JWT_SECRET':'qa-preview-access-unique-long-local-secret','JWT_REFRESH_SECRET':'qa-preview-refresh-unique-long-local-secret',
         'PUBLIC_BASE_URL':API,'CORS_ORIGINS':BASE,'MEDIA_LOCAL_DIR':str(Path(tempfile.gettempdir())/'circle-preview-media'/'media'),
         'MEDIA_PUBLIC_URL':'/api/backend','THROTTLE_ENABLED':'false','MEDIA_CLEANUP_ENABLED':'false','CALL_TURN_URLS':'','CALL_TURN_SECRET':''}
    subprocess.run(['node','dist/database/migrate.js','run'],cwd=ROOT/'server',env=env,check=True,stdout=subprocess.DEVNULL,creationflags=qa.FLAGS)
    sql('TRUNCATE users, circles, admin_audit_logs, media_file_deletions CASCADE')
    logs=[open(OUT/'api.log','w',encoding='utf-8'),open(OUT/'web.log','w',encoding='utf-8')]
    processes=[]
    try:
        processes.append(subprocess.Popen(['node','dist/main.js'],cwd=ROOT/'server',env=env,stdout=logs[0],stderr=subprocess.STDOUT,creationflags=qa.FLAGS))
        qa.wait(API+'/',processes[-1])
        processes.append(subprocess.Popen(['node','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3015'],cwd=ROOT/'client',
            env={**env,'PORT':'3015','API_ORIGIN':API,'APP_ORIGIN':BASE,'SITE_URL':BASE,'SESSION_COOKIE_SECURE':'false'},stdout=logs[1],stderr=subprocess.STDOUT,creationflags=qa.FLAGS))
        qa.wait(BASE,processes[-1])
        stamp=str(int(time.time()))
        _,_,body=request(API+'/api/auth/register','POST',{'username':f'deniz_{stamp}','email':f'deniz_{stamp}@example.com','password':'qaPassword123!','displayName':'Deniz Yıldız'})
        auth=json.loads(body);token={'Authorization':'Bearer '+auth['accessToken']};username=auth['user']['username']
        request(API+'/api/users/me','PATCH',{'bio':'Fotoğrafçı · İstanbul 📸 Gün batımı ve şehir hikâyeleri.'},token)
        boundary='----qa'+stamp
        def upload(data,name,mime):
            payload=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n').encode()+data+f'\r\n--{boundary}--\r\n'.encode()
            return json.loads(request(API+'/api/media','POST',payload,{**token,'Content-Type':f'multipart/form-data; boundary={boundary}'})[2])
        photo=upload(png(),'sunset.png','image/png')
        image_post=json.loads(request(API+'/api/posts','POST',{'content':'Galata’da gün batımı 🌅 Şehrin en güzel saati.','mediaIds':[photo['id']]},token)[2])
        text_post=json.loads(request(API+'/api/posts','POST',{'content':'Çalışma haftası için önerilerim: kahve, iyi bir çalma listesi ve birlikte çalışacak arkadaşlar. Sizinki ne?'},token)[2])
        results={}
        for name,path in [('image-post',f"/post/{image_post['id']}"),('text-post',f"/post/{text_post['id']}"),('profile',f'/profile/{username}'),('home','/')]:
            for agent,ua in AGENTS.items():
                status,headers,body=request(BASE+path,headers={'User-Agent':ua})
                html=body.decode('utf-8','replace')
                head=html.split('</head>')[0]
                tags=meta(head)
                results[f'{name}:{agent}']=tags
                assert tags.get('og:title') and tags.get('og:image') and tags.get('og:description'),(name,agent,tags)
            image=tags['og:image']
            assert image.startswith(BASE),(image)
            status,headers,data=request(image)
            assert status==200 and headers.get('Content-Type','').startswith('image/'),(name,image,status,headers.get('Content-Type'))
            ext='jpg' if 'jpeg' in headers['Content-Type'] else 'png'
            (OUT/f'{name}.{ext}').write_bytes(data)
            print(f"PASS {name}: {tags['og:title']!r} -> {headers['Content-Type']} {len(data)//1024} KB ({tags.get('twitter:card')})")
        status,_,robots=request(BASE+'/robots.txt');assert b'Disallow: /admin' in robots
        status,_,sitemap=request(BASE+'/sitemap.xml');assert b'<urlset' in sitemap
        (OUT/'tags.json').write_text(json.dumps(results,ensure_ascii=False,indent=1),encoding='utf-8')
        print('PASS robots.txt and sitemap.xml')
    finally:
        for process in reversed(processes):
            process.terminate()
            try:process.wait(timeout=8)
            except subprocess.TimeoutExpired:process.kill()
        for log in logs:log.close()

if __name__=='__main__':run()
