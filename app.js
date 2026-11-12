'use strict';

const STORAGE_KEY = 'gradpath-encrypted-v1';
const PREVIOUS_KEY = 'gradpath-encrypted-before-password-change-v1';
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const {bytesTo64, deriveKey, decrypt, accessPhraseFromFile, encryptWithPassword} = globalThis.GradCrypto;
let data = null, sessionKey = null, envelope = null, starterEnvelope = null, currentId = null, activeView = 'overview', toastTimer, passwordSetupMode = 'recovery';
let writeQueue = Promise.resolve();

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const statusClass = status => String(status || '').toLowerCase().replace(/[^a-z]+/g,'-');
const safeUrl = value => { try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const displayStatus = app => app.status || 'Not specified';
const taskDone = task => task.status === 'done';
const taskTodo = task => task.status === 'todo';
const short = (s, max = 115) => String(s || '').length > max ? `${String(s).slice(0,max-1)}…` : String(s || '');

function toast(message){ const node=$('#toast'); node.textContent=message; node.classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>node.classList.remove('visible'),3500); }
function serializeWrite(action){
  const pending=writeQueue.then(action);writeQueue=pending.catch(()=>{});return pending;
}
function persist(){
  return serializeWrite(async()=>{
    if(!data||!sessionKey||!envelope)throw new Error('The tracker is locked.');
    const observed=localStorage.getItem(STORAGE_KEY), iv=crypto.getRandomValues(new Uint8Array(12));
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},sessionKey,new TextEncoder().encode(JSON.stringify(data)));
    if(localStorage.getItem(STORAGE_KEY)!==observed)throw new Error('This tracker changed in another tab.');
    const updated={...envelope,iv:bytesTo64(iv),ciphertext:bytesTo64(encrypted)};
    localStorage.setItem(STORAGE_KEY,JSON.stringify(updated));envelope=updated;
  });
}
async function loadSeed(){
  const cached=localStorage.getItem(STORAGE_KEY);
  if(cached) return JSON.parse(cached);
  if(starterEnvelope) return starterEnvelope;
  throw new Error('Choose your private starter file or backup first.');
}

$('#starter-box').hidden=!!localStorage.getItem(STORAGE_KEY);
$('#starter-file').addEventListener('change',async event=>{
  const file=event.target.files[0];starterEnvelope=null;
  if(!file)return;
  try{const value=JSON.parse(await file.text());if(!value.kdf?.salt||!value.iv||!value.ciphertext)throw new Error();starterEnvelope=value;$('#login-error').textContent='';}
  catch{$('#login-error').textContent='Please choose a valid GradPath starter file or backup.';}
});
$('#show-password').addEventListener('click',()=>{const field=$('#password'); const visible=field.type==='text';field.type=visible?'password':'text';$('#show-password').textContent=visible?'Show':'Hide';$('#show-password').setAttribute('aria-label',visible?'Show password':'Hide password');});
$('#unlock-form').addEventListener('submit',async event=>{
  event.preventDefault(); const button=$('#unlock-button'); const error=$('#login-error'); error.textContent=''; button.disabled=true;button.textContent='Opening...';
  try{
    if(!crypto.subtle) throw new Error('Open this site over HTTPS in a modern browser.');
    const candidate=await loadSeed(); const key=await deriveKey($('#password').value,candidate.kdf); const decoded=await decrypt(candidate,key);
    localStorage.setItem(STORAGE_KEY,JSON.stringify(candidate));envelope=candidate;sessionKey=key;data=decoded;starterEnvelope=null;$('#starter-box').hidden=true;$('#password').value='';$('#login').hidden=true;$('#app').hidden=false;render();
  }catch(e){error.textContent=e.message==='Choose your private starter file or backup first.'?e.message:'That password did not open this tracker. Use “Set a password I can remember” with your original access phrase file.';}
  finally{button.disabled=false;button.innerHTML='Open my tracker <span aria-hidden="true">→</span>';}
});

function updateRecoveryFields(){
  const source=$('#reset-source').value, method=$('#reset-unlock-method').value;
  $('#reset-backup-box').hidden=source!=='backup';
  $('#phrase-file-box').hidden=method!=='phrase-file';
  $('#old-password-box').hidden=method!=='password';
}
function openPasswordSetup(mode){
  passwordSetupMode=mode;
  const form=$('#password-setup-form');form.reset();$('#password-setup-error').textContent='';
  $('#recovery-controls').hidden=mode==='unlocked';
  $('#password-intro').textContent=mode==='unlocked'?'Choose a new password for the tracker currently open in this browser.':'Use your original access phrase file to unlock your tracker, then choose a password you can remember.';
  $('#password-submit').textContent=mode==='unlocked'?'Change password':'Set password and open';
  const current=localStorage.getItem(STORAGE_KEY), previous=localStorage.getItem(PREVIOUS_KEY);
  $('#reset-source').querySelector('option[value="current"]').hidden=!current;
  $('#reset-source').querySelector('option[value="previous"]').hidden=!previous;
  $('#reset-source').value=current?'current':'backup';
  $('#reset-unlock-method').value='phrase-file';updateRecoveryFields();
  $('#password-dialog').showModal();
}
$('#setup-password').addEventListener('click',()=>openPasswordSetup('recovery'));
$('#change-password').addEventListener('click',()=>openPasswordSetup('unlocked'));
$('#reset-source').addEventListener('change',updateRecoveryFields);
$('#reset-unlock-method').addEventListener('change',updateRecoveryFields);
$('#password-close').addEventListener('click',()=>$('#password-dialog').close());
$('#password-cancel').addEventListener('click',()=>$('#password-dialog').close());
$('#password-setup-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const error=$('#password-setup-error'),button=$('#password-submit'),newPassword=$('#new-password').value;
  error.textContent='';
  if(newPassword!==$('#confirm-password').value){error.textContent='The two new passwords do not match. Please try again.';return;}
  if(newPassword.length<12){error.textContent='Choose a password with at least 12 characters.';return;}
  button.disabled=true;button.textContent='Setting password...';
  const previousButtonText=passwordSetupMode==='unlocked'?'Change password':'Set password and open';
  try{
    if(!crypto.subtle) throw new Error('Open this website over HTTPS in a modern browser.');
    const changed=await serializeWrite(async()=>{
      const observedCurrent=localStorage.getItem(STORAGE_KEY);
      let workingData=data, selectedSource='current';
      if(passwordSetupMode==='recovery'){
        selectedSource=$('#reset-source').value;
        let raw=selectedSource==='current'?observedCurrent:selectedSource==='previous'?localStorage.getItem(PREVIOUS_KEY):null;
        if(selectedSource==='backup'){
          const file=$('#reset-backup-file').files[0];
          if(!file)throw new Error('Choose your GradPath starter or backup file.');
          raw=await file.text();
        }
        if(!raw)throw new Error('There is no saved tracker in this browser. Choose a backup file.');
        let candidate;try{candidate=JSON.parse(raw);}catch{throw new Error('Choose a valid GradPath starter or backup file.');}
        let oldPassword;
        if($('#reset-unlock-method').value==='phrase-file'){
          const file=$('#phrase-file').files[0];if(!file)throw new Error('Choose your GradPath access phrase .txt file.');
          oldPassword=accessPhraseFromFile(await file.text());
        }else{
          oldPassword=$('#old-password').value;if(!oldPassword)throw new Error('Enter the password used for this tracker or backup.');
        }
        try{const oldKey=await deriveKey(oldPassword,candidate.kdf);workingData=await decrypt(candidate,oldKey);}
        catch{throw new Error('That access phrase or password does not open the selected tracker. Try another backup or password.');}
      }
      if(!workingData)throw new Error('Open your tracker before changing its password.');
      const next=await encryptWithPassword(workingData,newPassword);
      if(localStorage.getItem(STORAGE_KEY)!==observedCurrent)throw new Error('This tracker changed in another tab. Refresh the page and try again.');
      if(passwordSetupMode==='recovery'&&selectedSource!=='current'&&observedCurrent&&!confirm('The selected backup may be older. Replacing the current tracker in this browser could remove recent changes. Continue?'))return false;
      if(observedCurrent)localStorage.setItem(PREVIOUS_KEY,observedCurrent);
      localStorage.setItem(STORAGE_KEY,JSON.stringify(next.blob));
      data=workingData;sessionKey=next.key;envelope=next.blob;starterEnvelope=null;return true;
    });
    if(!changed)return;
    $('#starter-box').hidden=true;$('#password').value='';$('#login-error').textContent='';
    $('#login').hidden=true;$('#app').hidden=false;render();
    let saveMessage='You can save your password in your browser’s password manager.';
    if($('#remember-password').checked){
      if(typeof window.PasswordCredential==='function'&&navigator.credentials?.store){
        try{const credential=new PasswordCredential({id:'gradpath-elvis',name:'GradPath',password:newPassword});navigator.credentials.store(credential).catch(()=>{});saveMessage='If your browser asks to save your password, choose Save.';}
        catch{saveMessage='Your browser could not offer to save the password. Add it to your password manager manually.';}
      }else saveMessage='Your browser may not support automatic saving. Add this password to your password manager manually.';
    }
    $('#save-password-message').textContent=saveMessage;
    $('#password-setup-form').reset();$('#password-dialog').close();$('#password-success').showModal();
  }catch(e){error.textContent=e.message||'Could not change the password. Your saved tracker was not changed.';}
  finally{button.disabled=false;button.textContent=previousButtonText;}
});

function switchView(view){
  activeView=view; $$('.view').forEach(element=>element.hidden=element.id!==`${view}-view`);
  $$('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
  if(view==='updates')globalThis.GradMailUI?.prepare();
  window.scrollTo({top:0,behavior:'smooth'}); render();
}
$$('[data-view]').forEach(el=>el.addEventListener('click',()=>switchView(el.dataset.view)));
$$('[data-switch-view]').forEach(el=>el.addEventListener('click',()=>switchView(el.dataset.switchView)));
$('#search').addEventListener('input',renderApplications);
$('#status-filter').addEventListener('change',renderApplications);

function allOutstanding(){
  return data.applications.flatMap(app => displayStatus(app)==='Rejected' ? [] : (app.tasks||[]).filter(taskTodo).map(task=>({app,task})));
}
function initials(school){
  const words=school.split(/\s+/).filter(w=>!['of','and','the','university','state'].includes(w.toLowerCase()));
  return (words[0] || school).replace(/[^a-z0-9]/gi,'').slice(0,2).toUpperCase() || '✳';
}
function row(app){
  const status=displayStatus(app), letters=app.letters || '';
  return `<button type="button" class="application-row" data-open="${escapeHtml(app.id)}"><span class="school-icon">${escapeHtml(initials(app.school))}</span><span><span class="school-name">${escapeHtml(app.school)}</span><span class="school-program">${escapeHtml(app.program || 'Program not specified')}</span></span><span class="status-pill ${escapeHtml(statusClass(status))}">${escapeHtml(status)}</span><span class="row-letters">${letters?`${escapeHtml(letters)} letters`:'Letters to confirm'}</span><span class="row-arrow">›</span></button>`;
}
function renderStats(){
  const apps=data.applications, outstanding=allOutstanding().length;
  const items=[['All applications',apps.length,'Schools and programs','◫'],['In progress',apps.filter(a=>displayStatus(a)==='In Progress').length,'In your spreadsheet','◷'],['Submitted',apps.filter(a=>displayStatus(a)==='Submitted').length,'Status marked submitted','↗'],['Tasks to do',outstanding,'From recorded items','✓']];
  $('#stats').innerHTML=items.map(([label,value,description,icon])=>`<div class="stat-card"><span class="stat-label">${label}</span><span class="stat-icon">${icon}</span><div class="stat-value">${value}</div><span class="stat-description">${description}</span></div>`).join('');
  $('#nav-count').textContent=apps.length;
}
function renderFocus(){
  const pending=allOutstanding(); const top=pending.slice(0,3);
  $('#focus-grid').innerHTML=top.length?top.map(({app,task},i)=>`<article class="focus-card"><span class="focus-icon">${['✓','✳','↗'][i]}</span><div><h3>${escapeHtml(short(task.title,75))}</h3><p>${escapeHtml(app.school)}</p><button type="button" data-open="${escapeHtml(app.id)}">View application →</button></div></article>`).join(''):'<div class="empty-state">No tasks marked “To do” yet. Open an application to add your next step.</div>';
  const apps=[...data.applications].sort((a,b)=>Number((b.tasks||[]).some(taskTodo))-Number((a.tasks||[]).some(taskTodo)));
  $('#overview-list').innerHTML=apps.slice(0,6).map(row).join('') || '<div class="empty-state">Add your first application to get started.</div>';
}
function renderApplications(){
  if(!data)return;
  const q=$('#search').value.trim().toLowerCase(),status=$('#status-filter').value;
  const apps=data.applications.filter(a=>(!status||displayStatus(a)===status)&&(!q||`${a.school} ${a.program} ${a.notes||''}`.toLowerCase().includes(q)));
  $('#results-label').textContent=`${apps.length} ${apps.length===1?'application':'applications'}`;
  $('#all-list').innerHTML=apps.length?apps.map(row).join(''):'<div class="empty-state">No applications match those filters.</div>';
}
function renderTodo(){
  const tasks=allOutstanding();
  $('#todo-list').innerHTML=tasks.length?tasks.map(({app,task})=>`<div class="todo-row"><button type="button" class="check-button" data-finish="${escapeHtml(task.id)}" data-app="${escapeHtml(app.id)}" aria-label="Mark ${escapeHtml(task.title)} complete"></button><div class="todo-content"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(app.school)}</span></div><button type="button" class="todo-open" data-open="${escapeHtml(app.id)}">Details →</button></div>`).join(''):'<div class="empty-state">Nothing is marked “To do” right now. Requirements marked “Confirm” are kept inside each application.</div>';
}
function render(){
  if(!data)return;
  $('#today-label').textContent=new Intl.DateTimeFormat(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'}).format(new Date());
  const source=safeUrl(data.sourceUrl);$('#source-link').hidden=!source;if(source)$('#source-link').href=source;
  renderStats();renderFocus();renderApplications();renderTodo();globalThis.GradMailUI?.render();
}

function openApp(id){
  const app=data.applications.find(item=>item.id===id); if(!app)return;
  currentId=id;const form=$('#detail-form');
  $('#dialog-title').textContent=app.school;$('#detail-eyebrow').textContent='APPLICATION DETAILS';$('#delete-app').hidden=false;
  for(const field of ['school','program','status','deadline','fee','funding','letters','department','portal','notes']) form.elements[field].value=app[field]||((field==='status')?'Not specified':'');
  renderEditors(app);renderLinks(app);renderResearch(app);
  $('#source-hint').textContent=app.sourceRow?`Imported from spreadsheet row ${app.sourceRow}. ${app.recommendationsReviewed?'Recommender information also reflects school emails reviewed on 10 November 2026. ':''}Check the portal for current requirements and progress.`:'Added to this tracker.';
  $('#detail-dialog').showModal();
}
function addNewApp(){
  currentId=null;const form=$('#detail-form');form.reset();form.elements.status.value='Not specified';
  $('#dialog-title').textContent='Add an application';$('#detail-eyebrow').textContent='A NEW OPPORTUNITY';$('#delete-app').hidden=true;
  renderEditors({tasks:[],recommenders:[]});$('#research-section').hidden=true;$('#detail-links').innerHTML='';$('#source-hint').textContent='Add the details you know. You can return to fill in the rest.';$('#detail-dialog').showModal();
}
function searchUrl(app,kind){return `https://www.google.com/search?q=${encodeURIComponent(`${app.school} ${app.program||''} ${kind==='department'?'graduate program department':'graduate application portal'}`)}`;}
function renderLinks(app){
  const dept=safeUrl(app.department),portal=safeUrl(app.portal);
  $('#detail-links').innerHTML=`<a href="${escapeHtml(dept||searchUrl(app,'department'))}" target="_blank" rel="noopener noreferrer">${dept?'Program webpage':'Find program webpage'} ↗</a><a href="${escapeHtml(portal||searchUrl(app,'portal'))}" target="_blank" rel="noopener noreferrer">${portal?'Application page':'Find application portal'} ↗</a>`;
}
function option(value,label,selected){return `<option value="${value}" ${value===selected?'selected':''}>${label}</option>`;}
function taskEditor(task){return `<div class="editor-row task-editor-row" data-id="${escapeHtml(task.id||uid())}"><input class="task-title" aria-label="Task name" placeholder="Task or document" value="${escapeHtml(task.title||'')}"><select class="task-status" aria-label="Task status">${option('todo','To do',task.status)}${option('confirm','Confirm',task.status||'confirm')}${option('done','Done',task.status)}${option('not-required','Not required',task.status)}</select><button type="button" class="remove-row" aria-label="Remove task">×</button></div>`;}
function recommenderEditor(person){return `<div class="editor-row recommender-row" data-id="${escapeHtml(person.id||uid())}"><input class="person-name" aria-label="Recommender name" placeholder="Recommender name" value="${escapeHtml(person.name||'')}"><select class="person-status" aria-label="Recommendation status">${option('not requested','Not requested',person.status||'not requested')}${option('requested','Requested',person.status)}${option('submitted','Submitted',person.status)}${option('confirm','Confirm',person.status)}</select><button type="button" class="remove-row" aria-label="Remove recommender">×</button></div>`;}
function renderEditors(app){$('#task-editor').innerHTML=(app.tasks||[]).map(taskEditor).join('');$('#recommender-editor').innerHTML=(app.recommenders||[]).map(recommenderEditor).join('');}
$('#add-task').addEventListener('click',()=>$('#task-editor').insertAdjacentHTML('beforeend',taskEditor({status:'todo'})));
$('#add-recommender').addEventListener('click',()=>$('#recommender-editor').insertAdjacentHTML('beforeend',recommenderEditor({})));
$('#detail-dialog').addEventListener('click',event=>{const remove=event.target.closest('.remove-row');if(remove)remove.closest('.editor-row').remove();});
$$('.add-app').forEach(button=>button.addEventListener('click',addNewApp));
$('#close-dialog').addEventListener('click',()=>$('#detail-dialog').close());$('#cancel-dialog').addEventListener('click',()=>$('#detail-dialog').close());
$('#detail-form').addEventListener('submit',async event=>{
  event.preventDefault();const f=event.currentTarget;if(!f.reportValidity())return;
  const old=data.applications.find(a=>a.id===currentId);
  const updated=old?{...old}:{id:uid(),letters:'',sourceRow:null};
  for(const field of ['school','program','status','deadline','fee','funding','letters','department','portal','notes']) updated[field]=f.elements[field].value.trim();
  updated.tasks=$$('.task-editor-row').map(r=>({id:r.dataset.id,title:$('.task-title',r).value.trim(),status:$('.task-status',r).value})).filter(t=>t.title);
  updated.recommenders=$$('.recommender-row').map(r=>({id:r.dataset.id,name:$('.person-name',r).value.trim(),status:$('.person-status',r).value})).filter(p=>p.name);
  if(updated.letters && updated.letters!==(old?.letters||'')){
    const match=updated.letters.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
    if(match){const received=Number(match[1]),required=Number(match[2]),remaining=Math.max(required-received,0);let t=updated.tasks.find(item=>item.id.endsWith('-letters'));
      if(!t){t={id:`${updated.id}-letters`};updated.tasks.push(t);}
      t.status=remaining?'todo':'done';t.title=remaining?`${remaining} recommendation ${remaining===1?'letter':'letters'} still needed (${received}/${required} recorded)`:`Recommendation letters (${received}/${required} recorded)`;
    }
  }
  if(old) data.applications[data.applications.indexOf(old)]=updated; else data.applications.unshift(updated);
  try{await persist();$('#detail-dialog').close();render();toast('Changes saved in this browser.');}catch{toast('Could not save. Check your browser storage settings.');}
});
$('#delete-app').addEventListener('click',async()=>{
  const app=data.applications.find(a=>a.id===currentId);if(!app||!confirm(`Remove ${app.school} from this tracker? This will not change the source spreadsheet.`))return;
  data.applications=data.applications.filter(a=>a.id!==currentId);
  try{await persist();$('#detail-dialog').close();render();toast('Application removed from this tracker.');}catch{toast('Could not save. Check your browser storage settings.');}
});
document.addEventListener('click',async event=>{
  const opener=event.target.closest('[data-open]');if(opener){openApp(opener.dataset.open);return;}
  const done=event.target.closest('[data-finish]');if(!done)return;
  const app=data.applications.find(a=>a.id===done.dataset.app),task=app?.tasks?.find(t=>t.id===done.dataset.finish);if(!task)return;
  task.status='done';try{await persist();render();toast('Task marked complete.');}catch{toast('Could not save. Check your browser storage settings.');}
});
async function downloadBackup(){
  try{await persist();const blob=new Blob([JSON.stringify(envelope,null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`gradpath-backup-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);toast('Encrypted backup downloaded.');return true;}catch{toast('Could not create a backup.');return false;}
}
$('#export-button').addEventListener('click',downloadBackup);
$('#backup-now').addEventListener('click',async()=>{if(await downloadBackup())$('#password-success').close();});
$('#backup-later').addEventListener('click',()=>$('#password-success').close());
$('#import-button').addEventListener('click',()=>$('#import-file').click());
$('#import-file').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    const imported=JSON.parse(await file.text());
    const restored=await serializeWrite(async()=>{
      if(imported.kdf.salt!==envelope.kdf.salt||imported.kdf.iterations!==envelope.kdf.iterations)throw new Error('different key');
      const observed=localStorage.getItem(STORAGE_KEY), decoded=await decrypt(imported,sessionKey);
      if(localStorage.getItem(STORAGE_KEY)!==observed)throw new Error('changed');
      if(!confirm('Replace the tracker in this browser with this backup?'))return false;
      localStorage.setItem(STORAGE_KEY,JSON.stringify(imported));envelope=imported;data=decoded;return true;
    });
    if(restored){render();toast('Backup restored in this browser.');}
  }catch{toast('Could not open this backup with the current password. Older backups may use an earlier password.');}finally{event.target.value='';}
});
$('#lock-button').addEventListener('click',()=>{globalThis.GradMailUI?.stop();data=null;sessionKey=null;envelope=null;$('#app').hidden=true;$('#login').hidden=false;$('#login-error').textContent='';$('#password').focus();});

function renderResearch(app){
  const info=app.research;$('#research-section').hidden=!info;if(!info)return;
  const lines=[['Application fee',info.fee],['Deadline',info.deadline],['Additional requirements',info.requirements]];
  const fields=lines.map(([label,value])=>`<div class="research-field"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value||'Not yet verified')}</span></div>`).join('');
  const sources=(info.sources||[]).filter(source=>{try{return new URL(source.url).protocol==='https:';}catch{return false;}}).map(source=>`<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label||'Official source')} ↗</a>`).join('');
  $('#research-content').innerHTML=`<div class="research-grid">${fields}</div><p class="research-date">Checked ${escapeHtml(info.checkedAt||'date not recorded')} · Verify intake, degree, and international applicant conditions.</p><div class="detail-links">${sources}</div>`;
}
$('#import-research').addEventListener('click',()=>$('#research-file').click());
$('#research-file').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    if(file.size>2_000_000)throw new Error('This school details file is too large.');
    const pack=JSON.parse(await file.text());if(pack.kind!=='gradpath-school-research-v1'||!Array.isArray(pack.records)||pack.records.length>500)throw new Error('Choose a GradPath school details file.');
    const changed=[];
    for(const item of pack.records){
      const app=data.applications.find(a=>a.id===item.id&&GradMail.normalize(a.school)===GradMail.normalize(item.school));
      if(!app||!item.research||changed.some(c=>c.app===app))continue;
      if(item.program&&GradMail.normalize(app.program)!==GradMail.normalize(item.program))continue;
      const info=item.research;
      const sources=Array.isArray(info.sources)?info.sources.filter(x=>x&&typeof x.url==='string'&&typeof x.label==='string'&&x.url.startsWith('https://')).slice(0,8).map(x=>({url:x.url.slice(0,1000),label:x.label.slice(0,100)})):[];
      changed.push({app,previous:app.research});app.research={fee:String(info.fee||'').slice(0,1500),deadline:String(info.deadline||'').slice(0,1500),requirements:String(info.requirements||'').slice(0,3000),checkedAt:String(info.checkedAt||'').slice(0,50),sources};
    }
    if(!changed.length)throw new Error('No matching applications were found in this tracker.');
    try{await persist();}catch(error){changed.forEach(x=>x.app.research=x.previous);throw error;}
    render();toast(`School details added to ${changed.length} ${changed.length===1?'application':'applications'}.`);
  }catch(error){toast(error.message||'Could not import school details.');}finally{event.target.value='';}
});
