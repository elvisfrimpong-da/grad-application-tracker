(function(root){
  'use strict';
  const normalize=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
  const hostRoot=value=>{try{const host=new URL(value).hostname.toLowerCase().replace(/^www\./,'');const edu=host.match(/(?:^|\.)([^.]+\.edu)$/);return edu?edu[1]:'';}catch{return '';}};
  const emailDomain=from=>{const match=String(from||'').match(/[\w.+-]+@([\w.-]+)/);return match?match[1].toLowerCase().replace(/\.$/,''):'';};
  function matchApplications(message,applications){
    const content=` ${normalize(`${message.from} ${message.subject} ${message.snippet} ${message.body}`)} `;
    const from=emailDomain(message.from);let result=[];
    for(const app of applications){
      const school=normalize(app.school);if(school.length<8)continue;
      const rootHosts=[hostRoot(app.department),hostRoot(app.portal)].filter(Boolean);
      const byDomain=from&&rootHosts.some(host=>from===host||from.endsWith('.'+host));
      const byName=content.includes(` ${school} `);
      if(byDomain||byName)result.push({id:app.id,school:app.school,program:app.program||'',reason:byDomain?'sender domain matches a saved university link':'university name appears in the message'});
    }
    if(result.length>1){
      const specific=result.filter(match=>{const p=normalize(match.program);return p.length>=12&&content.includes(` ${p} `);});
      if(specific.length===1)result=specific;
    }
    return result;
  }
  function actionFor(message){
    const text=String(message.body||message.snippet||'').replace(/\r/g,'\n').replace(/[\t ]+/g,' ');
    const sentences=text.split(/\n+|(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean);
    const direct=sentences.find(s=>s.length>=15&&s.length<=300&&/\b(?:please|kindly|you (?:must|need to|are required to)|required to|action required)\b/i.test(s)&&/\b(?:submit|upload|send|provide|complete|confirm|pay|respond|reply|register|schedule|accept|review|check|contact|request|visit|log in|sign in|activate|verify|update)\b/i.test(s)&&!/^if you (?:have|need) (?:any )?(?:questions|assistance)/i.test(s));
    if(direct)return {label:'Action mentioned in the message',action:direct.slice(0,260)};
    const subjectBody=`${message.subject} ${text.slice(0,5000)}`.toLowerCase();
    if(/(?:decision|status).{0,45}(?:available|updated|posted|ready)|(?:available|updated|posted).{0,45}(?:decision|status)/.test(subjectBody))return {label:'Application update',action:'Open the official application portal to review the update and any response deadline.'};
    if(/congratulations.{0,100}(?:admitted|accepted|admission)|(?:offer of admission|admitted to the)/.test(subjectBody))return {label:'Possible admission decision',action:'Review the original message and official portal for the decision and any response deadline.'};
    if(/(?:missing|incomplete|outstanding).{0,100}(?:transcript|recommendation|document|material)|(?:transcript|recommendation|document|material).{0,100}(?:missing|incomplete|outstanding)/.test(subjectBody))return {label:'Possible missing item',action:'Check the original message and portal to identify any documents or recommendations still needed.'};
    if(/(?:application|submission).{0,50}(?:received|submitted|complete)/.test(subjectBody))return {label:'Application confirmation',action:'Keep the confirmation and check the portal for any remaining requirements.'};
    return {label:'Review this email',action:'Read the message and check the application portal for any required next step.'};
  }
  function decodeBody(encoded){
    if(!encoded)return '';
    try{const s=encoded.replace(/-/g,'+').replace(/_/g,'/');const raw=atob(s);return new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0)));}catch{return '';}
  }
  function bodyText(payload){
    const plain=[],html=[];
    function walk(part){if(!part||part.filename)return;const mime=(part.mimeType||'').toLowerCase();const value=decodeBody(part.body?.data);if(value){if(mime==='text/plain')plain.push(value);else if(mime==='text/html')html.push(value);}for(const child of part.parts||[])walk(child);}
    walk(payload);
    if(plain.length)return plain.join('\n').slice(0,25000);
    return html.join('\n').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<br\s*\/?\s*>|<\/p\s*>|<\/div\s*>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').slice(0,25000);
  }
  function parseMessage(message){
    const headers=message.payload?.headers||[];const header=name=>headers.find(h=>String(h.name).toLowerCase()===name)?.value||'';
    return {id:String(message.id||''),threadId:String(message.threadId||''),from:header('from'),subject:header('subject')||'(No subject)',date:Number(message.internalDate)||Date.parse(header('date'))||Date.now(),snippet:String(message.snippet||''),body:bodyText(message.payload)};
  }
  function abortableDelay(ms,signal){
    return new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(new DOMException('Aborted','AbortError'));return;}
      const complete=()=>{signal?.removeEventListener('abort',cancel);resolve();};
      const id=setTimeout(complete,Math.max(0,ms));
      function cancel(){clearTimeout(id);signal?.removeEventListener('abort',cancel);reject(new DOMException('Aborted','AbortError'));}
      signal?.addEventListener('abort',cancel,{once:true});
    });
  }
  function createRequestGate(interval=800,now=()=>Date.now(),sleep=abortableDelay){
    let next=0;
    return {wait(signal){const current=now(),when=Math.max(current,next);next=when+interval;return sleep(when-current,signal);},reset(){next=0;}};
  }
  function apiError(status,payload){
    const body=payload?.error||{};
    const reasons=[...(Array.isArray(body.errors)?body.errors.map(x=>x?.reason):[]),...(Array.isArray(body.details)?body.details.map(x=>x?.reason):[])].filter(x=>typeof x==='string'&&/^[a-zA-Z][\w]{0,63}$/.test(x));
    const reason=reasons.find(x=>/^(SERVICE_DISABLED|accessNotConfigured|insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|userRateLimitExceeded|rateLimitExceeded|quotaExceeded|dailyLimitExceeded|domainPolicy)$/i.test(x))||reasons[0]||'';
    const lower=reason.toLowerCase();let message;
    if(status===401)message='Your Google session expired. Select Connect Gmail to sign in again.';
    else if(lower==='service_disabled'||lower==='accessnotconfigured')message='The Gmail API is not enabled for the Google project associated with this client ID, or Google is still activating it. Check that project and try again.';
    else if(lower==='insufficientpermissions'||lower==='access_token_scope_insufficient')message='Google did not grant Gmail read-only access. Reconnect Gmail and review the permission screen.';
    else if(lower==='domainpolicy')message='This Google account’s administrator does not allow the Gmail API. Contact the account administrator.';
    else if(status===429||lower==='userratelimitexceeded'||lower==='ratelimitexceeded')message='Google is limiting Gmail requests for a short time. Please wait and try Check now again.';
    else if(lower==='dailylimitexceeded'||lower==='quotaexceeded')message='The Google project has reached a Gmail API quota limit. Check the project’s Gmail API quotas and try again later.';
    else if(status===403)message='Google could not allow the Gmail request. Check the Gmail API and granted permission for the selected account.';
    else message=`Gmail could not be checked (HTTP ${status}). Try again.`;
    return {message:reason?`${message} (Google reason: ${reason}; HTTP ${status})`:message,reason,temporary:status===429||lower==='userratelimitexceeded'||lower==='ratelimitexceeded'};
  }
  const api={normalize,hostRoot,emailDomain,matchApplications,actionFor,decodeBody,bodyText,parseMessage,abortableDelay,createRequestGate,apiError};root.GradMail=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
