"""One isolated login browser, operated through the authenticated admin relay."""
import base64
import queue
import threading
import time

class RemoteBrowser:
    def __init__(self, app, browser_context, lock):
        self.app,self.browser_context,self.lock=app,browser_context,lock
        self.commands=queue.Queue(maxsize=64)
        self.thread=None;self.owner=None;self.frame=None;self.message='';self.logged_in=False
        self.done=threading.Event()
    def status(self, owner):
        running=bool(self.thread and self.thread.is_alive())
        owned=owner==self.owner
        return {'running':running,'owned':owned,'frame':self.frame if owned and running else None,'width':1280,'height':900,'authenticated':self.logged_in if owned else False,'message':self.message if owned else 'Başka bir yönetici giriş ekranını kullanıyor.' if running else ''}
    def start(self, owner):
        from importer_automation import AutomationError
        if self.thread and self.thread.is_alive():
            if owner!=self.owner:raise AutomationError('Giriş ekranını başka bir yönetici kullanıyor.','BROWSER_BUSY',409)
            return {'loginWindowOpen':True,'remote':True}
        if not self.lock.acquire(blocking=False):raise AutomationError('Keşfet toplama işlemi devam ediyor.','BROWSER_BUSY',409)
        self.owner=owner;self.frame=None;self.message='Giriş ekranı açılıyor…';self.logged_in=False;self.done.clear()
        self.commands=queue.Queue(maxsize=64)
        self.thread=threading.Thread(target=self.run,daemon=True,name='importer-admin-login');self.thread.start()
        return {'loginWindowOpen':True,'remote':True,'message':'Giriş ekranı panelde açılıyor. Hesabına giriş yapıp Kaydet ve kapat seçeneğine bas.'}
    def command(self, owner, data):
        from importer_automation import AutomationError
        if owner!=self.owner or not self.thread or not self.thread.is_alive():raise AutomationError('Bu giriş ekranı açık değil veya sana ait değil.','BROWSER_NOT_OPEN',403)
        action=data.get('action')
        allowed=('click','down','move','up','text','key','scroll','reload','save','cancel')
        if action not in allowed:raise AutomationError('Geçersiz tarayıcı işlemi.','VALIDATION',400)
        if action in ('click','down','move','up'):
            if any(type(data.get(k)) not in (int,float) or not 0<=data[k]<=bound for k,bound in [('x',1280),('y',900)]):raise AutomationError('Geçersiz koordinat.','VALIDATION',400)
        if action=='text' and (not isinstance(data.get('text'),str) or len(data['text'])>2000):raise AutomationError('Geçersiz giriş metni.','VALIDATION',400)
        if action=='key' and data.get('key') not in ('Enter','Tab','Shift+Tab','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Control+A','Home','End','Escape'):raise AutomationError('Geçersiz tuş.','VALIDATION',400)
        if action=='scroll' and (type(data.get('delta')) not in (int,float) or abs(data['delta'])>2000):raise AutomationError('Geçersiz kaydırma.','VALIDATION',400)
        if action=='save' and not self.logged_in:raise AutomationError('Giriş henüz tamamlanmadı. Gerçek kaynak hesabına giriş yap veya doğrulamayı tamamla.','TIKTOK_LOGIN_REQUIRED',409)
        try:self.commands.put_nowait(dict(data))
        except queue.Full:raise AutomationError('Tarayıcı işlemleri sırada; biraz bekle.','BROWSER_BUSY',429)
        if action in ('save','cancel'):
            self.done.wait(8)
        return {'ok':True,'saved':action=='save','closed':not self.thread.is_alive()}
    def run(self):
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                context=self.browser_context(p,self.app.STATE,True)
                try:
                    page=context.pages[0] if context.pages else context.new_page()
                    page.goto('https://www.tiktok.com/foryou',wait_until='domcontentloaded',timeout=45000)
                    deadline=time.monotonic()+900
                    self.message='QR kodu veya giriş formunu kullan. Ekrana tıklayıp yazabilirsin.'
                    while time.monotonic()<deadline and context.pages:
                        page=context.pages[-1]
                        self.logged_in=any(c['name'] in ('sessionid','sessionid_ss','sid_tt') and c.get('value') for c in context.cookies('https://www.tiktok.com'))
                        while not self.commands.empty():
                            command=self.commands.get_nowait();action=command['action']
                            if action in ('save','cancel'):return
                            if action=='click':page.mouse.click(command['x'],command['y'])
                            elif action=='down':page.mouse.move(command['x'],command['y']);page.mouse.down()
                            elif action=='move':page.mouse.move(command['x'],command['y'])
                            elif action=='up':page.mouse.move(command['x'],command['y']);page.mouse.up()
                            elif action=='text':page.keyboard.insert_text(command['text'])
                            elif action=='key':page.keyboard.press(command['key'])
                            elif action=='scroll':page.mouse.wheel(0,command['delta'])
                            elif action=='reload':page.reload(wait_until='domcontentloaded',timeout=30000)
                        self.frame=base64.b64encode(page.screenshot(type='jpeg',quality=50,timeout=10000)).decode('ascii')
                        page.wait_for_timeout(400)
                    self.message='Giriş ekranının süresi doldu; tekrar açabilirsin.'
                finally:context.close()
        except Exception:
            self.message='Kaynak giriş ekranı açılamadı. Worker tarayıcı kurulumu, ağ erişimi veya kaynak doğrulaması gerekiyor.'
        finally:self.frame=None;self.lock.release();self.done.set()
