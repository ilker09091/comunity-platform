"""Real Chrome rendering/decoding and input on the production build, isolated API fixtures only."""
import json,os,subprocess,time,tempfile
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];BASE='http://127.0.0.1:3006';SESSION='10000000-0000-4000-8000-000000000001'
USER={'id':'20000000-0000-4000-8000-000000000001','username':'qa_viewer','displayName':'QA Viewer','role':'USER','avatarUrl':None,'postCount':0,'followerCount':0,'followingCount':0}
AUTHOR={**USER,'id':'20000000-0000-4000-8000-000000000002','username':'qa_creator','displayName':'QA Creator'}
posts=[]
for n in range(1,6):
 posts.append({'id':f'30000000-0000-4000-8000-{n:012}','kind':'POST','author':AUTHOR,'content':'Browser QA caption','visibility':'PUBLIC','media':[{'id':f'40000000-0000-4000-8000-{n:012}','type':'VIDEO','status':'READY','url':BASE+'/qa/clip.mp4','width':360,'height':640,'durationMs':3000,'mimeType':'video/mp4','sizeBytes':3000}],'createdAt':'2026-10-12T10:00:00Z','updatedAt':'2026-10-12T10:00:00Z','editedAt':None,'likeCount':0,'commentCount':2,'bookmarkCount':0,'repostCount':0,'quoteCount':0,'isLiked':False,'isBookmarked':False,'isReposted':False,'isFollowingAuthor':False,'referencedPost':None})
entries=[{'key':f'{SESSION}:1:{i+1}:{p["id"]}','postId':p['id'],'position':i+1,'cycle':1} for i,p in enumerate(posts)]
events=[];exposures=[];queries=[];errors=[]
def api(route):
 path=route.request.url.split('/api/backend/api/')[-1];queries.append(path)
 if path=='platform/config':body={'features':{'registration':True,'postCreation':True,'imageUploads':True,'videoUploads':True,'reels':True,'comments':True,'reposts':True,'search':True,'reporting':True},'posts':{'maxLength':5000,'maxMedia':10,'defaultVisibility':'PUBLIC'},'readOnlyMode':False}
 elif path=='users/me':body={**USER,'isPrivate':False,'status':'ACTIVE','email':'qa@example.invalid'}
 elif path.startswith('feed/reels/expose'):
  data=route.request.post_data_json;exposures.append(data);position=data.get('position') or next(e['position'] for e in entries if e['postId']==data['postId']);body={'position':position,'cycle':1,'nextSequence':1+max([e['sequence'] for e in events if e.get('position')==position] or [0])}
 elif path.startswith('feed/reels/watch'):
  events.extend(route.request.post_data_json['events']);return route.fulfill(status=204)
 elif path.startswith('feed/reels'):
  body={'items':posts,'entries':entries,'sessionId':SESSION,'cycle':1,'hasMore':False,'nextCursor':None,'sessionEnded':False}
 elif path.startswith('posts/') and '/comments' not in path:
  body=next(p for p in posts if p['id']==path.split('/')[1].split('?')[0])
 elif path.startswith('users/'+AUTHOR['id']+'/posts'):body={'items':posts,'hasMore':False,'nextCursor':None}
 elif path.startswith('users/') and not path.startswith('users/me/'):
  body={**AUTHOR,'isFollowing':False,'isFollowRequested':False,'isBlocking':False,'canViewContent':True,'isPrivate':False}
 else:body={'items':[],'hasMore':False,'nextCursor':None,'unreadCount':0,'count':0}
 route.fulfill(status=200,content_type='application/json',body=json.dumps(body))
logfile=ROOT/'.tools/reels-v2-browser.log';log=logfile.open('wb')
server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3006'],cwd=ROOT/'client',stdout=log,stderr=log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
try:
 for _ in range(80):
  if server.poll() is not None:raise RuntimeError('QA Next server failed')
  try:
   if urlopen(BASE+'/reels',timeout=1).status==200:break
  except Exception:time.sleep(.2)
 with tempfile.TemporaryDirectory(prefix='circle-reels-v2-') as temporary:
  clip=Path(temporary)/'clip.mp4';binary=ROOT/'server/node_modules/ffmpeg-static/ffmpeg.exe'
  subprocess.run([str(binary),'-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=royalblue:s=360x640:r=24','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',str(clip)],check=True,capture_output=True,timeout=20,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
  with sync_playwright() as p:
   browser=p.chromium.launch(channel='chrome',headless=True)
   context=browser.new_context(viewport={'width':1440,'height':900});context.route('**/api/backend/api/**',api);context.route('**/qa/clip.mp4',lambda r:r.fulfill(status=200,content_type='video/mp4',body=clip.read_bytes()))
   page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(BASE+'/reels',wait_until='networkidle')
   active=lambda:page.locator('section.reel-slide[aria-hidden="false"]')
   active().locator('video').wait_for();page.wait_for_function('document.querySelector("section[aria-hidden=false] video")?.currentTime>0.1')
   page.wait_for_timeout(1000)
   assert len([x for x in exposures if not x.get('prepare')])==1,exposures
   assert {e['position'] for e in events}=={1},events
   assert all(e.get('position') for e in events)
   page.wait_for_timeout(3200);assert any(e['type']=='VIDEO_REPLAY' for e in events),events
   assert len([x for x in exposures if not x.get('prepare')])==1
   print('PASS real H264 playback: selected exposure only; native loop creates no extra impression')
   for selector in ['.reels-workspace','.reel-actions','.reel-viewport']:
    old=active().get_attribute('aria-label');box=page.locator(selector).bounding_box();page.mouse.move(box['x']+5,box['y']+25);page.mouse.wheel(0,130);page.wait_for_function('(old)=>document.querySelector("section.reel-slide[aria-hidden=false]")?.getAttribute("aria-label")!==old',arg=old);page.wait_for_timeout(500)
   print('PASS native wheel across workspace background, action rail and player stage')
   old=active().get_attribute('aria-label');page.get_by_role('button',name='Comments, 2',exact=True).click();page.locator('.reel-comments-body').wait_for();box=page.locator('.reel-comments-body').bounding_box();page.mouse.move(box['x']+10,box['y']+10);page.mouse.wheel(0,160);page.wait_for_timeout(500);assert active().get_attribute('aria-label')==old
   page.get_by_role('button',name='Close comments',exact=True).click();page.wait_for_timeout(300)
   page.keyboard.press('ArrowUp');page.wait_for_timeout(500);assert active().get_attribute('aria-label')!=old
   current=active().get_attribute('aria-label');page.reload(wait_until='networkidle');active().locator('video').wait_for();assert active().get_attribute('aria-label')==current
   print('PASS native comment-scroll exclusion, keyboard backward navigation and reload restoration')
   (ROOT/'docs/qa').mkdir(exist_ok=True);page.screenshot(path=str(ROOT/'docs/qa/reels-v2-desktop.png'))
   mobile=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);mobile.route('**/api/backend/api/**',api);mobile.route('**/qa/clip.mp4',lambda r:r.fulfill(status=200,content_type='video/mp4',body=clip.read_bytes()))
   touch=mobile.new_page();touch.on('pageerror',lambda e:errors.append(str(e)));touch.goto(BASE+'/reels',wait_until='networkidle');touch.locator('section[aria-hidden="false"] video').wait_for()
   touch.evaluate("""()=>{const root=document.querySelector('.reels-workspace');const event=(type,y)=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:type==='touchend'?[]:[{clientX:5,clientY:y}]});root.dispatchEvent(e);};event('touchstart',600);event('touchmove',160);event('touchend',160);}""")
   touch.wait_for_timeout(500);assert 'Reel 2 ' in touch.locator('section[aria-hidden="false"]').get_attribute('aria-label')
   touch.screenshot(path=str(ROOT/'docs/qa/reels-v2-mobile.png'));assert not errors,errors
   print('PASS mobile Chrome viewport: swipe dispatched outside video; physical iOS not tested')
   before=len(events);page.goto(BASE+'/reels?user='+AUTHOR['id'],wait_until='networkidle');active().locator('video').wait_for();page.wait_for_timeout(2500);assert len(events)>before;print('PASS profile-origin Reels retain chronological queue and record real playback history')
   print('PASS production browser run; API fixtures isolated to QA context; no live posts or videos changed')
   browser.close()
finally:
 server.terminate()
 try:server.wait(timeout=8)
 except subprocess.TimeoutExpired:server.kill();server.wait()
 log.close()
