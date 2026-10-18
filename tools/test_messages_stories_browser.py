"""Browser checks for messages and stories against isolated API fixtures."""
import base64, json, os, subprocess, tempfile, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:3017'
ME = dict(id='10000000-0000-4000-8000-000000000001', username='qa_me', displayName='QA Me', avatarUrl=None, role='USER', isPrivate=False, isVerified=False, postCount=1, followerCount=1, followingCount=1)
PEER = {**ME, 'id': '10000000-0000-4000-8000-000000000002', 'username': 'qa_friend', 'displayName': 'QA Friend', 'isFollowing': True, 'isFollowRequested': False, 'isBlocking': False, 'isSelf': False, 'canViewContent': True}
STRANGER = {**PEER, 'id': '10000000-0000-4000-8000-000000000003', 'username': 'qa_stranger', 'displayName': 'QA Stranger', 'isFollowing': False}
def now(): return datetime.now(timezone.utc).isoformat()
MEDIA = dict(id='20000000-0000-4000-8000-000000000001', type='VIDEO', status='READY', url=BASE+'/qa/video.mp4', mimeType='video/mp4', sizeBytes=1000, width=180, height=320, durationMs=1000, createdAt=now(), processingProgress=None)
PHOTO = {**MEDIA, 'id': '20000000-0000-4000-8000-000000000002', 'type': 'IMAGE', 'url': BASE+'/qa/photo.png', 'mimeType': 'image/png'}
POST = dict(id='30000000-0000-4000-8000-000000000001', kind='POST', author=PEER, content='A video from your circle', media=[MEDIA], visibility='PUBLIC', createdAt=now(), updatedAt=now(), editedAt=None, likeCount=0, commentCount=0, repostCount=0, quoteCount=0, bookmarkCount=0, isLiked=False, isBookmarked=False, isReposted=False, isFollowingAuthor=True, referencedPost=None, referencedPostUnavailable=False)
MSG_EXTRA = dict(replyTo=None, viewOnce=False, viewOnceType=None, openedAt=None, deliveredAt=None, noteReply=None)
audio_uploads = []
messages = [dict(id='40000000-0000-4000-8000-000000000001', senderId=PEER['id'], recipientId=ME['id'], content='Hello from your friend', media=MEDIA, post=None, storyReply=None, createdAt=now(), readAt=None, **MSG_EXTRA)]
notes = [dict(id='90000000-0000-4000-8000-000000000001', author=PEER, text='Coffee time', songTitle='Tone', audioUrl=BASE+'/qa/clip.m4a', audioDurationMs=15000, createdAt=now(), expiresAt=now(), isOwn=False)]
presence = dict(typing=False)
stories = [dict(id='50000000-0000-4000-8000-000000000001', author=PEER, media=PHOTO, post=None, caption='A quiet moment', createdAt=now(), expiresAt=(datetime.now(timezone.utc)+timedelta(hours=24)).isoformat(), isViewed=False, isLiked=False, viewCount=0, likeCount=0)]
SPOILER_POST = {**POST, 'id': '30000000-0000-4000-8000-000000000002', 'content': 'Big reveal #spoiler', 'media': [PHOTO]}
STICKERS = [dict(id='70000000-0000-4000-8000-0000000000%02d' % i, name=n, emoji=e, url=None, isOwn=False) for i, (e, n) in enumerate([('\U0001F602', 'Laughing'), ('\U0001F525', 'Fire'), ('\u2764\ufe0f', 'Heart')])]
comments = []
accepted = set()
calls=[]; errors=[]; upload_media=MEDIA
def page(items): return dict(items=items, hasMore=False, nextCursor=None)
def api(route):
 global upload_media
 request=route.request; path=urlparse(request.url).path.removeprefix('/api/backend/api/'); method=request.method
 data=request.post_data_json if method=='POST' and request.headers.get('content-type','').startswith('application/json') else {}
 calls.append((method,path,data))
 status=200
 if path=='users/me': body=ME
 elif path=='platform/config': body=dict(features=dict(registration=True, postCreation=True, imageUploads=True, videoUploads=True, reels=True, comments=True, reposts=True, search=True, reporting=True), posts=dict(maxLength=5000,maxMedia=10,defaultVisibility='PUBLIC'),readOnlyMode=False,platformName='Circle',postMaxLength=5000,postMaxMedia=4,defaultVisibility='PUBLIC',allowedImageTypes=['image/jpeg','image/png','image/webp'],allowedVideoTypes=['video/mp4'],allowedReportReasons=['SPAM'])
 elif path=='messages/unread-count': body={'count':sum(not m['readAt'] and m['recipientId']==ME['id'] for m in messages)}
 elif path=='messages' and parse_qs(urlparse(request.url).query).get('folder')==['requests']: body=page([dict(user=STRANGER,lastMessage=dict(messages[0],id='40000000-0000-4000-8000-000000000099',senderId=STRANGER['id'],content='Hi, can we talk?',media=None,readAt=now()),unreadCount=0,isRequest=True,online=False,lastActiveAt=None)])
 elif path=='messages': body=page([dict(user=PEER,lastMessage=messages[-1],unreadCount=sum(not m['readAt'] and m['recipientId']==ME['id'] for m in messages),isRequest=False,online=True,lastActiveAt=now())])
 elif path.startswith('messages/') and path.endswith('/typing'): return route.fulfill(status=204)
 elif path=='notes' and method=='GET': body=notes
 elif path=='notes/audio':
  audio_uploads.append(len(request.post_data_buffer or b''))
  body=dict(id='91000000-0000-4000-8000-000000000001',url=BASE+'/qa/clip.m4a',durationMs=15000);status=201
 elif path.startswith('notes/') and path.endswith('/reply'):
  body=dict(messages[0],id='40000000-0000-4000-8000-000000000088',senderId=ME['id'],recipientId=PEER['id'],content=data.get('content'),media=None,createdAt=now(),readAt=None,**{**MSG_EXTRA,'noteReply':dict(text='Coffee time',songTitle='Tone')})
  messages.append(body);status=201
 elif path=='notes' and method=='POST':
  note=dict(id='90000000-0000-4000-8000-000000000002',author=ME,text=data.get('text') or '',songTitle=data.get('songTitle'),audioUrl=BASE+'/qa/clip.m4a' if data.get('audioId') else None,audioDurationMs=15000 if data.get('audioId') else None,createdAt=now(),expiresAt=now(),isOwn=True)
  notes[:]=[n for n in notes if not n['isOwn']]+[note];body=note;status=201
 elif path.startswith('messages/') and path.endswith('/status'):
  peer=path.split('/')[1]
  body=dict(isRequest=peer==STRANGER['id'] and peer not in accepted,awaitingAcceptance=False,canSend=True,peerTyping=presence['typing'],peerOnline=True,peerLastActiveAt=now())
 elif path.startswith('messages/') and path.endswith('/accept'):
  accepted.add(path.split('/')[1]);return route.fulfill(status=204)
 elif method=='DELETE' and path.startswith('messages/'):
  return route.fulfill(status=204)
 elif path.startswith('media/') and path.endswith('/soundtrack'):
  body=MEDIA;status=201
 elif path.startswith('messages/') and path.endswith('/read'):
  for m in messages: m['readAt']=now()
  return route.fulfill(status=204)
 elif path.startswith('messages/') and method=='POST':
  parent=next((m for m in messages if m['id']==data.get('replyToId')),None)
  once=bool(data.get('viewOnce'))
  body=dict(id='40000000-0000-4000-8000-'+str(len(messages)+1).zfill(12),senderId=ME['id'],recipientId=PEER['id'],content=data.get('content'),media=None if once else (upload_media if data.get('mediaId') else None),post=POST if data.get('postId') else None,storyReply=None,createdAt=now(),readAt=None,
            replyTo=dict(id=parent['id'],senderId=parent['senderId'],kind='TEXT',preview=parent['content']) if parent else None,viewOnce=once,viewOnceType=upload_media['type'] if once else None,openedAt=None,deliveredAt=now())
  messages.append(body);status=201
 elif path.startswith('messages/'): body=page(list(reversed(messages)))
 elif path=='search/users': body=page([PEER])
 elif path.startswith('users/') and path.endswith('/posts'): body=page([POST])
 elif path=='users/'+PEER['username']: body=PEER
 elif path=='stories' and method=='POST':
  body=dict(id='50000000-0000-4000-8000-'+str(len(stories)+1).zfill(12),author=ME,media=MEDIA if data.get('postId') else upload_media,post=POST if data.get('postId') else None,caption=data.get('caption'),createdAt=now(),expiresAt=(datetime.now(timezone.utc)+timedelta(hours=24)).isoformat(),isViewed=False,isLiked=False,viewCount=1,likeCount=1)
  stories.insert(0,body);status=201
 elif path=='stories': body=page(stories)
 elif path.startswith('stories/') and path.endswith('/viewers'): body=page([dict(user=PEER,viewedAt=now(),liked=True)])
 elif path.startswith('stories/') and path.endswith('/like'):
  for st in stories:
   if st['id']==path.split('/')[1]: st['isLiked']=method=='POST'
  return route.fulfill(status=204)
 elif path.startswith('stories/') and path.endswith('/reply'):
  body=dict(messages[0],id='40000000-0000-4000-8000-000000000077',senderId=ME['id'],recipientId=PEER['id'],content=data.get('content'),media=None,storyReply=dict(storyId=path.split('/')[1],media=PHOTO),readAt=None,**MSG_EXTRA);status=201
 elif path=='stickers' and method=='POST':
  body=dict(id='70000000-0000-4000-8000-000000000099',name='photo',emoji=None,url=BASE+'/qa/photo.png',isOwn=True);STICKERS.append(body);status=201
 elif path=='stickers': body=STICKERS
 elif path.startswith('posts/') and path.endswith('/comments') and method=='POST':
  sticker=next((x for x in STICKERS if x['id']==data.get('stickerId')),None)
  body=dict(id='80000000-0000-4000-8000-'+str(len(comments)+1).zfill(12),postId=POST['id'],parentId=None,depth=0,status='ACTIVE',author=ME,content=data.get('content') or '',sticker=sticker,stickerUnavailable=False,likeCount=0,replyCount=0,hasReplies=False,isLiked=False,canReply=True,createdAt=now(),updatedAt=now(),editedAt=None)
  comments.insert(0,body);status=201
 elif path.startswith('posts/') and path.endswith('/comments'): body=page(comments)
 elif path=='users/'+STRANGER['username']: body=STRANGER
 elif path.startswith('stories/') and method=='DELETE':
  stories[:]=[s for s in stories if s['id']!=path.split('/')[1]]
  return route.fulfill(status=204)
 elif path.startswith('stories/') and path.endswith('/view'):
  for s in stories:
   if s['id']==path.split('/')[1]:s['isViewed']=True
  return route.fulfill(status=204)
 elif path=='media/uploads' and method=='POST':
  upload_media=PHOTO if data['fileName'].endswith('.png') else MEDIA
  body=dict(id='60000000-0000-4000-8000-000000000001',received=0,chunkSize=1024*1024,size=data['size']);status=201
 elif path.endswith('/chunks'):body=dict(received=len(request.post_data_buffer))
 elif path.endswith('/complete'):body=upload_media;status=201
 elif path.startswith('media/'):body=upload_media
 elif path.startswith('feed/'):body=page([POST,SPOILER_POST])
 elif path.startswith('posts/'):body=SPOILER_POST if SPOILER_POST['id'] in path else POST
 else:body={**page([]),'count':0,'unreadCount':0}
 route.fulfill(status=status,content_type='application/json',body=json.dumps(body))

out=ROOT/'.tools/messages-stories-qa';out.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='circle-social-') as temp:
 temp=Path(temp);video=temp/'video.mp4';photo=temp/'photo.png';song=temp/'song.wav'
 photo.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6r1cAAAAASUVORK5CYII='))
 subprocess.run([str(ROOT/'server/node_modules/ffmpeg-static/ffmpeg.exe'),'-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=royalblue:s=180x320:r=10','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-y',str(video)],check=True,capture_output=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
 subprocess.run([str(ROOT/'server/node_modules/ffmpeg-static/ffmpeg.exe'),'-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=40','-ac','2','-ar','44100','-y',str(song)],check=True,capture_output=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
 log=(out/'server.log').open('wb')
 server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3017'],cwd=ROOT/'client',stdout=log,stderr=log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
 try:
  for _ in range(120):
   if server.poll() is not None:raise RuntimeError('Next server stopped; see '+str(out/'server.log'))
   try:
    if urlopen(BASE+'/messages',timeout=1).status==200:break
   except Exception: time.sleep(.25)
  with sync_playwright() as p:
   browser=p.chromium.launch(channel='chrome',headless=True)
   context=browser.new_context(viewport=dict(width=1440,height=1000))
   context.route('https://566dev.com/**',lambda r:r.fulfill(status=200,content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg"/>'))
   context.route('**/api/backend/api/**',api)
   context.route('**/qa/video.mp4',lambda r:r.fulfill(status=200,content_type='video/mp4',body=video.read_bytes()))
   context.route('**/qa/photo.png',lambda r:r.fulfill(status=200,content_type='image/png',body=photo.read_bytes()))
   context.route('**/qa/clip.m4a',lambda r:r.fulfill(status=200,content_type='audio/wav',body=song.read_bytes()))
   context.add_init_script("window.__vibrations=[];Object.defineProperty(navigator,'vibrate',{value:(p)=>{window.__vibrations.push(p);console.log('VIBRATE '+JSON.stringify(p)+' '+location.pathname);return true},configurable:true})")
   tab=context.new_page();tab.on('pageerror',lambda e:errors.append(str(e)))
   vibrations=[];tab.on('console',lambda m: vibrations.append(m.text.split(' ')[1]) if m.text.startswith('VIBRATE ') else None)
   tab.on("console",lambda m: errors.append(m.text) if m.type=="error" else None)
   tab.on("requestfailed",lambda r: errors.append(r.url+" "+str(r.failure)) if r.failure!="net::ERR_ABORTED" else None)
   tab.goto(BASE+'/messages',wait_until='networkidle')
   tab.locator('.dm-empty').get_by_text('Your messages',exact=True).wait_for()
   side=tab.locator('.dm-sidebar').bounding_box();main=tab.locator('.dm-main').bounding_box()
   assert side['width']>=230 and main['x']>=side['x']+side['width']-1 and abs(side['height']-main['height'])<2,(side,main)
   assert not tab.locator('.left-sidebar').is_visible() and not tab.locator('.right-sidebar').is_visible()
   shell=tab.locator('.dm-shell').bounding_box();header=tab.locator('.header-inner').bounding_box()
   assert abs(shell['width']-header['width'])<2 and abs(shell['x']-header['x'])<2,(shell,header)
   tab.screenshot(path=str(out/'initial.png'),full_page=True)
   tab.get_by_role('tab',name='Requests').click()
   tab.get_by_text('Hi, can we talk?').wait_for()
   tab.get_by_text('Hi, can we talk?').click()
   tab.get_by_text('Accept message request from qa_stranger?').wait_for()
   assert tab.locator('.dm-composer').count()==0
   assert not any(path.endswith('/read') for method,path,data in calls),'requests must not be marked seen'
   tab.get_by_role('button',name='Accept',exact=True).click()
   tab.locator('.dm-composer').wait_for()
   assert any(method=='POST' and path=='messages/'+STRANGER['id']+'/accept' for method,path,data in calls)
   print('PASS message request: Accept/Delete panel, no seen receipt before accepting, accept opens the composer')
   tab.goto(BASE+'/messages',wait_until='networkidle')
   tab.get_by_role('tab',name='Primary').click()
   tab.get_by_label('Search conversations').fill('nobody')
   tab.get_by_text('No conversations match your search.').wait_for()
   tab.get_by_label('Search conversations').fill('friend')
   print('PASS two-pane inbox, empty state, Primary/Requests folders and conversation search')
   tab.locator('.dm-row').first.click()
   tab.locator('.dm-row.active').wait_for()
   tab.get_by_role('button',name='Choose an emoji').click()
   tab.locator('.dm-emoji-panel button').nth(17).click()
   assert tab.get_by_label('Message',exact=True).input_value()=='\U0001F525'
   tab.get_by_label('Message',exact=True).fill('A new message from the browser')
   tab.get_by_label('Message',exact=True).press('Enter')
   tab.get_by_text('A new message from the browser',exact=True).wait_for()
   tab.locator('.dm-message.own').last.get_by_role('img',name='Delivered').wait_for()
   assert tab.locator('.dm-message.own .dm-bubble').last.evaluate('e=>getComputedStyle(e).backgroundColor')=='rgb(37, 140, 244)'
   assert any(path.endswith('/read') for method,path,data in calls)
   assert tab.evaluate('document.activeElement?.getAttribute("aria-label")')=='Message','composer keeps focus after sending'
   print('PASS conversation selection, emoji, Enter-to-send, blue own bubbles, delivery ticks, focus kept and read acknowledgement')
   tab.locator('.dm-thread-head').get_by_text('Active now').wait_for()
   assert tab.locator('.dm-thread-head .dm-avatar-wrap.online').count()==1
   presence['typing']=True
   tab.get_by_text('typing...').wait_for(timeout=8000)
   tab.locator('.dm-typing').wait_for()
   presence['typing']=False
   tab.get_by_label('Message',exact=True).fill('typing check')
   tab.wait_for_timeout(300)
   assert any(method=='POST' and path.endswith('/typing') for method,path,data in calls)
   tab.get_by_label('Message',exact=True).fill('')
   print('PASS presence: Active now with online dot, live typing indicator both ways')
   first=tab.locator('.dm-message').filter(has_text='Hello from your friend')
   first.hover();first.get_by_role('button',name='Reply').click()
   tab.get_by_text('Replying to QA Friend').wait_for()
   tab.get_by_label('Message',exact=True).fill('Quoted answer')
   tab.get_by_label('Message',exact=True).press('Enter')
   tab.locator('.dm-quote').filter(has_text='Hello from your friend').wait_for()
   assert any(data.get('replyToId')==messages[0]['id'] for method,path,data in calls if isinstance(data,dict))
   # Swiping a message sideways (as on a phone) must not create a horizontal scroll.
   tab.evaluate('document.querySelector(".dm-message").style.transform="translateX(72px)"')
   assert tab.evaluate('(() => { const el = document.querySelector(".dm-scroll"); el.scrollLeft = 200; return el.scrollLeft === 0 && getComputedStyle(el).overflowX === "hidden"; })()')
   tab.evaluate('document.querySelector(".dm-message").style.transform=""')
   print('PASS replying to a message with a quote')
   tab.locator('.dm-composer input[type=file]').set_input_files(str(photo))
   tab.get_by_text('Photo ready to send',exact=True).wait_for()
   tab.get_by_role('button',name='View once').click()
   tab.get_by_role('button',name='Send message',exact=True).click()
   tab.locator('.dm-viewonce').last.wait_for()
   assert any(data.get('viewOnce') is True for method,path,data in calls if isinstance(data,dict))
   print('PASS sending a view-once photo')
   own=tab.locator('.dm-message.own').filter(has_text='A new message from the browser')
   own.hover();own.get_by_role('button',name='More actions').click()
   own.get_by_role('menuitem',name='Unsend').click()
   tab.get_by_role('dialog',name='Unsend message?').get_by_role('button',name='Unsend').click()
   tab.get_by_text('Message unsent.').wait_for()
   assert any(method=='DELETE' and path.startswith('messages/') and path.count('/')==1 for method,path,data in calls)
   tab.locator('.dm-thread-head').get_by_label('Chat options').click()
   tab.get_by_role('button',name='Delete chat').click()
   tab.get_by_role('dialog',name='Delete this chat?').get_by_role('button',name='Delete chat').click()
   tab.wait_for_url(BASE+'/messages')
   assert any(method=='DELETE' and path.endswith('/conversation') for method,path,data in calls)
   tab.locator('.dm-row').first.click();tab.locator('.dm-thread').wait_for()
   print('PASS unsending a message and deleting the whole chat')
   tab.locator('.dm-composer input[type=file]').set_input_files(str(video))
   tab.get_by_text('Video ready to send',exact=True).wait_for()
   tab.get_by_role('button',name='Send message',exact=True).click()
   tab.wait_for_function('document.querySelectorAll(".dm-media").length===2')
   tab.locator('.dm-media').last.evaluate('(v)=>v.play()')
   tab.wait_for_function('Array.from(document.querySelectorAll(".dm-media")).at(-1).currentTime>0')
   assert any(data.get('mediaId')==MEDIA['id'] for method,path,data in calls if isinstance(data,dict))
   tab.wait_for_function('document.querySelector(".dm-messages li:last-child").getBoundingClientRect().bottom <= document.querySelector(".dm-scroll").getBoundingClientRect().bottom+1')
   assert tab.evaluate('document.documentElement.scrollHeight<=innerHeight+1'),'inbox should fit the viewport'
   tab.screenshot(path=str(out/'messages-desktop.png'),full_page=True)
   print('PASS video upload through chunks, attachment send, real H264 playback and independent message scrolling')
   tab.set_viewport_size(dict(width=390,height=844));tab.wait_for_timeout(300)
   shell=tab.locator('.dm-shell').bounding_box()
   assert shell['x']==0 and shell['y']==0 and shell['width']==390 and abs(shell['height']-844)<2,shell
   assert tab.evaluate('document.elementFromPoint(195,830).closest(".dm-shell")!==null'),'chat must cover the bottom navigation'
   assert tab.evaluate('document.documentElement.scrollWidth<=innerWidth')
   tab.screenshot(path=str(out/'messages-mobile-chat.png'))
   tab.get_by_role('link',name='Back to conversations').click()
   tab.locator('.dm-row').first.wait_for()
   assert not tab.locator('.dm-main').is_visible()
   nav=tab.locator('.mobile-nav > a, .mobile-nav > button')
   boxes=[a.bounding_box() for a in nav.all()]
   assert len(boxes)==5 and max(b['y'] for b in boxes)-min(b['y'] for b in boxes)<2,boxes
   assert [nav.nth(i).get_attribute('aria-label') for i in range(5)]==['Home','Explore','Create post','Reels','Profile']
   assert tab.locator('.app-header').get_by_role('link',name='Messages').is_visible()
   with tab.expect_file_chooser() as chooser:
    tab.locator('.mobile-nav').get_by_role('button',name='Create post').click()
   chooser.value.set_files(str(photo))
   tab.get_by_role('dialog',name='Create post').wait_for()
   tab.get_by_role('dialog',name='Create post').locator('.attachment img').wait_for()
   tab.keyboard.press('Escape');tab.wait_for_function('!document.querySelector("dialog[open]")')
   assert tab.evaluate('document.documentElement.scrollWidth<=innerWidth')
   shell=tab.locator('.dm-shell').bounding_box();navbox=tab.locator('.mobile-nav').bounding_box()
   assert abs(shell['y']+shell['height']-navbox['y'])<2 and tab.evaluate('document.documentElement.scrollHeight<=innerHeight+1'),(shell,navbox)
   tab.screenshot(path=str(out/'messages-mobile.png'),full_page=True)
   print('PASS mobile: full-screen chat over header/navigation, back to list, nav without wrapping or overflow')
   tab.set_viewport_size(dict(width=1440,height=1000));tab.goto(BASE+'/messages',wait_until='networkidle')
   tab.locator('.note-tile').filter(has_text='qa_friend').get_by_text('Coffee time').wait_for()
   tab.locator('.note-tile').filter(has_text='qa_friend').click()
   tab.wait_for_function('document.querySelector(".note-song-player.playing")')
   tab.wait_for_function('parseFloat(getComputedStyle(document.querySelector(".note-song-progress")).transform.split(",")[0].replace("matrix(",""))>0',timeout=8000)
   tab.locator('.note-song-player').click()
   tab.wait_for_function('!document.querySelector(".note-song-player.playing")')
   tab.get_by_label('Reply to qa_friend').fill('Count me in')
   tab.get_by_role('button',name='Send reply').click()
   tab.wait_for_function('!document.querySelector("dialog[open]")')
   assert any(method=='POST' and path.endswith('/reply') and path.startswith('notes/') and data.get('content')=='Count me in' for method,path,data in calls if isinstance(data,dict))
   tab.locator('.dm-row').first.click()
   tab.locator('.dm-note-reply').filter(has_text='You replied to their note').get_by_text('Coffee time').wait_for()
   tab.locator('.dm-note-reply').locator('.dm-note-song').get_by_text('Tone').wait_for()
   tab.locator('.dm-note-reply').scroll_into_view_if_needed();tab.screenshot(path=str(out/'note-reply-dm.png'))
   tab.goto(BASE+'/messages',wait_until='networkidle')
   print('PASS replying to a note shows the note bubble above the DM')
   tab.locator('.note-tile.own').click()
   tab.get_by_label('Note',exact=True).fill('Listening on repeat')
   tab.get_by_role('dialog',name='New note').locator('input[type=file]').set_input_files(str(song))
   tab.get_by_label('Clip start').wait_for()
   tab.get_by_label('Clip start').fill('10')
   tab.get_by_text('0:10 – 0:25').wait_for()
   tab.get_by_role('button',name='Preview').click()
   tab.get_by_role('button',name='Pause').wait_for()
   tab.screenshot(path=str(out/'note-composer.png'))
   tab.get_by_role('button',name='Share',exact=True).click()
   tab.wait_for_function('!document.querySelector("dialog[open]")')
   assert any(method=='POST' and path=='notes/audio' for method,path,data in calls)
   assert audio_uploads and audio_uploads[-1] < 1_000_000 and song.stat().st_size > 5_000_000,(audio_uploads,song.stat().st_size)
   assert any(method=='POST' and path=='notes' and data.get('audioId') and data.get('text')=='Listening on repeat' for method,path,data in calls if isinstance(data,dict))
   tab.locator('.note-tile.own').get_by_text('Listening on repeat').wait_for()
   tab.screenshot(path=str(out/'notes-tray.png'))
   print('PASS notes: tray with song, playing a clip, writing a note and picking 15 s of a song from the device')
   tab.set_viewport_size(dict(width=390,height=844))
   tab.goto(BASE+'/',wait_until='networkidle')
   tab.locator('.story-tile').filter(has_text='QA Friend').click()
   tab.locator('.story-overlay[open]').wait_for()
   tab.get_by_role('button',name='Pause story',exact=True).click()
   tab.wait_for_function('document.querySelector(".story-stage img")?.complete')
   frame=tab.locator('.story-frame').bounding_box()
   assert frame['x']==0 and frame['y']==0 and frame['width']==390 and abs(frame['height']-844)<2,frame
   assert any(path.endswith('/view') for method,path,data in calls)
   tab.wait_for_timeout(5600)
   assert tab.locator('.story-overlay[open]').count()==1,'paused story must not advance'
   tab.screenshot(path=str(out/'story-mobile.png'))
   tab.get_by_role('button',name='Close story',exact=True).click();tab.wait_for_function('!document.querySelector("dialog[open]")')
   tab.set_viewport_size(dict(width=1440,height=1000));tab.wait_for_timeout(200)
   tab.locator('.story-tile').filter(has_text='QA Friend').click()
   tab.locator('.story-overlay[open]').wait_for()
   assert 'blur' in tab.evaluate('getComputedStyle(document.querySelector(".story-overlay"),"::backdrop").backdropFilter')
   frame=tab.locator('.story-frame').bounding_box()
   assert frame['width']<frame['height'] and abs(frame['x']+frame['width']/2-720)<2,frame
   tab.wait_for_timeout(400);tab.screenshot(path=str(out/'story-desktop.png'))
   tab.wait_for_function('!document.querySelector("dialog[open]")',timeout=8000)
   print('PASS story viewing: full screen on mobile, blurred page on desktop, pause holds, auto-advance closes after the last story')
   tab.locator('.story-tile').filter(has_text='QA Friend').click()
   tab.locator('.story-overlay[open]').wait_for()
   tab.get_by_role('button',name='Like story').click()
   tab.get_by_role('button',name='Unlike story').wait_for()
   assert any(method=='POST' and path.endswith('/like') for method,path,data in calls)
   tab.wait_for_timeout(200)
   assert '[10,50,18]' in vibrations,'like should vibrate'
   tab.get_by_label('Reply to qa_friend').click()
   tab.locator('.story-reactions').wait_for()
   tab.wait_for_timeout(5600)
   assert tab.locator('.story-overlay[open]').count()==1,'typing a reply must pause the story'
   tab.get_by_label('Reply to qa_friend').fill('Love this!')
   tab.get_by_role('button',name='Send reply').click()
   tab.get_by_text('Sent to qa_friend.').wait_for()
   assert any(method=='POST' and path.endswith('/reply') and data.get('content')=='Love this!' for method,path,data in calls)
   tab.screenshot(path=str(out/'story-reply.png'))
   tab.get_by_role('button',name='Close story',exact=True).first.click();tab.wait_for_function('!document.querySelector("dialog[open]")')
   print('PASS story like (with haptic), quick reactions, reply pauses the story and sends a DM')
   tab.get_by_role('button',name='Add story',exact=True).click()
   tab.locator('.story-create-form input[type=file]').set_input_files(str(photo))
   tab.locator('.story-preview img').wait_for()
   tab.get_by_label('Story caption').fill('My browser story')
   tab.get_by_role('button',name='Share story',exact=True).click()
   tab.locator('.story-tile').filter(has_text='Your story').wait_for()
   tab.locator('.story-tile').filter(has_text='Your story').click()
   tab.get_by_role('button',name='1 view').click()
   tab.get_by_role('dialog',name='Story viewers').get_by_text('qa_friend').wait_for()
   assert tab.get_by_role('dialog',name='Story viewers').get_by_label('Liked your story').count()==1
   tab.screenshot(path=str(out/'story-viewers.png'))
   tab.get_by_role('button',name='Close viewers').click()
   print('PASS own story: live view count and viewer list with likes')
   tab.get_by_role('button',name='Delete story',exact=True).click()
   tab.get_by_role('dialog',name='Delete this story?',exact=True).get_by_role('button',name='Delete story',exact=True).click()
   tab.wait_for_function('!document.querySelector("dialog[open]")')
   print('PASS photo upload, caption publishing and own-story deletion')
   tab.get_by_role('button',name='Add story',exact=True).click()
   tab.locator('.story-create-form input[type=file]').set_input_files(str(video))
   tab.locator('.story-preview video').wait_for()
   tab.get_by_role('button',name='Share story',exact=True).click()
   tab.locator('.story-tile').filter(has_text='Your story').click()
   tab.wait_for_function('document.querySelector(".story-stage video")?.currentTime>0')
   tab.get_by_role('button',name='Delete story',exact=True).click()
   tab.get_by_role('dialog',name='Delete this story?',exact=True).get_by_role('button',name='Delete story',exact=True).click()
   tab.wait_for_function('!document.querySelector("dialog[open]")')
   print('PASS video-story upload, real playback and deletion')
   tab.get_by_role('button',name='Send to a user',exact=True).first.click()
   tab.get_by_role('button',name='Add to your story').click()
   tab.wait_for_function('!document.querySelector("dialog[open]")')
   assert any(method=='POST' and path=='stories' and data.get('postId')==POST['id'] for method,path,data in calls if isinstance(data,dict))
   tab.locator('.story-tile').filter(has_text='Your story').click()
   tab.locator('.story-reel-chip').get_by_text('@qa_friend').wait_for()
   tab.wait_for_function('document.querySelector(".story-stage video")?.currentTime>0')
   tab.wait_for_timeout(400);tab.screenshot(path=str(out/'story-reel.png'))
   tab.get_by_role('button',name='Close story',exact=True).first.click();tab.wait_for_function('!document.querySelector("dialog[open]")')
   print('PASS sharing a video post/Reel to the story and playing it with its Reel link')
   tab.set_viewport_size(dict(width=390,height=844));tab.goto(BASE+'/reels',wait_until='networkidle')
   with tab.expect_file_chooser() as chooser:
    tab.locator('.reels-mobile-nav').get_by_role('button',name='Create post').click()
   assert chooser.value.element.get_attribute('accept')=='video/*'
   chooser.value.set_files(str(video))
   dialog=tab.get_by_role('dialog',name='New Reel');dialog.wait_for()
   dialog.get_by_label('Caption').wait_for()
   assert tab.evaluate('!["TEXTAREA","INPUT"].includes(document.activeElement?.tagName)'),'no keyboard on open'
   assert tab.evaluate('document.activeElement?.id!=="reel-caption"'),'caption must not grab focus'
   dialog.get_by_role('button',name='Post',exact=True).wait_for()
   tab.wait_for_function('!document.querySelector(".reel-composer .rc-actions .reel-primary").disabled',timeout=15000)
   tab.wait_for_timeout(500)
   tab.screenshot(path=str(out/'reel-composer.png'))
   dialog.get_by_role('button',name='Add sound').click()
   with tab.expect_file_chooser() as chooser:
    dialog.get_by_role('button',name='Choose a song or video').click()
   chooser.value.set_files(str(song))
   dialog.get_by_label('Sound start').fill('5')
   dialog.get_by_role('button',name='Use this sound').click()
   tab.get_by_text('added to your Reel.').wait_for()
   assert any(method=='POST' and path.endswith('/soundtrack') for method,path,data in calls)
   tab.screenshot(path=str(out/'reel-sound.png'))
   dialog.get_by_role('button',name='Discard').click()
   with tab.expect_file_chooser() as chooser:
    dialog.get_by_role('button',name='Select video').click()
   chooser.value.set_files(str(video))
   dialog.get_by_label('Caption').wait_for()
   dialog.get_by_role('button',name='Discard').click()
   dialog.get_by_text('Upload a video').wait_for()
   tab.keyboard.press('Escape');tab.wait_for_function('!document.querySelector("dialog[open]")')
   tab.set_viewport_size(dict(width=1440,height=1000));tab.goto(BASE+'/',wait_until='networkidle')
   print('PASS + opens the gallery; TikTok-style Reel composer with Add sound; keyboard stays closed')
   before=len(vibrations)
   tab.get_by_role('button',name='Spoiler: show media').click()
   tab.wait_for_function('document.querySelector(".post-media-spoiler-wrap.revealing, .post-media-spoiler-wrap.is-gallery:not(.spoilered)")')
   tab.wait_for_timeout(200)
   assert '[8,30,8,30,16]' in vibrations[before:],vibrations
   print('PASS spoiler tap gives a haptic pulse')
   tab.goto(BASE+'/post/'+SPOILER_POST['id'],wait_until='networkidle')
   tab.get_by_role('button',name='Send a sticker').first.click()
   tab.get_by_role('dialog',name='Stickers').locator('.sticker-option').nth(1).click()
   tab.locator('.comment-sticker .sticker-view').first.wait_for()
   assert any(method=='POST' and path.endswith('/comments') and data.get('stickerId')==STICKERS[1]['id'] for method,path,data in calls)
   tab.get_by_role('button',name='Send a sticker').first.click()
   tab.get_by_role('tab',name='Your stickers').click()
   tab.get_by_role('dialog',name='Stickers').locator('input[type=file]').set_input_files(str(photo))
   tab.get_by_text('Sticker created.').wait_for()
   assert any(method=='POST' and path=='stickers' for method,path,data in calls)
   tab.get_by_role('dialog',name='Stickers').locator('.sticker-option').first.click()
   tab.wait_for_function('document.querySelectorAll(".comment-sticker").length===2')
   tab.screenshot(path=str(out/'comment-stickers.png'))
   print('PASS comment stickers: built-in pack, creating your own from a photo and sending it')
   tab.goto(BASE+'/',wait_until='networkidle')
   tab.get_by_role('button',name='Send to a user',exact=True).first.click()
   sheet=tab.get_by_role('dialog',name='Send to')
   sheet.get_by_role('button',name='Copy link').wait_for()
   with tab.expect_response(lambda r:'/search/users' in r.url):
    sheet.get_by_label('Search recipients').fill('qa_friend')
   sheet.locator('.send-person').first.click()
   sheet.locator('.send-person.on').wait_for()
   sheet.get_by_label('Add a message').fill('Watch this')
   tab.screenshot(path=str(out/'send-sheet.png'))
   sheet.get_by_role('button',name='Send',exact=True).click()
   tab.wait_for_function('!document.querySelector("dialog[open]")')
   assert any(path.startswith('messages/') and data.get('postId')==POST['id'] and data.get('content')=='Watch this' for method,path,data in calls if isinstance(data,dict))
   assert not errors,errors
   print('PASS recipient search and existing video-post sharing; no browser runtime errors')
   browser.close()
 except Exception:
  print("DIAGNOSTICS",json.dumps(dict(calls=calls,errors=errors)))
  raise
 finally:
  server.terminate()
  try: server.wait(timeout=10)
  except subprocess.TimeoutExpired:server.kill()
  log.close()
