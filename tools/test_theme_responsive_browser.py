"""Light/dark themes and responsive layout across the main pages, in real Chrome.
Seeds a post, a real voice note, a circle with answers and an admin account in the isolated
QA database (127.0.0.1:55433); reports horizontal overflow and saves screenshots per theme/width.
"""
import io, math, os, struct, subprocess, tempfile, time, wave
from pathlib import Path
import test_calls_browser as qa
from playwright.sync_api import sync_playwright

qa.DB='circle_theme_browser_test'
qa.OUT=qa.ROOT/'.tools/theme-qa'
ROOT, BASE, API, OUT=qa.ROOT,qa.BASE,qa.API,qa.OUT
WIDTHS=[(360,780),(390,844),(768,1024),(1280,900)]

def tone_wav(seconds=2.4,rate=16000):
    buffer=io.BytesIO()
    with wave.open(buffer,'wb') as out:
        out.setnchannels(1);out.setsampwidth(2);out.setframerate(rate)
        frames=b''.join(struct.pack('<h',int(9000*math.sin(2*math.pi*440*i/rate)*(0.3+0.7*abs(math.sin(i/rate*3))))) for i in range(int(seconds*rate)))
        out.writeframes(frames)
    return buffer.getvalue()

def run():
    OUT.mkdir(exist_ok=True)
    sql=lambda query,database=qa.DB:qa.sql(query,database)
    if not sql(f"SELECT 1 FROM pg_database WHERE datname='{qa.DB}'",'postgres'):
        sql(f'CREATE DATABASE {qa.DB}','postgres')
    env={**os.environ,'NODE_ENV':'production','PORT':'3014','DB_HOST':'127.0.0.1','DB_PORT':'55433','DB_USERNAME':'postgres','DB_PASSWORD':'','DB_NAME':qa.DB,
         'JWT_SECRET':'qa-theme-access-unique-long-local-secret','JWT_REFRESH_SECRET':'qa-theme-refresh-unique-long-local-secret',
         'PUBLIC_BASE_URL':API,'CORS_ORIGINS':BASE,'MEDIA_LOCAL_DIR':str(Path(tempfile.gettempdir())/'circle-theme-media'),
         'MEDIA_PUBLIC_URL':'/api/backend','THROTTLE_ENABLED':'false','MEDIA_CLEANUP_ENABLED':'false','CALL_TURN_URLS':'','CALL_TURN_SECRET':''}
    subprocess.run(['node','dist/database/migrate.js','run'],cwd=ROOT/'server',env=env,check=True,stdout=subprocess.DEVNULL,creationflags=qa.FLAGS)
    sql('TRUNCATE users, circles, admin_audit_logs, media_file_deletions CASCADE')
    logs=[open(OUT/'api.log','w',encoding='utf-8'),open(OUT/'web.log','w',encoding='utf-8')]
    processes=[]
    overflow=[]
    try:
        processes.append(subprocess.Popen(['node','dist/main.js'],cwd=ROOT/'server',env=env,stdout=logs[0],stderr=subprocess.STDOUT,creationflags=qa.FLAGS))
        qa.wait(API+'/',processes[-1])
        processes.append(subprocess.Popen(['node','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3015'],cwd=ROOT/'client',
            env={**env,'PORT':'3015','API_ORIGIN':API,'APP_ORIGIN':BASE,'SESSION_COOKIE_SECURE':'false'},stdout=logs[1],stderr=subprocess.STDOUT,creationflags=qa.FLAGS))
        qa.wait(BASE,processes[-1])
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome',headless=True)
            seed_a,seed_b=browser.new_context(),browser.new_context()
            def call(context,method,path,body=None,multipart=None):
                r=getattr(context.request,method)(BASE+'/api/backend/api/'+path,**({'multipart':multipart} if multipart else {'data':body or {}}),headers={'X-Social-Client':'web','Origin':BASE})
                assert r.ok,(path,r.status,r.text())
                return r.json() if r.status not in (204,) else None
            stamp=str(int(time.time()))
            me=call(seed_a,'post','auth/register',{'username':f'theme_{stamp}','email':f'theme_{stamp}@example.com','password':'qaPassword123!','displayName':'Selin Arslan'})['user']
            friend=call(seed_b,'post','auth/register',{'username':f'friend_{stamp}','email':f'friend_{stamp}@example.com','password':'qaPassword123!','displayName':'Mert Demir'})['user']
            sql(f"UPDATE users SET role='ADMIN' WHERE id='{me['id']}'")
            call(seed_a,'post',f"users/{friend['id']}/follow");call(seed_b,'post',f"users/{me['id']}/follow")
            call(seed_a,'post','posts',{'content':'Weekend hike photos coming soon. Who is in for Sunday? 🌲'})
            call(seed_b,'post',f"messages/{me['id']}",{'content':'Hey! Did you see the new circles feature?'})
            call(seed_a,'post',f"messages/{friend['id']}",{'content':'Yes, setting one up for our study group right now.'})
            for context,peer in [(seed_b,me),(seed_a,friend)]:
                audio=call(context,'post','messages/audio',multipart={'file':{'name':'voice.wav','mimeType':'audio/wav','buffer':tone_wav()}})
                call(context,'post',f"messages/{peer['id']}",{'audioId':audio['id']})
            circle=call(seed_a,'post','circles',{'name':'Study crew','emoji':'📚','color':'#7c5cff','kind':'class','description':'Room 12 · exam prep'})
            call(seed_b,'post','circles/join',{'code':circle['inviteCode']})
            prompt=call(seed_a,'post',f"circles/{circle['id']}/prompts",{'kind':'text','text':'What was the best part of your day?'})
            call(seed_a,'post',f"circles/{circle['id']}/posts",{'promptId':prompt['id'],'content':'Finished the chemistry notes'})
            call(seed_b,'post',f"circles/{circle['id']}/posts",{'promptId':prompt['id'],'content':'Basketball practice went great'})
            call(seed_b,'post',f"circles/{circle['id']}/posts",{'content':'Library at 5?'})
            call(seed_a,'post',f"admin/users/{friend['id']}/notes",{'body':'Helpful community member, verified via school.'})
            state=seed_a.storage_state()
            routes=[('home','/'),('messages',f"/messages?to={friend['username']}"),('circles','/circles'),('circle',f"/circles/{circle['id']}"),
                    ('settings','/settings'),('profile',f"/profile/{me['username']}"),('admin-user',f"/admin/users/{friend['id']}")]
            errors=[]
            for theme in ['light','dark']:
                for width,height in WIDTHS:
                    context=browser.new_context(storage_state=state,viewport={'width':width,'height':height},device_scale_factor=1,
                                                is_mobile=width<768,has_touch=width<768)
                    context.add_init_script(f"localStorage.setItem('circle-theme','{theme}')")
                    page=context.new_page()
                    page.on('pageerror',lambda error:errors.append(str(error)))
                    for name,path in routes:
                        page.goto(BASE+path)
                        page.wait_for_load_state('networkidle')
                        page.wait_for_timeout(500)
                        assert page.evaluate('document.documentElement.dataset.theme')==theme,(theme,path)
                        wide=page.evaluate('''()=>{const limit=document.documentElement.clientWidth+1;return [...document.querySelectorAll('body *')].filter(n=>{const r=n.getBoundingClientRect();
                          if(!r.width||r.right<=limit)return false;for(let p=n.parentElement;p;p=p.parentElement){const s=getComputedStyle(p);if(/(auto|scroll|hidden|clip)/.test(s.overflowX))return false;}return true;})
                          .slice(0,4).map(n=>(n.className&&n.className.baseVal===undefined?n.className:n.tagName)+' '+Math.round(n.getBoundingClientRect().right))}''')
                        if page.evaluate('document.documentElement.scrollWidth>document.documentElement.clientWidth+1') or wide:
                            overflow.append((theme,width,name,wide))
                        page.screenshot(path=str(OUT/f'{theme}-{width}-{name}.png'))
                    context.close()
                print(f'PASS {theme} theme rendered on every page and width')
            # The voice note renders a decoded waveform and plays.
            context=browser.new_context(storage_state=state,viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
            page=context.new_page()
            page.goto(BASE+f"/messages?to={friend['username']}")
            page.locator('.wa-voice').first.wait_for()
            page.locator('.wa-voice:not(.own) .wa-voice-play').first.click()
            page.wait_for_function("document.querySelector('.wa-voice.playing .wa-voice-rate')!==null",timeout=10000)
            page.wait_for_timeout(700)
            page.screenshot(path=str(OUT/'voice-playing.png'))
            print('PASS WhatsApp-style voice note plays with speed control')
            context.close()
            for theme,width in [('dark',1280),('light',390)]:
                context=browser.new_context(storage_state=state,viewport={'width':width,'height':900},is_mobile=width<768,has_touch=width<768)
                context.add_init_script(f"localStorage.setItem('circle-theme','{theme}')")
                page=context.new_page()
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.goto(BASE+f"/admin/users/{friend['id']}")
                for tab,ready in [('Activity','.admin-spark'),('Devices','.admin-device'),('Notes','.admin-notes li')]:
                    page.get_by_role('tab',name=tab).first.click()
                    page.locator(ready).first.wait_for(timeout=15000)
                    assert page.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'),(theme,width,tab)
                    page.screenshot(path=str(OUT/f'admin-{tab.lower()}-{theme}-{width}.png'),full_page=True)
                page.get_by_role('button',name='Edit profile').click()
                page.get_by_role('dialog').first.wait_for()
                page.screenshot(path=str(OUT/f'admin-edit-{theme}-{width}.png'))
                context.close()
            print('PASS admin activity, devices, notes and profile editor render in both themes')
            for width in [390,1280]:
                context=browser.new_context(viewport={'width':width,'height':900},is_mobile=width<768,has_touch=width<768)
                context.add_init_script("localStorage.setItem('circle-theme','dark')")
                page=context.new_page()
                page.goto(BASE+'/login');page.wait_for_load_state('networkidle')
                assert page.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'),width
                page.screenshot(path=str(OUT/f'dark-{width}-login.png'))
                context.close()
            print('PASS sign-in page in the dark theme')
            browser.close()
            for item in overflow:print('OVERFLOW',*item)
            assert not errors,errors
            print('PASS no browser page errors')
    finally:
        for process in reversed(processes):
            process.terminate()
            try:process.wait(timeout=8)
            except subprocess.TimeoutExpired:process.kill()
        for log in logs:log.close()

if __name__=='__main__':run()
