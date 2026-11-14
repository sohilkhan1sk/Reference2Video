const form=document.getElementById('analyzeForm'),fileInput=document.getElementById('video'),progress=document.getElementById('progress'),errorBox=document.getElementById('error'),results=document.getElementById('results'),btn=document.getElementById('analyzeBtn');
let currentData=null,selectedIdea=0,assemblyQueue=[],recentJobsById={};
fileInput.addEventListener('change',()=>{const f=fileInput.files[0];if(f){document.getElementById('fileTitle').textContent=f.name;document.getElementById('fileMeta').textContent=(f.size/1048576).toFixed(1)+' MB · Ready to analyze';}});
function formatElapsed(ms){const total=Math.floor(ms/1000),m=String(Math.floor(total/60)).padStart(2,'0'),s=String(total%60).padStart(2,'0');return m+':'+s;}
function setAnalyzeProgress(message){progress.innerHTML='<div class="progress-top"><span id="progressMessage"></span><strong id="elapsedTime">00:00</strong></div><div class="progress-track"><div class="progress-bar"></div></div><small class="progress-hint">Elapsed time · Upload and AI analysis can take a few minutes. Keep this tab open.</small>';document.getElementById('progressMessage').textContent=message;}
form.addEventListener('submit',e=>{e.preventDefault();errorBox.classList.add('hidden');results.classList.add('hidden');if(!fileInput.files[0])return;btn.disabled=true;const startedAt=Date.now();setAnalyzeProgress('Preparing your video…');progress.classList.remove('hidden');const timer=setInterval(()=>{const time=document.getElementById('elapsedTime');if(time)time.textContent=formatElapsed(Date.now()-startedAt);},1000);const xhr=new XMLHttpRequest();xhr.open('POST','/api/analyze');xhr.upload.addEventListener('progress',event=>{if(event.lengthComputable){const label=document.getElementById('progressMessage');if(label)label.textContent='Uploading video · '+Math.round(event.loaded/event.total*100)+'%';}});xhr.upload.addEventListener('load',()=>{const label=document.getElementById('progressMessage');if(label)label.textContent='Video uploaded · AI is analyzing the reference and creating concepts…';});xhr.onload=()=>{try{let data;try{data=JSON.parse(xhr.responseText);}catch(_){throw Error('The server returned an unexpected page instead of JSON (HTTP '+xhr.status+'). Please refresh and try again.');}if(xhr.status<200||xhr.status>=300)throw Error(data.error||'Upload failed (HTTP '+xhr.status+').');if(!data.job_id)throw Error('The server did not return an analysis job ID.');pollAnalysis(data.job_id,startedAt,timer);}catch(err){clearInterval(timer);errorBox.textContent=err.message;errorBox.classList.remove('hidden');progress.classList.add('hidden');btn.disabled=false;}};xhr.onerror=()=>{clearInterval(timer);errorBox.textContent='Network error while uploading or analyzing. Check your connection and try again.';errorBox.classList.remove('hidden');progress.classList.add('hidden');btn.disabled=false;};xhr.send(new FormData(form));});
async function readJsonResponse(response,context){const raw=await response.text();try{return JSON.parse(raw);}catch(_){const preview=raw.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,180);throw Error(context+' received a non-JSON response (HTTP '+response.status+'). '+(preview||'The server returned an empty response.')+' If this is a Render error page, the service may have restarted or timed out.');}}
async function pollAnalysis(jobId,startedAt,timer){try{const response=await fetch('/api/analyze/'+encodeURIComponent(jobId));const data=await readJsonResponse(response,'Analysis status check');if(!response.ok)throw Error(data.error||'Could not check analysis status (HTTP '+response.status+').');if(data.status==='COMPLETED'){clearInterval(timer);currentData=data.result;selectedIdea=0;render(currentData);progress.classList.add('hidden');btn.disabled=false;return;}if(data.status==='FAILED'){clearInterval(timer);throw Error(data.error||'Analysis failed.');}const label=document.getElementById('progressMessage');if(label)label.textContent=data.message||'AI is analyzing your reference video…';setTimeout(()=>pollAnalysis(jobId,startedAt,timer),3000);}catch(err){clearInterval(timer);errorBox.textContent=err.message;errorBox.classList.remove('hidden');progress.classList.add('hidden');btn.disabled=false;}}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
const labels={summary:'Overview',visual_style:'Visual style',editing_rhythm:'Editing rhythm',camera_language:'Camera language',color_and_lighting:'Color & lighting',text_and_graphics:'Text & graphics',audio_observations:'Audio observations',scene_structure:'Scene structure'};
function render(d){results.classList.remove('hidden');const a=d.analysis||{};document.getElementById('analysisGrid').innerHTML=Object.entries(labels).map(([k,v])=>'<article class="card"><h3>'+v+'</h3><p>'+esc(a[k]||'Not available')+'</p></article>').join('');document.getElementById('ideas').innerHTML=(d.ideas||[]).map((x,i)=>'<article class="card idea '+(i===0?'selected':'')+'" data-i="'+i+'"><small>CONCEPT 0'+(i+1)+'</small><h3>'+esc(x.title)+'</h3><p><b>'+esc(x.hook)+'</b></p><p>'+esc(x.concept)+'</p><p>Why it works: '+esc(x.why_it_works)+'</p></article>').join('');document.querySelectorAll('.idea').forEach(el=>el.onclick=()=>{selectedIdea=+el.dataset.i;document.querySelectorAll('.idea').forEach(x=>x.classList.toggle('selected',x===el));drawScenes();});drawScenes();results.scrollIntoView({behavior:'smooth'});}
function estimateVideoCost(duration,resolution){const rates={'854x480':0.05,'1280x720':0.10,'1920x1080':0.20};return rates[resolution]*duration;}
function formatUsd(value){return '$'+Number(value||0).toFixed(2);}
function updateSceneCost(card){const duration=Number(card.querySelector('.clip-duration').value),resolution=card.querySelector('.clip-resolution').value,cost=estimateVideoCost(duration,resolution),rate=estimateVideoCost(1,resolution);const el=card.querySelector('.cost-estimate');if(el)el.textContent='Estimated base cost: '+formatUsd(cost)+' ('+duration+' sec × '+formatUsd(rate)+'/sec). Final provider billing may vary.';}
function drawScenes(){const idea=currentData?.ideas?.[selectedIdea];document.getElementById('storyTitle').textContent=idea?.title||'Scene plan';const fields=[['Purpose','purpose'],['Visual prompt','visual_prompt'],['Video prompt','video_prompt'],['Camera & motion','camera_and_motion'],['On-screen text','on_screen_text'],['Voice-over','voiceover'],['Sound design','sound_design']];document.getElementById('scenes').innerHTML=(idea?.scenes||[]).map((s,i)=>'<article class="scene"><h3>SCENE '+String(i+1).padStart(2,'0')+' · '+esc(s.time)+'</h3><div class="fields sceneFields">'+fields.map(([l,k])=>'<label>'+l+'<textarea data-k="'+k+'">'+esc(s[k])+'</textarea></label>').join('')+'</div><div class="generate-controls"><label>CLIP LENGTH<select class="clip-duration"><option value="5" selected>5 seconds</option><option value="8">8 seconds</option><option value="10">10 seconds</option><option value="15">15 seconds</option><option value="20">20 seconds</option><option value="30">30 seconds</option></select></label><label>FORMAT<select class="clip-aspect"><option value="9:16" selected>9:16 vertical</option><option value="16:9">16:9 landscape</option><option value="1:1">1:1 square</option></select></label><label>QUALITY<select class="clip-resolution"><option value="854x480">480p</option><option value="1280x720" selected>720p</option><option value="1920x1080">1080p</option></select></label><button type="button" class="generate-btn" data-i="'+i+'">Generate Video ✨</button></div><div class="approval-row"><label class="approval-check"><input type="checkbox" class="approve-paid"> I reviewed the final prompt and approve a billable Wan v3.0 generation for this clip.</label><p class="cost-estimate"></p></div><div class="job-output" id="output-'+i+'" aria-live="polite"></div></article>').join('');document.querySelectorAll('.scene').forEach(card=>{updateSceneCost(card);card.querySelector('.clip-duration').addEventListener('change',()=>updateSceneCost(card));card.querySelector('.clip-resolution').addEventListener('change',()=>updateSceneCost(card));});document.querySelectorAll('.generate-btn').forEach(b=>b.onclick=()=>generateScene(+b.dataset.i,b));}
async function generateScene(index,button){const card=button.closest('.scene'),prompt=card.querySelector('[data-k="video_prompt"]').value.trim(),output=document.getElementById('output-'+index),approval=card.querySelector('.approve-paid');if(!prompt){output.textContent='Add a video prompt first.';return;}if(!approval.checked){output.textContent='No request was sent. Tick the approval box only after reviewing this final prompt and its estimated cost.';return;}const duration=Number(card.querySelector('.clip-duration').value),resolution=card.querySelector('.clip-resolution').value,estimatedCost=estimateVideoCost(duration,resolution);const confirmation=window.confirm('Approve one paid Wan v3.0 clip?\n\nDuration: '+duration+' seconds\nResolution: '+resolution+'\nEstimated base cost: '+formatUsd(estimatedCost)+' USD\n\nThis is an estimate based on published Singapore rates; final AI Gateway billing may differ. Continue?');if(!confirmation)return;const ownerToken=document.getElementById('videoAccessToken')?.value.trim()||'';if(!ownerToken){output.innerHTML='<p class="generation-error">Enter the owner access token first. It is configured privately in Render and is not saved by this page.</p>';return;}const payload={prompt,duration,aspect_ratio:card.querySelector('.clip-aspect').value,resolution,approved:true,owner_token:ownerToken};approval.checked=false;button.disabled=true;output.innerHTML='<div class="generation-status"><span class="spinner"></span><span id="gen-message">Preparing your approved Wan v3.0 request…</span><strong id="gen-time">00:00</strong></div><div class="progress-track"><div class="progress-bar"></div></div><small>Provider: Vercel AI Gateway · Alibaba Wan v3.0. Estimated base cost: '+formatUsd(estimatedCost)+' USD. Keep this tab open.</small>';const started=Date.now(),timer=setInterval(()=>{const t=document.getElementById('gen-time');if(t)t.textContent=formatElapsed(Date.now()-started);},1000);try{const response=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await readJsonResponse(response,'Video generation request');if(!response.ok)throw Error(data.error||'Could not start video generation (HTTP '+response.status+').');await pollVideoJob(data.job_id,output,button,timer);}catch(err){clearInterval(timer);output.innerHTML='<p class="generation-error">'+esc(err.message)+'</p>';button.disabled=false;}}
async function pollVideoJob(jobId,output,button,timer){try{const response=await fetch('/api/generate/'+encodeURIComponent(jobId));const data=await readJsonResponse(response,'Video generation status check');if(!response.ok)throw Error(data.error||'Could not check generation status (HTTP '+response.status+').');if(data.status==='FAILED')throw Error(data.error||'Video generation failed.');if(data.status==='COMPLETED'){clearInterval(timer);output.innerHTML='<video controls playsinline preload="metadata" src="'+esc(data.video_url)+'"></video><div class="video-actions"><a href="'+esc(data.download_url)+'">Download MP4 ↓</a><span>Generated inside Reference2Video · estimated base cost '+formatUsd(data.estimated_cost_usd)+' USD</span></div>';button.disabled=false;return;}const label=output.querySelector('#gen-message');if(label)label.textContent=data.message||'Generating your video…';setTimeout(()=>pollVideoJob(jobId,output,button,timer),4000);}catch(err){clearInterval(timer);output.innerHTML='<p class="generation-error">'+esc(err.message)+'</p>';button.disabled=false;}}
function renderRecentJobs(jobs,store,mediaBackend,mediaConfigured){
const box=document.getElementById('recentJobs'),status=document.getElementById('historyStatus');
if(!box)return;
recentJobsById={};(jobs||[]).forEach(job=>{recentJobsById[job.job_id]=job;});
if(status){const dbNote=store==='postgres'?'PostgreSQL keeps job metadata across restarts.':'SQLite metadata may be lost when the Render free instance is replaced.';const mediaNote=mediaConfigured?'Completed MP4 clips are stored in private S3-compatible object storage.':'MP4 clips remain on temporary server storage; configure S3-compatible storage to keep them across redeploys.';status.textContent='Loaded '+jobs.length+' recent jobs. '+dbNote+' '+mediaNote;}
if(!jobs.length){box.innerHTML='<p class="history-empty">No video-generation jobs have been recorded yet.</p>';return;}
box.innerHTML=jobs.map(job=>{
const created=job.created_at?new Date(Number(job.created_at)*1000).toLocaleString():'Date unknown';
const details=[job.duration?job.duration+' sec':'',job.aspect_ratio||'',job.resolution||'',job.estimated_cost_usd!=null?formatUsd(job.estimated_cost_usd)+' estimated':''].filter(Boolean).join(' · ');
let output='';
if(job.status==='COMPLETED'){
if(job.artifact_available){output='<video controls playsinline preload="metadata" src="'+esc(job.video_url)+'"></video><div class="video-actions"><a href="'+esc(job.download_url)+'">Download MP4 ↓</a><button type="button" class="secondary add-to-assembly" data-job="'+esc(job.job_id)+'">Add to assembly +</button></div>';}
else{output='<p class="history-missing">Clip metadata is saved, but its MP4 file is no longer on this server. Configure persistent media storage to retain video files across redeploys.</p>';}
}else if(job.status==='FAILED'){output='<p class="generation-error">'+esc(job.error||job.message||'Generation failed.')+'</p>';}
else{output='<button type="button" class="secondary resume-history" data-job="'+esc(job.job_id)+'">Resume tracking</button><div class="history-resume-output" id="resume-out-'+esc(job.job_id)+'"></div>';}
return '<article class="history-card"><div class="between"><strong>'+esc(job.status||'UNKNOWN')+'</strong><small>'+esc(created)+'</small></div><p>'+esc(details)+'</p>'+output+'</article>';
}).join('');
document.querySelectorAll('.resume-history').forEach(button=>button.addEventListener('click',()=>{
const jobId=button.dataset.job,output=document.getElementById('resume-out-'+jobId);
button.disabled=true;
output.innerHTML='<div class="generation-status"><span class="spinner"></span><span id="gen-message">Reconnecting to the saved job…</span><strong id="gen-time">--:--</strong></div>';
const started=Date.now();const timer=setInterval(()=>{const clock=output.querySelector('#gen-time');if(clock)clock.textContent=formatElapsed(Date.now()-started);},1000);
pollVideoJob(jobId,output,button,timer);
}));
document.querySelectorAll('.add-to-assembly').forEach(button=>button.addEventListener('click',()=>{
queueAssemblyClip(button.dataset.job);
}));
renderAssemblyQueue();
}
function queueAssemblyClip(jobId){
const job=recentJobsById[jobId];
const status=document.getElementById('assemblyStatus');
if(!job||!job.artifact_available){if(status)status.textContent='That clip is not currently available for assembly.';return;}
if(assemblyQueue.includes(jobId)){if(status)status.textContent='That clip is already in the assembly queue.';return;}
assemblyQueue.push(jobId);
renderAssemblyQueue();
if(status)status.textContent='Added clip to the assembly queue. Click Add to assembly on other clips, then reorder them.';
}
function renderAssemblyQueue(){
const box=document.getElementById('assemblyQueue'),button=document.getElementById('assembleBtn');
if(!box)return;
if(!assemblyQueue.length){
box.innerHTML='<p class="assembly-empty">No clips selected yet. Load history and add completed clips above.</p>';
if(button)button.disabled=true;
return;
}
box.innerHTML=assemblyQueue.map((jobId,index)=>{
const job=recentJobsById[jobId]||{};
const label='Clip '+String(index+1).padStart(2,'0')+' · '+(job.duration||'?')+' sec · '+(job.aspect_ratio||'format unknown');
return '<div class="assembly-queue-item"><strong>'+esc(label)+'</strong><div class="queue-actions"><button type="button" class="secondary queue-up" data-index="'+index+'" '+(index===0?'disabled':'')+'>↑</button><button type="button" class="secondary queue-down" data-index="'+index+'" '+(index===assemblyQueue.length-1?'disabled':'')+'>↓</button><button type="button" class="secondary queue-remove" data-index="'+index+'">Remove</button></div></div>';
}).join('');
box.querySelectorAll('.queue-up').forEach(button=>button.addEventListener('click',()=>moveAssemblyItem(Number(button.dataset.index),-1)));
box.querySelectorAll('.queue-down').forEach(button=>button.addEventListener('click',()=>moveAssemblyItem(Number(button.dataset.index),1)));
box.querySelectorAll('.queue-remove').forEach(button=>button.addEventListener('click',()=>{assemblyQueue.splice(Number(button.dataset.index),1);renderAssemblyQueue();}));
if(button)button.disabled=false;
}
function moveAssemblyItem(index,delta){
const target=index+delta;
if(target<0||target>=assemblyQueue.length)return;
[ assemblyQueue[index],assemblyQueue[target] ]=[ assemblyQueue[target],assemblyQueue[index] ];
renderAssemblyQueue();
}
async function createAssembly(){
const button=document.getElementById('assembleBtn'),output=document.getElementById('assemblyOutput');
const token=document.getElementById('videoAccessToken')?.value.trim()||'';
const status=document.getElementById('assemblyStatus');
if(!token){if(status)status.textContent='Enter the owner access token configured privately in Render first.';return;}
if(!assemblyQueue.length){if(status)status.textContent='Add at least one completed clip to the assembly queue.';return;}
const aspect=document.getElementById('assemblyAspect')?.value||'16:9';
if(!window.confirm('Assemble '+assemblyQueue.length+' existing clips in the displayed order as a '+aspect+' silent MP4? This uses FFmpeg on the server and does not call the paid video-generation provider.'))return;
button.disabled=true;
output.innerHTML='<div class="generation-status"><span class="spinner"></span><span>Starting FFmpeg assembly…</span></div>';
if(status)status.textContent='Creating a silent MP4 export. No paid video-generation request is sent.';
try{
const response=await fetch('/api/assemble',{method:'POST',headers:{'Content-Type':'application/json','X-Owner-Token':token},body:JSON.stringify({job_ids:assemblyQueue.slice(),aspect_ratio:aspect})});
const data=await readJsonResponse(response,'MP4 assembly');
if(!response.ok)throw Error(data.error||'Could not start assembly (HTTP '+response.status+').');
await pollAssembly(data.assembly_id,token,button,output);
}catch(err){
output.innerHTML='<p class="generation-error">'+esc(err.message)+'</p>';
button.disabled=false;
}
}
async function pollAssembly(assemblyId,token,button,output){
try{
const response=await fetch('/api/assemble/'+encodeURIComponent(assemblyId),{headers:{'X-Owner-Token':token}});
const data=await readJsonResponse(response,'Assembly status');
if(!response.ok)throw Error(data.error||'Could not check assembly status (HTTP '+response.status+').');
if(data.status==='FAILED')throw Error(data.error||'FFmpeg assembly failed.');
if(data.status==='COMPLETED'){
output.innerHTML='<video controls playsinline preload="metadata" src="'+esc(data.video_url)+'"></video><div class="video-actions"><a href="'+esc(data.download_url)+'">Download finished MP4 ↓</a><span>'+esc(data.aspect_ratio)+' · '+esc(data.source_count)+' clips · silent export</span></div>'+(data.storage_backend==='s3'?'<p class="assembly-note">Saved in durable private object storage.</p>':'<p class="assembly-note">Saved on temporary server storage. Download it before a Render restart or redeploy.</p>');
const status=document.getElementById('assemblyStatus');
if(status)status.textContent='Finished MP4 is ready. The preview/download links are temporary and expire after 15 minutes; reload history and assemble again for fresh links if needed.';
button.disabled=false;
return;
}
output.innerHTML='<div class="generation-status"><span class="spinner"></span><span>'+esc(data.message||'FFmpeg is processing the clips…')+'</span></div><small>Server-side assembly · no video-generation API charge</small>';
setTimeout(()=>pollAssembly(assemblyId,token,button,output),3000);
}catch(err){
output.innerHTML='<p class="generation-error">'+esc(err.message)+'</p>';
button.disabled=false;
}
}
document.getElementById('assembleBtn')?.addEventListener('click',createAssembly);
async function loadRecentJobs(){
const button=document.getElementById('loadJobsBtn'),status=document.getElementById('historyStatus'),token=document.getElementById('videoAccessToken')?.value.trim()||'';
if(!token){if(status)status.textContent='Enter the owner access token configured privately in Render, then load history.';return;}
if(button)button.disabled=true;
if(status)status.textContent='Loading saved generation jobs…';
try{
const response=await fetch('/api/jobs',{headers:{'X-Owner-Token':token}});
const data=await readJsonResponse(response,'Generation history');
if(!response.ok)throw Error(data.error||'Could not load generation history (HTTP '+response.status+').');
renderRecentJobs(data.jobs||[],data.store,data.media_storage_backend,data.media_storage_configured);
}catch(err){if(status)status.textContent=err.message;}
finally{if(button)button.disabled=false;}
}
document.getElementById('loadJobsBtn')?.addEventListener('click',loadRecentJobs);
async function refreshProviderStatus(){
const el=document.getElementById('providerStatus'),storageEl=document.getElementById('mediaStorageStatus');
if(!el)return;
try{
const response=await fetch('/health');
const data=await readJsonResponse(response,'Provider status');
if(!response.ok)throw Error('HTTP '+response.status);
if(storageEl){
storageEl.textContent=data.media_storage_configured
?'MP4 storage: durable private S3-compatible object storage is configured. New completed clips will be uploaded there; existing local clips stay on the server.'
:'MP4 storage: temporary local server storage. To retain generated clips across redeploys, configure S3_ENDPOINT_URL (if required), S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in Render.';
}
if(!data.paid_generation_enabled){el.textContent='Safety lock active: paid clip generation is disabled by the app owner. No paid API request can run until the owner enables it in Render.';}
else if(!data.video_access_token_configured){el.textContent='Set VIDEO_GENERATION_ACCESS_TOKEN privately in Render, then enter the same token in the owner access field below.';}
else if(!data.video_api_configured){el.textContent='Owner enabled generation, but AI_GATEWAY_API_KEY is not configured in Render.';}
else if(!data.node_available){el.textContent='Video runtime unavailable: Node.js is not present on this server.';}
else if(!data.video_sdk_installed){el.textContent='Provider credentials detected. The AI SDK will be installed automatically when the first approved clip is submitted.';}
else{el.textContent='Wan v3.0 is configured. Each clip still requires its own checkbox approval and browser confirmation.';}
}catch(err){
el.textContent='Could not check provider readiness: '+err.message;
if(storageEl)storageEl.textContent='Could not check MP4 storage readiness.';
}
}
refreshProviderStatus();
document.getElementById('exportBtn').onclick=()=>{if(!currentData)return;const copy=JSON.parse(JSON.stringify(currentData)),idea=copy.ideas?.[selectedIdea];if(!idea)return;idea.scenes.forEach((s,i)=>document.querySelectorAll('.scene')[i]?.querySelectorAll('textarea').forEach(t=>s[t.dataset.k]=t.value));copy.selected_idea_storyboard={title:idea.title,scenes:idea.scenes};const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(copy,null,2)],{type:'application/json'}));a.href=url;a.download='reference2video-storyboard.json';a.click();URL.revokeObjectURL(url);};