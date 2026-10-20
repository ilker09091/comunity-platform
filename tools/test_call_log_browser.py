"""Call history entries in a DM and the mobile profile header, in both themes (isolated QA database)."""
import os, subprocess, tempfile, time, uuid
from pathlib import Path
import test_calls_browser as qa
from playwright.sync_api import sync_playwright

qa.DB='circle_call_log_test'
qa.OUT=qa.ROOT/'.tools/call-log-qa'
ROOT, BASE, API, OUT=qa.ROOT,qa.BASE,qa.API,qa.OUT

def run():
    OUT.mkdir(exist_ok=True)
    sql=lambda query,database=qa.DB:qa.sql(query,database)
    if not sql(f"SELECT 1 FROM pg_database WHERE datname='{qa.DB}'",'postgres'):sql(f'CREATE DATABASE {qa.DB}','postgres')
    env={**os.environ,'NODE_ENV':'production','PORT':'3014','DB_HOST':'127.0.0.1','DB_PORT':'55433','DB_USERNAME':'postgres','DB_PASSWORD':'','DB_NAME':qa.DB,
         'JWT_SECRET':'qa-calllog-access-unique-long-local-secret','JWT_REFRESH_SECRET':'qa-calllog-refresh-unique-long-local-secret',
         'PUBLIC_BASE_URL':API,'CORS_ORIGINS':BASE,'MEDIA_LOCAL_DIR':str(Path(tempfile.gettempdir())/'circle-calllog-media'),
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
            a,b=browser.new_context(),browser.new_context()
            def post(context,path,body=None):
                r=context.request.post(BASE+'/api/backend/api/'+path,data=body or {},headers={'X-Social-Client':'web','Origin':BASE})
                assert r.ok,(path,r.status,r.text());return r.json() if r.status!=204 else None
            stamp=str(int(time.time()))
            me=post(a,'auth/register',{'username':f'emre_{stamp}','email':f'emre_{stamp}@example.com','password':'qaPassword123!','displayName':'Emre Koç'})['user']
            peer=post(b,'auth/register',{'username':f'zeynep_{stamp}','email':f'zeynep_{stamp}@example.com','password':'qaPassword123!','displayName':'Zeynep Ak'})['user']
            post(a,f"users/{peer['id']}/follow");post(b,f"users/{me['id']}/follow")
            post(a,f"messages/{peer['id']}",{'content':'Calling you now'})
            for caller,callee,kind,status,seconds in [(me,peer,'audio','completed',754),(peer,me,'video','missed',None),(me,peer,'video','declined',None),(peer,me,'audio','completed',42)]:
                sql(f"""INSERT INTO direct_messages(sender_id,recipient_id,call_id,call_kind,call_status,call_duration_s,delivered_at,read_at)
                    VALUES('{caller['id']}','{callee['id']}','{uuid.uuid4()}','{kind}','{status}',{seconds if seconds is not None else 'NULL'},now(),now())""")
            state=a.storage_state()
            for theme in ['light','dark']:
                context=browser.new_context(storage_state=state,viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
                context.add_init_script(f"localStorage.setItem('circle-theme','{theme}');localStorage.setItem('circle:notify-dismissed',String(Date.now()));localStorage.setItem('circle:app-banner-dismissed',String(Date.now()))")
                page=context.new_page()
                page.goto(BASE+f"/messages?to={peer['username']}");page.locator('.dm-call-log').first.wait_for()
                page.wait_for_timeout(500)
                page.screenshot(path=str(OUT/f'chat-{theme}.png'))
                print(theme,page.evaluate("""()=>[...document.querySelectorAll('.dm-call-log')].map(n=>{const s=getComputedStyle(n),t=getComputedStyle(n.querySelector('strong'));return [n.textContent.trim().slice(0,30),s.backgroundColor,t.color,s.opacity,s.visibility];})"""))
                page.goto(BASE+f"/profile/{peer['username']}");page.wait_for_load_state('networkidle');page.wait_for_timeout(400)
                page.screenshot(path=str(OUT/f'profile-{theme}.png'))
                context.close()
            browser.close()
    finally:
        for process in reversed(processes):
            process.terminate()
            try:process.wait(timeout=8)
            except subprocess.TimeoutExpired:process.kill()
        for log in logs:log.close()

if __name__=='__main__':run()
