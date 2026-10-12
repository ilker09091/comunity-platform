"""Local-only TikTok page downloader; Circle writes use its existing session gateway."""
from __future__ import annotations

import hashlib
from contextlib import contextmanager
import http.client
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import error, parse, request
from importer_automation import Automation, AutomationError, collect_personal, process_lock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools' / 'tiktok'))
PORT = int(os.getenv('IMPORTER_PORT', '4317'))
CIRCLE = os.getenv('CIRCLE_WEB_URL', 'http://localhost:3000').rstrip('/')
BASE = '/api/backend/importer'
STATE = ROOT / '.tools' / 'importer'
MAX_BYTES = int(os.getenv('IMPORTER_MAX_VIDEO_BYTES', '104857600'))
LOCK = threading.RLock()
JOBS: dict = {}
ACTIVE: dict = {}
SOURCES: dict = {}
EXPLORE_URL = 'https://www.tiktok.com/explore'
EXPLORE_LOCK = threading.Lock()
PERSONAL_BATCHES: dict = {}
PERSONAL_FEED_URL = 'https://www.tiktok.com/foryou'
AUTOMATION = None


class Failure(Exception):
    def __init__(self, message, code='IMPORT_FAILED', status=400):
        super().__init__(message)
        self.code, self.status = code, status


@contextmanager
def db():
    connection = sqlite3.connect(STATE / 'imports.sqlite3', timeout=15)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize():
    global AUTOMATION
    STATE.mkdir(parents=True, exist_ok=True)
    with db() as connection:
        connection.execute('''CREATE TABLE IF NOT EXISTS imports (
            destination TEXT NOT NULL, author TEXT NOT NULL, video TEXT NOT NULL,
            source TEXT NOT NULL, description TEXT NOT NULL, media TEXT, post TEXT,
            PRIMARY KEY(destination, author, video))''')
    AUTOMATION = Automation(sys.modules[__name__])
    AUTOMATION.initialize()


def source_url(account):
    value = str(account).strip()
    if re.fullmatch(r'https://(?:www\.)?tiktok\.com/@[\w.-]+(?:/video/\d+)?/?(?:\?[^\s]*)?', value):
        return value.split('?')[0].rstrip('/')
    value = value.removeprefix('@')
    if re.fullmatch(r'MS4wLjABAAAA[\w-]{64}', value):
        return f'tiktokuser:{value}'
    if re.fullmatch(r'[a-zA-Z0-9_.]{1,128}', value) and not value.isdigit():
        return f'https://www.tiktok.com/@{value}'
    raise Failure('TikTok @kullanıcı adını veya tam profil/video bağlantısını girin. Sayısal kullanıcı ID tek başına profil adresini belirtmez.', 'VALIDATION')


def source_key(account, mode='profile'):
    if mode == 'personal_auto':
        return 'personal-browser'
    if mode == 'explore':
        return EXPLORE_URL
    if mode == 'profile':
        return source_url(account)
    if mode == 'personal':
        if not re.fullmatch(r'[0-9a-f]{32}', str(account)):
            raise Failure('Açık TikTok hesabınızın Sizin İçin sekmesinde Circle Keşfetimi Al yer imini çalıştırın.', 'PERSONAL_FEED_REQUIRED')
        return f'personal:{account}'
    raise Failure('Geçerli bir video kaynağı seçin.', 'VALIDATION')


def video_limit(value):
    if not re.fullmatch(r'\d{1,3}', str(value)) or not 1 <= int(value) <= 500:
        raise Failure('Video sayısı 1–500 arasında tam sayı olmalı.', 'VALIDATION')
    return int(value)


def cookie_values(header):
    jar = SimpleCookie()
    try:
        jar.load(header or '')
    except Exception:
        return {}
    return {name: item.value for name, item in jar.items() if name in ('social_access', 'social_refresh')}


class CircleSession:
    def __init__(self, cookies):
        self.cookies = cookie_values(cookies)
        self.set_cookies = []
        self.on_rotation = None

    def cookie(self):
        return '; '.join(f'{name}={value}' for name, value in sorted(self.cookies.items()))

    def fingerprint(self):
        return hashlib.sha256(self.cookie().encode()).hexdigest()

    def receive(self, headers):
        values = headers.get_all('Set-Cookie', [])
        for value in values:
            self.set_cookies.append(value)
            self.cookies.update(cookie_values(value))
        if values and self.on_rotation:
            self.on_rotation(self)

    def call(self, path, body=None):
        headers = {'Cookie': self.cookie(), 'X-Social-Client': 'web', 'Origin': CIRCLE}
        if body is not None:
            headers['Content-Type'] = 'application/json'
        req = request.Request(CIRCLE + '/api/backend/api/' + path, headers=headers,
                              data=json.dumps(body).encode() if body is not None else None)
        try:
            with request.urlopen(req, timeout=125) as response:
                self.receive(response.headers)
                return json.load(response)
        except error.HTTPError as exc:
            self.receive(exc.headers)
            try:
                with exc:
                    data = json.load(exc)
            except Exception:
                data = {}
            if exc.code == 401:
                raise Failure(f'Önce {CIRCLE}/login adresinde Circle hesabınıza giriş yapın. Token girmek gerekmez.', 'CIRCLE_LOGIN_REQUIRED', 401) from None
            raise Failure(data.get('message', f'Circle isteği başarısız ({exc.code}).'), data.get('code', 'CIRCLE_ERROR'), exc.code) from None
        except (OSError, ValueError) as exc:
            raise Failure(f'Circle sunucusuna ulaşılamıyor: {CIRCLE}. Circle uygulaması ve mevcut backend çalışır durumda olmalı.', 'CIRCLE_UNAVAILABLE', 502) from exc

    def upload(self, path, update):
        target = parse.urlsplit(CIRCLE)
        boundary = 'Circle' + uuid.uuid4().hex
        prefix = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="tiktok.mp4"\r\nContent-Type: video/mp4\r\n\r\n').encode()
        suffix = f'\r\n--{boundary}--\r\n'.encode()
        size = path.stat().st_size
        connection_class = http.client.HTTPSConnection if target.scheme == 'https' else http.client.HTTPConnection
        connection = connection_class(target.hostname, target.port, timeout=125)
        try:
            connection.putrequest('POST', target.path.rstrip('/') + '/api/backend/api/media')
            for name, value in {'Content-Type': f'multipart/form-data; boundary={boundary}',
                                'Content-Length': str(len(prefix) + size + len(suffix)),
                                'Cookie': self.cookie(), 'Origin': CIRCLE, 'X-Social-Client': 'web'}.items():
                connection.putheader(name, value)
            connection.endheaders()
            connection.send(prefix)
            sent = 0
            with path.open('rb') as video:
                while chunk := video.read(256 * 1024):
                    connection.send(chunk)
                    sent += len(chunk)
                    update(progress=60 + 30 * sent / size, stage='Circle’a yükleniyor')
            connection.send(suffix)
            response = connection.getresponse()
            self.receive(response.headers)
            data = json.loads(response.read())
            if response.status not in (200, 201):
                raise Failure(data.get('message', 'Circle medya yüklemesi başarısız.'), data.get('code', 'UPLOAD_FAILED'), response.status)
            if not re.fullmatch(r'[0-9a-f-]{36}', str(data.get('id', ''))):
                raise Failure('Circle geçerli bir medya ID döndürmedi.', 'INVALID_RESPONSE', 502)
            return data['id']
        except (OSError, ValueError) as exc:
            raise Failure('Circle medya yüklemesi tamamlanamadı. Bağlantıyı kontrol edip yeniden deneyin.', 'UPLOAD_FAILED', 502) from exc
        finally:
            connection.close()


def list_videos(account, cursor, limit=20, mode='profile'):
    limit = video_limit(limit)
    url = source_key(account, mode)
    if mode == 'personal_auto':
        videos = AUTOMATION.personal(limit)
        # Reuse the strict metadata validator rather than trusting browser output.
        batch = register_personal({'version':1,'source':PERSONAL_FEED_URL,'limit':limit,'videos':videos})
        with LOCK:
            for video in batch['videos']:
                SOURCES[(url,video['id'])] = dict(SOURCES[(f"personal:{batch['account']}",video['id'])])
        return {'videos':batch['videos'],'nextCursor':None,
                'notice':f"{limit} video istendi; TikTok hesabının Sizin İçin akışından {len(batch['videos'])} farklı video alındı." if len(batch['videos'])<limit else ''}
    if mode == 'personal':
        with LOCK:
            batch = PERSONAL_BATCHES.get(account)
        if not batch:
            raise Failure('Kişisel akış kaydı bulunamadı. TikTok sekmesinde Circle Keşfetimi Al yer imini yeniden çalıştırın.', 'PERSONAL_FEED_REQUIRED')
        return {'videos': [dict(video) for video in batch['videos'][:limit]], 'nextCursor': None}
    if mode == 'explore':
        if cursor:
            raise Failure('Yeni Keşfet videoları için Keşfetten Getir düğmesini kullanın.', 'VALIDATION')
        return list_explore(limit)
    try:
        start = int(cursor or '0')
        if start < 0 or start > 100000:
            raise ValueError()
    except ValueError:
        raise Failure('Geçersiz sayfa.', 'VALIDATION') from None
    env = {**os.environ, 'PYTHONPATH': str(ROOT / '.tools' / 'tiktok'), 'PYTHONIOENCODING': 'utf-8'}
    command = [sys.executable, '-m', 'yt_dlp', '--ignore-config', '--no-warnings',
               '--dump-single-json', '--flat-playlist', '--skip-download', '--socket-timeout', '20',
               '--retries', '1', '--extractor-retries', '1', '--playlist-items', f'{start + 1}:{start + limit + 1}', url]
    try:
        result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', env=env,
                                timeout=170, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except subprocess.TimeoutExpired:
        raise Failure('TikTok sayfası zamanında yanıt vermedi. Biraz sonra tekrar deneyin veya doğrudan video bağlantısını girin.', 'TIKTOK_TIMEOUT', 504) from None
    if result.returncode:
        message = re.sub(r'\x1b\[[0-9;]*m', '', result.stderr).strip()[-1800:]
        raise Failure('TikTok sayfasından video alınamadı. Profil herkese açık olmalı. Profil listelemesi engellenirse doğrudan video bağlantısını deneyin.\n' + message, 'TIKTOK_PAGE_ERROR', 422)
    try:
        data = json.loads(result.stdout)
    except ValueError:
        raise Failure('Video çıkarıcısı geçerli sonuç döndürmedi.', 'INVALID_RESPONSE', 502) from None
    entries = data.get('entries', [data])
    output = []
    with LOCK:
        for entry in entries[:limit]:
            if not entry or not re.fullmatch(r'\d{1,30}', str(entry.get('id', ''))):
                continue
            video_id = str(entry['id'])
            video_url = entry.get('webpage_url') or entry.get('url')
            if not video_url or not re.fullmatch(r'https?://(?:www\.)?tiktok\.com/@[\w.-]+/video/\d+/?', video_url):
                # TikTok flat playlist IDs have a canonical public video page.
                video_url = f'https://www.tiktok.com/@_/video/{video_id}'
            SOURCES[(url, video_id)] = {'url': video_url, 'description': entry.get('description') or entry.get('title') or ''}
            output.append({'id': video_id, 'description': SOURCES[(url, video_id)]['description'],
                           'creator': video_url.split('/@', 1)[1].split('/', 1)[0],
                           'thumbnailUrl': entry.get('thumbnail') or (entry.get('thumbnails') or [{}])[-1].get('url'),
                           'durationSeconds': entry.get('duration'), 'canImport': True, 'imported': False})
    return {'videos': output, 'nextCursor': str(start + limit) if len(entries) > limit else None}


def register_personal(data):
    """Stage only video metadata collected in the user's existing TikTok tab."""
    if not isinstance(data, dict) or data.get('version') != 1 or data.get('source') != PERSONAL_FEED_URL:
        raise Failure('Geçersiz kişisel akış verisi.', 'VALIDATION')
    limit = video_limit(data.get('limit'))
    items = data.get('videos')
    if not isinstance(items, list) or not 1 <= len(items) <= 100 or len(items) > limit:
        raise Failure('Kişisel akış 1–100 video içermeli ve seçilen sayıyı aşmamalı.', 'VALIDATION')
    output, sources, seen = [], {}, set()
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get('id'), str):
            raise Failure('Kişisel akış video ID değerleri metin olmalı.', 'VALIDATION')
        video_id = item['id']
        match = re.fullmatch(r'https://(?:www\.)?tiktok\.com/@([a-zA-Z0-9_.-]{1,128})/video/(\d{1,30})', str(item.get('sourceUrl', '')))
        if not match or match[2] != video_id:
            raise Failure('Kişisel akışta geçersiz veya eşleşmeyen TikTok video bağlantısı var.', 'VALIDATION')
        if video_id in seen:
            continue
        seen.add(video_id)
        description = item.get('description', '')
        if not isinstance(description, str) or len(description) > 1000:
            raise Failure('Video açıklaması geçersiz.', 'VALIDATION')
        thumbnail = item.get('thumbnailUrl')
        if thumbnail is not None:
            if not isinstance(thumbnail, str) or len(thumbnail) > 2000:
                raise Failure('Video görseli geçersiz.', 'VALIDATION')
            parsed = parse.urlsplit(thumbnail)
            if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
                raise Failure('Video görseli HTTPS adresi olmalı.', 'VALIDATION')
        duration = item.get('durationSeconds')
        if not isinstance(duration, (int, float)) or isinstance(duration, bool) or not math.isfinite(duration) or not 0 <= duration <= 86400:
            duration = None
        source = f'https://www.tiktok.com/@{match[1]}/video/{video_id}'
        sources[video_id] = {'url': source, 'description': description}
        output.append({'id': video_id, 'description': description, 'creator': match[1],
                       'thumbnailUrl': thumbnail, 'durationSeconds': duration,
                       'canImport': True, 'imported': False})
    batch_id = uuid.uuid4().hex
    with LOCK:
        for expired in [key for key, batch in PERSONAL_BATCHES.items() if batch['created'] < time.time() - 3600]:
            batch = PERSONAL_BATCHES.pop(expired)
            for video in batch['videos']:
                SOURCES.pop((f'personal:{expired}', video['id']), None)
        PERSONAL_BATCHES[batch_id] = {'videos': output, 'created': time.time()}
        for video_id, source in sources.items():
            SOURCES[(f'personal:{batch_id}', video_id)] = source
    return {'account': batch_id, 'videos': output, 'nextCursor': None,
            'notice': f'{limit} video istendi; açık TikTok sekmesinden {len(output)} farklı video alındı.' if len(output) < limit else ''}


def explore_items(data):
    """Read video metadata from responses made by the real public TikTok page."""
    output = {}

    def visit(value):
        if isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, dict):
            video_id = str(value.get('id', ''))
            video, author = value.get('video'), value.get('author')
            if re.fullmatch(r'\d{1,30}', video_id) and isinstance(video, dict) and isinstance(author, dict):
                creator = author.get('uniqueId', '')
                if (re.fullmatch(r'[\w.-]{1,128}', str(creator)) and video.get('duration', 0) > 0
                        and not any(value.get(key) for key in ('isAd', 'privateItem', 'imagePost', 'isProhibited'))):
                    output[video_id] = {'id': video_id, 'description': str(value.get('desc', '')),
                                        'thumbnailUrl': video.get('cover') or video.get('originCover'),
                                        'durationSeconds': video['duration'], 'creator': creator,
                                        'sourceUrl': f'https://www.tiktok.com/@{creator}/video/{video_id}',
                                        'canImport': True, 'imported': False}
                return
            for child in value.values():
                if isinstance(child, (dict, list)):
                    visit(child)

    visit(data)
    return list(output.values())


def collect_explore(limit):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise Failure('Keşfet için tarayıcı okuyucusu eksik. start-importer.cmd dosyasını yeniden açın.', 'BROWSER_NOT_CONFIGURED', 503) from None
    collected = {}
    with sync_playwright() as playwright:
        # Use a fresh, separate browser context. Never read the user's browser profile.
        channel = 'msedge' if (Path(os.getenv('PROGRAMFILES(X86)', 'C:/Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe').is_file() else 'chrome'
        try:
            browser = playwright.chromium.launch(channel=channel, headless=True, timeout=20000)
        except Exception:
            raise Failure('Keşfet için Microsoft Edge veya Google Chrome kurulu olmalı.', 'BROWSER_NOT_CONFIGURED', 503) from None
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 900})

            def receive(response):
                host = parse.urlsplit(response.url).hostname or ''
                if (host == 'tiktok.com' or host.endswith('.tiktok.com')) and response.ok and 'json' in response.headers.get('content-type', ''):
                    try:
                        for video in explore_items(response.json()):
                            collected.setdefault(video['id'], video)
                    except Exception:
                        pass  # Other TikTok responses are unrelated to video discovery.

            page.on('response', receive)
            page.goto(EXPLORE_URL, wait_until='domcontentloaded', timeout=35000)
            deadline = time.monotonic() + 85
            page.mouse.move(950, 700)
            while len(collected) < limit and time.monotonic() < deadline:
                page.wait_for_timeout(1500)
                # Bring the actual last video into view even when TikTok changes
                # the content scroll container or uses a nested layout.
                cards = page.locator('a[href*="/video/"]')
                if cards.count():
                    cards.last.scroll_into_view_if_needed(timeout=3000)
                page.mouse.wheel(0, 900)
            if not collected:
                raise Failure('TikTok Keşfet bu bağlantıda video yüklemedi. Erişim engeli, doğrulama veya bağlantı sorunu olabilir. Biraz sonra yeniden deneyin; profil modu kullanılabilir.', 'TIKTOK_EXPLORE_UNAVAILABLE', 422)
            return list(collected.values())[:limit]
        finally:
            browser.close()


def list_explore(limit):
    if not EXPLORE_LOCK.acquire(blocking=False):
        raise Failure('Keşfet listelemesi devam ediyor. Tamamlanmasını bekleyin.', 'FETCH_BUSY', 409)
    try:
        result = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--explore', str(limit)],
                                capture_output=True, text=True, encoding='utf-8',
                                env={**os.environ, 'PYTHONIOENCODING': 'utf-8'}, timeout=155,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        try:
            data = json.loads(result.stdout)
        except ValueError:
            raise Failure('Keşfet tarayıcı okuyucusu başlatılamadı. start-importer.cmd dosyasını yeniden açın.', 'BROWSER_NOT_CONFIGURED', 503) from None
        if result.returncode:
            raise Failure(data.get('message', 'Keşfet yüklenemedi.'), data.get('code', 'TIKTOK_EXPLORE_UNAVAILABLE'), data.get('status', 422))
        videos = data['videos'][:limit]
        with LOCK:
            for video in videos:
                SOURCES[(EXPLORE_URL, video['id'])] = {'url': video.pop('sourceUrl'), 'description': video['description']}
        return {'videos': videos, 'nextCursor': None,
                'notice': f'{limit} video istendi; bu yüklemede {len(videos)} erişilebilir video bulundu.' if len(videos) < limit else ''}
    except subprocess.TimeoutExpired:
        raise Failure('TikTok Keşfet zamanında yanıt vermedi. Biraz sonra yeniden deneyin.', 'TIKTOK_TIMEOUT', 504) from None
    finally:
        EXPLORE_LOCK.release()


def find_post(session, author, media):
    cursor = None
    while True:
        page = session.call(f'users/{author}/posts?' + parse.urlencode({'limit': 50, **({'cursor': cursor} if cursor else {})}))
        for post in page.get('items', []):
            if any(item.get('id') == media for item in post.get('media', [])):
                return post['id']
        cursor = page.get('nextCursor')
        if not cursor:
            return None


def run_import(job_id, session, author, video_id, source, update_hook=None):
    def update(**values):
        with LOCK:
            JOBS[job_id].update(values)
            snapshot = dict(JOBS[job_id])
        if update_hook:
            update_hook(snapshot)

    key = (CIRCLE, author, video_id)
    try:
        with db() as connection:
            connection.execute('INSERT OR IGNORE INTO imports(destination,author,video,source,description) VALUES(?,?,?,?,?)', (*key, source['url'], source['description']))
            row = dict(connection.execute('SELECT * FROM imports WHERE destination=? AND author=? AND video=?', key).fetchone())
        if row['post']:
            update(status='duplicate', postId=row['post'], progress=100)
            return
        media = row['media']
        if media:
            update(stage='Önceki aktarım kontrol ediliyor', progress=90)
            post = find_post(session, author, media)
            if post:
                with db() as connection:
                    connection.execute('UPDATE imports SET post=? WHERE destination=? AND author=? AND video=?', (post, *key))
                update(status='duplicate', postId=post, progress=100)
                return
        else:
            from yt_dlp import YoutubeDL

            def download_progress(value):
                downloaded = value.get('downloaded_bytes', 0)
                if downloaded > MAX_BYTES:
                    raise Failure('Video dosyası Circle boyut sınırını aşıyor.', 'VIDEO_TOO_LARGE', 413)
                total = value.get('total_bytes') or value.get('total_bytes_estimate')
                update(stage='TikTok’tan indiriliyor', progress=min(59, 60 * downloaded / total) if total else 0,
                       downloadedBytes=downloaded)

            with tempfile.TemporaryDirectory(prefix='download-', dir=STATE) as directory:
                options = {'quiet': True, 'no_warnings': True, 'noprogress': True, 'noplaylist': True,
                           'format': 'best[ext=mp4]', 'outtmpl': str(Path(directory) / '%(id)s.%(ext)s'),
                           'socket_timeout': 20, 'retries': 1, 'extractor_retries': 1,
                           'max_filesize': MAX_BYTES, 'progress_hooks': [download_progress]}
                update(status='processing', stage='TikTok video dosyası alınıyor', progress=0)
                with YoutubeDL(options) as downloader:
                    info = downloader.extract_info(source['url'], download=True)
                    if str(info.get('id')) != video_id:
                        raise Failure('İndirilen video ID eşleşmedi.', 'INVALID_RESPONSE')
                    path = Path(downloader.prepare_filename(info))
                if not path.is_file() or path.stat().st_size > MAX_BYTES:
                    raise Failure('Video indirilemedi veya Circle dosya boyutu sınırını aşıyor.', 'VIDEO_TOO_LARGE', 413)
                media = session.upload(path, update)
                description = info.get('description') or row['description']
                with db() as connection:
                    connection.execute('UPDATE imports SET media=?, description=? WHERE destination=? AND author=? AND video=?', (media, description, *key))
                row['description'] = description
        update(stage='Circle gönderisi oluşturuluyor', progress=95)
        # Reuse the same media after an ambiguous timeout. Circle locks attachments,
        # so retrying cannot attach it to a second post; reconciliation finds the first.
        post = session.call('posts', {'content': row['description'][:5000].strip(),
                                      'mediaIds': [media], 'visibility': 'PUBLIC'})
        if not re.fullmatch(r'[0-9a-f-]{36}', str(post.get('id', ''))):
            raise Failure('Circle gönderiyi doğrulamadı.', 'INVALID_RESPONSE', 502)
        with db() as connection:
            connection.execute('UPDATE imports SET post=? WHERE destination=? AND author=? AND video=?', (post['id'], *key))
        update(status='imported', postId=post['id'], progress=100)
    except Exception as exc:
        update(status='failed', code=getattr(exc, 'code', 'IMPORT_FAILED'), message=str(exc)[:2000])
    finally:
        with LOCK:
            ACTIVE.pop(key, None)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Never log session cookies or query strings.

    def send_json(self, data, status=200, cookies=()):
        payload = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        for cookie in cookies:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(payload)

    def check_origin(self):
        expected = f'localhost:{PORT}'
        if self.headers.get('Host') != expected:
            raise Failure(f'Aracı http://{expected} adresinden açın.', 'INVALID_HOST', 403)
        if self.headers.get('Origin') not in (None, f'http://{expected}'):
            raise Failure('Bu araç yalnızca kendi yerel sayfasından çağrılabilir.', 'INVALID_ORIGIN', 403)
        if self.headers.get('Sec-Fetch-Site') in ('cross-site', 'same-site') or self.headers.get('X-Social-Client') != 'web':
            raise Failure('Geçersiz yerel araç isteği.', 'INVALID_ORIGIN', 403)

    def do_GET(self):
        session = CircleSession(self.headers.get('Cookie'))
        try:
            parsed = parse.urlsplit(self.path)
            if self.headers.get('Host') != f'localhost:{PORT}':
                raise Failure(f'Aracı http://localhost:{PORT} adresinden açın.', 'INVALID_HOST', 403)
            if parsed.path in ('/', '/index.html'):
                payload = (ROOT / 'index.html').read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(payload)))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('X-Frame-Options', 'DENY')
                self.end_headers()
                self.wfile.write(payload)
                return
            self.check_origin()
            if parsed.path == BASE + '/health':
                self.send_json({'ok': True, 'circleUrl': CIRCLE, 'features': ['profile', 'explore', 'personal', 'personal_auto', 'video-limit', 'background-queue', 'automation', 'database-settings']})
            elif parsed.path == BASE + '/automation/state':
                self.send_json(AUTOMATION.state(session),cookies=session.set_cookies)
            elif parsed.path == BASE + '/configuration':
                self.send_json(AUTOMATION.database('read'))
            elif parsed.path == BASE + '/browser/status':
                self.send_json(AUTOMATION.browser_status())
            elif parsed.path == BASE + '/startup':
                self.send_json(AUTOMATION.startup())
            elif parsed.path.startswith(BASE + '/batches/'):
                author, _ = AUTOMATION.identify(session)
                self.send_json(AUTOMATION.batch(parsed.path.removeprefix(BASE+'/batches/'),author),cookies=session.set_cookies)
            elif parsed.path == BASE + '/videos':
                query = parse.parse_qs(parsed.query)
                page = list_videos(query.get('account', [''])[0], query.get('cursor', [''])[0],
                                   query.get('limit', ['20'])[0], query.get('mode', ['profile'])[0])
                if session.cookies:
                    try:
                        author = session.call('users/me')['id']
                        with db() as connection:
                            imported = {row['video'] for row in connection.execute(
                                'SELECT video FROM imports WHERE destination=? AND author=? AND post IS NOT NULL', (CIRCLE, author))}
                        for video in page['videos']:
                            video['imported'] = video['id'] in imported
                    except Failure:
                        pass  # Public page listing works even while Circle is offline/signed out.
                self.send_json(page, cookies=session.set_cookies)
            elif parsed.path.startswith(BASE + '/imports/'):
                job_id = parsed.path.removeprefix(BASE + '/imports/')
                with LOCK:
                    job = dict(JOBS.get(job_id, {}))
                if not job or job.pop('session', None) != session.fingerprint():
                    raise Failure('Aktarım bulunamadı veya Circle oturumu değişti.', 'JOB_NOT_FOUND', 404)
                self.send_json(job)
            else:
                raise Failure('Uç nokta bulunamadı.', 'NOT_FOUND', 404)
        except (Failure,AutomationError) as exc:
            self.send_json({'code': exc.code, 'message': str(exc)}, exc.status, session.set_cookies)
        except Exception:
            self.send_json({'code': 'INTERNAL_ERROR', 'message': 'Yerel araç beklenmeyen bir hata aldı.'}, 500)

    def do_POST(self):
        session = CircleSession(self.headers.get('Cookie'))
        try:
            self.check_origin()
            allowed = ('/imports','/personal-feed','/batches','/batches/control','/automation/schedule','/automation/connect',
                       '/browser/login','/database/test','/database/apply','/automation/stop-all','/startup')
            if self.path not in tuple(BASE+p for p in allowed):
                raise Failure('Uç nokta bulunamadı.', 'NOT_FOUND', 404)
            length = int(self.headers.get('Content-Length', '0'))
            if length < 1 or length > (262144 if self.path == BASE + '/personal-feed' else 16384):
                raise Failure('Geçersiz istek.', 'VALIDATION')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data,dict):
                raise Failure('Geçersiz istek.', 'VALIDATION')
            action = self.path.removeprefix(BASE)
            if action in ('/batches','/batches/control','/automation/schedule','/automation/connect','/browser/login','/database/test','/database/apply','/automation/stop-all','/startup'):
                if action == '/batches':
                    reply = AUTOMATION.enqueue_selected(data,session)
                elif action == '/batches/control':
                    reply = AUTOMATION.control(data,session)
                elif action == '/automation/schedule':
                    reply = AUTOMATION.schedule(data,session)
                elif action == '/automation/connect':
                    reply = AUTOMATION.connect(session)
                elif action == '/browser/login':
                    reply = AUTOMATION.login()
                elif action == '/automation/stop-all':
                    reply = AUTOMATION.stop_all(data.get('cancelAll') is True)
                elif action == '/startup':
                    if not isinstance(data.get('enabled'),bool):
                        raise Failure('Geçersiz başlangıç ayarı.','VALIDATION')
                    reply = AUTOMATION.startup(data['enabled'])
                else:
                    reply = AUTOMATION.database('test' if action == '/database/test' else 'apply',data)
                self.send_json(reply,cookies=session.set_cookies)
                return
            if self.path == BASE + '/personal-feed':
                page = register_personal(data)
                if session.cookies:
                    try:
                        author = session.call('users/me')['id']
                        with db() as connection:
                            imported = {row['video'] for row in connection.execute(
                                'SELECT video FROM imports WHERE destination=? AND author=? AND post IS NOT NULL', (CIRCLE, author))}
                        for video in page['videos']:
                            video['imported'] = video['id'] in imported
                    except Failure:
                        pass
                self.send_json(page, cookies=session.set_cookies)
                return
            selected_source = (source_key(data.get('account', ''), data.get('mode', 'profile')), str(data.get('videoId', '')))
            with LOCK:
                source = SOURCES.get(selected_source)
            if not source:
                raise Failure('Önce videoları listeleyin, sonra aktarılacak videoları seçin.', 'VIDEO_NOT_LISTED')
            user = session.call('users/me')
            author, video_id = user['id'], selected_source[1]
            key = (CIRCLE, author, video_id)
            with LOCK:
                with db() as connection:
                    row = connection.execute('SELECT post FROM imports WHERE destination=? AND author=? AND video=?', key).fetchone()
                if row and row['post']:
                    self.send_json({'status': 'duplicate', 'videoId': video_id, 'postId': row['post']}, cookies=session.set_cookies)
                    return
                job_id = ACTIVE.get(key)
                if not job_id:
                    # Bound parallel downloads/uploads and memory use for this small tool.
                    if ACTIVE:
                        raise Failure('Bir aktarım devam ediyor. Tamamlandıktan sonra yeniden deneyin.', 'IMPORT_BUSY', 409)
                    for expired in [identifier for identifier, job in JOBS.items() if job.get('created', 0) < time.time() - 3600]:
                        JOBS.pop(expired, None)
                    job_id = uuid.uuid4().hex
                    ACTIVE[key] = job_id
                    JOBS[job_id] = {'status': 'queued', 'videoId': video_id, 'jobId': job_id, 'progress': 0,
                                    'session': session.fingerprint(), 'created': time.time()}
                    threading.Thread(target=run_import, args=(job_id, session, author, video_id, source), daemon=True).start()
                reply = {k: v for k, v in JOBS[job_id].items() if k not in ('session', 'created')}
            self.send_json(reply, 202, session.set_cookies)
        except (Failure,AutomationError) as exc:
            self.send_json({'code': exc.code, 'message': str(exc)}, exc.status, session.set_cookies)
        except (ValueError, KeyError):
            self.send_json({'code': 'VALIDATION', 'message': 'Geçersiz aktarım isteği.'}, 400)
        except Exception:
            self.send_json({'code': 'INTERNAL_ERROR', 'message': 'Aktarım başlatılamadı.'}, 500)


if __name__ == '__main__':
    if sys.argv[1:2] in (['--personal-collect'],['--tiktok-login']):
        try:
            STATE.mkdir(parents=True,exist_ok=True)
            print(json.dumps(collect_personal(STATE,video_limit(sys.argv[2]) if len(sys.argv)>2 else 1,
                                             login=sys.argv[1]=='--tiktok-login'),ensure_ascii=True))
        except Exception as exc:
            print(json.dumps({'code':getattr(exc,'code','TIKTOK_PERSONAL_UNAVAILABLE'),'message':str(exc)[:1000],
                              'status':getattr(exc,'status',422)},ensure_ascii=True))
            sys.exit(1)
        sys.exit(0)
    if len(sys.argv) == 3 and sys.argv[1] == '--explore':
        try:
            print(json.dumps({'videos': collect_explore(video_limit(sys.argv[2]))}, ensure_ascii=True))
        except Exception as exc:
            print(json.dumps({'code': getattr(exc, 'code', 'TIKTOK_EXPLORE_UNAVAILABLE'),
                              'message': str(exc)[:1800], 'status': getattr(exc, 'status', 422)}, ensure_ascii=True))
            sys.exit(1)
        sys.exit(0)
    target = parse.urlsplit(CIRCLE)
    if target.scheme not in ('http', 'https') or not target.netloc or target.username or target.password or target.query or target.fragment:
        raise SystemExit('CIRCLE_WEB_URL must be an HTTP(S) URL without credentials, query or fragment.')
    worker_lock = process_lock(STATE)
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    initialize()
    AUTOMATION.start()
    print(f'Circle Video Importer: http://localhost:{PORT}', flush=True)
    print(f'Circle destination: {CIRCLE}', flush=True)
    server.serve_forever()
