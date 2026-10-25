"""Private, bounded Browser Use form service. No public port or application secrets."""
import hmac
import json
import os
import signal
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

key=os.environ.get('BOOP_FORM_BROWSER_TOKEN','')
if len(key)<32: raise RuntimeError('A private worker token of at least 32 characters is required')
slot=threading.BoundedSemaphore(1)
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass  # Never log questions, answers, URLs or tokens.
    def reply(self,status,data):
        body=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_POST(self):
        if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+key): self.reply(401,{'error':'Unauthorized'});return
        if self.path not in ['/inspect','/submit']: self.reply(404,{'error':'Unsupported operation'});return
        try: length=int(self.headers.get('Content-Length','0'))
        except ValueError: self.reply(400,{'error':'Invalid request size'});return
        if not 0<length<=64000:self.reply(413,{'error':'Request exceeds limit'});return
        if not slot.acquire(False):self.reply(429,{'error':'Form browser is busy; no new browser was started.'});return
        try:
            args=json.loads(self.rfile.read(length))
            # No request-controlled executable, environment, profile, proxy or script.
            env={k:os.environ[k] for k in ['PATH','HOME','LANG','BOOP_FORM_CHROMIUM','BOOP_FORM_PROXY','BOOP_FORM_DOCKER'] if k in os.environ}
            env.update(ANONYMIZED_TELEMETRY='false',DO_NOT_TRACK='1')
            proc=subprocess.Popen([sys.executable,'/worker/google-forms-worker.py'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,env=env,start_new_session=True)
            try:
                stdout,_=proc.communicate(json.dumps({'op':self.path[1:],'args':args})+'\n',timeout=103)
            finally:
                # Reap the worker process group on success and timeout.
                try: os.killpg(proc.pid,signal.SIGKILL)
                except ProcessLookupError: pass
                proc.wait()
            lines=[line[10:] for line in stdout.splitlines() if line.startswith('BOOP_FORM ')]
            self.reply(200,json.loads(lines[-1]) if lines else {'error':'Worker ended without a verified result'})
        except Exception:self.reply(200,{'error':'Worker did not return a verified result. Do not automatically retry a submission.'})
        finally:slot.release()
ThreadingHTTPServer(('0.0.0.0',9000),Handler).serve_forever()
