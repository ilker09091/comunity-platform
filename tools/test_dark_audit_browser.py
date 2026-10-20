"""Dark-theme colour audit in real Chrome: seeds realistic content in the isolated QA database
(127.0.0.1:55433) and captures every main screen and popup. Also flags text whose contrast with
its effective background is too low (WCAG AA 4.5:1 for normal text, 3:1 for large text).
"""
import io, math, os, struct, subprocess, tempfile, time, wave, zlib, json
from pathlib import Path
import test_calls_browser as qa
from playwright.sync_api import sync_playwright

qa.DB='circle_dark_audit_test'
qa.OUT=qa.ROOT/'.tools/dark-audit'
ROOT, BASE, API, OUT=qa.ROOT,qa.BASE,qa.API,qa.OUT
FFMPEG=ROOT/'server/node_modules/ffmpeg-static/ffmpeg.exe'

def png(width=640,height=480,rgb=(70,130,200)):
    chunk=lambda kind,data:struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    rows=b''.join(b'\x00'+bytes(v for x in range(width) for v in (int(rgb[0]*x/width)%256,rgb[1],int(rgb[2]*y/height)%256)) for y in range(height))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
def tone_wav(seconds=2.0,rate=16000):
    buffer=io.BytesIO()
    with wave.open(buffer,'wb') as out:
        out.setnchannels(1);out.setsampwidth(2);out.setframerate(rate)
        out.writeframes(b''.join(struct.pack('<h',int(8000*math.sin(2*math.pi*330*i/rate))) for i in range(int(seconds*rate))))
    return buffer.getvalue()
def video():
    target=OUT/'clip.mp4'
    if not target.exists():
        subprocess.run([str(FFMPEG),'-y','-f','lavfi','-i','testsrc=size=540x960:rate=24:duration=4','-f','lavfi','-i','sine=frequency=440:duration=4',
                        '-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',str(target)],check=True,capture_output=True,creationflags=qa.FLAGS)
    return target.read_bytes()

CONTRAST='''()=>{const parse=c=>{const m=c.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const p=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);return [p[0],p[1],p[2],p.length>3?p[3]:1];};
const lum=([r,g,b])=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};
const bg=n=>{let layers=[];for(let e=n;e;e=e.parentElement){const s=getComputedStyle(e);if(s.backgroundImage!=='none'&&!/gradient/.test(s.backgroundImage))return null;const c=parse(s.backgroundColor);if(c&&c[3]>0){layers.push(c);if(c[3]>=0.99)break;}}
  let out=[13,14,17];for(const c of layers.reverse())out=out.map((v,i)=>v*(1-c[3])+c[i]*c[3]);return out;};
const bad=[];for(const n of document.querySelectorAll('body *')){if(n.closest('video,canvas,svg,.reel-stage,.story-overlay,.call-dialog,[aria-hidden=true]'))continue;
  const text=[...n.childNodes].filter(c=>c.nodeType===3&&c.textContent.trim()).map(c=>c.textContent.trim()).join(' ');if(!text)continue;
  const r=n.getBoundingClientRect();if(!r.width||!r.height||r.bottom<0||r.top>innerHeight)continue;const s=getComputedStyle(n);if(s.visibility==='hidden'||+s.opacity<0.4)continue;
  const fg=parse(s.color),b=bg(n);if(!fg||!b)continue;const f=fg.slice(0,3).map((v,i)=>v*fg[3]+b[i]*(1-fg[3]));
  const L1=lum(f),L2=lum(b),ratio=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);const large=parseFloat(s.fontSize)>=18.5||(parseFloat(s.fontSize)>=14&&+s.fontWeight>=700);
  if(ratio<(large?3:4.5)&&!n.closest('button:disabled,[disabled]'))bad.push({text:text.slice(0,40),ratio:+ratio.toFixed(2),cls:(n.className&&n.className.baseVal===undefined?n.className:n.tagName).toString().slice(0,60),color:s.color});}
return bad.slice(0,25);}'''

def run():
    OUT.mkdir(exist_ok=True)
    sql=lambda query,database=qa.DB:qa.sql(query,database)
    if not sql(f"SELECT 1 FROM pg_database WHERE datname='{qa.DB}'",'postgres'):
        sql(f'CREATE DATABASE {qa.DB}','postgres')
    env={**os.environ,'NODE_ENV':'production','PORT':'3014','DB_HOST':'127.0.0.1','DB_PORT':'55433','DB_USERNAME':'postgres','DB_PASSWORD':'','DB_NAME':qa.DB,
         'JWT_SECRET':'qa-dark-access-unique-long-local-secret','JWT_REFRESH_SECRET':'qa-dark-refresh-unique-long-local-secret',
         'PUBLIC_BASE_URL':API,'CORS_ORIGINS':BASE,'MEDIA_LOCAL_DIR':str(Path(tempfile.gettempdir())/'circle-dark-media'),
         'MEDIA_PUBLIC_URL':'/api/backend','THROTTLE_ENABLED':'false','MEDIA_CLEANUP_ENABLED':'false','CALL_TURN_URLS':'','CALL_TURN_SECRET':''}
    subprocess.run(['node','dist/database/migrate.js','run'],cwd=ROOT/'server',env=env,check=True,stdout=subprocess.DEVNULL,creationflags=qa.FLAGS)
    sql('TRUNCATE users, circles, admin_audit_logs, media_file_deletions CASCADE')
    logs=[open(OUT/'api.log','w',encoding='utf-8'),open(OUT/'web.log','w',encoding='utf-8')]
    processes=[];report={}
    try:
        processes.append(subprocess.Popen(['node','dist/main.js'],cwd=ROOT/'server',env=env,stdout=logs[0],stderr=subprocess.STDOUT,creationflags=qa.FLAGS))
        qa.wait(API+'/',processes[-1])
        processes.append(subprocess.Popen(['node','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3015'],cwd=ROOT/'client',
            env={**env,'PORT':'3015','API_ORIGIN':API,'APP_ORIGIN':BASE,'SESSION_COOKIE_SECURE':'false'},stdout=logs[1],stderr=subprocess.STDOUT,creationflags=qa.FLAGS))
        qa.wait(BASE,processes[-1])
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome',headless=True)
            a_ctx,b_ctx,c_ctx=browser.new_context(),browser.new_context(),browser.new_context()
            def call(context,method,path,body=None,multipart=None,ok=True):
                r=getattr(context.request,method)(BASE+'/api/backend/api/'+path,**({'multipart':multipart} if multipart else {'data':body or {}}),headers={'X-Social-Client':'web','Origin':BASE})
                if ok:assert r.ok,(path,r.status,r.text())
                return r.json() if r.ok and r.status!=204 else None
            stamp=str(int(time.time()))
            def register(context,name,display):
                return call(context,'post','auth/register',{'username':f'{name}_{stamp}','email':f'{name}_{stamp}@example.com','password':'qaPassword123!','displayName':display})['user']
            me,ben,cem=register(a_ctx,'ayse','Ayşe Kaya'),register(b_ctx,'burak','Burak Şahin'),register(c_ctx,'ceren','Ceren Aydın')
            sql(f"UPDATE users SET role='ADMIN' WHERE id='{me['id']}'")
            for x,y in [(a_ctx,ben),(a_ctx,cem),(b_ctx,me),(c_ctx,me),(b_ctx,cem)]:call(x,'post',f"users/{y['id']}/follow")
            image=call(b_ctx,'post','media',multipart={'file':{'name':'photo.png','mimeType':'image/png','buffer':png()}})
            photo_post=call(b_ctx,'post','posts',{'content':'Sunset from the pier tonight 🌅 #weekend','mediaIds':[image['id']]})
            call(a_ctx,'post','posts',{'content':'Exam week survival kit: coffee, playlists and a good study crew. What is on yours?'})
            clip=call(c_ctx,'post','media',multipart={'file':{'name':'clip.mp4','mimeType':'video/mp4','buffer':video()}})
            for _ in range(60):
                state=call(c_ctx,'get',f"media/{clip['id']}")
                if state['status']=='READY':break
                time.sleep(1)
            reel=call(c_ctx,'post','posts',{'content':'Testing the new camera 🎥','mediaIds':[clip['id']]})
            for ctx,text in [(a_ctx,'Beautiful colours!'),(c_ctx,'Where is this?')]:call(ctx,'post',f"posts/{photo_post['id']}/comments",{'content':text})
            call(a_ctx,'post',f"posts/{photo_post['id']}/like",ok=False);call(c_ctx,'post',f"posts/{photo_post['id']}/like",ok=False)
            story_media=call(b_ctx,'post','media',multipart={'file':{'name':'story.png','mimeType':'image/png','buffer':png(540,960,(200,90,140))}})
            call(b_ctx,'post','stories',{'mediaId':story_media['id'],'caption':'Morning run'})
            call(b_ctx,'post',f"messages/{me['id']}",{'content':'Are you coming to the study session?'})
            call(a_ctx,'post',f"messages/{ben['id']}",{'content':'Yes! 5pm at the library.'})
            audio=call(b_ctx,'post','messages/audio',multipart={'file':{'name':'v.wav','mimeType':'audio/wav','buffer':tone_wav()}})
            call(b_ctx,'post',f"messages/{me['id']}",{'audioId':audio['id']})
            circle=call(a_ctx,'post','circles',{'name':'Study crew','emoji':'📚','color':'#7c5cff'})
            call(b_ctx,'post','circles/join',{'code':circle['inviteCode']})
            call(c_ctx,'post','reports',{'targetType':'POST','targetId':photo_post['id'],'reason':'SPAM','details':'Looks like spam'},ok=False)
            state=a_ctx.storage_state()
            errors=[]
            def page_for(width,theme='dark'):
                context=browser.new_context(storage_state=state,viewport={'width':width,'height':900 if width>700 else 844},is_mobile=width<768,has_touch=width<768)
                context.add_init_script(f"localStorage.setItem('circle-theme','{theme}');localStorage.setItem('circle:notify-dismissed',String(Date.now()));localStorage.setItem('circle:app-banner-dismissed',String(Date.now()))")
                page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
                return context,page
            def shot(page,name,action=None):
                try:
                    if action:action(page)
                    page.wait_for_timeout(600)
                    page.screenshot(path=str(OUT/f'{name}.png'))
                    report[name]=page.evaluate(CONTRAST)
                except Exception as error:
                    report[name]=[{'error':str(error).splitlines()[0][:160]}]
            for theme in ['dark','light']:
                for width in [390,1280]:
                    tag=f'{theme}-{width}'
                    context,page=page_for(width,theme)
                    go=lambda path:(page.goto(BASE+path),page.wait_for_load_state('networkidle'))
                    go('/');shot(page,f'{tag}-home')
                    shot(page,f'{tag}-post-menu',lambda pg:pg.locator('summary[aria-label="Post options"]').first.click())
                    page.keyboard.press('Escape')
                    go('/');shot(page,f'{tag}-share-post',lambda pg:pg.get_by_role('button',name='Send to a user').first.click())
                    go(f"/post/{photo_post['id']}");shot(page,f'{tag}-post')
                    go('/explore');shot(page,f'{tag}-explore')
                    go('/notifications');shot(page,f'{tag}-notifications')
                    go(f"/profile/{ben['username']}");shot(page,f'{tag}-profile')
                    go('/profile/edit');shot(page,f'{tag}-profile-edit')
                    go('/messages');shot(page,f'{tag}-inbox')
                    go(f"/messages?to={ben['username']}");shot(page,f'{tag}-chat')
                    shot(page,f'{tag}-chat-emoji',lambda pg:pg.get_by_role('button',name='Emoji').first.click())
                    go(f"/reels?start={reel['id']}");shot(page,f'{tag}-reels')
                    shot(page,f'{tag}-reel-share',lambda pg:pg.get_by_role('button',name='Send to a user').first.click())
                    go('/saved');shot(page,f'{tag}-saved')
                    go('/explore?q=bu');shot(page,f'{tag}-search')
                    go('/settings');shot(page,f'{tag}-settings')
                    go('/circles');shot(page,f'{tag}-circles-create',lambda pg:pg.get_by_role('button',name='Create',exact=True).click())
                    for name,path in [('admin','/admin'),('admin-users','/admin/users'),('admin-reports','/admin/reports'),('admin-content','/admin/content'),
                                      ('admin-settings','/admin/settings'),('admin-audit','/admin/audit-logs'),('admin-analytics','/admin/analytics')]:
                        go(path);shot(page,f'{tag}-{name}')
                    context.close()
            browser.close()
        (OUT/'contrast.json').write_text(json.dumps(report,ensure_ascii=False,indent=1),encoding='utf-8')
        print('errors',errors[:5])
        for name,items in report.items():
            if items:print(name,len(items),items[:3])
    finally:
        for process in reversed(processes):
            process.terminate()
            try:process.wait(timeout=8)
            except subprocess.TimeoutExpired:process.kill()
        for log in logs:log.close()

if __name__=='__main__':run()
