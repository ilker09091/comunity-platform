"""Isolated integration checks; no requests or writes to the real Circle backend."""
import json
from pathlib import Path
import tempfile
import threading
import time
import types
import subprocess
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import request, error

import tiktok_importer as app
import importer_automation as automation

AUTHOR = '11111111-1111-4111-8111-111111111111'
MEDIA = '22222222-2222-4222-8222-222222222222'
POST = '33333333-3333-4333-8333-333333333333'
VIDEO = '7694797676306615583'
COOKIE = 'social_access=test-session'
BACKGROUND_COOKIE = 'social_access=background-access'


class CircleStub(BaseHTTPRequestHandler):
    posts = []
    uploads = []
    lose_post_response = False

    def log_message(self, *_):
        pass

    def reply(self, data, status=200):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if not any(cookie in self.headers.get('Cookie', '') for cookie in (COOKIE,BACKGROUND_COOKIE)):
            self.reply({'code': 'INVALID_TOKEN'}, 401)
        elif self.path == '/api/backend/api/users/me':
            self.reply({'id': AUTHOR,'role':'ADMIN'})
        elif self.path == '/api/backend/api/media/'+MEDIA:
            self.reply({'id':MEDIA,'status':'READY','processingProgress':None})
        elif self.path.startswith(f'/api/backend/api/users/{AUTHOR}/posts?'):
            self.reply({'items': self.posts, 'nextCursor': None})
        else:
            self.reply({'message': 'Unexpected contract'}, 404)

    def do_POST(self):
        body = self.rfile.read(int(self.headers['Content-Length']))
        if not any(cookie in self.headers.get('Cookie', '') for cookie in (COOKIE,BACKGROUND_COOKIE)) or self.headers.get('X-Social-Client') != 'web':
            self.reply({'code': 'FORBIDDEN'}, 403)
        elif self.path == '/api/backend/api/auth/background-session':
            self.reply({'user': {'id':AUTHOR}, 'accessToken':'background-access', 'refreshToken':'background-refresh'})
        elif self.path == '/api/backend/api/media':
            self.uploads.append((self.headers.get('Content-Type'), body))
            self.reply({'id': MEDIA}, 201)
        elif self.path == '/api/backend/api/posts':
            payload = json.loads(body)
            if payload.get('mediaIds') != [MEDIA] or payload.get('visibility') != 'PUBLIC':
                self.reply({'message': 'Invalid existing post contract'}, 400)
                return
            if self.posts:
                self.reply({'code': 'MEDIA_IN_USE', 'message': 'Media already attached'}, 409)
                return
            self.posts.append({'id': POST, 'media': [{'id': MEDIA}], 'content': payload['content']})
            self.reply({'code': 'API_UNAVAILABLE', 'message': 'Response lost'} if self.lose_post_response else self.posts[0],
                       502 if self.lose_post_response else 201)
        else:
            self.reply({'message': 'Unexpected contract'}, 404)


class DownloadFixture:
    """Tiny download fixture exclusively for tests of the import orchestration."""
    def __init__(self, options):
        self.options = options

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def prepare_filename(self, info):
        return self.options['outtmpl'].replace('%(id)s', VIDEO).replace('%(ext)s', 'mp4')

    def extract_info(self, url, download):
        info = {'id': VIDEO, 'description': 'Integration test caption'}
        Path(self.prepare_filename(info)).write_bytes(b'\x00\x00\x00\x1cftypisom' + b'x' * 1024)
        for hook in self.options['progress_hooks']:
            hook({'downloaded_bytes': 1036, 'total_bytes': 1036})
        return info


class ImporterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        app.STATE = Path(cls.temp.name)
        app.initialize()
        cls.circle = ThreadingHTTPServer(('127.0.0.1', 0), CircleStub)
        app.CIRCLE = f'http://127.0.0.1:{cls.circle.server_port}'
        cls.helper = ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        app.PORT = cls.helper.server_port
        cls.base = f'http://127.0.0.1:{app.PORT}'
        for server in (cls.circle, cls.helper):
            threading.Thread(target=server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.stop_worker()
        cls.helper.shutdown()
        cls.circle.shutdown()
        cls.helper.server_close()
        cls.circle.server_close()
        cls.temp.cleanup()

    def setUp(self):
        self.stop_worker()
        app.JOBS.clear()
        app.ACTIVE.clear()
        app.SOURCES.clear()
        app.PERSONAL_BATCHES.clear()
        CircleStub.posts = []
        CircleStub.uploads = []
        CircleStub.lose_post_response = False
        with app.db() as connection:
            connection.execute('DELETE FROM imports')
            for table in ('worker_items','worker_batches','worker_schedules','worker_credentials'):
                connection.execute(f'DELETE FROM {table}')
        app.AUTOMATION = automation.Automation(app)
        app.AUTOMATION.initialize()
        app.SOURCES[(app.source_url('@creator'), VIDEO)] = {'url': f'https://www.tiktok.com/@creator/video/{VIDEO}', 'description': 'test'}

    @staticmethod
    def stop_worker():
        if app.AUTOMATION and app.AUTOMATION.worker:
            app.AUTOMATION.stop.set()
            app.AUTOMATION.wake.set()
            app.AUTOMATION.worker.join(5)
            if app.AUTOMATION.worker.is_alive():
                raise AssertionError('Test worker failed to stop')

    def tearDown(self):
        self.stop_worker()

    def call(self, path, body=None, cookie=COOKIE, origin=None):
        headers = {'X-Social-Client': 'web', 'Cookie': cookie, 'Host': f'localhost:{app.PORT}'}
        if origin:
            headers['Origin'] = origin
        if body is not None:
            headers['Content-Type'] = 'application/json'
        req = request.Request(self.base + app.BASE + path, headers=headers,
                              data=json.dumps(body).encode() if body is not None else None)
        try:
            with request.urlopen(req, timeout=5) as response:
                return response.status, json.load(response)
        except error.HTTPError as exc:
            with exc:
                return exc.code, json.load(exc)

    def import_and_wait(self):
        status, result = self.call('/imports', {'account': '@creator', 'videoId': VIDEO})
        self.assertIn(status, (200, 202))
        end = time.monotonic() + 5
        while result['status'] in ('queued', 'processing'):
            self.assertLess(time.monotonic(), end)
            time.sleep(.02)
            _, result = self.call('/imports/' + result['jobId'])
        while app.ACTIVE:
            self.assertLess(time.monotonic(), end)
            time.sleep(.01)
        return result

    def test_real_contract_and_persistent_duplicate(self):
        with patch.dict('sys.modules', {'yt_dlp': types.SimpleNamespace(YoutubeDL=DownloadFixture)}):
            result = self.import_and_wait()
        self.assertEqual(result['status'], 'imported')
        self.assertEqual(result['postId'], POST)
        self.assertEqual(len(CircleStub.uploads), 1)
        mime, body = CircleStub.uploads[0]
        self.assertIn('multipart/form-data; boundary=', mime)
        self.assertIn(b'name="file"', body)
        self.assertIn(b'Content-Type: video/mp4', body)
        self.assertEqual(CircleStub.posts[0]['content'], 'Integration test caption')
        self.assertFalse(any(app.STATE.glob('download-*')))
        app.JOBS.clear()  # Persisted ledger still prevents a second upload/post.
        self.assertEqual(self.import_and_wait()['status'], 'duplicate')
        self.assertEqual(len(CircleStub.posts), 1)
        self.assertEqual(len(CircleStub.uploads), 1)

    def test_lost_post_response_is_reconciled(self):
        CircleStub.lose_post_response = True
        with patch.dict('sys.modules', {'yt_dlp': types.SimpleNamespace(YoutubeDL=DownloadFixture)}):
            self.assertEqual(self.import_and_wait()['status'], 'failed')
        self.assertEqual(self.import_and_wait()['status'], 'duplicate')
        self.assertEqual(len(CircleStub.posts), 1)
        self.assertEqual(len(CircleStub.uploads), 1)

    def test_auth_origin_and_source_validation(self):
        self.assertEqual(self.call('/health', origin='https://other.example')[0], 403)
        self.assertEqual(self.call('/imports', {'account': '@creator', 'videoId': VIDEO}, cookie='')[0], 401)
        self.assertEqual(self.call('/imports', {'account': 'https://example.com', 'videoId': VIDEO})[0], 400)
        self.assertEqual(self.call('/imports', {'account': '@creator', 'videoId': '1'})[0], 400)
        self.assertFalse(CircleStub.posts)
        self.assertFalse(CircleStub.uploads)
        with self.assertRaises(app.Failure):
            app.source_url('12345')

    def test_requested_profile_count_and_pagination(self):
        entries = [{'id': str(int(VIDEO) + i), 'title': 'fixture', 'duration': 12} for i in range(4)]
        result = subprocess.CompletedProcess([], 0, stdout=json.dumps({'entries': entries}), stderr='')
        with patch.object(app.subprocess, 'run', return_value=result) as run:
            status, page = self.call('/videos?account=%40creator&limit=3&cursor=6', cookie='')
        self.assertEqual(status, 200)
        self.assertEqual(len(page['videos']), 3)
        self.assertEqual(page['nextCursor'], '9')
        command = run.call_args.args[0]
        self.assertEqual(command[command.index('--playlist-items') + 1], '7:10')
        self.assertTrue(all(isinstance(video['id'], str) for video in page['videos']))
        for limit in ('0', '501', '2.5', 'abc'):
            self.assertEqual(self.call('/videos?account=%40creator&limit=' + limit)[0], 400)

    def test_explore_filters_real_video_items_and_bounds_count(self):
        item = {'id': VIDEO, 'desc': 'fixture', 'author': {'uniqueId': 'creator'},
                'video': {'duration': 12, 'cover': 'https://example.com/image.jpg'}, 'isAd': False}
        photos = {**item, 'id': str(int(VIDEO) + 1), 'imagePost': {'images': [1]}}
        advert = {**item, 'id': str(int(VIDEO) + 2), 'isAd': True}
        self.assertEqual([video['id'] for video in app.explore_items({'itemList': [item, photos, advert]})], [VIDEO])
        videos = app.explore_items({'itemList': [item]})
        result = subprocess.CompletedProcess([], 0, stdout=json.dumps({'videos': videos}), stderr='')
        with patch.object(app.subprocess, 'run', return_value=result) as run:
            status, page = self.call('/videos?mode=explore&limit=3', cookie='')
        self.assertEqual(status, 200)
        self.assertEqual(len(page['videos']), 1)
        self.assertIsNone(page['nextCursor'])
        self.assertIn('3', page['notice'])
        self.assertEqual(run.call_args.args[0][-2:], ['--explore', '3'])
        self.assertIn((app.EXPLORE_URL, VIDEO), app.SOURCES)
        with patch.dict('sys.modules', {'yt_dlp': types.SimpleNamespace(YoutubeDL=DownloadFixture)}):
            status, job = self.call('/imports', {'mode': 'explore', 'videoId': VIDEO, 'account': ''})
            self.assertEqual(status, 202)
            end = time.monotonic() + 5
            while job['status'] in ('queued', 'processing'):
                self.assertLess(time.monotonic(), end)
                time.sleep(.02)
                _, job = self.call('/imports/' + job['jobId'])
        self.assertEqual(job['status'], 'imported')
        # TikTok source mode never changes the current Circle destination author.
        with app.db() as connection:
            row = connection.execute('SELECT author, video, source FROM imports').fetchone()
        self.assertEqual(row['author'], AUTHOR)
        self.assertEqual(row['video'], VIDEO)
        self.assertEqual(row['source'], f'https://www.tiktok.com/@creator/video/{VIDEO}')

    def test_explore_failure_is_explicit(self):
        failure = {'code': 'TIKTOK_EXPLORE_UNAVAILABLE', 'message': 'Public page unavailable', 'status': 422}
        result = subprocess.CompletedProcess([], 1, stdout=json.dumps(failure), stderr='')
        with patch.object(app.subprocess, 'run', return_value=result):
            status, response = self.call('/videos?mode=explore&limit=10', cookie='')
        self.assertEqual(status, 422)
        self.assertEqual(response['code'], failure['code'])
        self.assertNotIn('videos', response)

    def test_personal_feed_staging_and_import(self):
        item = {'id': VIDEO, 'sourceUrl': f'https://www.tiktok.com/@creator/video/{VIDEO}',
                'description': 'From the current browser feed', 'thumbnailUrl': 'https://example.com/cover.jpg',
                'durationSeconds': 12}
        payload = {'version': 1, 'source': app.PERSONAL_FEED_URL, 'limit': 3, 'videos': [item, item]}
        status, page = self.call('/personal-feed', payload)
        self.assertEqual(status, 200)
        self.assertEqual(len(page['videos']), 1)
        self.assertEqual(page['videos'][0]['creator'], 'creator')
        self.assertIn('account', page)
        self.assertIn((f"personal:{page['account']}", VIDEO), app.SOURCES)
        self.assertFalse(CircleStub.posts)  # Staging never publishes automatically.
        status, snapshot = self.call('/videos?mode=personal&account=' + page['account'] + '&limit=3')
        self.assertEqual(status, 200)
        self.assertEqual(snapshot['videos'][0]['id'], VIDEO)
        with patch.dict('sys.modules', {'yt_dlp': types.SimpleNamespace(YoutubeDL=DownloadFixture)}):
            status, job = self.call('/imports', {'mode': 'personal', 'account': page['account'], 'videoId': VIDEO})
            self.assertEqual(status, 202)
            end = time.monotonic() + 5
            while job['status'] in ('queued', 'processing'):
                self.assertLess(time.monotonic(), end)
                time.sleep(.02)
                _, job = self.call('/imports/' + job['jobId'])
        self.assertEqual(job['status'], 'imported')
        self.assertEqual(CircleStub.posts[0]['content'], 'Integration test caption')

    def test_personal_feed_validation_and_no_anonymous_fallback(self):
        with patch.object(app.subprocess, 'run') as run:
            status, response = self.call('/videos?mode=personal&limit=10', cookie='')
            self.assertEqual(status, 400)
            self.assertEqual(response['code'], 'PERSONAL_FEED_REQUIRED')
            run.assert_not_called()
        item = {'id': VIDEO, 'sourceUrl': f'https://www.tiktok.com/@creator/video/{VIDEO}', 'description': 'test'}
        base = {'version': 1, 'source': app.PERSONAL_FEED_URL, 'limit': 1, 'videos': [item]}
        for payload in [
            {**base, 'source': app.EXPLORE_URL},
            {**base, 'videos': []},
            {**base, 'videos': [{**item, 'sourceUrl': 'http://localhost/private'}]},
            {**base, 'videos': [{**item, 'sourceUrl': f'https://www.tiktok.com/@creator/video/{int(VIDEO)+1}'}]},
            {**base, 'videos': [{**item, 'id': int(VIDEO)}]},
            {**base, 'videos': [{**item, 'thumbnailUrl': 'http://localhost/private'}]},
        ]:
            self.assertEqual(self.call('/personal-feed', payload)[0], 400)
        self.assertEqual(self.call('/personal-feed', base, origin='https://www.tiktok.com')[0], 403)

    def test_background_queue_survives_client_and_worker_restart(self):
        # Real DPAPI is verified separately; deterministic encryption fixture is test-only.
        def fixture_protect(value, decrypt=False):
            return value.removeprefix('test-encrypted:') if decrypt else 'test-encrypted:'+value
        with patch.object(automation,'protect',side_effect=fixture_protect):
            self.assertEqual(self.call('/batches', {'account':'@creator','videoIds':[VIDEO]}, cookie='')[0],401)
            status,result=self.call('/batches', {'account':'@creator','videoIds':[VIDEO]})
            self.assertEqual(status,200)
            with app.db() as c:
                secret=c.execute('SELECT secret FROM worker_credentials').fetchone()[0]
                self.assertIn('background-access',secret)
                self.assertNotIn('test-session',secret)
                c.execute("UPDATE worker_batches SET status='processing'")
                c.execute("UPDATE worker_items SET status='processing'")
            app.AUTOMATION=automation.Automation(app)
            app.AUTOMATION.initialize()  # Lost in-flight state is recovered on startup.
            self.assertEqual(app.AUTOMATION.batch(result['batchId'],AUTHOR)['status'],'queued')
            with patch.dict('sys.modules', {'yt_dlp':types.SimpleNamespace(YoutubeDL=DownloadFixture)}):
                app.AUTOMATION.start()
                end=time.monotonic()+5
                while app.AUTOMATION.batch(result['batchId'],AUTHOR)['status']!='completed':
                    self.assertLess(time.monotonic(),end)
                    time.sleep(.02)
                self.stop_worker()
            batch=app.AUTOMATION.batch(result['batchId'],AUTHOR)
            self.assertEqual(batch['counts']['imported'],1)
            self.assertEqual(len(CircleStub.posts),1)
            self.assertEqual(len(CircleStub.uploads),1)
            # A second durable batch uses the same TikTok-ID ledger.
            _,second=self.call('/batches', {'account':'@creator','videoIds':[VIDEO]})
            self.assertEqual(app.AUTOMATION.batch(second['batchId'],AUTHOR)['counts']['duplicate'],1)
            self.assertNotIn('secret',json.dumps(self.call('/automation/state')[1]))

    def test_pause_cancel_and_emergency_stop_without_circle(self):
        source=app.SOURCES[(app.source_url('@creator'),VIDEO)]
        batch=app.AUTOMATION.create_batch(AUTHOR,{}, {VIDEO:source})
        self.assertEqual(self.call('/batches/control',{'batchId':batch,'action':'pause'})[1]['status'],'paused')
        self.assertEqual(self.call('/batches/control',{'batchId':batch,'action':'cancel'})[1]['counts']['cancelled'],1)
        second=app.AUTOMATION.create_batch(AUTHOR,{}, {VIDEO:source})
        self.assertEqual(self.call('/automation/stop-all',{'cancelAll':True},cookie='')[0],200)
        self.assertEqual(app.AUTOMATION.batch(second,AUTHOR)['status'],'cancelled')
        self.assertFalse(CircleStub.posts)

    def schedule_row(self):
        with app.db() as c:
            return dict(c.execute('SELECT * FROM worker_schedules').fetchone())

    def test_schedule_count_interval_max_runs_and_daily_limit(self):
        worker=app.AUTOMATION
        app.SOURCES[('personal-browser',VIDEO)]=app.SOURCES[(app.source_url('@creator'),VIDEO)]
        with patch.object(worker,'ensure_connected'),patch.object(worker,'session_for'),patch.object(app,'list_videos',return_value={'videos':[{'id':VIDEO}]}) as listing:
            worker.schedule({'limit':3,'intervalMinutes':7,'dailyLimit':2,'maxRuns':1},app.CircleSession(COOKIE))
            started=time.time()
            worker.run_schedule(self.schedule_row())
            listing.assert_called_once_with('',None,2,'personal_auto')
            row=self.schedule_row()
            self.assertEqual(row['enabled'],0)
            self.assertEqual(json.loads(row['config'])['runs'],1)
            self.assertGreaterEqual(row['next_run'],started+7*60)
            with app.db() as c:
                c.execute("UPDATE worker_items SET status='imported',finished=?,post=?",(time.time(),POST))
                c.execute("UPDATE worker_batches SET status='completed',created=?",(time.time()-86400*2,))
            worker.schedule({'limit':3,'intervalMinutes':7,'dailyLimit':1},app.CircleSession(COOKIE))
            listing.reset_mock()
            worker.run_schedule(self.schedule_row())
            listing.assert_not_called()  # Counts publication day, not creation day.
            self.assertIn('limit',self.schedule_row()['message'])

    def test_schedule_stops_on_auth_failure_or_three_collection_errors(self):
        worker=app.AUTOMATION
        with patch.object(worker,'ensure_connected'),patch.object(worker,'session_for'),patch.object(app,'list_videos',side_effect=automation.AutomationError('Page unavailable','TIKTOK_TIMEOUT')):
            worker.schedule({'limit':1},app.CircleSession(COOKIE))
            for count in range(1,4):
                worker.run_schedule(self.schedule_row())
                row=self.schedule_row()
                self.assertEqual(row['failures'],count)
                self.assertEqual(row['enabled'],int(count<3))
            worker.schedule({'limit':1},app.CircleSession(COOKIE))
            with patch.object(app,'list_videos',side_effect=automation.AutomationError('Sign in','TIKTOK_LOGIN_REQUIRED')):
                worker.run_schedule(self.schedule_row())
                self.assertEqual(self.schedule_row()['enabled'],0)
        for value in (0,1441,2.5,True,'1e2'):
            with self.assertRaises(automation.AutomationError):
                worker.config({'intervalMinutes':value})

    def test_stop_during_collection_does_not_publish(self):
        worker=app.AUTOMATION
        def collect(*_):
            worker.stop_all()
            return {'videos':[]}
        with patch.object(worker,'ensure_connected'),patch.object(worker,'session_for'),patch.object(app,'list_videos',side_effect=collect):
            worker.schedule({'limit':1},app.CircleSession(COOKIE))
            worker.run_schedule(self.schedule_row())
        with app.db() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM worker_batches').fetchone()[0],0)
        self.assertEqual(self.schedule_row()['enabled'],0)

    def test_database_apply_rolls_back_failed_restart_and_rejects_busy_queue(self):
        worker=app.AUTOMATION
        for restart_result in ({'ok':False},subprocess.TimeoutExpired('test-restart',15)):
            with self.subTest(restart=type(restart_result).__name__),tempfile.TemporaryDirectory() as folder:
                root=Path(folder);(root/'server').mkdir();env=root/'server'/'.env'
                env.write_text('OLD_CONFIGURATION',encoding='utf-8')
                def apply(*_):
                    env.write_text('NEW_CONFIGURATION',encoding='utf-8')
                    return {'saved':True}
                with patch.object(app,'ROOT',root),patch.object(worker,'bridge',side_effect=apply),patch.object(worker,'restart_circle',side_effect=[restart_result,{'ok':True}]):
                    result=worker.database('apply',{})
                self.assertFalse(result['saved'])
                self.assertEqual(env.read_text(),'OLD_CONFIGURATION')
        worker.create_batch(AUTHOR,{}, {VIDEO:app.SOURCES[(app.source_url('@creator'),VIDEO)]})
        with patch.object(worker,'bridge') as bridge:
            with self.assertRaises(automation.AutomationError) as caught:
                worker.database('apply',{})
            self.assertEqual(caught.exception.code,'WORKER_BUSY')
            bridge.assert_not_called()


    def test_deploy_private_worker_requires_server_key(self):
        key=Path(self.temp.name)/'control-key';key.write_text('k'*64,encoding='utf-8')
        with patch.object(app,'DEPLOYED',True),patch.object(app,'SECRET_FILE',key):
            self.assertEqual(self.call('/health')[0],403)
            req=request.Request(self.base+app.BASE+'/health',headers={'Host':'importer:4317','X-Importer-Key':'k'*64,'X-Social-Client':'web'})
            with request.urlopen(req,timeout=5) as response:self.assertTrue(json.load(response)['ok'])
            req=request.Request(self.base+app.BASE+'/health',headers={'Host':'importer:4317','X-Importer-Key':'wrong','X-Social-Client':'web'})
            with self.assertRaises(error.HTTPError) as caught:request.urlopen(req,timeout=5)
            self.assertEqual(caught.exception.code,403)
            caught.exception.close()

    def test_expired_background_session_is_renewed_from_current_admin_submission(self):
        worker=app.AUTOMATION
        session=app.CircleSession(COOKIE);session.admin_required=True
        worker.remember(session,AUTHOR)
        for code in ('CIRCLE_LOGIN_REQUIRED','CIRCLE_RECONNECT_REQUIRED'):
            with self.subTest(code=code),patch.object(worker,'session_for',side_effect=app.Failure('Expired',code,401)),patch.object(worker,'connect') as reconnect:
                worker.ensure_connected(session,AUTHOR)
                reconnect.assert_called_once_with(session)
        with patch.object(worker,'session_for',side_effect=automation.AutomationError('Role revoked','CIRCLE_ADMIN_REVOKED',401)),patch.object(worker,'connect') as reconnect:
            with self.assertRaises(automation.AutomationError):worker.ensure_connected(session,AUTHOR)
            reconnect.assert_not_called()

    def test_deploy_credentials_use_authenticated_encryption(self):
        with patch.dict('os.environ',{'IMPORTER_DEPLOYED':'1','IMPORTER_SHARED_SECRET':'k'*64}):
            encrypted=automation.protect(COOKIE)
            self.assertTrue(encrypted.startswith('aesgcm:v1:'))
            self.assertNotIn(COOKIE,encrypted)
            self.assertEqual(automation.protect(encrypted,True),COOKIE)
            with patch.dict('os.environ',{'IMPORTER_SHARED_SECRET':'different-key-'*8}):
                with self.assertRaises(automation.AutomationError):automation.protect(encrypted,True)

    def test_admin_background_work_stops_after_role_revocation(self):
        session=app.CircleSession(COOKIE);session.admin_required=True
        app.AUTOMATION.remember(session,AUTHOR)
        with patch.object(app.AUTOMATION,'identify',return_value=(AUTHOR,{'id':AUTHOR,'role':'USER'})):
            with self.assertRaises(automation.AutomationError) as caught:app.AUTOMATION.session_for(AUTHOR)
            self.assertEqual(caught.exception.code,'CIRCLE_ADMIN_REVOKED')

    def test_remote_login_frames_and_commands_are_owner_scoped(self):
        remote=app.AUTOMATION.remote_browser
        remote.owner=AUTHOR;remote.thread=types.SimpleNamespace(is_alive=lambda:True);remote.frame='private-frame'
        self.assertEqual(remote.status(AUTHOR)['frame'],'private-frame')
        self.assertIsNone(remote.status('someone-else')['frame'])
        with self.assertRaises(automation.AutomationError):remote.command('someone-else',{'action':'text','text':'hidden'})
        with self.assertRaises(automation.AutomationError):remote.command(AUTHOR,{'action':'move','x':-1,'y':0})
        with self.assertRaises(automation.AutomationError):remote.command(AUTHOR,{'action':'save'})
        remote.command(AUTHOR,{'action':'text','text':'typed explicitly'})
        self.assertEqual(remote.commands.get_nowait()['action'],'text')

    def test_failed_transcoding_never_reports_a_published_import(self):
        original=app.CircleSession.call
        def call(session,path,body=None):
            if path=='media/'+MEDIA:return {'id':MEDIA,'status':'FAILED'}
            return original(session,path,body)
        with patch.dict('sys.modules',{'yt_dlp':types.SimpleNamespace(YoutubeDL=DownloadFixture)}),patch.object(app.CircleSession,'call',call):
            result=self.import_and_wait()
        self.assertEqual(result['status'],'failed');self.assertEqual(result['code'],'VIDEO_PROCESSING_FAILED')
        self.assertEqual(CircleStub.posts,[])


if __name__ == '__main__':
    unittest.main(verbosity=2)
