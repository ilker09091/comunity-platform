"""Two real Chrome peers: screen capture, camera-off, navigation and recovery.
Uses only the isolated local QA database and synthetic microphone/camera.
"""
import os, subprocess, tempfile, time
from pathlib import Path
import test_calls_browser as qa
from playwright.sync_api import sync_playwright

qa.DB='circle_call_experience_test'
qa.OUT=qa.ROOT/'.tools/call-experience-qa'
ROOT, BASE, API, OUT=qa.ROOT,qa.BASE,qa.API,qa.OUT

def packets(page):
    return page.evaluate("async()=>[...(await window.__qaPCs.at(-1).getStats()).values()].filter(s=>s.type==='inbound-rtp'&&s.kind==='audio').reduce((n,s)=>n+(s.packetsReceived||0),0)")

def connected(page):
    page.wait_for_function("window.__qaPCs.at(-1)?.connectionState==='connected' && document.querySelector('.call-person [role=status]')?.textContent.match(/^\\d+:\\d+/)",timeout=45000)

def run():
    OUT.mkdir(exist_ok=True)
    # Pass database explicitly: the imported helper's default argument is bound at definition.
    sql=lambda query,database=qa.DB:qa.sql(query,database)
    if not sql(f"SELECT 1 FROM pg_database WHERE datname='{qa.DB}'",'postgres'):
        sql(f'CREATE DATABASE {qa.DB}','postgres')
    env={**os.environ,'NODE_ENV':'production','PORT':'3014','DB_HOST':'127.0.0.1','DB_PORT':'55433','DB_USERNAME':'postgres','DB_PASSWORD':'','DB_NAME':qa.DB,
         'JWT_SECRET':'qa-call-access-unique-long-local-secret','JWT_REFRESH_SECRET':'qa-call-refresh-unique-long-local-secret',
         'PUBLIC_BASE_URL':API,'CORS_ORIGINS':BASE,'MEDIA_LOCAL_DIR':str(Path(tempfile.gettempdir())/'circle-call-experience-media'),
         'MEDIA_PUBLIC_URL':'/api/backend','THROTTLE_ENABLED':'false','MEDIA_CLEANUP_ENABLED':'false','CALL_TURN_URLS':'','CALL_TURN_SECRET':'',
         'CALL_TURN_SECRET_FILE':str(OUT/'turn-control/key')}
    subprocess.run(['node','dist/database/migrate.js','run'],cwd=ROOT/'server',env=env,check=True,stdout=subprocess.DEVNULL,creationflags=qa.FLAGS)
    sql('TRUNCATE users, admin_audit_logs, media_file_deletions, media_private_deletions CASCADE')
    logs=[open(OUT/'api.log','w',encoding='utf-8'),open(OUT/'web.log','w',encoding='utf-8')]
    processes=[]
    try:
        processes.append(subprocess.Popen(['node','dist/main.js'],cwd=ROOT/'server',env=env,stdout=logs[0],stderr=subprocess.STDOUT,creationflags=qa.FLAGS))
        qa.wait(API+'/',processes[-1])
        key=(OUT/'turn-control/key').read_text().strip()
        assert len(key)==64
        print('PASS API automatically initializes the persistent TURN key before serving requests')
        processes.append(subprocess.Popen(['node','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3015'],cwd=ROOT/'client',env={**env,'PORT':'3015','API_ORIGIN':API,'APP_ORIGIN':BASE,'SESSION_COOKIE_SECURE':'false'},stdout=logs[1],stderr=subprocess.STDOUT,creationflags=qa.FLAGS))
        qa.wait(BASE,processes[-1])
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome',headless=True,args=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--auto-select-tab-capture-source-by-title=Circle capture QA'])
            contexts=[browser.new_context(viewport={'width':1440,'height':1000},permissions=['microphone','camera']) for _ in range(2)]
            for context in contexts:
                context.add_init_script('''window.__qaPCs=[];window.__qaRestarts=0;
                    window.__qaStops=[];const stop=MediaStreamTrack.prototype.stop;MediaStreamTrack.prototype.stop=function(){window.__qaStops.push({id:this.id,kind:this.kind,stack:new Error().stack});return stop.call(this);};
                    window.__qaCapture=[];const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...a)=>{const stream=await gum(...a);for(const t of stream.getTracks()){window.__qaCapture.push({event:'acquired',id:t.id,kind:t.kind,ready:t.readyState,settings:t.getSettings()});t.addEventListener('ended',()=>window.__qaCapture.push({event:'ended',id:t.id,time:Date.now()}));}return stream;};
                    window.RTCPeerConnection=class extends RTCPeerConnection{constructor(...a){super(...a);window.__qaPCs.push(this);}restartIce(){window.__qaRestarts++;super.restartIce();}};''')
            def post(context,path,body=None):
                r=context.request.post(BASE+'/api/backend/api/'+path,data=body or {},headers={'X-Social-Client':'web','Origin':BASE})
                assert r.ok,(path,r.status,r.text())
                return r.json() if r.status!=204 else None
            stamp=str(int(time.time()))
            users=[post(c,'auth/register',{'username':f'callexp_{stamp}_{i}','email':f'callexp_{stamp}_{i}@example.com','password':'qaPassword123!','displayName':'QA Caller' if i==0 else 'QA Friend'})['user'] for i,c in enumerate(contexts)]
            for i in range(2):
                peer=users[1-i]
                post(contexts[i],f"users/{peer['id']}/follow")
                post(contexts[i],f"messages/{peer['id']}",{'content':'Call QA'})
            left,right=[c.new_page() for c in contexts]
            errors=[]
            for page,peer in [(left,users[1]),(right,users[0])]:
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.goto(BASE+f"/messages?to={peer['username']}")
                page.get_by_role('button',name='Start voice call').wait_for()
            left.evaluate("document.title='Circle capture QA'")
            config_failures=[0]
            def flaky_config(route):
                config_failures[0]+=1
                if config_failures[0]<=2:route.abort()
                else:route.continue_()
            contexts[1].route('**/api/backend/api/calls/config',flaky_config)
            left.get_by_role('button',name='Start voice call').click()
            right.get_by_role('button',name='Answer',exact=True).click(timeout=15000)
            for page in [left,right]:
                connected(page)
                page.wait_for_function("document.querySelector('.call-audio')?.currentTime>0.1")
            assert packets(left)>0 and packets(right)>0
            assert config_failures[0]>=3
            print('PASS two real WebRTC audio peers, including temporary config failures while accepting')
            for page in [left,right]:page.get_by_role('button',name='Camera on',exact=True).click()
            for page in [left,right]:
                page.bring_to_front()
                try:page.wait_for_function("document.querySelector('.call-remote')?.dataset.videoActive==='true' && document.querySelector('.call-remote').videoWidth>0",timeout=20000)
                except Exception:
                    for peer in [left,right]:
                        print('VIDEO DEBUG',peer.evaluate('''()=>({type:document.querySelector('.call-type')?.textContent,stops:window.__qaStops,capture:window.__qaCapture,video:{active:document.querySelector('.call-remote')?.dataset.videoActive,width:document.querySelector('.call-remote')?.videoWidth},pcs:window.__qaPCs.map(p=>({state:p.connectionState,send:p.getSenders().map(s=>({id:s.track?.id,kind:s.track?.kind,ready:s.track?.readyState})),recv:p.getReceivers().map(r=>({kind:r.track.kind,muted:r.track.muted,ready:r.track.readyState}))}))})'''))
                    raise
            right.evaluate('window.__audioElement=document.querySelector(".call-audio");window.__audioSource=window.__audioElement.srcObject')
            before=packets(right)
            for page in [left,right]:page.get_by_role('button',name='Camera off',exact=True).click()
            for page in [left,right]:
                page.wait_for_function("document.querySelector('.call-remote')?.dataset.videoActive==='false' && document.querySelector('.call-type')?.textContent==='Voice call'")
                assert page.locator('.call-person .avatar').is_visible()
            assert right.evaluate('document.querySelector(".call-audio")===window.__audioElement && window.__audioElement.srcObject===window.__audioSource')
            right.wait_for_function("document.querySelector('.call-audio').currentTime>0.5")
            assert packets(right)>before
            print('PASS camera off restores voice view and preserves the playing audio element')
            # Native getDisplayMedia API with Chrome's automated capture source.
            frames=right.evaluate("async()=>[...(await window.__qaPCs.at(-1).getStats()).values()].filter(s=>s.type==='inbound-rtp'&&s.kind==='video').reduce((n,s)=>n+(s.framesDecoded||0),0)")
            left.get_by_role('button',name='Share screen',exact=True).click()
            left.get_by_role('button',name='Stop sharing',exact=True).wait_for(timeout=20000)
            right.wait_for_function("document.querySelector('.viewing-screen .call-remote')?.dataset.videoActive==='true'",timeout=20000)
            assert left.evaluate("window.__qaPCs.at(-1).getSenders().some(s=>s.track?.kind==='video'&&!!s.track.getSettings().displaySurface)")
            right.wait_for_function("document.querySelector('.call-remote').videoWidth>0")
            right.wait_for_function("async before=>[...(await window.__qaPCs.at(-1).getStats()).values()].filter(s=>s.type==='inbound-rtp'&&s.kind==='video').reduce((n,s)=>n+(s.framesDecoded||0),0)>before",arg=frames)
            assert right.locator('.call-remote').evaluate('(n)=>getComputedStyle(n).objectFit')=='contain'
            left.evaluate('window.__screenTrack=window.__qaPCs.at(-1).getSenders().find(s=>s.track?.kind==="video").track;window.__shareMic=window.__qaPCs.at(-1).getSenders().find(s=>s.track?.kind==="audio").track')
            for quality,width,fps in [('720p 30 FPS',1280,30),('720p 60 FPS',1280,60),('1080p 30 FPS',1920,30),('1080p 60 FPS',1920,60)]:
                left.get_by_role('button',name=quality,exact=True).click()
                left.wait_for_function('label=>{const b=document.querySelector(`button[aria-label="${label}"]`);return b?.getAttribute("aria-pressed")==="true"&&!b.disabled;}',arg=quality)
                assert left.evaluate('({width,fps})=>{const c=window.__screenTrack.getConstraints();return c.width.max===width&&c.frameRate.max===fps;}',{'width':width,'fps':fps})
                assert left.evaluate('window.__qaPCs.at(-1).getSenders().some(s=>s.track===window.__screenTrack)&&window.__shareMic.readyState==="live"')
            for width,height in [(390,844),(320,568),(844,390)]:
                left.set_viewport_size({'width':width,'height':height})
                left.wait_for_timeout(150)
                panel=left.locator('.call-share-settings').bounding_box()
                assert panel and panel['x']>=0 and panel['y']>=0 and panel['x']+panel['width']<=width+1 and panel['y']+panel['height']<=height+1,(width,height,panel)
                for button in left.locator('.call-actions button').all():
                    box=button.bounding_box()
                    assert box and (box['y']+box['height']<=panel['y'] or box['y']>=panel['y']+panel['height'] or box['x']+box['width']<=panel['x'] or box['x']>=panel['x']+panel['width']),(panel,box)
                left.screenshot(path=str(OUT/f'sharing-quality-{width}x{height}.png'))
            left.set_viewport_size({'width':1440,'height':1000})
            left.get_by_role('button',name='Minimize call',exact=True).click()
            assert not left.locator('.call-share-settings').is_visible()
            left.get_by_role('button',name='Restore call',exact=True).click()
            assert left.get_by_role('button',name='1080p 60 FPS',exact=True).get_attribute('aria-pressed')=='true'
            print('PASS four live sharing presets, unchanged capture/microphone, responsive quality panel and minimize/restore')
            left.wait_for_timeout(250)
            left.screenshot(path=str(OUT/'sharing-desktop.png'))
            left.get_by_role('button',name='Stop sharing',exact=True).click()
            right.wait_for_function("document.querySelector('.call-type')?.textContent==='Voice call'")
            print('PASS browser getDisplayMedia capture, decoded remote frames and stop sharing from voice call')
            left.get_by_role('button',name='Camera on',exact=True).click()
            left.get_by_role('button',name='Share screen',exact=True).click()
            left.get_by_role('button',name='Stop sharing',exact=True).wait_for()
            left.get_by_role('button',name='Stop sharing',exact=True).click()
            left.get_by_role('button',name='Camera off',exact=True).wait_for()
            assert left.evaluate("window.__qaPCs.at(-1).getSenders().some(s=>s.track?.kind==='video'&&!s.track.getSettings().displaySurface)")
            print('PASS screen sharing restores the previous camera')
            # Keep the same peer, DOM audio node and stream while navigating with Next Link.
            left.evaluate('window.__callPeer=window.__qaPCs.at(-1);window.__callAudio=document.querySelector(".call-audio");window.__callSource=window.__callAudio.srcObject')
            before=packets(left)
            left.get_by_role('button',name='Minimize call',exact=True).click()
            assert not left.locator('.call-dialog').evaluate('(d)=>d.matches(":modal")')
            left.locator('a[href="/explore"]').first.click()
            left.wait_for_url('**/explore')
            assert left.evaluate('window.__qaPCs.at(-1)===window.__callPeer && document.querySelector(".call-audio")===window.__callAudio && window.__callAudio.srcObject===window.__callSource')
            left.screenshot(path=str(OUT/'minimized-navigation.png'))
            left.get_by_role('button',name='Restore call',exact=True).click()
            assert left.locator('.call-dialog').evaluate('(d)=>d.matches(":modal")')
            assert packets(left)>before
            print('PASS minimized call stays alive through client navigation and restore')
            # A signaling outage must not hang up an otherwise viable media connection.
            contexts[0].set_offline(True)
            left.wait_for_timeout(5000)
            assert left.locator('.call-dialog[open]').count()==1
            contexts[0].set_offline(False)
            left.evaluate('window.dispatchEvent(new Event("online"))')
            for page in [left,right]:connected(page)
            assert left.evaluate('window.__qaRestarts>0')
            before=packets(right)
            right.wait_for_timeout(1200)
            assert packets(right)>before
            print('PASS short signaling outage recovers with ICE restart and live audio')
            for width,height in [(390,844),(320,568),(844,390)]:
                left.set_viewport_size({'width':width,'height':height})
                left.wait_for_timeout(200)
                for button in left.locator('.call-actions button').all():
                    box=button.bounding_box()
                    assert box and box['x']>=0 and box['y']>=0 and box['x']+box['width']<=width+1 and box['y']+box['height']<=height+1,(width,height,box)
                assert left.locator('.call-dialog').evaluate('(d)=>d.scrollWidth<=d.clientWidth+1')
                left.screenshot(path=str(OUT/f'call-{width}x{height}.png'))
                left.get_by_role('button',name='Minimize call',exact=True).click()
                left.wait_for_timeout(200)
                box=left.locator('.call-dialog').bounding_box()
                assert box and box['x']>=0 and box['y']>=0 and box['x']+box['width']<=width+1 and box['y']+box['height']<=height+1,box
                left.get_by_role('button',name='Restore call',exact=True).click()
            print('PASS 320px, 390px and landscape call controls and mini window bounds')
            right.get_by_role('button',name='End call',exact=True).click()
            for page in [left,right]:
                page.wait_for_function('!document.querySelector(".call-dialog[open]")')
                assert page.evaluate("window.__qaPCs.every(p=>p.connectionState==='closed')")
            left.goto(BASE+f"/messages?to={users[1]['username']}")
            left.get_by_role('button',name='Start video call',exact=True).click()
            right.get_by_role('button',name='Answer',exact=True).click(timeout=15000)
            for page in [left,right]:
                page.bring_to_front();connected(page)
                page.wait_for_function("document.querySelector('.call-remote')?.dataset.videoActive==='true'")
            for page in [left,right]:page.get_by_role('button',name='Camera off',exact=True).click()
            for page in [left,right]:
                page.wait_for_function("document.querySelector('.call-type')?.textContent==='Voice call' && document.querySelector('.call-remote')?.dataset.videoActive==='false'")
            right.get_by_role('button',name='End call',exact=True).click()
            for page in [left,right]:page.wait_for_function('!document.querySelector(".call-dialog[open]")')
            print('PASS a directly started video call becomes a voice call when both cameras turn off')
            assert not errors,errors
            browser.close()
            print('PASS hangup closes both peers; no browser page errors')
    finally:
        for process in reversed(processes):
            process.terminate()
            try:process.wait(timeout=8)
            except subprocess.TimeoutExpired:process.kill()
        for log in logs:log.close()

if __name__=='__main__':run()
