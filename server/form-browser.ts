import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

// The remote service only accepts inspect/submit operations. No model credentials,
// workspace identifiers, cookies, filesystem access or arbitrary scripts cross it.
export async function callFormBrowser(op: "inspect"|"submit", args: unknown): Promise<unknown> {
  const endpoint=process.env.BOOP_FORM_BROWSER_URL;
  if (endpoint) {
    const u=new URL(endpoint); if (!['http:', 'https:'].includes(u.protocol)||u.username||u.password||u.pathname!=="/") throw new Error("Invalid form browser endpoint");
    const key=process.env.BOOP_FORM_BROWSER_TOKEN; if (!key) throw new Error("Missing private form worker token");
    // Never retry submission requests: a timeout may have happened after the click.
    const r=await fetch(new URL('/'+op,u), {method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify(args),signal:AbortSignal.timeout(110000)});
    if (!r.ok) throw new Error(`Form browser unavailable (${r.status}).`);
    const body=await r.json() as {result?:unknown;error?:string}; if(body.error)throw new Error(body.error);return body.result;
  }
  if (process.env.NODE_ENV==='production') throw new Error("The isolated form browser service is not configured.");
  return runLocalFormBrowser(op,args);
}
export function runLocalFormBrowser(op:string,args:unknown, fixtureOrigin?:string):Promise<unknown> {
  return new Promise((resolveResult,reject)=>{
    const python=resolve(process.env.BOOP_BROWSER_PYTHON??'data/browser-use/venv/bin/python');
    const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].flatMap(k=>process.env[k]?[[k,process.env[k]!]]:[]));
    const chromium=process.env.BOOP_BROWSER_EXECUTABLE_PATH??(process.platform==='darwin'?'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser':undefined);
    const child=spawn(python,[resolve('server/google-forms-worker.py'),...(fixtureOrigin?['--fixture-origin',fixtureOrigin]:[])],{env:{...env,...(chromium?{BOOP_FORM_CHROMIUM:chromium}:{}),ANONYMIZED_TELEMETRY:'false',DO_NOT_TRACK:'1'},stdio:['pipe','pipe','ignore']});
    let received=false;const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Form browser timeout. Submission outcome may be unknown.'));},105000);
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    createInterface({input:child.stdout}).on('line',line=>{if(!line.startsWith('BOOP_FORM '))return;try{const body=JSON.parse(line.slice(10));received=true;if(body.error)reject(new Error(body.error));else resolveResult(body.result);}catch(e){reject(e);} });
    child.once('exit',()=>{clearTimeout(timer);if(!received)reject(new Error('Form browser exited without a verified result.'));});
    child.stdin.end(JSON.stringify({op,args})+'\n');
  });
}
