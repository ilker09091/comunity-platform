"""Isolated rendered Chrome QA with intercepted API fixtures, never production seed data.
Uses the existing compiled Next frontend and a browser-recorded real WebM clip.
Run with the workspace's existing Playwright Python dependency on PYTHONPATH.
"""
import base64
import json
import os
from pathlib import Path
import subprocess
import time
import tempfile
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:3004'
ARTIFACTS = ROOT / 'docs' / 'qa'
ARTIFACTS.mkdir(exist_ok=True)
USER = {'id': '10000000-0000-4000-8000-000000000001', 'username': 'qa_creator', 'displayName': 'QA Creator', 'avatarUrl': None}
VIEWER = {'id': '20000000-0000-4000-8000-000000000001', 'username': 'qa_viewer', 'displayName': 'QA Viewer', 'avatarUrl': None, 'role':'USER','postCount':0,'followerCount':0,'followingCount':0}
SESSION = '30000000-0000-4000-8000-000000000001'

def svg(width, height, color):
    raw = f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}"><rect width="100%" height="100%" fill="{color}"/><circle cx="{width//2}" cy="{height//2}" r="{width//4}" fill="#ffffff99"/><text x="50%" y="75%" text-anchor="middle" fill="white" font-size="80">{width}:{height}</text></svg>'
    return 'data:image/svg+xml;base64,' + base64.b64encode(raw.encode()).decode()

def post(n, kind='image'):
    media = []
    if kind != 'text':
        video = kind in ('portrait', 'landscape')
        width, height = (256, 144) if kind == 'landscape' else (900, 1600)
        media = [{'id':f'50000000-0000-4000-8000-{n:012}', 'type':'VIDEO' if video else 'IMAGE', 'status':'READY',
                  'url':BASE+'/qa/'+kind+'.mp4' if video else svg(width,height,'#3986e9'), 'width':width, 'height':height, 'durationMs':None, 'mimeType':'video/mp4' if video else 'image/svg+xml', 'sizeBytes':1000}]
    return {'id':f'40000000-0000-4000-8000-{n:012}', 'kind':'POST', 'author':USER, 'content':f'QA {kind} post {n}', 'visibility':'PUBLIC', 'media':media,
            'createdAt':'2026-10-11T10:00:00Z', 'updatedAt':'2026-10-11T10:00:00Z', 'editedAt':None,
            'likeCount':7, 'commentCount':2, 'bookmarkCount':1, 'repostCount':0, 'quoteCount':0,
            'isLiked':False, 'isBookmarked':False, 'isReposted':False, 'isFollowingAuthor':False, 'referencedPost':None}

images = [post(1), post(2,'text')]
images[0]['media'].append({**images[0]['media'][0], 'id':'50000000-0000-4000-8000-000000000099', 'url':svg(1600,900,'#845ae5'), 'width':1600, 'height':900})
videos = [post(n, 'landscape' if n == 12 else 'portrait') for n in range(10,15)]
clips = {}
events = []
queries = []
errors = []
page_number = 0

def route_api(route):
    request = route.request
    path = request.url.split('/api/backend/api/')[-1]
    queries.append(path)
    if path=='users/me':
        body = {**VIEWER, 'isPrivate':False, 'status':'ACTIVE', 'email':'qa@example.invalid'}
    elif path.startswith('feed/reels/expose'):
        body = {'nextSequence':1+max([e['sequence'] for e in events if e['postId']==request.post_data_json['postId']] or [0])}
    elif path.startswith('feed/reels/watch'):
        events.extend(request.post_data_json['events'])
        return route.fulfill(status=204)
    elif path.startswith('feed/reels'):
        second = 'cursor=qa-next' in path
        body = {'items':videos[3:] if second else videos[:3], 'hasMore':not second, 'nextCursor':None if second else 'qa-next', 'sessionId':SESSION}
    elif path.startswith('feed/'):
        body = {'items':images, 'hasMore':False, 'nextCursor':None}
    elif path.startswith('users/'+USER['id']+'/posts'):
        items = videos if 'content=reels' in path else [{**images[0], 'id':'40000000-0000-4000-8000-000000000090', 'kind':'REPOST', 'author':VIEWER, 'media':[], 'referencedPost':images[0]}] if 'kinds=REPOST' in path else images
        body = {'items':items, 'hasMore':False, 'nextCursor':None}
    elif path.startswith('users/qa_creator'):
        body = {**USER, 'createdAt':'2025-10-11T10:00:00Z','coverUrl':None,'bio':'QA profile for rendered media checks','website':'https://example.invalid','location':'Tbilisi', 'postCount':7,'followerCount':10,'followingCount':4,
                'isSelf':False,'isPrivate':False,'isFollowing':False,'isFollowRequested':False,'isBlocking':False,'canViewContent':True,'followsYou':False}
    elif path.startswith('posts/'):
        identifier = path.split('/')[1].split('?')[0]
        body = next((p for p in images+videos if p['id']==identifier),images[0])
    elif path.startswith('notifications') or path.startswith('users/me/'):
        body={'items':[], 'count':0, 'unreadCount':0,'hasMore':False,'nextCursor':None}
    else:
        return route.continue_()  # existing configuration endpoints remain real/read-only
    route.fulfill(status=200,content_type='application/json',body=json.dumps(body))

RECORD = """async ({width,height})=>{
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');const stream=canvas.captureStream(15);
  const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];
  recorder.ondataavailable=e=>chunks.push(e.data);const done=new Promise(resolve=>recorder.onstop=resolve);
  recorder.start();let frame=0;const timer=setInterval(()=>{context.fillStyle='#2559ae';context.fillRect(0,0,width,height);context.fillStyle='#fff';context.fillRect(10+frame++%50,20,40,40);},60);
  await new Promise(resolve=>setTimeout(resolve,1200));recorder.stop();await done;clearInterval(timer);stream.getTracks().forEach(t=>t.stop());
  return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}));});
}"""

log = (ROOT / '.tools' / 'media-browser-qa.log').open('wb')
server = subprocess.Popen(['node', 'node_modules/next/dist/bin/next', 'start','--hostname','127.0.0.1','--port','3004'],cwd=ROOT/'client',stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
try:
    for _ in range(60):
        if server.poll() is not None: raise RuntimeError('QA Next host did not start; inspect .tools/media-browser-qa.log')
        try:
            if urlopen(BASE,timeout=1).status==200:break
        except Exception:time.sleep(.25)
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='chrome',headless=True)
        context=browser.new_context(viewport={'width':1440,'height':900},device_scale_factor=1)
        context.route('**/api/backend/api/**',route_api)
        page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(BASE+'/qa',wait_until='domcontentloaded')
        for kind,width,height in [('portrait',144,256),('landscape',256,144)]:
            raw=base64.b64decode(page.evaluate(RECORD,{'width':width,'height':height}))
            with tempfile.TemporaryDirectory(prefix='circle-qa-clip-') as directory:
                incoming=Path(directory)/'recorded.webm';outgoing=Path(directory)/'recorded.mp4';incoming.write_bytes(raw)
                binary=ROOT/'server/node_modules/ffmpeg-static/ffmpeg.exe'
                subprocess.run([str(binary),'-hide_banner','-loglevel','error','-i',str(incoming),'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',str(outgoing)],check=True,capture_output=True,timeout=20,creationflags=subprocess.CREATE_NO_WINDOW)
                clips[kind]=outgoing.read_bytes()
        context.route('**/qa/*.mp4',lambda route:route.fulfill(status=200,content_type='video/mp4',body=clips['landscape' if 'landscape' in route.request.url else 'portrait']))
        page.goto(BASE,wait_until='networkidle')
        print(json.dumps({'homeErrors':errors,'homeQueries':queries[:20],'homeBody':page.locator('body').inner_text()[:1500]}),flush=True)
        page.locator('.photo-preview').first.wait_for()
        assert all('video' not in (node.get_attribute('accept') or '') for node in page.locator('input[type=file]').all())
        assert page.get_by_role('link',name='Create Reel',exact=True).count()>0
        page.locator('.photo-preview').first.click()
        page.locator('dialog.photo-viewer[open]').wait_for()
        page.locator('.photo-stage img').wait_for()
        page.wait_for_function("document.querySelector('.photo-stage img').naturalWidth===900")
        box=page.locator('.photo-stage img').bounding_box();assert abs(box['width']/box['height']-9/16)<.005
        page.keyboard.press('ArrowRight');page.wait_for_function("document.querySelector('.photo-stage img').naturalWidth===1600")
        box=page.locator('.photo-stage img').bounding_box();assert abs(box['width']/box['height']-16/9)<.005
        page.screenshot(path=str(ARTIFACTS/'photo-viewer-desktop.png'))
        page.keyboard.press('Escape');page.locator('dialog.photo-viewer').wait_for(state='detached')
        page.goto(BASE+'/profile/qa_creator',wait_until='networkidle');page.get_by_role('button',name='Grid View',exact=True).click();page.locator('.profile-social-grid').wait_for()
        count_before=len([q for q in queries if '/posts?' in q]);page.get_by_role('button',name='Classic View',exact=True).click();page.get_by_role('button',name='Grid View',exact=True).click();page.wait_for_timeout(100)
        assert count_before==len([q for q in queries if '/posts?' in q]),'layout switching should reuse loaded profile data'
        page.get_by_role('tab',name='Reels',exact=True).click();page.locator('.profile-tile[href*="start="]').first.wait_for()
        page.screenshot(path=str(ARTIFACTS/'profile-grid-desktop.png'))
        page.reload(wait_until='networkidle');assert page.get_by_role('button',name='Grid View',exact=True).get_attribute('aria-pressed')=='true'
        page.get_by_role('tab',name='Reposts',exact=True).click();page.locator('.grid-attribution').wait_for();assert '@qa_creator' in page.locator('.grid-attribution').inner_text()
        page.goto(BASE+'/reels',wait_until='networkidle');page.wait_for_function("document.querySelector('section[aria-hidden=false] video')?.videoWidth>0")
        page.wait_for_function("!document.querySelector('section[aria-hidden=false] video').paused")
        first=page.locator('section[aria-hidden=false] video').evaluate('(v)=>({src:v.src,width:v.videoWidth,height:v.videoHeight,loop:v.loop,inline:v.playsInline})')
        assert first['width']/first['height']==9/16 and first['loop'] and first['inline']
        page.wait_for_timeout(2700)
        page.screenshot(path=str(ARTIFACTS/'reels-desktop.png'))
        page.get_by_role('button',name='Next reel',exact=True).click();page.wait_for_timeout(350)
        page.get_by_role('button',name='Previous reel',exact=True).click();page.wait_for_timeout(350)
        assert page.locator('section[aria-hidden=false] video').get_attribute('src')==first['src']
        assert any('cursor=qa-next' in q for q in queries),'next page must append'
        for _ in range(5):page.get_by_role('button',name='Next reel',exact=True).click();page.wait_for_timeout(350)
        assert page.get_by_role('button',name='Watch again',exact=True).count()==1
        assert page.get_by_role('link',name='Return to Home',exact=True).count()==1
        # Native portrait and landscape decoding in a mobile viewport; VisualViewport toolbar changes are simulated.
        page.set_viewport_size({'width':390,'height':844})
        page.add_init_script("if(innerWidth<900){const vv=new EventTarget();Object.assign(vv,{height:innerHeight,width:innerWidth,scale:1,offsetTop:0,offsetLeft:0});Object.defineProperty(window,'visualViewport',{value:vv,configurable:true});}")
        page.goto(BASE+'/reels?start='+videos[2]['id'],wait_until='networkidle')
        page.wait_for_function("document.querySelector('section[aria-hidden=false] video')?.videoWidth===256")
        assert page.locator('section[aria-hidden=false] video').evaluate("v=>getComputedStyle(v).objectFit")=='contain'
        page.evaluate("()=>{window.visualViewport.height=700;window.visualViewport.dispatchEvent(new Event('resize'));}")
        page.wait_for_function("document.documentElement.style.getPropertyValue('--app-h')==='700px'")
        metrics=page.evaluate("""()=>{const r=s=>{const v=document.querySelector(s).getBoundingClientRect();return {top:v.top,bottom:v.bottom,height:v.height};};return {page:r('.reels-page'),nav:r('.reels-mobile-nav'),dock:r('section[aria-hidden=false] .video-playback-dock')};}""")
        assert abs(metrics['page']['height']-700)<1 and metrics['dock']['bottom']<=metrics['nav']['top']+1
        page.screenshot(path=str(ARTIFACTS/'reels-mobile-landscape-source.png'))
        page.evaluate("()=>{window.visualViewport.height=420;window.visualViewport.offsetTop=60;window.visualViewport.dispatchEvent(new Event('resize'));}")
        page.wait_for_function("document.documentElement.style.getPropertyValue('--app-h')==='420px'")
        assert abs(page.locator('.reels-page').bounding_box()['y']-60)<1
        page.set_viewport_size({'width':844,'height':390})
        page.evaluate("()=>{window.visualViewport.height=390;window.visualViewport.offsetTop=0;window.visualViewport.dispatchEvent(new Event('resize'));}")
        page.wait_for_timeout(150)
        for selector in ['.reel-actions','.reels-mobile-nav','section[aria-hidden=false] .video-playback-dock']:
            box=page.locator(selector).bounding_box();assert box['y']>=0 and box['y']+box['height']<=391,selector
        page.screenshot(path=str(ARTIFACTS/'reels-mobile-rotation.png'))
        assert not errors,errors
        assert any(e['type']=='VIDEO_START' for e in events),events
        assert any(e['type']=='VIDEO_COMPLETE' for e in events),events
        assert any(e['type']=='VIDEO_REPLAY' for e in events),events
        print(json.dumps({'ok':True,'nativeChromeDecoding':True,'watchEvents':len(events),'profileLayoutRefetch':False,'apiFixturesOnly':True,'iosHardwareTested':False,'screenshots':str(ARTIFACTS)}))
        context.close();browser.close()
finally:
    if 'page' in globals():
        try:
            print(json.dumps({'qaErrors':errors,'qaQueries':queries[:20],'qaBody':page.locator('body').inner_text()[:1200]}))
            page.screenshot(path=str(ARTIFACTS/'qa-last-state.png'))
        except Exception:pass
    server.terminate()
    try:server.wait(timeout=10)
    except subprocess.TimeoutExpired:server.kill()
    log.close()
