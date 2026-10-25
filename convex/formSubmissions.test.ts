/// <reference types="vite/client" />
import {test,expect} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {api} from './_generated/api';
import {RUNTIME_ISSUER} from './model/auth';
const modules=import.meta.glob('./**/*.ts');
test('form submission is owner/conversation scoped, claimed once and marked sent only after verification',async()=>{
 const t=convexTest(schema,modules);
 const a=t.withIdentity({issuer:RUNTIME_ISSUER,subject:'worker',workspace:'alice'});
 const b=t.withIdentity({issuer:RUNTIME_ISSUER,subject:'worker',workspace:'bob'});
 await a.mutation(api.drafts.create,{draftId:'form-a',conversationId:'chat-a',kind:'browser.googleform',summary:'Test',payload:'{}'});
 await expect(b.mutation(api.drafts.claimFormSubmission,{draftId:'form-a',conversationId:'chat-a'})).rejects.toThrow();
 await expect(a.mutation(api.drafts.claimFormSubmission,{draftId:'form-a',conversationId:'another-chat'})).rejects.toThrow();
 await expect(a.mutation(api.drafts.setStatus,{draftId:'form-a',status:'sent'})).rejects.toThrow();
 const claims=await Promise.allSettled([1,2].map(()=>a.mutation(api.drafts.claimFormSubmission,{draftId:'form-a',conversationId:'chat-a'})));
 expect(claims.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect((await a.query(api.drafts.get,{draftId:'form-a'}))?.status).toBe('submitting');
 await a.mutation(api.drafts.finishFormSubmission,{draftId:'form-a',status:'uncertain',note:'Confirmation lost'});
 await expect(a.mutation(api.drafts.claimFormSubmission,{draftId:'form-a',conversationId:'chat-a'})).rejects.toThrow();
 await expect(a.mutation(api.drafts.setStatus,{draftId:'form-a',status:'pending'})).rejects.toThrow();
 expect((await a.query(api.drafts.get,{draftId:'form-a'}))?.status).toBe('uncertain');
});
test('expired and rejected form drafts cannot be submitted',async()=>{
 const t=convexTest(schema,modules);const a=t.withIdentity({issuer:RUNTIME_ISSUER,subject:'worker',workspace:'alice'});
 for(const id of ['old','rejected'])await a.mutation(api.drafts.create,{draftId:id,conversationId:'chat',kind:'browser.googleform',summary:'Test',payload:'{}'});
 await t.run(async ctx=>{const old=await ctx.db.query('drafts').withIndex('by_owner_draft_id',q=>q.eq('ownerId','alice').eq('draftId','old')).unique();await ctx.db.patch(old!._id,{createdAt:Date.now()-3600001});});
 await a.mutation(api.drafts.setStatus,{draftId:'rejected',status:'rejected'});
 for(const id of ['old','rejected'])await expect(a.mutation(api.drafts.claimFormSubmission,{draftId:id,conversationId:'chat'})).rejects.toThrow();
});
