import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {runLocalFormBrowser} from '../server/form-browser.js';
import {formInspection,validateFormAnswers} from '../server/google-form-policy.js';
import {mkdir,writeFile} from 'node:fs/promises';
let submissions=0;let received='';
const html=`<!doctype html><h1>Boop synthetic form</h1><form method="post" action="/formResponse">
<div role="listitem"><h3>Name *</h3><input name="name" required></div>
<div role="listitem"><h3>Notes</h3><textarea name="notes"></textarea></div>
<div role="listitem"><h3>Choice *</h3><label>A<input type="radio" name="choice" value="A" required></label><label>B<input type="radio" name="choice" value="B"></label><label>Other<input type="radio" name="choice" value="__other_option__"></label><input aria-label="Other response"></div>
<div role="listitem"><h3>Interests</h3><div role="listitem"><input type="checkbox" name="interests" value="Music"></div><div role="listitem"><input type="checkbox" name="interests" value="Books"></div></div>
<div role="listitem"><h3>Team</h3><select name="team"><option>Blue</option><option>Green</option></select></div>
<button type="submit">Submit</button></form>`;
const customHtml=html
 .replace(/<label>A<input[\s\S]*?<input aria-label="Other response">/,`<div role="radiogroup"><div role="radio" data-value="A" aria-checked="false" onclick="setRadio(this)">A</div><div role="radio" data-value="B" aria-checked="false" onclick="setRadio(this)">B</div></div><input type="hidden" name="choice">`)
 .replace(/<div role="listitem"><input type="checkbox" name="interests" value="Music"><\/div><div role="listitem"><input type="checkbox" name="interests" value="Books"><\/div>/,`<div role="checkbox" data-value="Music" aria-checked="false" onclick="setCheck(this)">Music</div><div role="checkbox" data-value="Books" aria-checked="false" onclick="setCheck(this)">Books</div>`)
 .replace(/<select name="team">[\s\S]*?<\/select>/,`<div role="listbox"><div role="option" data-value="Blue" aria-selected="false" onclick="setOption(this)">Blue</div><div role="option" data-value="Green" aria-selected="false" onclick="setOption(this)">Green</div></div><input type="hidden" name="team">`)
 +`<script>
 function setRadio(el){el.parentElement.querySelectorAll('[role=radio]').forEach(e=>e.setAttribute('aria-checked',String(e===el)));el.closest('[role=listitem]').querySelector('input[type=hidden]').value=el.dataset.value;}
 function setCheck(el){const checked=el.getAttribute('aria-checked')!=='true';el.setAttribute('aria-checked',String(checked));const b=el.closest('[role=listitem]');b.querySelectorAll('input[type=hidden]').forEach(e=>e.remove());b.querySelectorAll('[aria-checked=true]').forEach(e=>{const i=document.createElement('input');i.type='hidden';i.name='interests';i.value=e.dataset.value;b.append(i);});}
 function setOption(el){el.parentElement.querySelectorAll('[role=option]').forEach(e=>e.setAttribute('aria-selected',String(e===el)));el.closest('[role=listitem]').querySelector('input[type=hidden]').value=el.dataset.value;}
 </script>`;
const server=createServer(async(req,res)=>{
 if(req.method==='POST'){for await(const chunk of req)received+=chunk.toString();submissions++;if(req.url?.includes('delayed')){setTimeout(()=>res.end('<h1>Your response has been recorded.</h1>'),1800);return;}if(req.url?.includes('uncertain')){res.end(html+'<p>Your response has been recorded — example question text, not confirmation</p>');return;}res.end('<h1>Your response has been recorded.</h1><a href="/form">Submit another response</a>');return;}
 res.setHeader('content-type','text/html');res.end(req.url==='/delayed'?html.replace('/formResponse','/formResponse?delayed'):req.url==='/coordinate-blocked'?html+`<script>document.addEventListener('click',event=>{if(event.isTrusted&&event.target.matches('input[type=checkbox]')){event.preventDefault();event.stopImmediatePropagation();}},true)</script>`:req.url==='/keyboard-blocked'?html+`<script>document.addEventListener('keydown',event=>event.preventDefault())</script>`:req.url==='/custom'?customHtml:req.url==='/uncertain'?html.replace('/formResponse','/formResponse?uncertain'):req.url==='/multipage'?html.replace('>Submit<','>Next<'):html);
});
server.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
const address=server.address();if(!address||typeof address==='string')throw Error('Fixture unavailable');const origin=`http://127.0.0.1:${address.port}`;
try{
 const inspection=formInspection.parse(await runLocalFormBrowser('inspect',{url:origin+'/form'},origin));
 assert.equal(submissions,0);assert.equal(inspection.questions.length,5);
 const answers=[{questionId:'q0',values:['Sample User']},{questionId:'q1',values:['Synthetic testing only']},{questionId:'q2',values:['B']},{questionId:'q3',values:['Music','Books']},{questionId:'q4',values:['Green']}];
 validateFormAnswers(inspection,answers);
 const stale=await runLocalFormBrowser('submit',{version:1,inspection:{...inspection,fingerprint:'0'.repeat(64)},answers},origin) as any;
 assert.equal(stale.status,'failed');assert.equal(submissions,0);
 const result=await runLocalFormBrowser('submit',{version:1,inspection,answers},origin) as any;
 assert.equal(result.status,'confirmed',JSON.stringify(result));assert.equal(submissions,1);
 const data=new URLSearchParams(received);assert.equal(data.get('name'),'Sample User');assert.equal(data.get('choice'),'B');assert.equal(data.get('team'),'Green');assert.deepEqual(data.getAll('interests'),['Music','Books']);
 const unsupported=await runLocalFormBrowser('inspect',{url:origin+'/multipage'},origin).then(()=>false,()=>true);
 assert.equal(unsupported,true);assert.equal(submissions,1);
 const uncertainInspection=formInspection.parse(await runLocalFormBrowser('inspect',{url:origin+'/uncertain'},origin));
 const uncertain=await runLocalFormBrowser('submit',{version:1,inspection:uncertainInspection,answers},origin) as {status:string};
 assert.equal(uncertain.status,'uncertain');assert.equal(submissions,2,'One click per explicit submission; never retry on missing confirmation');
 received='';
 const customInspection=formInspection.parse(await runLocalFormBrowser('inspect',{url:origin+'/custom'},origin));
 assert.equal(customInspection.questions.length,5);
 const custom=await runLocalFormBrowser('submit',{version:1,inspection:customInspection,answers},origin) as {status:string};
 assert.equal(custom.status,'confirmed',JSON.stringify(custom));assert.equal(submissions,3);
 const customData=new URLSearchParams(received);assert.equal(customData.get('choice'),'B');assert.equal(customData.get('team'),'Green');assert.deepEqual(customData.getAll('interests'),['Music','Books']);
 received='';
 const keyboardInspection=formInspection.parse(await runLocalFormBrowser('inspect',{url:origin+'/keyboard-blocked'},origin));
 const keyboardResult=await runLocalFormBrowser('submit',{version:1,inspection:keyboardInspection,answers},origin) as {status:string};
 assert.equal(keyboardResult.status,'confirmed',JSON.stringify(keyboardResult));assert.equal(submissions,4);
 const keyboardData=new URLSearchParams(received);assert.equal(keyboardData.get('name'),'Sample User');assert.equal(keyboardData.get('notes'),'Synthetic testing only');
 received='';
 const coordinateInspection=formInspection.parse(await runLocalFormBrowser('inspect',{url:origin+'/coordinate-blocked'},origin));
 const coordinateResult=await runLocalFormBrowser('submit',{version:1,inspection:coordinateInspection,answers},origin) as {status:string};
 assert.equal(coordinateResult.status,'confirmed',JSON.stringify(coordinateResult));assert.equal(submissions,5);
 assert.deepEqual(new URLSearchParams(received).getAll('interests'),['Music','Books']);
 received='';
 const delayedInspection=formInspection.parse(await runLocalFormBrowser('inspect',{url:origin+'/delayed'},origin));
 const delayedResult=await runLocalFormBrowser('submit',{version:1,inspection:delayedInspection,answers},origin) as {status:string};
 assert.equal(delayedResult.status,'confirmed',JSON.stringify(delayedResult));assert.equal(submissions,6);
 const report={at:new Date().toISOString(),passed:true,provider:'Browser Use',realBrowser:true,onlySyntheticData:true,fieldTypes:['text','paragraph','radio','checkbox','select'],staleFormBlocked:true,confirmationVerified:true,multipageBlocked:true,customGoogleStyleControls:true,keyboardDiscardRegression:true,unretainedCheckboxRegression:true,delayedConfirmationVerified:true,unverifiedResultNotReportedAsSuccess:true,submissions};
 await mkdir('data/google-forms',{recursive:true});await writeFile('data/google-forms/qualification.json',JSON.stringify(report,null,2));console.log(report);
}finally{server.closeAllConnections();server.close();}
