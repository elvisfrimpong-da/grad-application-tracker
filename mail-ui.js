(function(){
  'use strict';
  const SCOPE='https://www.googleapis.com/auth/gmail.readonly';
  const CHECK_INTERVAL=10*60*1000, MAX_MESSAGES=300;
  let token='', expiresAt=0, timer=null, controller=null, busy=false, gisLoading=false, gisReady=false, sessionVersion=0;
  const getSettings=()=>data?.gmailSettings||{};
  const mailApi=globalThis.GradMail;
  function initGoogle(){
    if(gisReady||gisLoading||globalThis.google?.accounts?.oauth2){gisReady=!!globalThis.google?.accounts?.oauth2;return;}
    gisLoading=true;const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
    script.onload=()=>{gisReady=!!globalThis.google?.accounts?.oauth2;gisLoading=false;renderMail();};
    script.onerror=()=>{gisLoading=false;$('#mail-status').textContent='Google sign-in could not load. Check your connection and try again.';};document.head.appendChild(script);
  }
  function endSession(){sessionVersion++;clearInterval(timer);timer=null;controller?.abort();controller=null;token='';expiresAt=0;busy=false;}
  function renderMail(){
    if(!data)return;
    const settings=getSettings(), updates=data.mailUpdates||[];
    const connected=!!token&&Date.now()<expiresAt;
    if(token&&!connected)endSession();
    $('#mail-connect').hidden=connected;$('#mail-connect').disabled=busy;$('#mail-sync').hidden=!connected;$('#mail-sync').disabled=busy;$('#mail-disconnect').hidden=!connected;
    let state=connected?`Connected to ${settings.account||'Gmail'}. Checking every 10 minutes while this page is open.`:'Not connected in this session.';
    if(settings.lastSync)state+=` Last checked: ${new Date(settings.lastSync).toLocaleString()}.`;
    if(settings.truncated)state+=' The last check reached its 300-message limit; older matching emails may be missing.';
    $('#mail-status').textContent=busy?'Checking Gmail for application updates…':state;
    const idInput=$('#google-client-id');if(document.activeElement!==idInput)idInput.value=settings.clientId||'';
    if(!settings.clientId)$('#mail-setup').open=true;
    const count=updates.filter(u=>!u.reviewed).length;$('#updates-count').hidden=!count;$('#updates-count').textContent=count;
    const apps=data.applications;
    $('#mail-list').innerHTML=updates.length?updates.slice().sort((a,b)=>b.date-a.date).map(u=>{
      const app=apps.find(a=>a.id===u.appId);const matches=(u.candidates||[]).map(id=>apps.find(a=>a.id===id)).filter(Boolean);
      const select=!app&&matches.length?`<label class="mail-match">Choose the application<select data-mail-assign="${escapeHtml(u.key)}"><option value="">Select a program</option>${matches.map(a=>`<option value="${escapeHtml(a.id)}">${escapeHtml(a.school)}${a.program?' · '+escapeHtml(a.program):''}</option>`).join('')}</select></label>`:'';
      const source=`https://mail.google.com/mail/?authuser=${encodeURIComponent(u.account||'')}#all/${encodeURIComponent(u.id)}`;
      const date=Number.isFinite(Number(u.date))?new Date(Number(u.date)).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'Date unavailable';
      return `<article class="mail-card ${u.reviewed?'is-reviewed':''}"><div class="mail-card-head"><div><span class="mail-tag">${escapeHtml(u.label)}</span><h3>${escapeHtml(u.subject)}</h3><p>${escapeHtml(app?app.school:'Choose the matching application')} · ${escapeHtml(date)}</p></div>${u.reviewed?'<span class="reviewed-badge">Reviewed</span>':''}</div><p class="mail-from">From: ${escapeHtml(u.from)}</p><p class="mail-snippet">${escapeHtml(u.snippet)}</p><div class="mail-next"><strong>Suggested next step</strong><p>${escapeHtml(u.action)}</p></div>${select}<div class="mail-card-actions"><a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">Open original email ↗</a>${app?`<button type="button" data-open="${escapeHtml(app.id)}">Application details →</button><button type="button" data-mail-task="${escapeHtml(u.key)}" ${u.addedTaskId?'disabled':''}>${u.addedTaskId?'Added to to-do':'Add next step to to-do'}</button>`:''}<button type="button" data-mail-review="${escapeHtml(u.key)}">${u.reviewed?'Mark unreviewed':'Mark reviewed'}</button></div></article>`;
    }).join(''):'<div class="empty-state">No updates saved yet. Connect Gmail and check for recent application messages.</div>';
  }
  async function requestJson(path,signal){
    const response=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`,{headers:{Authorization:`Bearer ${token}`},signal,cache:'no-store'});
    let result={};try{result=await response.json();}catch{}
    if(!response.ok){const err=new Error(response.status===401?'Your Google session expired. Connect Gmail again.':response.status===403?'Gmail did not allow access. Check that the Gmail API is enabled and your account is listed as a test user.':`Gmail could not be checked (HTTP ${response.status}).`);err.status=response.status;throw err;}
    return result;
  }
  async function syncMail(){
    if(busy||!data)return;
    if(!token||Date.now()>=expiresAt){endSession();renderMail();toast('Connect Gmail again to check for updates.');return;}
    busy=true;controller=new AbortController();const signal=controller.signal,version=sessionVersion;renderMail();
    try{
      const profile=await requestJson('profile',signal);if(!profile.emailAddress)throw new Error('Could not identify the connected Gmail account.');
      const account=profile.emailAddress,settings=getSettings();
      const after=settings.account===account&&settings.lastSync?`after:${Math.floor((settings.lastSync-48*3600000)/1000)}`:'newer_than:180d';
      const q=`${after} -in:sent -in:drafts -in:spam -in:trash {application admission admissions graduate recommendation transcript assistantship enrollment enrolment portal decision}`;
      let pageToken='',messages=[],truncated=false;
      do{
        const params=new URLSearchParams({q,maxResults:'100'});if(pageToken)params.set('pageToken',pageToken);
        const page=await requestJson(`messages?${params}`,signal);messages.push(...(page.messages||[]));pageToken=page.nextPageToken||'';
        if(messages.length>=MAX_MESSAGES){messages=messages.slice(0,MAX_MESSAGES);truncated=!!pageToken;break;}
      }while(pageToken);
      const incoming=[],existing=new Set((data.mailUpdates||[]).map(u=>u.key));let cursor=0;
      async function worker(){while(cursor<messages.length){const item=messages[cursor++];const key=`${account}:${item.id}`;if(existing.has(key))continue;const raw=await requestJson(`messages/${encodeURIComponent(item.id)}?format=full`,signal);const parsed=mailApi.parseMessage(raw);const matches=mailApi.matchApplications(parsed,data.applications);if(!matches.length)continue;const next=mailApi.actionFor(parsed);incoming.push({key,id:parsed.id,threadId:parsed.threadId,account,from:parsed.from,subject:parsed.subject,date:parsed.date,snippet:parsed.snippet.slice(0,350),label:next.label,action:next.action,candidates:matches.map(m=>m.id),appId:matches.length===1?matches[0].id:'',reviewed:false});}}
      await Promise.all(Array.from({length:Math.min(5,messages.length)},worker));
      if(!data||version!==sessionVersion)return;
      const previousUpdates=data.mailUpdates,previousSettings=data.gmailSettings;
      data.mailUpdates=[...(data.mailUpdates||[]),...incoming];data.gmailSettings={...settings,account,lastSync:Date.now(),truncated};
      try{await persist();}catch(e){data.mailUpdates=previousUpdates;data.gmailSettings=previousSettings;throw e;}
      if(!data||version!==sessionVersion)return;
      render();toast(incoming.length?`${incoming.length} new ${incoming.length===1?'update':'updates'} found.`:'No new matching updates found.');
    }catch(error){if(error.name!=='AbortError'&&data&&version===sessionVersion){if(error.status===401){endSession();renderMail();}toast(error.message||'Could not check Gmail. Try again.');}}
    finally{if(version===sessionVersion){busy=false;controller=null;renderMail();}}
  }
  $('#mail-setup-form').addEventListener('submit',async event=>{
    event.preventDefault();const value=$('#google-client-id').value.trim(),error=$('#mail-setup-error');error.textContent='';
    if(!/^[0-9]+-[\w-]+\.apps\.googleusercontent\.com$/.test(value)){error.textContent='Enter the Web application client ID from Google Cloud.';return;}
    const previous=data.gmailSettings;data.gmailSettings={...(previous||{}),clientId:value};
    try{await persist();endSession();$('#mail-setup').open=false;initGoogle();renderMail();toast('Client ID saved. You can now connect Gmail.');}catch{data.gmailSettings=previous;error.textContent='Could not save the client ID in this tracker.';}
  });
  $('#mail-connect').addEventListener('click',()=>{
    const clientId=getSettings().clientId;if(!clientId){$('#mail-setup').open=true;$('#google-client-id').focus();toast('Complete the one-time Google setup first.');return;}
    if(!gisReady){initGoogle();toast('Google sign-in is loading. Please select Connect Gmail again.');return;}
    const requestedVersion=sessionVersion;
    try{
      const client=google.accounts.oauth2.initTokenClient({client_id:clientId,scope:SCOPE,include_granted_scopes:false,
        callback:response=>{if(requestedVersion!==sessionVersion||!data){if(response.access_token)google.accounts.oauth2.revoke(response.access_token,()=>{});return;}if(response.error||!response.access_token){toast('Google access was not granted.');return;}if(!google.accounts.oauth2.hasGrantedAllScopes(response,SCOPE)){toast('Gmail read-only access was not granted.');return;}endSession();token=response.access_token;expiresAt=Date.now()+Math.max(0,(Number(response.expires_in)||3600)-30)*1000;timer=setInterval(syncMail,CHECK_INTERVAL);renderMail();syncMail();},
        error_callback:()=>toast('Google sign-in was closed or could not open.')});
      client.requestAccessToken({prompt:''});
    }catch{toast('Could not start Google sign-in. Check the client ID.');}
  });
  $('#mail-sync').addEventListener('click',syncMail);
  $('#mail-disconnect').addEventListener('click',()=>{const old=token;endSession();if(old&&globalThis.google?.accounts?.oauth2)google.accounts.oauth2.revoke(old,()=>{});renderMail();toast('Gmail disconnected. Saved updates remain encrypted in your tracker.');});
  $('#mail-list').addEventListener('change',async event=>{const select=event.target.closest('[data-mail-assign]');if(!select)return;const u=(data.mailUpdates||[]).find(x=>x.key===select.dataset.mailAssign);if(!u||!u.candidates.includes(select.value))return;u.appId=select.value;try{await persist();render();}catch{u.appId='';toast('Could not save that choice.');}});
  $('#mail-list').addEventListener('click',async event=>{
    const target=event.target.closest('[data-mail-review],[data-mail-task]');if(!target)return;
    const key=target.dataset.mailReview||target.dataset.mailTask,u=(data.mailUpdates||[]).find(x=>x.key===key);if(!u)return;
    if(target.hasAttribute('data-mail-review')){u.reviewed=!u.reviewed;try{await persist();render();}catch{u.reviewed=!u.reviewed;toast('Could not save that change.');}return;}
    const app=data.applications.find(a=>a.id===u.appId);if(!app||u.addedTaskId)return;app.tasks=app.tasks||[];const task={id:uid(),title:u.action,status:'todo'};app.tasks.push(task);u.addedTaskId=task.id;
    try{await persist();render();toast('Next step added to your to-do list.');}catch{app.tasks=app.tasks.filter(t=>t.id!==task.id);delete u.addedTaskId;toast('Could not save the to-do item.');}
  });
  globalThis.GradMailUI={render:renderMail,stop:endSession,prepare:initGoogle};
})();
