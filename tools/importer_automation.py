"""Durable local queue, scheduling and an isolated TikTok browser profile."""
from __future__ import annotations

import base64
import ctypes
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
import hashlib
from datetime import datetime, timedelta, timezone
from urllib import request
from functools import wraps


class AutomationError(Exception):
    def __init__(self, message, code='AUTOMATION_ERROR', status=400):
        super().__init__(message)
        self.code, self.status = code, status


def protect(value, decrypt=False):
    """Windows-user DPAPI encryption, not plaintext/base64 credential storage."""
    if os.name != 'nt' or os.getenv('IMPORTER_DEPLOYED')=='1':
        secret_path=os.getenv('IMPORTER_SECRET_FILE',str(Path(__file__).resolve().parents[1]/'server/storage/importer-control/key'))
        try:
            result=subprocess.run(['node',str(Path(__file__).with_name('importer_secrets.mjs')),'decrypt' if decrypt else 'encrypt'],input=json.dumps({'value':value}),capture_output=True,text=True,encoding='utf-8',timeout=10,env={**os.environ,'IMPORTER_SECRET_FILE':secret_path},creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            data=json.loads(result.stdout)
            if result.returncode or 'value' not in data:raise ValueError()
            return data['value']
        except Exception:
            raise AutomationError('Güvenli worker anahtarı hazır değil veya değişmiş. Circle backend ve importer kontrol volume’ünü kontrol edip oturumu yeniden bağlayın.','SECRET_STORAGE_UNAVAILABLE',503) from None
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    raw = base64.b64decode(value) if decrypt else value.encode('utf-8')
    buffer = ctypes.create_string_buffer(raw)
    incoming = Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    operation = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    operation.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                          ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    operation.restype = wintypes.BOOL
    if not operation(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
        if decrypt:
            raise AutomationError('Windows oturum anahtarını çözemedi. Circle oturumunu yeniden bağlayın.', 'CIRCLE_RECONNECT_REQUIRED', 401)
        raise AutomationError('Windows güvenli oturum saklamayı başlatamadı. Aracı start-importer.cmd ile kendi Windows oturumunuzda açın.', 'SECRET_STORAGE_UNAVAILABLE', 503)
    try:
        result = ctypes.string_at(outgoing.data, outgoing.size)
        return result.decode('utf-8') if decrypt else base64.b64encode(result).decode('ascii')
    finally:
        kernel.LocalFree(outgoing.data)


FEED_CARDS = r"""() => {
  const visible = s => [...document.querySelectorAll(s)].some(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height);
  if (visible('[data-e2e="top-login-button"], [data-e2e="nav-login"]')) return {signedOut:true,videos:[]};
  const videos=[];
  for(const card of document.querySelectorAll('[data-e2e="feed-video"], [data-e2e="recommend-list-item-container"], article')) {
    const player=card.querySelector('video'); if(!player) continue;
    let item=null;
    const fiberKey=Object.keys(card).find(k=>k.startsWith('__reactFiber$'));
    for(let f=fiberKey && card[fiberKey], i=0;f && i<12;f=f.return,i++) {
      const v=f.memoizedProps?.item; if(v?.video && v?.author){item=v;break;}
    }
    if(item && ['isAd','imagePost','privateItem','isProhibited','liveRoom'].some(k=>item[k])) continue;
    const wrapper=card.querySelector('[id^="xgwrapper-"]');
    const id=wrapper?.id.match(/-(\d{1,30})$/)?.[1] || (typeof item?.id==='string' ? item.id : null);
    const profile=[...card.querySelectorAll('a[href]')].map(a=>a.href.match(/tiktok\.com\/@([a-zA-Z0-9_.-]+)(?:\/?(?:\?|$))/)?.[1]).find(Boolean);
    const creator=profile || item?.author?.uniqueId;
    if(!id || !/^[a-zA-Z0-9_.-]{1,128}$/.test(creator || '')) continue;
    const duration=Number.isFinite(player.duration) && player.duration>0 ? player.duration : item?.video?.duration;
    let thumbnail=player.poster || item?.video?.cover || item?.video?.originCover || null;
    if(thumbnail && !thumbnail.startsWith('https://')) thumbnail=null;
    videos.push({id,creator,description:(card.querySelector('[data-e2e="video-desc"]')?.textContent || item?.desc || '').trim().slice(0,1000),
      sourceUrl:`https://www.tiktok.com/@${creator}/video/${id}`,thumbnailUrl:thumbnail,
      durationSeconds:Number.isFinite(duration)?duration:null,canImport:true,imported:false});
  }
  return {signedOut:false,videos};
}"""


def browser_context(playwright, state, headless):
    edge = Path(os.getenv('PROGRAMFILES(X86)', 'C:/Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe'
    try:
        return playwright.chromium.launch_persistent_context(str(state / 'tiktok-browser'),
            channel=os.getenv('IMPORTER_BROWSER_CHANNEL') or ('msedge' if edge.is_file() else 'chrome' if os.name=='nt' else None), headless=headless,
            viewport={'width': 1280, 'height': 900}, timeout=25000)
    except Exception:
        raise AutomationError('TikTok penceresini kapatıp tekrar deneyin. Edge/Chrome kurulu olmalı; başka bir işlem aynı otomasyon profilini kullanıyor olabilir.', 'TIKTOK_BROWSER_BUSY', 409) from None


def collect_personal(state, limit, login=False):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        context = browser_context(playwright, state, not login)
        try:
            if not login and not any(cookie['name'] in ('sessionid','sessionid_ss','sid_tt') and cookie.get('value')
                                     for cookie in context.cookies('https://www.tiktok.com')):
                raise AutomationError('TikTok otomasyon penceresine henüz giriş yapılmamış. TikTok hesabını bağla düğmesiyle giriş yapıp pencereyi kapatın.', 'TIKTOK_LOGIN_REQUIRED',401)
            page = context.pages[0] if context.pages else context.new_page()
            page.goto('https://www.tiktok.com/foryou', wait_until='domcontentloaded', timeout=45000)
            if login:
                # A visible window is opened only by the explicit "TikTok hesabını bağla" action.
                # Authentication stays inside this isolated browser profile.
                deadline = time.monotonic() + 900
                while context.pages and time.monotonic() < deadline:
                    try:
                        page.wait_for_timeout(1000)
                    except Exception:
                        break
                return {'loginWindowClosed': True}
            collected = {}
            deadline = time.monotonic() + 100
            # Do not conclude "signed in" before TikTok has rendered the feed/navigation.
            page.wait_for_timeout(3500)
            while len(collected) < limit and time.monotonic() < deadline:
                result = page.evaluate(FEED_CARDS)
                if result['signedOut']:
                    raise AutomationError('Otomasyon TikTok hesabına giriş yapılmamış. TikTok hesabını bağla düğmesiyle giriş yapıp pencereyi kapatın.', 'TIKTOK_LOGIN_REQUIRED', 401)
                for video in result['videos']:
                    collected.setdefault(video['id'], video)
                if len(collected) >= limit:
                    break
                next_button = page.locator('[data-e2e="feed-navigation-next"]')
                if next_button.count() and next_button.first.is_visible():
                    next_button.first.click(timeout=3000)
                else:
                    cards = page.locator('[data-e2e="feed-video"]')
                    if cards.count():
                        cards.last.scroll_into_view_if_needed(timeout=3000)
                    page.mouse.move(800, 650)
                    page.mouse.wheel(0, 850)
                page.wait_for_timeout(1500)
            if not collected:
                raise AutomationError('Hesabın Sizin İçin akışı video yüklemedi. Açılan TikTok penceresinde giriş/doğrulama durumunu kontrol edin.', 'TIKTOK_PERSONAL_UNAVAILABLE', 422)
            return {'videos': list(collected.values())[:limit]}
        finally:
            context.close()


def submission(operation):
    """Serialize UI submissions and database changes without blocking progress polling."""
    @wraps(operation)
    def locked(self, *args, **kwargs):
        with self.submission_lock:
            return operation(self, *args, **kwargs)
    return locked


class Automation:
    def __init__(self, app):
        self.app = app
        self.wake = threading.Event()
        self.stop = threading.Event()
        self.browser_lock = threading.Lock()
        from importer_remote_browser import RemoteBrowser
        self.remote_browser=RemoteBrowser(app,browser_context,self.browser_lock)
        self.login_process = None
        self.worker = None
        self.configuration_lock = threading.RLock()
        self.submission_lock = threading.RLock()
        self.worker_error = ''

    def initialize(self):
        with self.app.db() as c:
            c.executescript('''
              CREATE TABLE IF NOT EXISTS worker_credentials (
                destination TEXT, author TEXT, secret TEXT NOT NULL,
                PRIMARY KEY(destination,author));
              CREATE TABLE IF NOT EXISTS worker_batches (
                id TEXT PRIMARY KEY, destination TEXT, author TEXT, status TEXT,
                config TEXT, created REAL, updated REAL, message TEXT DEFAULT '');
              CREATE TABLE IF NOT EXISTS worker_items (
                batch TEXT REFERENCES worker_batches(id), position INTEGER, video TEXT,
                source TEXT, status TEXT DEFAULT 'queued', progress REAL DEFAULT 0,
                stage TEXT DEFAULT 'Sırada', code TEXT DEFAULT '', message TEXT DEFAULT '',
                post TEXT, attempts INTEGER DEFAULT 0, next_attempt REAL DEFAULT 0,
                PRIMARY KEY(batch,video));
              CREATE TABLE IF NOT EXISTS worker_schedules (
                id TEXT PRIMARY KEY, destination TEXT, author TEXT, config TEXT,
                enabled INTEGER, next_run REAL, last_run REAL, failures INTEGER DEFAULT 0,
                message TEXT DEFAULT '', batch TEXT, UNIQUE(destination,author));
            ''')
            c.execute("UPDATE worker_items SET status='queued',stage='Yeniden başlatmadan sonra sırada' WHERE status='processing'")
            c.execute("UPDATE worker_batches SET status='queued' WHERE status='processing'")
            if 'finished' not in {r['name'] for r in c.execute('PRAGMA table_info(worker_items)')}:
                c.execute('ALTER TABLE worker_items ADD COLUMN finished REAL DEFAULT 0')
                c.execute("UPDATE worker_items SET finished=(SELECT updated FROM worker_batches WHERE id=batch) WHERE status='imported'")

        with self.app.db() as c:
            columns={r['name'] for r in c.execute('PRAGMA table_info(worker_credentials)')}
            if 'admin_required' not in columns:c.execute('ALTER TABLE worker_credentials ADD COLUMN admin_required INTEGER NOT NULL DEFAULT 0')

    def start(self):
        if not self.worker or not self.worker.is_alive():
            self.worker = threading.Thread(target=self.loop, name='circle-import-worker', daemon=True)
            self.worker.start()

    def identify(self, session):
        user = session.call('users/me')
        author = user.get('id')
        if not re.fullmatch(r'[0-9a-f-]{36}', str(author)):
            raise AutomationError('Circle geçerli hesap döndürmedi.', 'INVALID_RESPONSE', 502)
        return author, user

    def remember(self, session, author):
        encrypted = protect(session.cookie())
        with self.app.db() as c:
            c.execute('INSERT OR REPLACE INTO worker_credentials(destination,author,secret,admin_required) VALUES(?,?,?,?)', (self.app.CIRCLE, author, encrypted,int(getattr(session,'admin_required',False) or os.getenv('IMPORTER_DEPLOYED')=='1')))

    @submission
    def connect(self, session):
        if self.app.ACTIVE:
            raise AutomationError('Video aktarımı bitince Circle oturumunu yeniden bağlayın.', 'IMPORT_BUSY',409)
        author,user = self.identify(session)
        protect('storage-availability-check')
        result = session.call('auth/background-session', {})
        if result.get('user',{}).get('id') != author or not result.get('accessToken') or not result.get('refreshToken'):
            raise AutomationError('Circle arka plan oturumu doğrulanmadı. Güncel backend çalışmalı.', 'INVALID_RESPONSE',502)
        background = self.app.CircleSession(f"social_access={result['accessToken']}; social_refresh={result['refreshToken']}")
        background.admin_required=getattr(session,'admin_required',False)
        self.remember(background,author)
        return {'connected':True,'username':user.get('username','')}

    def ensure_connected(self, session, author):
        with self.app.db() as c:
            present=c.execute('SELECT 1 FROM worker_credentials WHERE destination=? AND author=?',(self.app.CIRCLE,author)).fetchone()
        if not present:
            self.connect(session)
        else:
            try:
                background=self.session_for(author)
                # An admin submission must not reuse a legacy unprivileged background chain.
                if getattr(session,'admin_required',False) and not getattr(background,'admin_required',False):
                    self.connect(session)
            except (self.app.Failure,AutomationError) as exc:
                if exc.code not in ('CIRCLE_LOGIN_REQUIRED','CIRCLE_RECONNECT_REQUIRED','SECRET_STORAGE_UNAVAILABLE'):
                    raise
                # The current authenticated admin request can replace an expired saved session.
                self.connect(session)

    def session_for(self, author):
        with self.app.db() as c:
            row = c.execute('SELECT secret,admin_required FROM worker_credentials WHERE destination=? AND author=?', (self.app.CIRCLE, author)).fetchone()
        if not row:
            raise AutomationError('Arka plan Circle oturumunu yeniden bağlayın.', 'CIRCLE_RECONNECT_REQUIRED', 401)
        session = self.app.CircleSession(protect(row['secret'], decrypt=True))
        session.on_rotation = lambda value: self.remember(value,author)
        actual,user=self.identify(session)
        session.admin_required=bool(row['admin_required']) or os.getenv('IMPORTER_DEPLOYED')=='1'
        if session.admin_required and user.get('role') not in ('ADMIN','SUPER_ADMIN'):
            raise AutomationError('Yönetici yetkisi değişmiş; otomasyon durduruldu.','CIRCLE_ADMIN_REVOKED',401)
        if actual != author:
            raise AutomationError('Circle hesabı değişmiş; kuyruk güvenlik için durdu.', 'CIRCLE_ACCOUNT_CHANGED', 401)
        self.remember(session, author)
        return session

    def config(self, data):
        mode = data.get('mode', 'personal_auto')
        if mode not in ('personal_auto', 'explore', 'profile'):
            raise AutomationError('Otomasyon için kişisel arka plan Keşfet, genel Keşfet veya profil seçin.', 'VALIDATION')
        account = str(data.get('account', '')).strip()
        if mode == 'profile':
            self.app.source_url(account)
        count = self.app.video_limit(data.get('limit', 10))
        try:
            values=[data.get('intervalMinutes',30),data.get('dailyLimit',1000),data.get('maxRuns',0)]
            if any(not re.fullmatch(r'\d{1,4}',str(v)) for v in values):
                raise ValueError()
            interval,daily,max_runs=map(int,values)
        except (ValueError, TypeError):
            raise AutomationError('Aralık, günlük limit ve çalışma sınırı tam sayı olmalı.', 'VALIDATION') from None
        if not 1 <= interval <= 1440 or not 1 <= daily <= 1000 or not 0 <= max_runs <= 1000:
            raise AutomationError('Aralık 1–1440 dakika, günlük limit 1–1000, çalışma sınırı 0–1000 olmalı.', 'VALIDATION')
        scheduled_hour = data.get('scheduledHour')
        scheduled_minute = data.get('scheduledMinute')
        if scheduled_hour is not None or scheduled_minute is not None:
            try:
                scheduled_hour = int(scheduled_hour)
                scheduled_minute = int(scheduled_minute)
            except (ValueError, TypeError):
                raise AutomationError('Zamanlanan saat geçersiz.', 'VALIDATION') from None
            if not 0 <= scheduled_hour <= 23 or not 0 <= scheduled_minute <= 59:
                raise AutomationError('Saat 0–23, dakika 0–59 arasında olmalı.', 'VALIDATION')
        return {'mode': mode, 'account': account, 'limit': count, 'intervalMinutes': interval,
                'dailyLimit': daily, 'maxRuns': max_runs, 'runs': 0,
                'scheduledHour': scheduled_hour, 'scheduledMinute': scheduled_minute}

    def next_scheduled_run(self, config):
        hour = config.get('scheduledHour')
        minute = config.get('scheduledMinute')
        if hour is None or minute is None:
            return time.time()
        now = time.time()
        local = time.localtime(now)
        target = time.mktime((local.tm_year, local.tm_mon, local.tm_mday, int(hour), int(minute), 0, 0, 0, -1))
        if target <= now:
            target += 86400
        return target

    def create_batch(self, author, config, sources):
        if not sources:
            raise AutomationError('Yeni ve aktarılabilir video bulunamadı.', 'NO_NEW_VIDEOS', 409)
        if len(sources) > 100:
            raise AutomationError('Bir kuyruk en fazla 100 video içerebilir.', 'VALIDATION')
        identifier, now = uuid.uuid4().hex, time.time()
        with self.app.db() as c:
            active = c.execute("SELECT count(*) FROM worker_batches WHERE destination=? AND author=? AND status IN ('queued','processing','paused')", (self.app.CIRCLE, author)).fetchone()[0]
            if active >= 10:
                raise AutomationError('En fazla 10 açık kuyruk olabilir. Önce eski kuyrukları bitirin/iptal edin.', 'QUEUE_FULL', 409)
            c.execute('INSERT INTO worker_batches(id,destination,author,status,config,created,updated) VALUES(?,?,?,?,?,?,?)',
                      (identifier, self.app.CIRCLE, author, 'queued', json.dumps(config), now, now))
            for position, (video, source) in enumerate(sources.items()):
                imported = c.execute('SELECT post FROM imports WHERE destination=? AND author=? AND video=?', (self.app.CIRCLE, author, video)).fetchone()
                c.execute('INSERT INTO worker_items(batch,position,video,source,status,post,progress) VALUES(?,?,?,?,?,?,?)',
                          (identifier, position, video, json.dumps(source), 'duplicate' if imported and imported['post'] else 'queued',
                           imported['post'] if imported else None, 100 if imported and imported['post'] else 0))
        self.wake.set()
        return identifier

    @submission
    def enqueue_selected(self, data, session):
        author, _ = self.identify(session)
        ids = data.get('videoIds')
        if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or any(not isinstance(v, str) for v in ids):
            raise AutomationError('1–100 video seçin.', 'VALIDATION')
        source_key = self.app.source_key(data.get('account', ''), data.get('mode', 'profile'))
        sources = {}
        with self.app.LOCK:
            for identifier in ids:
                source = self.app.SOURCES.get((source_key, identifier))
                if not source:
                    raise AutomationError('Önce gerçek videoları listeleyin.', 'VIDEO_NOT_LISTED')
                sources[identifier] = dict(source)
        self.ensure_connected(session, author)
        identifier = self.create_batch(author, {'mode': data.get('mode'), 'account': data.get('account')}, sources)
        return {'batchId': identifier, 'status': 'queued', 'count': len(sources)}

    def batch(self, identifier, author):
        with self.app.db() as c:
            row = c.execute('SELECT * FROM worker_batches WHERE id=? AND author=? AND destination=?', (identifier, author, self.app.CIRCLE)).fetchone()
            if not row:
                raise AutomationError('Kuyruk bulunamadı.', 'JOB_NOT_FOUND', 404)
            items = [dict(v) for v in c.execute('SELECT video,status,progress,stage,code,message,post AS postId,attempts FROM worker_items WHERE batch=? ORDER BY position', (identifier,))]
        counts = {status: sum(i['status'] == status for i in items) for status in ('imported','duplicate','failed','cancelled','queued','processing')}
        return {'id': identifier, 'status': row['status'], 'created': row['created'], 'message': row['message'],
                'total': len(items), 'items': items, 'counts': counts,
                'progress': sum(i['progress'] if i['status'] in ('queued','processing') else 100 for i in items) / max(1, len(items))}

    def state(self, session):
        author, user = self.identify(session)
        with self.app.db() as c:
            batches = [v['id'] for v in c.execute("SELECT id FROM worker_batches WHERE author=? AND destination=? ORDER BY CASE WHEN status IN ('queued','processing','paused') THEN 0 ELSE 1 END,created DESC LIMIT 20", (author, self.app.CIRCLE))]
            schedule = c.execute('SELECT * FROM worker_schedules WHERE author=? AND destination=?', (author, self.app.CIRCLE)).fetchone()
            credentials = c.execute('SELECT 1 FROM worker_credentials WHERE author=? AND destination=?', (author, self.app.CIRCLE)).fetchone()
        return {'user': {'id': author, 'username': user.get('username', ''), 'displayName': user.get('displayName', '')},
                'connected': bool(credentials), 'batches': [self.batch(v, author) for v in batches],
                'schedule': {**{k: schedule[k] for k in ('id','enabled','next_run','last_run','failures','message','batch')},
                             'config': json.loads(schedule['config'])} if schedule else None,
                'browser': self.browser_status(), 'workerAlive': bool(self.worker and self.worker.is_alive()), 'workerError':self.worker_error}

    @submission
    def control(self, data, session):
        author, _ = self.identify(session)
        identifier, action = data.get('batchId'), data.get('action')
        batch = self.batch(identifier, author)
        if action in ('resume','retry'):
            self.ensure_connected(session, author)
        with self.app.db() as c:
            if action == 'pause' and batch['status'] in ('queued','processing'):
                c.execute("UPDATE worker_batches SET status='paused',updated=? WHERE id=?", (time.time(), identifier))
            elif action == 'resume' and batch['status'] == 'paused':
                c.execute("UPDATE worker_batches SET status='queued',message='',updated=? WHERE id=?", (time.time(), identifier))
            elif action == 'cancel' and batch['status'] in ('queued','processing','paused'):
                c.execute("UPDATE worker_batches SET status='cancelled',updated=? WHERE id=?", (time.time(), identifier))
                c.execute("UPDATE worker_items SET status='cancelled',stage='İptal edildi' WHERE batch=? AND status='queued'", (identifier,))
            elif action == 'retry' and batch['status'] in ('completed','failed','paused'):
                c.execute("UPDATE worker_items SET status='queued',progress=0,stage='Yeniden sırada',message='',code='',attempts=0,next_attempt=0 WHERE batch=? AND status='failed'", (identifier,))
                c.execute("UPDATE worker_batches SET status='queued',message='',updated=? WHERE id=?", (time.time(), identifier))
            else:
                raise AutomationError('Bu kuyruk için işlem uygun değil.', 'VALIDATION')
        self.wake.set()
        return self.batch(identifier, author)

    @submission
    def schedule(self, data, session):
        author, _ = self.identify(session)
        if data.get('enabled') is False:
            with self.app.db() as c:
                c.execute('UPDATE worker_schedules SET enabled=0 WHERE destination=? AND author=?', (self.app.CIRCLE, author))
            return {'enabled': False, 'message': 'Yeni otomatik turlar durduruldu. Mevcut kuyruğu ayrıca duraklatabilirsiniz.'}
        config = self.config(data)
        self.ensure_connected(session, author)
        with self.app.db() as c:
            old = c.execute('SELECT id FROM worker_schedules WHERE destination=? AND author=?', (self.app.CIRCLE, author)).fetchone()
            identifier = old['id'] if old else uuid.uuid4().hex
            first_run = self.next_scheduled_run(config)
            message = 'Zamanlandı; belirlenen saatte başlayacak' if first_run > time.time() + 60 else 'İlk tur sırada'
            c.execute('INSERT OR REPLACE INTO worker_schedules(id,destination,author,config,enabled,next_run,failures,message) VALUES(?,?,?,?,?,?,0,?)',
                      (identifier, self.app.CIRCLE, author, json.dumps(config), 1, first_run, message))
        self.wake.set()
        return {'id': identifier, 'enabled': True, 'config': config}

    @submission
    def stop_all(self, cancel=False):
        with self.app.db() as c:
            c.execute('UPDATE worker_schedules SET enabled=0')
            c.execute("UPDATE worker_batches SET status=?,message='Yerel araçtan durduruldu' WHERE status IN ('queued','processing','paused')",('cancelled' if cancel else 'paused',))
            if cancel:
                c.execute("UPDATE worker_items SET status='cancelled',stage='İptal edildi' WHERE status='queued'")
        return {'ok':True,'message':'Tüm otomasyonlar ve yeni işler durduruldu. Devam eden video tamamlanır.'}

    def startup(self, enabled=None):
        if os.name!='nt':
            return {'enabled':False,'supported':False}
        import winreg
        name='CircleVideoImporter_'+hashlib.sha256(str(self.app.ROOT).encode()).hexdigest()[:10]
        command=f'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{self.app.ROOT / "tools" / "start-importer.ps1"}" -NoBrowser'
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Run') as key:
            if enabled is True:
                winreg.SetValueEx(key,name,0,winreg.REG_SZ,command)
            elif enabled is False:
                try:
                    winreg.DeleteValue(key,name)
                except FileNotFoundError:
                    pass
            try:
                value=winreg.QueryValueEx(key,name)[0]
            except FileNotFoundError:
                value=None
        return {'enabled':value==command,'supported':True}

    def browser_status(self):
        running = bool(self.login_process and self.login_process.poll() is None)
        return {'loginWindowOpen': running or bool(self.remote_browser.thread and self.remote_browser.thread.is_alive()), 'remote': bool(self.remote_browser.thread and self.remote_browser.thread.is_alive()), 'profileExists': (self.app.STATE / 'tiktok-browser').is_dir()}

    def login(self):
        if self.browser_status()['loginWindowOpen']:
            return self.browser_status()
        if self.browser_lock.locked():
            raise AutomationError('Kişisel akış toplanıyor. Önce tamamlanmasını bekleyin.', 'TIKTOK_BROWSER_BUSY', 409)
        log = (self.app.STATE / 'tiktok-browser.log').open('ab')
        try:
            self.login_process = subprocess.Popen([sys.executable, str(Path(self.app.__file__).resolve()), '--tiktok-login'],
                stdout=log, stderr=log, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        finally:
            log.close()
        return {'loginWindowOpen': True, 'message': 'TikTok penceresinde kendi hesabına giriş yapın ve pencereyi kapatın.'}

    def personal(self, limit):
        if self.browser_status()['loginWindowOpen'] or not self.browser_lock.acquire(blocking=False):
            raise AutomationError('Giriş penceresini kapatın veya süren kişisel Keşfet turunu bekleyin.', 'TIKTOK_BROWSER_BUSY', 409)
        try:
            result = subprocess.run([sys.executable, str(Path(self.app.__file__).resolve()), '--personal-collect', str(limit)],
                capture_output=True, text=True, encoding='utf-8', timeout=160,
                env={**os.environ, 'PYTHONIOENCODING': 'utf-8'}, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            try:
                data = json.loads(result.stdout)
            except ValueError:
                raise AutomationError('TikTok okuyucusu başlatılamadı. start-importer.cmd dosyasını yeniden çalıştırın.', 'BROWSER_NOT_CONFIGURED', 503) from None
            if result.returncode:
                raise AutomationError(data.get('message','Kişisel Keşfet alınamadı.'), data.get('code','TIKTOK_PERSONAL_UNAVAILABLE'), data.get('status',422))
            return data['videos']
        except subprocess.TimeoutExpired:
            raise AutomationError('Kişisel Keşfet zaman aşımına uğradı; giriş/doğrulama durumunu kontrol edin.', 'TIKTOK_TIMEOUT', 504) from None
        finally:
            self.browser_lock.release()

    def process_batch(self, batch):
        author, identifier = batch['author'], batch['id']
        with self.app.db() as c:
            item = c.execute("SELECT * FROM worker_items WHERE batch=? AND status='queued' AND next_attempt<=? ORDER BY position LIMIT 1", (identifier,time.time())).fetchone()
            if not item:
                pending = c.execute("SELECT 1 FROM worker_items WHERE batch=? AND status='queued'", (identifier,)).fetchone()
                if not pending:
                    c.execute("UPDATE worker_batches SET status='completed',updated=? WHERE id=? AND status IN ('queued','processing')", (time.time(),identifier))
                return
            config=json.loads(batch['config'])
            if config.get('scheduled'):
                midnight=self.midnight()
                used=self.daily_used(c,author,midnight)
                if used>=config['dailyLimit']:
                    c.execute("UPDATE worker_items SET next_attempt=?,stage='Günlük limit; yarın devam edecek' WHERE batch=? AND status='queued'",(midnight+86400,identifier))
                    return
        try:
            session = self.session_for(author)
        except Exception as exc:
            with self.app.db() as c:
                c.execute("UPDATE worker_batches SET status='paused',message=?,updated=? WHERE id=?", (str(exc)[:1000], time.time(), identifier))
            return
        job_id = uuid.uuid4().hex
        key = (self.app.CIRCLE, author, item['video'])
        with self.app.LOCK:
            if self.app.ACTIVE:
                return
            self.app.ACTIVE[key] = job_id
            self.app.JOBS[job_id] = {'jobId':job_id,'videoId':item['video'],'status':'processing','progress':0,'created':time.time()}
        with self.app.db() as c:
            # Pause/cancel can race with session validation; check again before starting work.
            current = c.execute('SELECT status FROM worker_batches WHERE id=?',(identifier,)).fetchone()
            if not current or current['status'] not in ('queued','processing'):
                with self.app.LOCK:
                    self.app.ACTIVE.pop(key,None)
                    self.app.JOBS.pop(job_id,None)
                return
            c.execute("UPDATE worker_batches SET status='processing',updated=? WHERE id=?",(time.time(),identifier))
            c.execute("UPDATE worker_items SET status='processing',attempts=attempts+1 WHERE batch=? AND video=?",(identifier,item['video']))
        last_save = 0
        def persist(values):
            nonlocal last_save
            if values.get('status') not in ('imported','duplicate','failed') and time.monotonic()-last_save<.5:
                return
            last_save=time.monotonic()
            with self.app.db() as c:
                c.execute('UPDATE worker_items SET status=?,progress=?,stage=?,message=?,code=?,post=? WHERE batch=? AND video=?',
                    (values.get('status','processing'),values.get('progress',0),values.get('stage','Aktarılıyor'),values.get('message',''),
                     values.get('code',''),values.get('postId'),identifier,item['video']))
                c.execute('UPDATE worker_batches SET updated=? WHERE id=?',(time.time(),identifier))
                if values.get('status') in ('imported','duplicate'):
                    c.execute('UPDATE worker_items SET finished=? WHERE batch=? AND video=?',(time.time(),identifier,item['video']))
        self.app.run_import(job_id,session,author,item['video'],json.loads(item['source']),persist)
        with self.app.LOCK:
            result = self.app.JOBS.pop(job_id, {})
        self.remember(session,author)
        if result.get('status') == 'failed':
            code=result.get('code')
            with self.app.db() as c:
                if code in ('CIRCLE_LOGIN_REQUIRED','CIRCLE_RECONNECT_REQUIRED','CIRCLE_ACCOUNT_CHANGED','CIRCLE_ADMIN_REVOKED'):
                    c.execute("UPDATE worker_batches SET status='paused',message=? WHERE id=? AND status!='cancelled'",(result.get('message','Circle girişini yenileyin.'),identifier))
                elif code in ('CIRCLE_UNAVAILABLE','UPLOAD_FAILED','TIKTOK_TIMEOUT') and item['attempts']<2:
                    c.execute("UPDATE worker_items SET status='queued',stage='Geçici hata; tekrar denenecek',next_attempt=? WHERE batch=? AND video=?",(time.time()+30*(item['attempts']+1),identifier,item['video']))

    def midnight(self):
        return datetime.fromtimestamp(time.time(),timezone(timedelta(hours=4))).replace(hour=0,minute=0,second=0,microsecond=0).timestamp()

    def daily_used(self, c, author, midnight):
        return c.execute("SELECT count(DISTINCT i.post) FROM worker_items i JOIN worker_batches b ON b.id=i.batch WHERE b.author=? AND b.destination=? AND i.finished>=? AND i.status IN ('imported','duplicate') AND json_extract(b.config,'$.scheduled')=1",(author,self.app.CIRCLE,midnight)).fetchone()[0]

    def run_schedule(self, schedule):
        author= schedule['author']
        config=json.loads(schedule['config'])
        now=time.time()
        try:
            with self.app.db() as c:
                open_batch=c.execute("SELECT 1 FROM worker_batches WHERE author=? AND destination=? AND status IN ('queued','processing','paused')",(author,self.app.CIRCLE)).fetchone()
                if open_batch:
                    c.execute('UPDATE worker_schedules SET next_run=? WHERE id=?',(now+60,schedule['id']))
                    return
                # User's local day: Asia/Tbilisi (UTC+4). Do not use execution-host time.
                used=self.daily_used(c,author,self.midnight())
            remaining=config['dailyLimit']-used
            if remaining<=0:
                with self.app.db() as c:
                    c.execute('UPDATE worker_schedules SET next_run=?,message=? WHERE id=?',(now+3600,'Günlük yayın limiti doldu',schedule['id']))
                return
            self.session_for(author)
            page=self.app.list_videos(config['account'],None,min(config['limit'],remaining),config['mode'])
            source_key=self.app.source_key(config['account'],config['mode'])
            with self.app.db() as c:
                imported={r['video'] for r in c.execute('SELECT video FROM imports WHERE destination=? AND author=? AND post IS NOT NULL',(self.app.CIRCLE,author))}
            with self.app.LOCK:
                sources={v['id']:dict(self.app.SOURCES[(source_key,v['id'])]) for v in page['videos'] if v['id'] not in imported}
            # Stop must take effect even if clicked while the browser was collecting.
            with self.app.db() as c:
                current=c.execute('SELECT enabled,config FROM worker_schedules WHERE id=?',(schedule['id'],)).fetchone()
            if not current or not current['enabled'] or current['config']!=schedule['config']:
                return
            batch=self.create_batch(author,{**config,'scheduled':True},sources) if sources else None
            config['runs']=config.get('runs',0)+1
            next_run = self.next_scheduled_run(config) if config.get('scheduledHour') is not None else time.time()+config['intervalMinutes']*60
            with self.app.db() as c:
                c.execute('UPDATE worker_schedules SET next_run=?,last_run=?,failures=0,message=?,batch=?,config=?,enabled=? WHERE id=?',
                    (next_run,now,f'{len(sources)} yeni video sıraya alındı' if sources else 'Bu turda yeni video bulunamadı',batch,json.dumps(config),
                     int(not config['maxRuns'] or config['runs']<config['maxRuns']),schedule['id']))
        except Exception as exc:
            failures=schedule['failures']+1
            pause=getattr(exc,'code','') in ('TIKTOK_LOGIN_REQUIRED','CIRCLE_LOGIN_REQUIRED','CIRCLE_RECONNECT_REQUIRED','CIRCLE_ACCOUNT_CHANGED','CIRCLE_ADMIN_REVOKED') or failures>=3
            with self.app.db() as c:
                c.execute('UPDATE worker_schedules SET next_run=?,failures=?,message=?,enabled=? WHERE id=?',
                          (time.time()+max(60,config['intervalMinutes']*60),failures,str(exc)[:1000],0 if pause else 1,schedule['id']))

    def loop(self):
        last_cleanup=0
        while not self.stop.is_set():
            try:
                with self.configuration_lock:
                    with self.app.db() as c:
                        batch=c.execute("SELECT * FROM worker_batches b WHERE destination=? AND status IN ('queued','processing') AND (NOT EXISTS(SELECT 1 FROM worker_items i WHERE i.batch=b.id AND i.status='queued') OR EXISTS(SELECT 1 FROM worker_items i WHERE i.batch=b.id AND i.status='queued' AND i.next_attempt<=?)) ORDER BY created LIMIT 1",(self.app.CIRCLE,time.time())).fetchone()
                        schedule=c.execute('SELECT * FROM worker_schedules WHERE destination=? AND enabled=1 AND next_run<=? ORDER BY next_run LIMIT 1',(self.app.CIRCLE,time.time())).fetchone()
                    if batch:
                        self.process_batch(dict(batch))
                    elif schedule:
                        self.run_schedule(dict(schedule))
                    if time.time()-last_cleanup>3600:
                        with self.app.db() as c:
                            cutoff=time.time()-30*86400
                            c.execute("DELETE FROM worker_items WHERE batch IN (SELECT id FROM worker_batches WHERE status IN ('completed','cancelled','failed') AND created<?)",(cutoff,))
                            c.execute("DELETE FROM worker_batches WHERE status IN ('completed','cancelled','failed') AND created<?",(cutoff,))
                        last_cleanup=time.time()
                self.worker_error=''
            except Exception:
                # Do not print database credentials, cookies or unfiltered request data.
                self.worker_error='Arka plan işçisinin kayıt işlemi başarısız; otomatik tekrar deneniyor. Disk ve yerel kuyruk bağlantısını kontrol edin.'
            self.wake.wait(1)
            self.wake.clear()

    def bridge(self, operation, data=None):
        node=shutil.which('node')
        if not node:
            raise AutomationError('Circle veritabanı ayarları için Node.js gerekiyor.', 'NODE_NOT_CONFIGURED',503)
        result=subprocess.run([node,str(self.app.ROOT/'tools'/'importer_circle.mjs'),operation], input=json.dumps(data or {}),
            text=True,capture_output=True,encoding='utf-8',timeout=35,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        try:
            response=json.loads(result.stdout)
        except ValueError:
            raise AutomationError('Circle yapılandırma yardımcısı çalışmadı. server/node_modules ve derlenmiş backend mevcut olmalı.', 'CONFIGURATION_ERROR',503) from None
        if result.returncode:
            raise AutomationError(response.get('message','Veritabanı işlemi başarısız.'),response.get('code','DATABASE_ERROR'),400)
        return response

    @submission
    def database(self, action, data=None):
        if action!='apply':
            return self.bridge(action,data)
        if self.app.ACTIVE:
            raise AutomationError('Veritabanı değişmeden önce devam eden aktarım bitmeli.', 'WORKER_BUSY',409)
        with self.configuration_lock:
            with self.app.db() as c:
                busy=c.execute("SELECT 1 FROM worker_batches WHERE status IN ('queued','processing','paused') LIMIT 1").fetchone()
                enabled=c.execute('SELECT 1 FROM worker_schedules WHERE enabled=1 LIMIT 1').fetchone()
            if busy or enabled or self.app.ACTIVE:
                raise AutomationError('Veritabanı değişmeden önce otomasyonu durdurun ve açık kuyrukları bitirin/iptal edin.', 'WORKER_BUSY',409)
            env_file=self.app.ROOT/'server'/'.env'
            previous=env_file.read_bytes()
            response=self.bridge('apply',data)
            try:
                response['restart']=self.restart_circle()
            except Exception:
                response['restart']={'ok':False,'message':'Backend yeniden başlatma işlemi başarısız oldu.'}
            if not response['restart']['ok']:
                temporary=env_file.with_name(f'.env.{uuid.uuid4().hex}.tmp')
                try:
                    temporary.write_bytes(previous)
                    os.replace(temporary,env_file)
                finally:
                    temporary.unlink(missing_ok=True)
                try:
                    rollback=self.restart_circle()
                except Exception:
                    rollback={'ok':False,'message':'Eski ayarlar geri yüklendi; Circle backend’ini elle yeniden başlatın.'}
                response['saved']=False
                response['message']='Yeni bağlantıda Circle başlayamadı; eski veritabanı ayarları geri yüklendi.'
                response['restart']=rollback
            else:
                with self.app.db() as c:
                    c.execute('DELETE FROM worker_credentials')
            return response

    def restart_circle(self):
        # Match only this project's compiled backend, never another Node process.
        server=self.app.ROOT/'server'
        if os.name!='nt':
            return {'ok':False,'message':'Ayarlar kaydedildi. Circle backend’ini yeniden başlatın.'}
        script=r"""$ErrorActionPreference='Stop';
          $taskRoot=$env:CIRCLE_RESTART_ROOT;
          $taskMain=Join-Path $taskRoot 'dist\main';
          $taskProcesses=Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine.Contains($taskMain) };
          foreach($taskP in $taskProcesses){ Stop-Process -Id $taskP.ProcessId -Force };
        """
        stopped=subprocess.run(['powershell.exe','-NoProfile','-Command',script],capture_output=True,
            env={**os.environ,'CIRCLE_RESTART_ROOT':str(server)},timeout=15,creationflags=subprocess.CREATE_NO_WINDOW)
        if stopped.returncode:
            return {'ok':False,'message':'Ayarlar kaydedildi; çalışan Circle backend’i yeniden başlatılamadı. Backend’i elle yeniden başlatın.'}
        log=(self.app.STATE/'circle-backend.log').open('ab')
        try:
            process=subprocess.Popen([shutil.which('node'),'--enable-source-maps',str(server/'dist'/'main.js')],cwd=server,
                stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW,
                env={k:v for k,v in os.environ.items() if k not in ('DB_HOST','DB_PORT','DB_USERNAME','DB_PASSWORD','DB_NAME','DB_SSL')})
        finally:
            log.close()
        (self.app.STATE/'circle-backend.pid').write_text(str(process.pid),encoding='ascii')
        port=self.bridge('read')['serverPort']
        for _ in range(20):
            if process.poll() is not None:
                return {'ok':False,'message':'Ayarlar kaydedildi, fakat Circle backend başlayamadı. .tools/importer/circle-backend.log dosyasını kontrol edin.'}
            try:
                with request.urlopen(f'http://127.0.0.1:{port}/',timeout=1) as reply:
                    if reply.status==200:
                        owner=subprocess.run(['powershell.exe','-NoProfile','-Command',
                            '$p=Get-NetTCPConnection -State Listen -LocalPort $env:CIRCLE_RESTART_PORT -ErrorAction SilentlyContinue; if($p.OwningProcess -contains [int]$env:CIRCLE_RESTART_PID){exit 0}else{exit 1}'],
                            capture_output=True,timeout=8,creationflags=subprocess.CREATE_NO_WINDOW,
                            env={**os.environ,'CIRCLE_RESTART_PORT':str(port),'CIRCLE_RESTART_PID':str(process.pid)})
                        if owner.returncode==0 and process.poll() is None:
                            return {'ok':True,'message':'Circle backend yeni bağlantıyla hazır. Farklı veritabanına geçtiysen Circle’a tekrar giriş yapıp otomasyon oturumunu bağla.'}
            except Exception:
                time.sleep(.5)
        return {'ok':False,'message':'Ayarlar kaydedildi; Circle backend henüz hazır değil. .tools/importer/circle-backend.log dosyasını kontrol edin.'}


def process_lock(state):
    """One durable worker per workspace, even if two launchers use different ports."""
    state.mkdir(parents=True,exist_ok=True)
    handle=(state/'worker.lock').open('a+b')
    handle.seek(0)
    if not handle.read(1):
        handle.write(b'1');handle.flush()
    handle.seek(0)
    try:
        if os.name=='nt':
            import msvcrt
            msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    except OSError:
        handle.close()
        raise SystemExit('Bu proje için bir importer zaten çalışıyor. Mevcut http://localhost:4317 sayfasını kullanın.') from None
    return handle
