"""Mobile interaction and group/share QA. Uses only isolated local test data."""
import os, subprocess, tempfile, time, uuid
from pathlib import Path
import test_calls_browser as qa
from test_gifs_replies_browser import png
from playwright.sync_api import sync_playwright

qa.DB='circle_messaging_browser_test'
qa.OUT=qa.ROOT/'.tools/messaging-upgrade-qa'
ROOT,BASE,API,OUT=qa.ROOT,qa.BASE,qa.API,qa.OUT

def run():
    OUT.mkdir(exist_ok=True)
    sql=lambda query,database=qa.DB:qa.sql(query,database)
    if not sql(f"SELECT 1 FROM pg_database WHERE datname='{qa.DB}'",'postgres'):sql(f'CREATE DATABASE {qa.DB}','postgres')
    env={**os.environ,'NODE_ENV':'production','PORT':'3014','DB_HOST':'127.0.0.1','DB_PORT':'55433','DB_USERNAME':'postgres','DB_PASSWORD':'','DB_NAME':qa.DB,
         'JWT_SECRET':'qa-message-access-unique-long-local-secret','JWT_REFRESH_SECRET':'qa-message-refresh-unique-long-local-secret',
         'PUBLIC_BASE_URL':API,'CORS_ORIGINS':BASE,'MEDIA_LOCAL_DIR':str(Path(tempfile.gettempdir())/'circle-messaging-browser-qa-media'),'MEDIA_PUBLIC_URL':'/api/backend',
         'THROTTLE_ENABLED':'false','MEDIA_CLEANUP_ENABLED':'false','CALL_TURN_URLS':'','CALL_TURN_SECRET':'','CALL_TURN_SECRET_FILE':str(OUT/'turn/key')}
    subprocess.run(['node','dist/database/migrate.js','run'],cwd=ROOT/'server',env=env,check=True,stdout=subprocess.DEVNULL,creationflags=qa.FLAGS)
    sql('TRUNCATE users, circles, admin_audit_logs, media_file_deletions CASCADE')
    logs=[open(OUT/'api.log','w',encoding='utf-8'),open(OUT/'web.log','w',encoding='utf-8')]
    processes=[]
    try:
        processes.append(subprocess.Popen(['node','dist/main.js'],cwd=ROOT/'server',env=env,stdout=logs[0],stderr=subprocess.STDOUT,creationflags=qa.FLAGS));qa.wait(API+'/',processes[-1])
        processes.append(subprocess.Popen(['node','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3015'],cwd=ROOT/'client',env={**env,'PORT':'3015','API_ORIGIN':API,'APP_ORIGIN':BASE,'SESSION_COOKIE_SECURE':'false'},stdout=logs[1],stderr=subprocess.STDOUT,creationflags=qa.FLAGS));qa.wait(BASE,processes[-1])
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome',headless=True)
            contexts=[browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True),browser.new_context(),browser.new_context()]
            for context in contexts:context.add_init_script("localStorage.setItem('circle-theme','light');localStorage.setItem('circle:notify-dismissed',String(Date.now()));localStorage.setItem('circle:app-banner-dismissed',String(Date.now()))")
            def post(context,path,body=None,multipart=None):
                response=context.request.post(BASE+'/api/backend/api/'+path,headers={'X-Social-Client':'web','Origin':BASE},**({'multipart':multipart} if multipart else {'data':body or {}}))
                assert response.ok,(path,response.status,response.text());return response.json() if response.status!=204 else None
            stamp=str(int(time.time()))
            users=[post(context,'auth/register',{'username':f'messageqa_{stamp}_{i}','email':f'messageqa_{stamp}_{i}@example.com','password':'qaPassword123!','displayName':['Lale QA','Kerem QA','Deniz QA'][i]})['user'] for i,context in enumerate(contexts)]
            a,b,c=users
            for i in (1,2):
                post(contexts[0],f"users/{users[i]['id']}/follow");post(contexts[i],f"users/{a['id']}/follow")
                post(contexts[i],f"messages/{a['id']}",{'content':'Ready to chat'})
                post(contexts[0],f"messages/{users[i]['id']}",{'content':'Hello friend'})
            sql(f"INSERT INTO direct_messages(sender_id,recipient_id,content,created_at) SELECT '{uuid.UUID(a['id'])}','{uuid.UUID(b['id'])}','Older message '||n,now()-interval '10 minutes'+n*interval '1 second' FROM generate_series(1,75) n")
            link=post(contexts[0],f"messages/{b['id']}",{'content':'Visit https://example.com/help, and www.example.org. javascript:alert(1)'})
            post(contexts[1],'notes',{'text':'Coffee later?'});
            post(contexts[0],'users/me/cover',multipart={'file':{'name':'cover.png','mimeType':'image/png','buffer':png()}})
            circle=post(contexts[0],'circles',{'name':'QA Close Friends','emoji':'🌸','color':'#7c5cff'})
            page=contexts[0].new_page();friend=contexts[1].new_page();errors=[]
            for view in [page,friend]:view.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(BASE+f"/messages?to={b['username']}");page.locator(f"#msg-{link['id']} .dm-message-text a").first.wait_for()
            message=page.locator(f"#msg-{link['id']}")
            assert message.locator('a[href="https://example.com/help"]').count()==1
            assert message.locator('a[href="https://www.example.org/"]').count()==1
            assert message.locator('a[href^="javascript:"]').count()==0
            # A real touch long-press can be dismissed on the backdrop, repeatedly.
            cdp=contexts[0].new_cdp_session(page)
            page.evaluate('''()=>{window.__touchLog=[];for(const type of ['pointerdown','pointerup','pointercancel','contextmenu','scroll'])document.addEventListener(type,event=>window.__touchLog.push({type,target:event.target?.className,pointer:event.pointerType}),true);new MutationObserver(()=>{const menu=!!document.querySelector('.dm-menu-layer');if(menu!==window.__menuWas){window.__touchLog.push({menu,time:Date.now()});window.__menuWas=menu;}}).observe(document.body,{childList:true,subtree:true});}''')
            def long_press(node):
                node.scroll_into_view_if_needed();box=node.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
                cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]});page.wait_for_timeout(550)
                cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
                try:page.locator('.dm-message-menu.sheet').wait_for(timeout=5000)
                except Exception:
                    print('TOUCH DEBUG',box,page.evaluate('window.__touchLog'));page.screenshot(path=str(OUT/'touch-failure.png'));raise
            for _ in range(2):
                long_press(message.locator('.dm-stamp'))
                page.locator('.dm-menu-layer').tap(position={'x':10,'y':100})
                page.wait_for_function('!document.querySelector(".dm-menu-layer")');page.wait_for_timeout(550)
                assert page.locator('.dm-menu-layer').count()==0
            long_press(message.locator('.dm-stamp'));page.get_by_role('menuitem',name='Edit message',exact=True).click()
            page.get_by_role('textbox',name='Message',exact=True).fill('Edited on mobile https://example.com/new')
            page.get_by_role('button',name='Save edit',exact=True).click()
            message.get_by_text('Edited on mobile',exact=False).wait_for();message.locator('.dm-edited').wait_for()
            friend.goto(BASE+f"/messages?to={a['username']}");friend.locator('.dm-thread').get_by_text('Edited on mobile',exact=False).wait_for()
            assert page.locator('.dm-compose-row [aria-label="Attach photo or video"]:visible').count()==1
            page.get_by_role('textbox',name='Message',exact=True).fill('Icons hide while typing')
            assert not page.get_by_role('button',name='Attach photo or video').is_visible()
            assert page.get_by_role('button',name='Send message',exact=True).is_visible()
            page.get_by_role('textbox',name='Message',exact=True).fill('')
            print('PASS touch menu dismisses without Cancel, editing syncs, links are actionable and composer icons adapt')
            # Scroll history to its leading sentinel: no click on Load more.
            count=page.locator('.dm-message').count()
            page.locator('.dm-scroll').evaluate('(element)=>element.scrollTop=0')
            page.wait_for_function('(count)=>document.querySelectorAll(".dm-message").length>count',arg=count,timeout=15000)
            page.locator('.dm-scroll').evaluate('(element)=>element.scrollTop=0')
            page.wait_for_function('!!Array.from(document.querySelectorAll(".dm-message")).find(n=>n.textContent.includes("Older message 1"))',timeout=15000)
            print('PASS older history loads automatically on scroll')
            page.goto(BASE+'/messages');page.locator('.note-tile').filter(has_text='Coffee later?').click()
            page.get_by_role('textbox',name=f"Reply to {b['username']}").fill('Yes, coffee!')
            page.get_by_role('button',name='Send reply',exact=True).click();page.wait_for_url(f"**/messages?to={b['username']}")
            page.locator('.dm-thread').get_by_text('Yes, coffee!',exact=True).wait_for();page.locator('.dm-thread').get_by_text('Coffee later?',exact=True).wait_for()
            print('PASS note replies open the DM with the original note snapshot')
            page.goto(BASE+'/messages');page.get_by_role('button',name='New group chat',exact=True).click()
            dialog=page.get_by_role('dialog',name='New group chat',exact=True)
            dialog.get_by_role('textbox',name='Group name',exact=True).fill('Weekend crew')
            for person in [b,c]:
                dialog.get_by_role('textbox',name='Search recipients').fill(person['username'])
                dialog.locator('.recipient-row').filter(has_text=person['username']).click()
            dialog.get_by_role('button',name='Create group',exact=False).click();page.wait_for_url('**/messages?group=*')
            group_id=page.url.split('group=')[1]
            page.get_by_role('textbox',name='Message',exact=True).fill('Hello from our new group')
            page.get_by_role('button',name='Send message',exact=True).click();page.locator('.dm-thread').get_by_text('Hello from our new group',exact=True).wait_for()
            friend.goto(BASE+f'/messages?group={group_id}');friend.locator('.dm-thread').get_by_text('Hello from our new group',exact=True).wait_for()
            friend.get_by_role('textbox',name='Message',exact=True).fill('Hello Lale!');friend.get_by_role('button',name='Send message',exact=True).click();page.locator('.dm-thread').get_by_text('Hello Lale!',exact=True).wait_for(timeout=12000)
            page.screenshot(path=str(OUT/'group-mobile.png'))
            for width,height in [(320,568),(390,844),(844,390),(1440,1000)]:
                page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(150)
                assert page.locator('.dm-thread').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),(width,height)
                box=page.locator('.dm-compose-row').bounding_box();assert box and box['x']>=0 and box['x']+box['width']<=width+1 and box['y']+box['height']<=height+1,(width,height,box)
            page.set_viewport_size({'width':390,'height':844})
            page.get_by_role('button',name='Group details',exact=True).click();page.get_by_role('textbox',name='Rename group').fill('Renamed weekend');page.get_by_role('button',name='Save',exact=True).click();page.get_by_role('button',name='Close dialog',exact=True).click()
            print('PASS group creation, two-peer messaging, settings and 320px/390px/landscape/desktop bounds')
            page.goto(BASE+f"/circles/{circle['id']}");page.get_by_role('button',name='Invite',exact=True).click();page.get_by_role('button',name='Send in Circle',exact=True).click()
            share=page.get_by_role('dialog',name='Send Circle invite',exact=True)
            share.get_by_role('textbox',name='Search recipients').fill(b['username']);share.locator('.recipient-row').filter(has_text=b['username']).click()
            share.get_by_role('tab',name='Groups',exact=True).click();share.get_by_role('button',name='Renamed weekend',exact=False).click()
            share.get_by_role('button',name='Send · 2',exact=True).click();share.wait_for(state='hidden')
            friend.goto(BASE+f'/messages?group={group_id}');invite=friend.locator(f'a[href="/circles/join/{circle["inviteCode"]}"]').first;invite.wait_for();invite.click()
            friend.wait_for_url('**/circles/join/*');friend.get_by_role('button',name='Join circle',exact=True).click();friend.wait_for_url(f"**/circles/{circle['id']}")
            check=contexts[1].request.get(BASE+f"/api/backend/api/messages/{a['id']}");assert circle['inviteCode'] in check.text()
            print('PASS Circle invite sent to both DM and group, opens inside app and recipient joins')
            page.goto(BASE+f"/profile/{a['username']}");page.locator('.ig-profile-cover img').wait_for();page.wait_for_function('document.querySelector(".ig-profile-cover img")?.naturalWidth>0')
            assert page.locator('.ig-profile-cover').is_visible()
            assert page.locator('.ig-profile-cover').bounding_box()['height']>=130
            assert page.locator('body').evaluate('(n)=>getComputedStyle(n).backgroundColor')=='rgb(255, 255, 255)'
            assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
            page.screenshot(path=str(OUT/'profile-mobile.png'))
            print('PASS mobile profile banner and white light-mode background without horizontal overflow')
            assert not errors,errors
            browser.close();print('PASS no browser page errors')
    finally:
        for process in reversed(processes):
            process.terminate()
            try:process.wait(timeout=8)
            except subprocess.TimeoutExpired:process.kill()
        for log in logs:log.close()

if __name__=='__main__':run()
