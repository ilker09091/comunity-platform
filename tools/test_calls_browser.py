"""Real Chromium WebRTC + responsive QA against isolated PostgreSQL/API/production Next.
Requires the existing .tools/tiktok Playwright installation and local PostgreSQL :55433.
Never uses the application's configured database or production accounts.
"""
import os, re, subprocess, sys, tempfile, time, urllib.request, uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/tiktok'))
from playwright.sync_api import sync_playwright

BASE='http://127.0.0.1:3015'
API='http://127.0.0.1:3014'
OUT=ROOT/'.tools/calls-qa'
PG=Path('C:/Program Files/PostgreSQL/18/bin/psql.exe')
DB='circle_calls_browser_test'
FLAGS=getattr(subprocess,'CREATE_NO_WINDOW',0)
def sql(query,database=DB):
    return subprocess.run([str(PG),'-h','127.0.0.1','-p','55433','-U','postgres','-d',database,'-At','-c',query],check=True,capture_output=True,text=True,creationflags=FLAGS).stdout.strip()
def wait(url,process):
    for _ in range(100):
        if process.poll() is not None: raise RuntimeError('QA server stopped; see .tools/calls-qa logs')
        try:
            with urllib.request.urlopen(url,timeout=2) as response:
                if response.status==200:return
        except Exception:pass
        time.sleep(.5)
    raise RuntimeError('QA server did not become ready')

def run():
    OUT.mkdir(exist_ok=True)
    if not sql("SELECT 1 FROM pg_database WHERE datname='circle_calls_browser_test'",'postgres'):
        sql('CREATE DATABASE circle_calls_browser_test','postgres')
    env={**os.environ,'NODE_ENV':'production','PORT':'3014','DB_HOST':'127.0.0.1','DB_PORT':'55433','DB_USERNAME':'postgres','DB_PASSWORD':'','DB_NAME':DB,
         'JWT_SECRET':'qa-call-access-unique-long-local-secret','JWT_REFRESH_SECRET':'qa-call-refresh-unique-long-local-secret',
         'PUBLIC_BASE_URL':API,'CORS_ORIGINS':BASE,'MEDIA_LOCAL_DIR':str(Path(tempfile.gettempdir())/'circle-calls-browser-qa-media'),'MEDIA_PUBLIC_URL':'/api/backend','THROTTLE_ENABLED':'false','MEDIA_CLEANUP_ENABLED':'false'}
    subprocess.run(['node','dist/database/migrate.js','run'],cwd=ROOT/'server',env=env,check=True,stdout=subprocess.DEVNULL,creationflags=FLAGS)
    sql('TRUNCATE users, admin_audit_logs, media_file_deletions, media_private_deletions CASCADE')
    logs=[open(OUT/'api.log','w',encoding='utf-8'),open(OUT/'web.log','w',encoding='utf-8')]
    processes=[]
    errors=[]
    try:
        processes.append(subprocess.Popen(['node','dist/main.js'],cwd=ROOT/'server',env=env,stdout=logs[0],stderr=subprocess.STDOUT,creationflags=FLAGS))
        wait(API+'/',processes[-1])
        webenv={**env,'PORT':'3015','API_ORIGIN':API,'APP_ORIGIN':BASE,'SESSION_COOKIE_SECURE':'false'}
        processes.append(subprocess.Popen(['node','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3015'],cwd=ROOT/'client',env=webenv,stdout=logs[1],stderr=subprocess.STDOUT,creationflags=FLAGS))
        wait(BASE,processes[-1])
        p=sync_playwright().start()
        browser=p.chromium.launch(channel='chrome',headless=True,args=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required'])
        contexts=[browser.new_context(viewport={'width':1440,'height':1000},permissions=['microphone','camera']) for _ in range(3)]
        for context in contexts:
            context.add_init_script('window.__qaPCs=[];window.RTCPeerConnection=class extends RTCPeerConnection{constructor(...args){super(...args);window.__qaPCs.push(this);}};')
        def request(context,path,body=None):
            response=context.request.post(BASE+'/api/backend/api/'+path,data=body or {},headers={'X-Social-Client':'web','Origin':BASE})
            assert response.ok,(path,response.status,response.text())
            return response.json() if response.status!=204 else None
        stamp=str(int(time.time()))
        users=[]
        for i,context in enumerate(contexts):
            users.append(request(context,'auth/register',{'username':f'callqa_{stamp}_{i}','email':f'callqa_{stamp}_{i}@example.com','password':'qaPassword123!','displayName':('A very long profile name for responsive checking' if i==0 else 'QA Friend')} )['user'])
        a,b,admin=users
        sql(f"UPDATE users SET role='ADMIN' WHERE id='{uuid.UUID(admin['id'])}'")
        request(contexts[1],f"users/{a['id']}/follow")
        request(contexts[0],f"users/{b['id']}/follow")
        request(contexts[0],f"messages/{b['id']}",{'content':'Hello from caller'})
        request(contexts[1],f"messages/{a['id']}",{'content':'Hello from recipient'})
        image=contexts[0].request.post(BASE+'/api/backend/api/media',headers={'X-Social-Client':'web','Origin':BASE},multipart={'file':{'name':'photo.jpeg','mimeType':'image/jpeg','buffer':(ROOT/'client/public/circlelogo.jpeg').read_bytes()}})
        assert image.ok,image.text()
        request(contexts[0],f"messages/{b['id']}",{'mediaId':image.json()['id']})
        avatar=contexts[1].request.post(BASE+'/api/backend/api/users/me/avatar',headers={'X-Social-Client':'web','Origin':BASE},multipart={'file':{'name':'avatar.jpeg','mimeType':'image/jpeg','buffer':(ROOT/'client/public/circlelogo.jpeg').read_bytes()}})
        assert avatar.ok,avatar.text()
        pages=[c.new_page() for c in contexts]
        for page in pages:page.on('pageerror',lambda error:errors.append(str(error)))
        left,right,staff=pages
        contexts[1].set_offline(True)
        left.goto(BASE+f"/messages?to={b['username']}")
        left.get_by_role('textbox',name='Message',exact=True).fill('Receipt device confirmation test')
        left.get_by_role('button',name='Send message',exact=True).click()
        receipt=left.locator('.dm-message.own').filter(has_text='Receipt device confirmation test')
        receipt.locator('.dm-ticks.sent').wait_for(timeout=15000)
        contexts[1].set_offline(False)
        right.goto(BASE+'/')
        receipt.locator('.dm-ticks.delivered').wait_for(timeout=20000)
        assert receipt.locator('.dm-ticks.read').count()==0
        right.goto(BASE+f"/messages?to={a['username']}")
        right.bring_to_front()
        receipt.locator('.dm-ticks.read').wait_for(timeout=15000)
        assert receipt.locator('.dm-ticks').evaluate('(n)=>getComputedStyle(n).color')=='rgb(7, 87, 188)'
        print('PASS offline single tick, device-acknowledged double tick and dark-blue read ticks')
        for page in [left,right]:page.get_by_role('button',name='Start voice call').wait_for()
        left.set_viewport_size({'width':390,'height':844})
        left.locator('.dm-compose-row input[type=file]').set_input_files(str(ROOT/'client/public/circlelogo.jpeg'))
        left.get_by_alt_text('Photo preview before sending',exact=True).wait_for()
        left.wait_for_function("document.querySelector('.dm-draft-media img')?.naturalWidth>0")
        left.screenshot(path=str(OUT/'photo-draft-mobile.png'))
        left.get_by_role('button',name='Enlarge photo preview',exact=True).click()
        left.get_by_role('dialog',name='Photo preview',exact=True).wait_for()
        left.get_by_role('button',name='Close dialog').click()
        left.wait_for_function('!document.querySelector("dialog[open]")')
        left.wait_for_function("document.querySelector('.dm-send:not(:disabled)')")
        left.get_by_role('button',name='Send message',exact=True).click()
        left.locator('.dm-attachment-preview').wait_for(state='hidden')
        left.get_by_role('button',name='Record voice message',exact=True).click()
        left.get_by_role('button',name='Stop recording',exact=True).wait_for()
        left.wait_for_timeout(1400)
        left.get_by_role('button',name='Stop recording',exact=True).click()
        left.get_by_role('button',name='Send voice message',exact=True).wait_for()
        left.wait_for_function("document.querySelector('audio[aria-label=\"Recording preview\"]')?.readyState>=2")
        left.screenshot(path=str(OUT/'voice-preview-mobile.png'))
        left.get_by_role('button',name='Send voice message',exact=True).click()
        left.locator('.dm-voice-capture').wait_for(state='hidden',timeout=25000)
        right.wait_for_function("document.querySelector('.dm-voice-message audio')?.readyState>=2",timeout=20000)
        right.locator('.dm-voice-message audio').evaluate('(audio)=>audio.play()')
        right.wait_for_function("document.querySelector('.dm-voice-message audio')?.currentTime>.1")
        left.get_by_role('button',name='Send a sticker',exact=True).click()
        library=left.get_by_role('dialog',name='Stickers',exact=True)
        library.get_by_role('tab',name='Your stickers',exact=True).click()
        library.locator('input[type=file]').set_input_files(str(ROOT/'client/public/circlelogo.jpeg'))
        library.get_by_role('button',name='Send circlelogo sticker',exact=True).wait_for(timeout=20000)
        assert library.evaluate('(d)=>Math.abs(d.getBoundingClientRect().height-innerHeight)<2 && Math.abs(d.getBoundingClientRect().width-innerWidth)<2')
        left.screenshot(path=str(OUT/'stickers-mobile.png'))
        library.get_by_role('button',name='Send circlelogo sticker',exact=True).click()
        right.get_by_role('button',name='Add circlelogo sticker to favorites',exact=True).wait_for(timeout=15000)
        right.get_by_role('button',name='Add circlelogo sticker to favorites',exact=True).click()
        right.get_by_role('button',name='Remove circlelogo sticker from favorites',exact=True).wait_for(timeout=15000)
        right.get_by_role('button',name='Send a sticker',exact=True).click()
        favorites=right.get_by_role('dialog',name='Stickers',exact=True)
        favorites.get_by_role('tab',name='Favorites',exact=True).click()
        favorites.get_by_role('button',name='Send circlelogo sticker',exact=True).click()
        left.locator('.dm-message:not(.own) .dm-sticker-message').wait_for(timeout=15000)
        print('PASS in-thread photo draft/enlargement, real MediaRecorder voice normalization/playback, custom sticker creation/favorite/reuse')
        post=request(contexts[0],'posts',{'content':'Fullscreen share QA '+stamp})
        left.goto(BASE+f"/post/{post['id']}")
        for width in [320,390,430,767]:
            left.set_viewport_size({'width':width,'height':844})
            left.get_by_role('button',name='Send to a user',exact=True).click()
            dialog=left.get_by_role('dialog',name='Send to',exact=True);dialog.wait_for()
            left.wait_for_timeout(300)
            assert dialog.evaluate('(d)=>Math.abs(d.getBoundingClientRect().height-innerHeight)<2 && Math.abs(d.getBoundingClientRect().width-innerWidth)<2'),width
            assert dialog.evaluate('(d)=>d.scrollWidth<=d.clientWidth+1'),width
            if width==390:left.screenshot(path=str(OUT/'share-fullscreen-mobile.png'))
            dialog.get_by_role('button',name='Close dialog',exact=True).click()
            left.wait_for_function('!document.querySelector("dialog[open]")')
            left.locator('.mobile-nav > input[type=file]').set_input_files(str(ROOT/'client/public/circlelogo.jpeg'))
            dialog=left.get_by_role('dialog',name='Create post',exact=True);dialog.wait_for()
            dialog.locator('.upload-progress').wait_for(state='hidden',timeout=20000)
            left.wait_for_timeout(300)
            assert dialog.evaluate('(d)=>Math.abs(d.getBoundingClientRect().height-innerHeight)<2 && Math.abs(d.getBoundingClientRect().width-innerWidth)<2'),width
            assert dialog.evaluate('(d)=>d.scrollWidth<=d.clientWidth+1'),width
            if width==390:left.screenshot(path=str(OUT/'post-fullscreen-mobile.png'))
            dialog.get_by_role('button',name='Close dialog',exact=True).click()
            left.wait_for_function('!document.querySelector("dialog[open]")')
        print('PASS share and post composers fill the mobile viewport at 320, 390, 430 and 767 pixels')
        left.set_viewport_size({'width':1440,'height':1000})
        left.goto(BASE+f"/messages?to={b['username']}")
        right.get_by_role('button',name='Open photo in conversation').last.click()
        right.get_by_role('dialog',name='Photo in conversation').wait_for()
        right.wait_for_function("document.querySelector('.photo-stage img')?.naturalWidth>0")
        assert right.url.endswith(a['username'])
        right.get_by_role('button',name='Zoom in',exact=True).click()
        assert '1.4' in right.locator('.photo-stage img').get_attribute('style')
        right.get_by_role('button',name='Reset zoom',exact=True).click()
        right.screenshot(path=str(OUT/'photo-desktop.png'))
        right.set_viewport_size({'width':390,'height':844})
        right.screenshot(path=str(OUT/'photo-mobile.png'))
        assert right.locator('.photo-viewer').evaluate('(d)=>d.scrollWidth<=d.clientWidth+1')
        right.get_by_role('button',name='Close dialog').click()
        right.set_viewport_size({'width':1440,'height':1000})
        right.wait_for_function('!document.querySelector("dialog[open]")')
        print('PASS DM photo opens inside the conversation without navigation')
        left.get_by_role('button',name='Start voice call').click()
        right.get_by_role('dialog',name='Incoming call').wait_for(timeout=15000)
        right.wait_for_timeout(350)
        right.screenshot(path=str(OUT/'call-incoming.png'))
        right.get_by_role('button',name='Answer',exact=True).click()
        for page in [left,right]:
            page.wait_for_function('''() => {const v=document.querySelector('.call-audio');return !!v?.srcObject?.getAudioTracks().length && v.currentTime>0.1;}''',timeout=45000)
            assert page.evaluate("Promise.all(window.__qaPCs.map(async p=>[...(await p.getStats()).values()].some(s=>s.type==='inbound-rtp'&&s.kind==='audio'&&s.packetsReceived>0))).then(values=>values.some(Boolean))")
        left.get_by_role('button',name='Mute',exact=True).click()
        assert left.evaluate("window.__qaPCs.at(-1).getSenders().filter(s=>s.track?.kind==='audio').every(s=>!s.track.enabled)")
        left.get_by_role('button',name='Unmute',exact=True).click()
        print('PASS real peer-to-peer audio, answer, mute and unmute in two authenticated browsers')
        for page in [left,right]:page.get_by_role('button',name='Camera on',exact=True).click()
        for page in [left,right]:
            page.bring_to_front()
            page.wait_for_function("document.querySelector('.call-remote').videoWidth>0",timeout=20000)
        for page in [left,right]:
            assert page.evaluate("Promise.all(window.__qaPCs.map(async p=>[...(await p.getStats()).values()].some(s=>s.type==='inbound-rtp'&&s.kind==='video'&&s.framesDecoded>0))).then(values=>values.some(Boolean))")
        left.get_by_role('button',name='Flip',exact=True).click()
        left.get_by_role('button',name='Camera off',exact=True).click()
        assert left.evaluate("window.__qaPCs.at(-1).getSenders().every(s=>s.track?.kind!=='video')")
        left.get_by_role('button',name='Camera on',exact=True).click()
        left.wait_for_timeout(300)
        left.screenshot(path=str(OUT/'video-desktop.png'))
        right.get_by_role('button',name='End call',exact=True).click()
        for page in [left,right]:page.wait_for_function('!document.querySelector(".call-dialog[open]")',timeout=10000)
        print('PASS upgrade audio to live video, camera switching and remote hangup')
        left.get_by_role('button',name='Start video call').click()
        right.get_by_role('dialog',name='Incoming call').wait_for(timeout=15000)
        right.get_by_role('button',name='Decline',exact=True).click()
        left.wait_for_function('!document.querySelector(".call-dialog[open]")',timeout=10000)
        print('PASS video-call decline releases the caller')
        left.get_by_role('button',name='Start video call').click()
        right.get_by_role('dialog',name='Incoming call').wait_for(timeout=15000)
        right.get_by_role('button',name='Answer',exact=True).click()
        for page in [left,right]:
            page.bring_to_front()
            page.wait_for_function("document.querySelector('.call-remote')?.videoWidth>0",timeout=20000)
        left.set_viewport_size({'width':390,'height':844})
        left.wait_for_timeout(300);left.screenshot(path=str(OUT/'video-mobile.png'))
        assert left.locator('.call-dialog').evaluate('(d)=>d.scrollWidth<=d.clientWidth+1')
        for width,height in [(320,568),(844,390)]:
            left.set_viewport_size({'width':width,'height':height})
            left.wait_for_timeout(100)
            for button in left.locator('.call-actions button').all():
                box=button.bounding_box()
                assert box and box['x']>=0 and box['x']+box['width']<=width+1 and box['y']+box['height']<=height+1,(width,height,box)
        right.get_by_role('button',name='End call',exact=True).click()
        for page in [left,right]:page.wait_for_function('!document.querySelector(".call-dialog[open]")',timeout=10000)
        left.set_viewport_size({'width':1440,'height':1000})
        print('PASS starting directly with video and mobile call layout')
        staff.goto(BASE+f"/admin/users/{a['id']}")
        staff.get_by_role('button',name='Delete account permanently',exact=True).click()
        dialog=staff.get_by_role('dialog',name=f"Delete @{a['username']} permanently")
        dialog.wait_for()
        for width in [1440,1024,768,390]:
            staff.set_viewport_size({'width':width,'height':844})
            box=dialog.bounding_box()
            assert box and box['x']>=0 and box['x']+box['width']<=width+1,(width,box)
            assert dialog.evaluate('(d)=>d.scrollWidth<=d.clientWidth+1'),width
        staff.wait_for_timeout(300)
        staff.screenshot(path=str(OUT/'delete-mobile.png'))
        staff.get_by_role('button',name='Close dialog').click()
        print('PASS permanent account deletion confirmation fits desktop, tablet and mobile')
        for width in [1440,1024,768,390]:
            right.set_viewport_size({'width':width,'height':844})
            right.get_by_label('Chat options',exact=True).click()
            menu=right.locator('.dm-chat-menu .dropdown-menu')
            box=menu.bounding_box()
            assert box and box['x']>=0 and box['x']+box['width']<=width+1 and box['y']+box['height']<=845,(width,box)
            right.get_by_role('button',name='Delete chat',exact=True).click()
            dialog=right.get_by_role('dialog',name='Delete this chat?');dialog.wait_for()
            assert dialog.evaluate('(d)=>d.scrollWidth<=d.clientWidth+1'),width
            right.wait_for_timeout(300)
            right.screenshot(path=str(OUT/f'dm-delete-{width}.png'))
            dialog.get_by_role('button',name='Cancel',exact=True).click()
            right.wait_for_function('!document.querySelector("dialog[open]")')
            assert right.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
        print('PASS chat/delete menus and confirmation dialogs stay inside all four viewport widths')
        left.goto(BASE+f"/profile/{b['username']}")
        photo=left.get_by_role('button',name=re.compile('Enlarge .*profile photo'))
        photo.click();left.get_by_role('dialog',name=re.compile('profile photo')).wait_for()
        left.get_by_role('button',name='Close dialog').click();left.wait_for_function('!document.querySelector("dialog[open]")')
        left.set_viewport_size({'width':390,'height':844})
        photo.dispatch_event('pointerdown',{'pointerType':'touch','clientX':50,'clientY':150})
        left.get_by_role('dialog',name=re.compile('profile photo')).wait_for()
        photo.dispatch_event('pointerup',{'pointerType':'touch'})
        left.screenshot(path=str(OUT/'profile-photo-mobile.png'))
        left.get_by_role('button',name='Close dialog').click();left.wait_for_function('!document.querySelector("dialog[open]")')
        print('PASS desktop profile-photo click and simulated mobile long-press enlarge in place')
        # Real API privacy transition while the blocked user's profile is open.
        left.goto(BASE+f"/profile/{b['username']}")
        request(contexts[1],f"users/{a['id']}/block")
        left.get_by_role('heading',name='Kullanıcı bulunamadı').wait_for(timeout=20000)
        left.wait_for_function("!document.querySelector('.ig-profile-header')",timeout=20000)
        print('PASS already-open blocked profile disappears on revalidation')
        left.goto(BASE+f"/messages?to={b['username']}")
        left.get_by_text("You can't message this account",exact=True).wait_for(timeout=15000)
        left.get_by_text('Hello from caller',exact=True).wait_for(timeout=15000)
        assert left.get_by_role('textbox',name='Message',exact=True).count()==0
        left.screenshot(path=str(OUT/'blocked-chat.png'))
        right.goto(BASE+f"/messages?to={a['username']}")
        right.get_by_text('You blocked this account',exact=True).wait_for(timeout=15000)
        right.get_by_role('button',name='Unblock',exact=True).click()
        dialog=right.get_by_role('dialog',name='Unblock this account?')
        dialog.get_by_role('button',name='Unblock',exact=True).click()
        right.get_by_role('textbox',name='Message',exact=True).wait_for(timeout=15000)
        left.get_by_role('textbox',name='Message',exact=True).wait_for(timeout=15000)
        right.get_by_label('Chat options',exact=True).click()
        right.get_by_role('button',name='Block account',exact=True).click()
        dialog=right.get_by_role('dialog',name='Block this account?')
        dialog.screenshot(path=str(OUT/'block-confirmation.png'))
        dialog.get_by_role('button',name='Block',exact=True).click()
        right.get_by_text('You blocked this account',exact=True).wait_for(timeout=15000)
        left.get_by_text("You can't message this account",exact=True).wait_for(timeout=15000)
        print('PASS blocked chats retain history, hide identity/presence and disable contact; unblock restores the composer')
        # Native MP4 decoding and identity preservation across the preloaded-to-selected transition.
        video=OUT/'tiny.mp4'
        subprocess.run([str(ROOT/'server/node_modules/ffmpeg-static/ffmpeg.exe'),'-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc=size=180x320:rate=15','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',str(video)],check=True,creationflags=FLAGS)
        for i in range(3):
            uploaded=contexts[2].request.post(BASE+'/api/backend/api/media',headers={'X-Social-Client':'web','Origin':BASE},multipart={'file':{'name':'tiny.mp4','mimeType':'video/mp4','buffer':video.read_bytes()}})
            assert uploaded.ok,uploaded.text()
            media=uploaded.json()
            for _ in range(100):
                media=contexts[2].request.get(BASE+f"/api/backend/api/media/{media['id']}").json()
                if media['status']=='READY':break
                time.sleep(.2)
            assert media['status']=='READY'
            request(contexts[2],'posts',{'content':f'QA reel {stamp} {i}','mediaIds':[media['id']]})
        staff.set_viewport_size({'width':1440,'height':1000})
        staff.goto(BASE+'/reels')
        staff.wait_for_function("document.querySelector('.reel-slide[aria-hidden=false] video')?.currentTime>0",timeout=30000)
        staff.wait_for_function("document.querySelectorAll('.reel-slide video').length>=2 && document.querySelectorAll('.reel-slide video')[1].readyState>=2",timeout=20000)
        staff.evaluate("window.__qaWarm=document.querySelectorAll('.reel-slide video')[1]")
        began=time.monotonic();staff.get_by_role('button',name='Next reel',exact=True).click()
        staff.wait_for_function("document.querySelector('.reel-slide[aria-hidden=false] video')===window.__qaWarm && window.__qaWarm.currentTime>0",timeout=15000)
        latency=round((time.monotonic()-began)*1000)
        staff.screenshot(path=str(OUT/'reels-warm-transition.png'))
        print(f'PASS native Reels decoding: warmed video is retained on selection ({latency} ms local transition)')
        assert not errors,errors
        browser.close()
    except Exception:
        if 'pages' in locals():
            for i,page in enumerate(pages):
                try:
                    print('QA DIAGNOSTICS',i,page.evaluate("({text:document.body.innerText.slice(-1200),pcs:window.__qaPCs?.map(p=>({state:p.connectionState,ice:p.iceConnectionState,signaling:p.signalingState,senders:p.getSenders().map(s=>({kind:s.track?.kind,state:s.track?.readyState})),receivers:p.getReceivers().map(s=>({kind:s.track?.kind,state:s.track?.readyState,muted:s.track?.muted}))}))})"))
                    page.screenshot(path=str(OUT/f'failure-{i}.png'))
                except Exception:pass
        raise
    finally:
        for process in reversed(processes):
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill()
        for log in logs:log.close()
        if "p" in locals():p.stop()

if __name__=='__main__':run()
