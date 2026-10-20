"""Circles in real Chrome: create, invite, join, daily question unlock, shared streak and albums.
Uses only the isolated local QA database (127.0.0.1:55433) like the call tests.
"""
import os, subprocess, tempfile, time
from pathlib import Path
import test_calls_browser as qa
from playwright.sync_api import sync_playwright

qa.DB='circle_circles_browser_test'
qa.OUT=qa.ROOT/'.tools/circles-qa'
ROOT, BASE, API, OUT=qa.ROOT,qa.BASE,qa.API,qa.OUT
def make_png(width=64,height=48,rgb=(124,92,255)):
    import struct,zlib
    chunk=lambda kind,data:struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    rows=b''.join(b'\x00'+bytes(rgb)*width for _ in range(height))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
PNG=make_png()

def run():
    OUT.mkdir(exist_ok=True)
    sql=lambda query,database=qa.DB:qa.sql(query,database)
    if not sql(f"SELECT 1 FROM pg_database WHERE datname='{qa.DB}'",'postgres'):
        sql(f'CREATE DATABASE {qa.DB}','postgres')
    env={**os.environ,'NODE_ENV':'production','PORT':'3014','DB_HOST':'127.0.0.1','DB_PORT':'55433','DB_USERNAME':'postgres','DB_PASSWORD':'','DB_NAME':qa.DB,
         'JWT_SECRET':'qa-circles-access-unique-long-local-secret','JWT_REFRESH_SECRET':'qa-circles-refresh-unique-long-local-secret',
         'PUBLIC_BASE_URL':API,'CORS_ORIGINS':BASE,'MEDIA_LOCAL_DIR':str(Path(tempfile.gettempdir())/'circle-circles-media'),
         'MEDIA_PUBLIC_URL':'/api/backend','THROTTLE_ENABLED':'false','MEDIA_CLEANUP_ENABLED':'false','CALL_TURN_URLS':'','CALL_TURN_SECRET':''}
    subprocess.run(['node','dist/database/migrate.js','run'],cwd=ROOT/'server',env=env,check=True,stdout=subprocess.DEVNULL,creationflags=qa.FLAGS)
    sql('TRUNCATE users, circles, admin_audit_logs, media_file_deletions CASCADE')
    logs=[open(OUT/'api.log','w',encoding='utf-8'),open(OUT/'web.log','w',encoding='utf-8')]
    processes=[]
    try:
        processes.append(subprocess.Popen(['node','dist/main.js'],cwd=ROOT/'server',env=env,stdout=logs[0],stderr=subprocess.STDOUT,creationflags=qa.FLAGS))
        qa.wait(API+'/',processes[-1])
        processes.append(subprocess.Popen(['node','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3015'],cwd=ROOT/'client',
            env={**env,'PORT':'3015','API_ORIGIN':API,'APP_ORIGIN':BASE,'SESSION_COOKIE_SECURE':'false'},stdout=logs[1],stderr=subprocess.STDOUT,creationflags=qa.FLAGS))
        qa.wait(BASE,processes[-1])
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome',headless=True)
            desktop=browser.new_context(viewport={'width':1440,'height':1000})
            phone=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True)
            def post(context,path,body=None):
                r=context.request.post(BASE+'/api/backend/api/'+path,data=body or {},headers={'X-Social-Client':'web','Origin':BASE})
                assert r.ok,(path,r.status,r.text())
                return r.json() if r.status!=204 else None
            stamp=str(int(time.time()))
            owner,friend=[post(c,'auth/register',{'username':f'circ_{stamp}_{i}','email':f'circ_{stamp}_{i}@example.com','password':'qaPassword123!','displayName':name})['user']
                          for i,(c,name) in enumerate([(desktop,'Deniz Kaya'),(phone,'Ece Yılmaz')])]
            left,right=desktop.new_page(),phone.new_page()
            errors=[]
            for page in [left,right]:page.on('pageerror',lambda error:errors.append(str(error)))
            left.goto(BASE+'/circles')
            left.get_by_role('heading',name='Start your first circle').wait_for()
            left.screenshot(path=str(OUT/'empty.png'))
            left.get_by_role('button',name='Create',exact=True).click()
            left.get_by_label('Name').fill('Study crew')
            left.get_by_role('button',name='Use 📚').click()
            left.get_by_role('radio',name='Class').click()
            left.get_by_label('Description (optional)').fill('Room 12 · exam prep')
            left.screenshot(path=str(OUT/'create.png'))
            left.get_by_role('button',name='Create circle').click()
            left.wait_for_url('**/circles/*')
            left.get_by_role('heading',name='Study crew').wait_for()
            circle_id=left.url.rstrip('/').split('/')[-1]
            print('PASS create a circle from the form and land on its page')
            left.get_by_role('button',name='Invite').click()
            code=left.locator('.circle-invite-code').inner_text().strip()
            assert len(code)==8,code
            left.screenshot(path=str(OUT/'invite.png'))
            left.keyboard.press('Escape')
            right.goto(BASE+f'/circles/join/{code}')
            right.get_by_role('heading',name='Study crew').wait_for()
            right.screenshot(path=str(OUT/'join-mobile.png'))
            right.get_by_role('button',name='Join circle').click()
            right.wait_for_url(f'**/circles/{circle_id}')
            print('PASS invite code preview and join from a phone')
            # Today's question: unlocks after answering, both answers count toward the streak.
            post(desktop,f'circles/{circle_id}/prompts',{'kind':'text','text':'What was the best part of your day?'})
            left.reload()
            left.get_by_placeholder('Your answer…').fill('Finished the chemistry notes 🎉')
            left.get_by_role('button',name='Answer',exact=True).click()
            left.get_by_text('Finished the chemistry notes 🎉').wait_for()
            right.reload()
            right.get_by_text('1 answer is waiting. Answer to see them.').wait_for()
            right.screenshot(path=str(OUT/'today-locked-mobile.png'))
            right.get_by_placeholder('Your answer…').fill('Basketball practice')
            right.get_by_role('button',name='Answer',exact=True).click()
            right.get_by_text('Finished the chemistry notes 🎉').wait_for()
            right.get_by_text('Streak secured for today. See you tomorrow!').wait_for()
            right.screenshot(path=str(OUT/'today-answered-mobile.png'),full_page=True)
            print('PASS answers stay hidden until you answer, then the shared streak completes')
            # Album with a photo upload.
            left.reload()
            left.get_by_role('tab',name='Albums').click()
            left.get_by_role('button',name='New album').click()
            left.get_by_label('Title').fill('Science fair')
            left.get_by_role('button',name='Create album').click()
            left.get_by_role('button',name='Science fair').click()
            left.locator('.circle-album-add input[type=file]').set_input_files({'name':'fair.png','mimeType':'image/png','buffer':PNG})
            left.wait_for_function("[...document.querySelectorAll('.circle-album-grid img')].filter(i=>i.complete&&i.naturalWidth>0).length===1",timeout=20000)
            left.screenshot(path=str(OUT/'album.png'))
            print('PASS albums upload a photo into the open album')
            left.get_by_role('tab',name='Feed').click()
            left.get_by_placeholder('Share something with Study crew…').fill('Library at 5?')
            left.get_by_role('button',name='Post',exact=True).click()
            left.get_by_text('Library at 5?').wait_for()
            left.get_by_role('tab',name='Members').click()
            left.get_by_text('Ece Yılmaz').wait_for()
            left.screenshot(path=str(OUT/'members.png'))
            left.goto(BASE+'/circles')
            left.locator('.circle-row').first.wait_for()
            assert left.locator('.circle-streak-chip.done').count()==1
            left.screenshot(path=str(OUT/'list.png'))
            right.goto(BASE+f'/circles/{circle_id}')
            right.get_by_role('heading',name='Study crew').wait_for()
            right.screenshot(path=str(OUT/'circle-mobile.png'))
            assert right.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
            print('PASS feed post, members, list streak badge and no horizontal overflow on a phone')
            assert not errors,errors
            browser.close()
            print('PASS no browser page errors')
    finally:
        for process in reversed(processes):
            process.terminate()
            try:process.wait(timeout=8)
            except subprocess.TimeoutExpired:process.kill()
        for log in logs:log.close()

if __name__=='__main__':run()
