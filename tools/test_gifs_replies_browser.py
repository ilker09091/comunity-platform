"""GIFs and WhatsApp-style replies in real Chrome, with a local stand-in for the GIPHY API.
Isolated QA database (127.0.0.1:55433); GIF media itself loads from GIPHY's CDN.
"""
import io, json, math, os, struct, subprocess, tempfile, threading, time, wave, zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import test_calls_browser as qa
from playwright.sync_api import sync_playwright

qa.DB='circle_gif_test'
qa.OUT=qa.ROOT/'.tools/gif-qa'
ROOT, BASE, API, OUT=qa.ROOT,qa.BASE,qa.API,qa.OUT
GIF_IDS=['3o7TKSjRrfIPjeiVyM','l0MYt5jPR6QX5pnqM','26ufdipQqU2lhNA4g','xT9IgG50Fb7Mi0prBC','3oEjI6SIIHBdRxXI40','l3q2K5jinAlChoCLS']

def gif(id):
    base=f'https://media0.giphy.com/media/{id}'
    return {'id':id,'title':f'GIF {id[:4]}','images':{
        'fixed_width':{'url':f'{base}/200w.gif','webp':f'{base}/200w.webp','mp4':f'{base}/200w.mp4','width':'200','height':'150'},
        'fixed_width_small':{'url':f'{base}/100w.gif','webp':f'{base}/100w.webp','width':'100','height':'75'}}}

class Giphy(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        path=urlparse(self.path).path
        body={'data':[gif(i) for i in GIF_IDS],'pagination':{'total_count':len(GIF_IDS)}} if path in ('/gifs/trending','/gifs/search') else {'data':gif(path.rsplit('/',1)[-1])}
        data=json.dumps(body).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

def tone_wav(seconds=3.0,rate=16000):
    buffer=io.BytesIO()
    with wave.open(buffer,'wb') as out:
        out.setnchannels(1);out.setsampwidth(2);out.setframerate(rate)
        out.writeframes(b''.join(struct.pack('<h',int(8000*math.sin(2*math.pi*300*i/rate)*abs(math.sin(i/rate*4)))) for i in range(int(seconds*rate))))
    return buffer.getvalue()
def png(width=480,height=360):
    chunk=lambda kind,data:struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    rows=b''.join(b'\x00'+bytes(v for x in range(width) for v in (x*255//width,140,y*255//height)) for y in range(height))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')

def run():
    OUT.mkdir(exist_ok=True)
    giphy=ThreadingHTTPServer(('127.0.0.1',0),Giphy);threading.Thread(target=giphy.serve_forever,daemon=True).start()
    sql=lambda query,database=qa.DB:qa.sql(query,database)
    if not sql(f"SELECT 1 FROM pg_database WHERE datname='{qa.DB}'",'postgres'):sql(f'CREATE DATABASE {qa.DB}','postgres')
    env={**os.environ,'NODE_ENV':'production','PORT':'3014','DB_HOST':'127.0.0.1','DB_PORT':'55433','DB_USERNAME':'postgres','DB_PASSWORD':'','DB_NAME':qa.DB,
         'JWT_SECRET':'qa-gif-access-unique-long-local-secret','JWT_REFRESH_SECRET':'qa-gif-refresh-unique-long-local-secret',
         'PUBLIC_BASE_URL':API,'CORS_ORIGINS':BASE,'MEDIA_LOCAL_DIR':str(Path(tempfile.gettempdir())/'circle-gif-media'),
         'MEDIA_PUBLIC_URL':'/api/backend','THROTTLE_ENABLED':'false','MEDIA_CLEANUP_ENABLED':'false','CALL_TURN_URLS':'','CALL_TURN_SECRET':'',
         'GIPHY_API_KEY':'qa-key','GIPHY_API_URL':f'http://127.0.0.1:{giphy.server_address[1]}'}
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
            def call(context,path,body=None,multipart=None):
                r=context.request.post(BASE+'/api/backend/api/'+path,**({'multipart':multipart} if multipart else {'data':body or {}}),headers={'X-Social-Client':'web','Origin':BASE})
                assert r.ok,(path,r.status,r.text());return r.json() if r.status!=204 else None
            stamp=str(int(time.time()))
            me=call(a,'auth/register',{'username':f'lale_{stamp}','email':f'lale_{stamp}@example.com','password':'qaPassword123!','displayName':'Lale Er'})['user']
            peer=call(b,'auth/register',{'username':f'kerem_{stamp}','email':f'kerem_{stamp}@example.com','password':'qaPassword123!','displayName':'Kerem Tan'})['user']
            call(a,f"users/{peer['id']}/follow");call(b,f"users/{me['id']}/follow")
            call(b,f"messages/{me['id']}",{'content':'Listen to this 👇'})
            audio=call(b,'messages/audio',multipart={'file':{'name':'v.wav','mimeType':'audio/wav','buffer':tone_wav()}})
            call(b,f"messages/{me['id']}",{'audioId':audio['id']})
            photo=call(b,'media',multipart={'file':{'name':'p.png','mimeType':'image/png','buffer':png()}})
            call(b,f"messages/{me['id']}",{'mediaId':photo['id']})
            post=call(b,'posts',{'content':'Friday mood?'})
            state=a.storage_state()
            errors=[]
            # Mobile: dragging across a voice note seeks it and never opens a reply.
            context=browser.new_context(storage_state=state,viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
            context.add_init_script("localStorage.setItem('circle:notify-dismissed',String(Date.now()));localStorage.setItem('circle:app-banner-dismissed',String(Date.now()))")
            page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(BASE+f"/messages?to={peer['username']}");page.locator('.wa-voice-wave').first.wait_for()
            box=page.locator('.wa-voice-wave').first.bounding_box()
            cdp=context.new_cdp_session(page);y=box['y']+box['height']/2
            cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':box['x']+10,'y':y}]})
            for step in range(1,9):cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':box['x']+10+step*18,'y':y}]})
            page.wait_for_timeout(600)
            cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
            page.wait_for_timeout(300)
            assert page.locator('.dm-replying').count()==0,'Scrubbing a voice note must not start a reply'
            assert page.locator('.dm-menu-layer').count()==0,'…nor open the message menu'
            assert float(page.locator('.wa-voice-wave').first.get_attribute('aria-valuenow') or 0)>0,'The drag seeks the voice note'
            print('PASS dragging a voice note scrubs it without swiping to reply or opening the menu')
            context.close()
            # Desktop: reply to the voice note with a GIF, and to the photo with text.
            for theme in ['light','dark']:
                context=browser.new_context(storage_state=state,viewport={'width':1280,'height':900})
                context.add_init_script(f"localStorage.setItem('circle-theme','{theme}');localStorage.setItem('circle:notify-dismissed',String(Date.now()));localStorage.setItem('circle:app-banner-dismissed',String(Date.now()))")
                page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(BASE+f"/messages?to={peer['username']}");page.locator('.wa-voice').first.wait_for()
                if theme=='light':
                    voice=page.locator('li.dm-message',has=page.locator('.wa-voice')).first
                    voice.hover();voice.get_by_role('button',name='Reply').click()
                    page.locator('.dm-replying').get_by_text('Voice message 0:03').wait_for()
                    page.get_by_role('button',name='Send a sticker').click()
                    page.get_by_role('tab',name='GIFs').click()
                    page.locator('.gif-option').first.wait_for(timeout=15000)
                    page.screenshot(path=str(OUT/'gif-tray.png'))
                    page.locator('.gif-option').first.click()
                    page.locator('.dm-reply-head .dm-quote').get_by_text('Voice message 0:03').wait_for()
                    page.locator('.dm-message .dm-gif').first.wait_for()
                    assert page.locator('.dm-replying').count()==0
                    photo_msg=page.locator('li.dm-message',has=page.locator('.dm-photo')).first
                    photo_msg.hover();photo_msg.get_by_role('button',name='Reply').click()
                    page.locator('.dm-replying .dm-quote-thumb').wait_for()
                    page.locator('textarea[aria-label="Message"]').fill('Great shot!');page.keyboard.press('Enter')
                    page.locator('.dm-bubble .dm-quote .dm-quote-thumb').first.wait_for()
                    print('PASS reply to a voice note shows its length, GIF replies carry the quote on top, photo quotes show a thumbnail')
                page.wait_for_timeout(800)
                page.screenshot(path=str(OUT/f'chat-{theme}.png'))
                page.goto(BASE+f"/post/{post['id']}");page.wait_for_load_state('networkidle')
                if theme=='light':
                    page.locator('.comment-sticker-button').first.click()
                    page.get_by_role('tab',name='GIFs').click()
                    page.locator('.gif-option').first.wait_for(timeout=15000)
                    page.locator('.gif-option').first.click()
                    page.locator('.comment-item .comment-gif').first.wait_for()
                    print('PASS GIF comments')
                page.wait_for_timeout(800)
                page.screenshot(path=str(OUT/f'comments-{theme}.png'))
                context.close()
            browser.close()
            assert not errors,errors
            print('PASS no browser page errors')
    finally:
        giphy.shutdown()
        for process in reversed(processes):
            process.terminate()
            try:process.wait(timeout=8)
            except subprocess.TimeoutExpired:process.kill()
        for log in logs:log.close()

if __name__=='__main__':run()
