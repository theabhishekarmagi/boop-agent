import {test} from 'node:test';
import assert from 'node:assert/strict';
import {googleFormUrl,explicitFormConfirmation,validateFormAnswers,type FormInspection} from '../server/google-form-policy.js';
const inspection:FormInspection={url:'https://docs.google.com/forms/d/e/fixture/viewform',title:'Fixture',fingerprint:'a'.repeat(64),singlePage:true,questions:[
 {id:'q0',label:'Name',type:'text',required:true,options:[]},
 {id:'q1',label:'Choice',type:'radio',required:true,options:['A','B']},
 {id:'q2',label:'Interests',type:'checkbox',required:false,options:['Music','Books']},
]};
test('form URLs permit only Google respondent paths, never credentials, editor links, alternate ports or internal addresses',()=>{
 for(const u of ['http://127.0.0.1/form','https://docs.google.com.evil.test/forms/d/e/x/viewform','https://user:pass@docs.google.com/forms/d/e/x/viewform','https://docs.google.com/forms/d/x/edit','https://docs.google.com:8443/forms/d/e/x/viewform','https://169.254.169.254/latest/meta-data'])assert.throws(()=>googleFormUrl(u));
 assert.match(googleFormUrl('https://forms.gle/AbC123'),/forms.gle/);
 assert.match(googleFormUrl(inspection.url),/hl=en/);
});
test('submission requires a clear human confirmation, not negation, webpage text or a proposed task',()=>{
 for(const text of ['submit it','yes, submit it','Please submit the form','go ahead'])assert(explicitFormConfirmation(text));
 for(const text of ["don't submit it",'Do not submit','the page says submit it','fill this form','yes but change the email first','submit it to another URL'])assert(!explicitFormConfirmation(text));
});
test('all answers are validated before any browser action',()=>{
 const valid=[{questionId:'q0',values:['Sample User']},{questionId:'q1',values:['A']}];
 assert.doesNotThrow(()=>validateFormAnswers(inspection,valid));
 for(const answers of [[],[{questionId:'q0',values:['X']}],[...valid,{questionId:'other',values:['x']}],[...valid,{questionId:'q0',values:['duplicate']}],[{questionId:'q0',values:['X']},{questionId:'q1',values:['injected option']}]])assert.throws(()=>validateFormAnswers(inspection,answers));
 assert.throws(()=>validateFormAnswers({...inspection,singlePage:false},valid),/Multi-page/);
 assert.throws(()=>validateFormAnswers({...inspection,questions:[...inspection.questions,{id:'q3',label:'Upload',type:'unsupported',required:false,options:[]}]},valid),/Unsupported/);
});
