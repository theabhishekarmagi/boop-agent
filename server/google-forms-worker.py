"""One-shot public Google Forms Browser Use worker; no agent/AI credentials."""
import asyncio
import contextlib
import hashlib
import json
import os
import re
import sys
import tempfile
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

wire=sys.stdout
os.environ.update(ANONYMIZED_TELEMETRY='false',DO_NOT_TRACK='1',BROWSER_USE_LOGGING_LEVEL='error')
with contextlib.redirect_stdout(sys.stderr):
    from browser_use import Browser

# This switch is ONLY available to a direct local fixture runner. The HTTP worker
# never forwards command-line flags or an origin supplied in a request.
submission_started=False
fixture=None
if len(sys.argv)==3 and sys.argv[1]=='--fixture-origin':
    parsed=urlparse(sys.argv[2])
    if parsed.hostname!='127.0.0.1' or parsed.scheme!='http': raise ValueError('Invalid local fixture origin')
    fixture=sys.argv[2]

def valid_url(url, respondent=True):
    p=urlparse(url)
    if fixture and f'{p.scheme}://{p.netloc}'==fixture: return url
    if p.scheme!='https' or p.username or p.password or p.port: raise ValueError('Only public Google Forms URLs are supported')
    if p.hostname=='forms.gle' and re.fullmatch(r'/[A-Za-z0-9_-]+/?',p.path): return url
    suffix='viewform' if respondent else '(?:viewform|formResponse)'
    if p.hostname!='docs.google.com' or not re.fullmatch(r'/forms/(?:u/\d+/)?d/(?:e/)?[A-Za-z0-9_-]+/'+suffix+r'/?',p.path):
        raise ValueError('This form requires sign-in or navigated outside public Google Forms')
    return url

DOM_INSPECT=r'''() => {
 const visible=e=>e.getClientRects().length>0 && getComputedStyle(e).visibility!=='hidden';
 const buttons=[...document.querySelectorAll('[role="button"],button,input[type="submit"]')].filter(visible);
 const name=e=>(e.innerText||e.value||e.getAttribute('aria-label')||'').trim();
 const submit=buttons.filter(e=>name(e)==='Submit');
 const captcha=[...document.querySelectorAll('iframe')].some(e=>visible(e)&&/challenge/i.test(e.title)&&/recaptcha/i.test(e.src));
 const blocks=[...document.querySelectorAll('[role="listitem"]')].filter(b=>!b.parentElement?.closest('[role="listitem"]'));
 const questions=[];
 for(const [i,b] of blocks.entries()) {
  const controls=[...b.querySelectorAll('input:not([type="hidden"]),textarea,[role="radio"],[role="checkbox"],[role="listbox"],select')];
  if(!controls.length)continue;
  const id='q'+i;b.setAttribute('data-boop-question',id);
  const heading=b.querySelector('[role="heading"],h2,h3,label');
  const label=(heading?.textContent||controls[0].getAttribute('aria-label')||'Question '+(i+1)).trim();
  const choice=b.querySelector('[role="radio"],[role="checkbox"],input[type="radio"],input[type="checkbox"]');
  const dropdown=b.querySelector('select,[role="listbox"]');
  let type=b.querySelector('textarea')?'paragraph':choice?(choice.getAttribute('role')||choice.type):dropdown?'select':'text';
  if(b.querySelector('input[type="file"],input[type="date"],input[type="time"],input[type="password"]')||b.querySelectorAll('[role="radiogroup"]').length>1)type='unsupported';
  if(choice && [...b.querySelectorAll('input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"])')].some(e=>e.getAttribute('aria-label')!=='Other response'))type='unsupported';
  const optionNodes=type==='select'?b.querySelectorAll('option,[role="option"]'):b.querySelectorAll('[role="radio"],[role="checkbox"],input[type="radio"],input[type="checkbox"]');
  const options=[...optionNodes].map(e=>e.getAttribute('data-value')||e.getAttribute('aria-label')||e.value||e.textContent?.trim()||'').filter(v=>v&&v!=='__other_option__');
  questions.push({id,label,type,required:!!b.querySelector('[aria-required="true"],[required]')||/\*\s*$/.test(label),options:[...new Set(options)]});
 }
 return {title:(document.querySelector('[role="heading"][aria-level="1"],h1')?.textContent||document.title).trim(),questions,
 singlePage:submit.length===1&&!buttons.some(e=>name(e)==='Next'),captcha,hasSubmit:submit.length===1};
}'''

async def evaluate(page, code):
    result=await page.evaluate(code)
    if not isinstance(result,str): return result
    if result in ['True','true']: return True
    if result in ['False','false']: return False
    if result.startswith(('{','[')): return json.loads(result)
    return result

async def main(request):
    global submission_started
    op,args=request.get('op'),request.get('args',{})
    if op not in ['inspect','submit']: raise ValueError('Unknown form operation')
    url=args['url'] if op=='inspect' else args['inspection']['url']
    valid_url(url)
    # No existing user profile, no cookies, no downloaded files or browser secrets.
    with tempfile.TemporaryDirectory(prefix='boop-form-') as directory:
        browser=Browser(executable_path=os.environ.get('BOOP_FORM_CHROMIUM'),headless=True,use_cloud=False,is_local=True,
            # Start on a permitted blank target: distro Chromium's default
            # new-tab page can race the navigation watchdog during attachment.
            args=['--no-startup-window'],
            user_data_dir=directory,enable_default_extensions=False,permissions=[],accept_downloads=False,auto_download_pdfs=False,
            chromium_sandbox=os.environ.get('BOOP_FORM_DOCKER')!='true',
            proxy={'server':os.environ['BOOP_FORM_PROXY']} if os.environ.get('BOOP_FORM_PROXY') else None,
            allowed_domains=['docs.google.com','forms.gle','accounts.google.com']+([fixture] if fixture else []),
            cross_origin_iframes=False,keep_alive=False)
        try:
            await browser.start()
            await browser.navigate_to(url)
            page=await browser.get_current_page()
            state=None
            for _ in range(5):
                state=await browser.get_browser_state_summary(include_screenshot=False,cached=False)
                valid_url(state.url)
                view=await evaluate(page,DOM_INSPECT)
                if view['questions'] and view['hasSubmit']: break
                await asyncio.sleep(.5)
            if not view['questions'] or not view['hasSubmit']:
                diagnostic=await evaluate(page,'() => document.body.innerText.slice(0,600)')
                raise ValueError('Form unavailable, requires sign-in, or is multi-page. No response was submitted. Page: '+str(diagnostic))
            if view['captcha']: raise ValueError('CAPTCHA requires user interaction. No response was submitted.')
            if len(view['questions'])>60: raise ValueError('Form exceeds the 60-question limit')
            for q in view['questions']:
                if len(q['label'])>2000 or len(q['options'])>100: raise ValueError('Form exceeds question size limits')
            fingerprint=hashlib.sha256(json.dumps(view['questions'],sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
            inspection={'url':state.url,'title':view['title'][:2000],'fingerprint':fingerprint,'questions':view['questions'],'singlePage':view['singlePage']}
            if op=='inspect': return inspection
            if fingerprint!=args['inspection']['fingerprint']: return {'status':'failed','note':'The form questions or options changed after the draft. Prepare a new draft; nothing was submitted.'}
            if not view['singlePage']: return {'status':'failed','note':'Multi-page forms are not supported. Nothing was submitted.'}
            answers=args['answers'];known={q['id']:q for q in view['questions']}; by_id={a['questionId']:a['values'] for a in answers}
            if len(by_id)!=len(answers) or any(k not in known for k in by_id): raise ValueError('Unknown or repeated question ID')
            # Validate the entire plan before typing anything.
            for q in known.values():
                values=by_id.get(q['id'],[])
                if q['type']=='unsupported': raise ValueError('Unsupported question type; no response submitted')
                if len(values)>100 or any(not isinstance(v,str) or len(v)>10000 for v in values): raise ValueError('Answer exceeds limits')
                if q['required'] and not any(v.strip() for v in values): raise ValueError('Missing required answer')
                if q['type']!='checkbox' and len(values)>1: raise ValueError('Multiple answers require a checkbox question')
                if q['type'] in ['radio','checkbox','select'] and any(v not in q['options'] for v in values): raise ValueError('Answer not in displayed options')
            for q in known.values():
                values=by_id.get(q['id'],[])
                selector='[data-boop-question="'+q['id']+'"] '
                if q['type'] in ['text','paragraph']:
                    nodes=await page.get_elements_by_css_selector(selector+('textarea' if q['type']=='paragraph' else 'input:not([type="hidden"])'))
                    if len(nodes)!=1: raise ValueError('Ambiguous input; no response submitted')
                    # Google Forms can discard synthetic keyboard text even when
                    # the typing action returns successfully. Set the native input
                    # value and dispatch the input/change events its controller uses.
                    await nodes[0].evaluate("""(value) => {
                        const proto=this.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
                        Object.getOwnPropertyDescriptor(proto,'value').set.call(this,value);
                        this.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));
                        this.dispatchEvent(new Event('change',{bubbles:true}));
                        return this.value;
                    }""",values[0] if values else '')
                elif q['type']=='select':
                    if not values: continue
                    nodes=await page.get_elements_by_css_selector(selector+'select')
                    if nodes: await nodes[0].select_option(values[0])
                    else:
                        nodes=await page.get_elements_by_css_selector(selector+'[role="listbox"]')
                        await nodes[0].click()
                        options=await page.get_elements_by_css_selector(selector+'[role="option"]')
                        for el in options:
                            value=await el.evaluate('() => this.getAttribute("data-value")||this.textContent.trim()')
                            if value==values[0]: await el.click();break
                        else: raise ValueError('Dropdown option unavailable; nothing submitted')
                else:
                    nodes=await page.get_elements_by_css_selector(selector+'[role="'+q['type']+'"],'+selector+'input[type="'+q['type']+'"]')
                    for el in nodes:
                        value=await el.evaluate('() => this.getAttribute("data-value")||this.getAttribute("aria-label")||this.value||this.textContent.trim()')
                        checked=await el.evaluate('() => this.checked===true||this.getAttribute("aria-checked")==="true"')
                        desired=value in values
                        if desired != (str(checked).lower()=='true'):
                            await el.click()
                            await asyncio.sleep(.15)
                            selected=await el.evaluate('() => this.checked===true||this.getAttribute("aria-checked")==="true"')
                            if desired != (str(selected).lower()=='true'):
                                # Long Google Forms may move a control while the
                                # coordinate click is dispatched. Activate that
                                # exact already-resolved control once, then verify.
                                await el.evaluate('() => { this.click(); return true; }')
                                await asyncio.sleep(.15)
                                selected=await el.evaluate('() => this.checked===true||this.getAttribute("aria-checked")==="true"')
                                if desired != (str(selected).lower()=='true'): raise ValueError('The form option did not retain its reviewed selection; nothing submitted')
            # Read back every visible field before the irreversible click. This
            # also rejects unexpected prefilled/default answers absent in the draft.
            verified=await evaluate(page,"""() => {
              const answers="""+json.dumps(by_id)+""";
              for(const b of document.querySelectorAll('[data-boop-question]')) {
                const expected=answers[b.getAttribute('data-boop-question')]||[];
                const text=b.querySelector('textarea,input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])');
                const choices=[...b.querySelectorAll('[role="radio"],[role="checkbox"],input[type="radio"],input[type="checkbox"]')];
                const select=b.querySelector('select,[role="listbox"]');
                let actual=[];
                const val=e=>e.getAttribute('data-value')??e.getAttribute('aria-label')??e.value??e.textContent.trim();
                if(choices.length) actual=choices.filter(e=>e.checked||e.getAttribute('aria-checked')==='true').map(val);
                else if(select) actual=select.tagName==='SELECT'?[...select.selectedOptions].map(e=>e.value):[...select.querySelectorAll('[aria-selected="true"]')].map(val);
                else if(text) actual=[text.value];
                actual=actual.filter(v=>v!=='').sort();
                if(JSON.stringify(actual)!==JSON.stringify(expected.filter(v=>v!=='').slice().sort())) return {matches:false,question:b.getAttribute('data-boop-question'),actual,expected};
              }
              return {matches:true};
            }""")
            if not verified.get('matches'): return {'status':'failed','note':'Field verification mismatch: '+json.dumps(verified)[:1000]+'. Nothing was submitted.'}
            before=await evaluate(page,DOM_INSPECT)
            if before['captcha']: return {'status':'failed','note':'CAPTCHA needs user interaction. No response submitted.'}
            buttons=await page.get_elements_by_css_selector('[role="button"],button,input[type="submit"]')
            target=[]
            for el in buttons:
                yes=await el.evaluate('() => this.getClientRects().length>0 && (this.innerText||this.value||this.getAttribute("aria-label")||"").trim()==="Submit"')
                if str(yes).lower()=='true': target.append(el)
            if len(target)!=1: return {'status':'failed','note':'No unique Submit button. No response submitted.'}
            # Irreversible boundary: exactly one click, never retried.
            try:
                submission_started=True
                try:
                    await target[0].click()
                except Exception:
                    # The click may have reached Google before navigation detached
                    # its target. Verify the result, without a second click.
                    pass
                for _ in range(16):
                    await asyncio.sleep(.5)
                    try:
                        state=await browser.get_browser_state_summary(include_screenshot=False,cached=False)
                        valid_url(state.url,False)
                        # A submit navigation can destroy the previous execution
                        # context. Read the current page again; never click again.
                        page=await browser.get_current_page()
                        result=await evaluate(page,r'''() => ({text:document.body.innerText.slice(0,4000),errors:[...document.querySelectorAll('[role="alert"],[aria-invalid="true"]')].filter(e=>e.getClientRects().length).map(e=>e.textContent.trim()).filter(Boolean).slice(0,5),questions:[...document.querySelectorAll('[role="listitem"] input:not([type="hidden"]),[role="listitem"] textarea,[role="listitem"] [role="radio"],[role="listitem"] [role="checkbox"],[role="listitem"] [role="listbox"],select')].filter(e=>e.getClientRects().length).length})''')
                    except Exception:
                        continue
                    if 'formResponse' in urlparse(state.url).path and result['questions']==0 and re.search(r'Your response has been recorded|Submit another response|Edit your response',result['text']):
                        return {'status':'confirmed','note':result['text'][:2000],'url':state.url}
                    if result['errors']: return {'status':'failed','note':'Google rejected validation: '+'; '.join(result['errors'])[:1200],'url':state.url}
                return {'status':'uncertain','note':'Submit was clicked once but Google’s confirmation was not verified. Check the form owner’s responses before retrying.','url':state.url}
            except Exception:
                return {'status':'uncertain','note':'The browser lost confirmation after clicking Submit once. Do not automatically retry.'}
        finally:
            await asyncio.wait_for(browser.kill(),10)

async def runner():
    request={}
    try:
        request=json.loads(sys.stdin.readline())
        result=await asyncio.wait_for(main(request),85)
        message={'result':result}
    except Exception as exc:
        if request.get('op')=='submit': message={'result':{'status':'uncertain' if submission_started else 'failed','note':str(exc)[:1000] or 'Browser timeout; check the response before retrying.'}}
        else: message={'error':str(exc)[:1000]}
    wire.write('BOOP_FORM '+json.dumps(message)+'\n');wire.flush()
with contextlib.redirect_stdout(sys.stderr): asyncio.run(runner())
