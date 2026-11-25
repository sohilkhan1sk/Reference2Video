const form=document.getElementById('analyzeForm'),fileInput=document.getElementById('video'),progress=document.getElementById('progress'),errorBox=document.getElementById('error'),results=document.getElementById('results'),btn=document.getElementById('analyzeBtn');
let currentData=null,selectedIdea=0,assemblyQueue=[],assemblyEditsById={},recentJobsById={},assemblyVideoPreviewState=null,assemblyVideoSyncRaf=0;
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
const actualDuration=Number(job.actual_duration_seconds);
const durationText=Number.isFinite(actualDuration)&&actualDuration>0
 ?actualDuration.toFixed(2)+' sec measured'+(job.duration?' · requested '+job.duration+' sec':'')
 :(job.duration?job.duration+' sec requested':'');
const dimensions=job.actual_width&&job.actual_height?job.actual_width+'×'+job.actual_height:'';
const details=[durationText,dimensions,job.actual_frame_rate?Number(job.actual_frame_rate).toFixed(2)+' fps':'',job.aspect_ratio||'',job.resolution||'',job.estimated_cost_usd!=null?formatUsd(job.estimated_cost_usd)+' estimated':''].filter(Boolean).join(' · ');
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
if(!assemblyEditsById[jobId])assemblyEditsById[jobId]={trim_start_seconds:0,trim_end_seconds:0,transition_after:'cut',transition_duration_seconds:0.5};
renderAssemblyQueue();
if(status)status.textContent='Added clip. Set optional trim points and the transition to the next scene; the final scene always ends with a cut.';
}
function collectSceneEdits(){
return assemblyQueue.map((jobId,index)=>{
const edit=assemblyEditsById[jobId]||{};
return {
 trim_start_seconds:Number(edit.trim_start_seconds||0),
 trim_end_seconds:Number(edit.trim_end_seconds||0),
 transition_after:index===assemblyQueue.length-1?'cut':(edit.transition_after||'cut'),
 transition_duration_seconds:Number(edit.transition_duration_seconds??0.5)
};
});
}
function renderAssemblyQueue(){
const box=document.getElementById('assemblyQueue'),button=document.getElementById('assembleBtn');
if(!box)return;
if(!assemblyQueue.length){
box.innerHTML='<p class="assembly-empty">No clips selected yet. Load history and add completed clips above.</p>';
if(button)button.disabled=true;
renderAssemblyVideoPreview();
renderAudioTimeline();
return;
}
box.innerHTML=assemblyQueue.map((jobId,index)=>{
const job=recentJobsById[jobId]||{};
const timing=window.Reference2VideoVideoPreview.resolveClipDuration(job);
const durationLabel=timing?timing.durationSeconds.toFixed(2)+' sec '+(timing.source==='measured'?'measured':'requested'):'duration unavailable';
const label='Scene '+String(index+1).padStart(2,'0')+' · '+durationLabel+' · '+(job.aspect_ratio||'format unknown');
const edit=assemblyEditsById[jobId]||{trim_start_seconds:0,trim_end_seconds:0,transition_after:'cut',transition_duration_seconds:0.5};
const last=index===assemblyQueue.length-1;
if(last&&edit.transition_after==='crossfade'){edit.transition_after='cut';assemblyEditsById[jobId]=edit;}
const transition=last?'cut':(edit.transition_after||'cut');
return '<div class="assembly-queue-item"><div class="assembly-queue-main"><strong>'+esc(label)+'</strong><div class="scene-edit-controls"><label>TRIM IN (SEC)<input type="number" min="0" max="3600" step="0.1" data-scene-edit="trim_start_seconds" data-job="'+esc(jobId)+'" value="'+esc(edit.trim_start_seconds||0)+'"></label><label>TRIM OUT (SEC) · 0 = FULL<input type="number" min="0" max="3600" step="0.1" data-scene-edit="trim_end_seconds" data-job="'+esc(jobId)+'" value="'+esc(edit.trim_end_seconds||0)+'"></label><label>TRANSITION TO NEXT<select data-scene-edit="transition_after" data-job="'+esc(jobId)+'" '+(last?'disabled':'')+'><option value="cut" '+(transition==='cut'?'selected':'')+'>Hard cut</option><option value="crossfade" '+(transition==='crossfade'?'selected':'')+'>Crossfade</option></select></label><label>CROSSFADE (SEC)<input type="number" min="0.25" max="2" step="0.05" data-scene-edit="transition_duration_seconds" data-job="'+esc(jobId)+'" value="'+esc(edit.transition_duration_seconds??0.5)+'" '+(last||transition!=='crossfade'?'disabled':'')+'></label></div></div><div class="queue-actions"><button type="button" class="secondary queue-up" data-index="'+index+'" '+(index===0?'disabled':'')+'>↑</button><button type="button" class="secondary queue-down" data-index="'+index+'" '+(last?'disabled':'')+'>↓</button><button type="button" class="secondary queue-remove" data-index="'+index+'">Remove</button></div></div>';
}).join('');
box.querySelectorAll('.queue-up').forEach(button=>button.addEventListener('click',()=>moveAssemblyItem(Number(button.dataset.index),-1)));
box.querySelectorAll('.queue-down').forEach(button=>button.addEventListener('click',()=>moveAssemblyItem(Number(button.dataset.index),1)));
box.querySelectorAll('.queue-remove').forEach(button=>button.addEventListener('click',()=>{assemblyQueue.splice(Number(button.dataset.index),1);renderAssemblyQueue();}));
box.querySelectorAll('[data-scene-edit]').forEach(input=>{
 const update=()=>{
  const id=input.dataset.job,field=input.dataset.sceneEdit;
  const value=input.tagName==='SELECT'?input.value:Number(input.value||0);
  assemblyEditsById[id]=Object.assign({},assemblyEditsById[id]||{}, {[field]:value});
  if(field==='transition_after')renderAssemblyQueue();
  else{renderAssemblyVideoPreview();renderAudioTimeline();}
 };
 if(input.tagName==='SELECT')input.addEventListener('change',update);
 else input.addEventListener('input',update);
});
if(button)button.disabled=false;
renderAssemblyVideoPreview();
renderAudioTimeline();
}
function moveAssemblyItem(index,delta){
const target=index+delta;
if(target<0||target>=assemblyQueue.length)return;
[ assemblyQueue[index],assemblyQueue[target] ]=[ assemblyQueue[target],assemblyQueue[index] ];
renderAssemblyQueue();
}

const audioDurationCache = new WeakMap();
const audioBufferCache = new WeakMap();
let audioTimelineRevision = 0;
let audioPreviewContext = null;
let audioPreviewState = null;
let audioTimelinePlayheadSeconds = 0;

function getAudioPreviewContext(){
 const AudioContextClass=window.AudioContext||window.webkitAudioContext;
 if(!AudioContextClass)return null;
 if(!audioPreviewContext){
  try{audioPreviewContext=new AudioContextClass();}
  catch(_){return null;}
 }
 return audioPreviewContext;
}

function readLocalAudioDuration(file){
 if(!file)return Promise.resolve(null);
 if(audioDurationCache.has(file))return audioDurationCache.get(file);
 const promise=new Promise(resolve=>{
  const audio=document.createElement('audio');
  const url=URL.createObjectURL(file);
  let finished=false,timeoutId=null;
  const finish=value=>{
   if(finished)return;
   finished=true;
   if(timeoutId!==null)window.clearTimeout(timeoutId);
   audio.removeAttribute('src');
   audio.load();
   URL.revokeObjectURL(url);
   resolve(Number.isFinite(value)&&value>0?value:null);
  };
  audio.preload='metadata';
  audio.addEventListener('loadedmetadata',()=>finish(audio.duration),{once:true});
  audio.addEventListener('error',()=>finish(null),{once:true});
  audio.src=url;
  audio.load();
  timeoutId=window.setTimeout(()=>finish(null),8000);
 });
 audioDurationCache.set(file,promise);
 return promise;
}

function decodeLocalAudioBuffer(file){
 if(!file)return Promise.resolve(null);
 if(audioBufferCache.has(file))return audioBufferCache.get(file);
 const promise=(async()=>{
  const context=getAudioPreviewContext();
  if(!context||typeof file.arrayBuffer!=='function')return null;
  try{
   const bytes=await file.arrayBuffer();
   return await context.decodeAudioData(bytes.slice(0));
  }catch(_){return null;}
 })();
 audioBufferCache.set(file,promise);
 return promise;
}

function timelineAudioOptions(prefix){
 const cap=name=>name.split('_').map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join('');
 const read=name=>Number(document.getElementById(prefix+cap(name))?.value||0);
 return {
  trimStartSeconds:read('trim_start'),
  trimEndSeconds:read('trim_end'),
  fadeInSeconds:read('fade_in'),
  fadeOutStartSeconds:read('fade_out_start'),
  fadeOutSeconds:read('fade_out')
 };
}

function stopAudioPreview(preservePosition=true){
 const state=audioPreviewState;
 if(!state)return;
 if(preservePosition&&state.context&&state.seek){
  const seconds=state.startTimelineSeconds+Math.max(0,state.context.currentTime-state.startContextTime);
  audioTimelinePlayheadSeconds=Math.min(state.durationSeconds,seconds);
  state.seek.value=String(audioTimelinePlayheadSeconds);
  if(state.updatePlayhead)state.updatePlayhead();
 }
 if(state.rafId)window.cancelAnimationFrame(state.rafId);
 (state.sources||[]).forEach(source=>{
  try{source.stop();}catch(_){}
  try{source.disconnect();}catch(_){}
 });
 try{state.master?.disconnect();}catch(_){}
 audioPreviewState=null;
 stopAssemblyVideoSyncLoop();
 pauseAssemblyVideoPreview();
 const play=document.getElementById('audioPreviewPlay');
 const stop=document.getElementById('audioPreviewStop');
 if(play){play.disabled=false;play.textContent='▶ Play video + audio';}
 if(stop)stop.disabled=true;
}


function stopAssemblyVideoSyncLoop(){if(assemblyVideoSyncRaf)window.cancelAnimationFrame(assemblyVideoSyncRaf);assemblyVideoSyncRaf=0;}
function pauseAssemblyVideoPreview(){
 const state=assemblyVideoPreviewState;
 if(!state)return;
 state.shouldPlay=false;
 (state.layers||[]).forEach(slot=>{
  slot.playPending=false;
  if(slot.video&&!slot.video.paused)slot.video.pause();
 });
}
function syncAssemblyVideoPreview(seconds,shouldPlay){
 const state=assemblyVideoPreviewState;
 if(!state||!Array.isArray(state.layers))return;
 const frame=window.Reference2VideoVideoPreview.locateLayersAtTime(state.plan,seconds);
 state.currentSeconds=frame.timeSeconds;
 renderSubtitleOverlay(frame.timeSeconds);
 const wasPlaying=state.shouldPlay;
 state.shouldPlay=Boolean(shouldPlay);
 if(state.shouldPlay&&!wasPlaying){
  state.layers.forEach(slot=>{slot.playBlocked=false;slot.lastSyncAt=0;});
 }
 const activeIds=new Set(frame.layers.map(layer=>layer.segment.jobId));
 state.layers.forEach(slot=>{
  if(!activeIds.has(slot.jobId)){
   slot.video.style.opacity="0";
   slot.playPending=false;
   if(!slot.video.paused)slot.video.pause();
  }
 });
 const used=new Set();
 frame.layers.forEach(descriptor=>{
  const jobId=descriptor.segment.jobId;
  let slot=state.layers.find(item=>item.jobId===jobId);
  if(!slot)slot=state.layers.find(item=>!used.has(item)&&!activeIds.has(item.jobId));
  if(!slot)slot=state.layers.find(item=>!used.has(item));
  if(!slot)return;
  used.add(slot);
  const video=slot.video;
  video.style.opacity=String(Math.max(0,Math.min(1,descriptor.opacity)));
  video.style.zIndex=descriptor.role==="incoming"?"2":"1";
  if(slot.jobId!==jobId){
   slot.jobId=jobId;
   slot.loading=true;
   slot.lastSyncAt=0;
   slot.playBlocked=false;
   slot.playPending=false;
   video.pause();
   video.onerror=()=>{
    if(assemblyVideoPreviewState!==state||slot.jobId!==jobId)return;
    slot.loading=false;
    state.shouldPlay=false;
    if(state.status)state.status.textContent="Could not load "+descriptor.segment.title+". Reload history and confirm its MP4 is still available.";
    stopAudioPreview(false);
   };
   video.onloadedmetadata=()=>{
    if(assemblyVideoPreviewState!==state||slot.jobId!==jobId)return;
    slot.loading=false;
    syncAssemblyVideoPreview(state.currentSeconds,state.shouldPlay);
   };
   video.src=descriptor.segment.url;
   video.load();
   if(video.readyState>=1)slot.loading=false;
  }
  if(slot.loading)return;
  const safeOffset=Number.isFinite(video.duration)&&video.duration>0
   ?Math.min(descriptor.offsetSeconds,Math.max(0,video.duration-0.04))
   :descriptor.offsetSeconds;
  const now=Date.now();
  if(!state.shouldPlay||!slot.lastSyncAt||now-slot.lastSyncAt>220){
   slot.lastSyncAt=now;
   const drift=Math.abs((video.currentTime||0)-safeOffset);
   if(drift>(state.shouldPlay?0.65:0.035)){try{video.currentTime=safeOffset;}catch(_){}}
  }
  if(state.shouldPlay&&!slot.playBlocked&&video.paused&&!slot.playPending){
   slot.playPending=true;
   try{
    const result=video.play();
    if(result&&typeof result.then==="function"){
     result.then(()=>{if(slot.jobId===jobId)slot.playPending=false;}).catch(()=>{
      if(slot.jobId!==jobId)return;
      slot.playPending=false;
      slot.playBlocked=true;
      if(state.status)state.status.textContent="The browser blocked video playback. Press Play again or check browser media permissions.";
     });
    }else slot.playPending=false;
   }catch(_){
    slot.playPending=false;
    slot.playBlocked=true;
    if(state.status)state.status.textContent="The browser could not start video playback. Press Play again.";
   }
  }else if(!state.shouldPlay){
   slot.playPending=false;
   if(!video.paused)video.pause();
  }
 });
 if(state.status){
  let message="Ready · "+state.plan.segments.length+" scene clip(s) queued.";
  if(frame.isCrossfade&&frame.layers.length===2){
   message="Crossfade · Scene "+(frame.layers[0].segment.index+1)+" → Scene "+(frame.layers[1].segment.index+1)+" · "+Math.round(frame.progress*100)+"%";
  }else if(frame.layers.length){
   message="Scene "+(frame.layers[0].segment.index+1)+" of "+state.plan.segments.length+" · source video muted; selected audio tracks play from the local preview.";
  }
  if(state.status.textContent!==message)state.status.textContent=message;
 }
}
function startAssemblyVideoSyncLoop(){
 stopAssemblyVideoSyncLoop();
 const tick=()=>{if(!audioPreviewState){assemblyVideoSyncRaf=0;pauseAssemblyVideoPreview();return;}syncAssemblyVideoPreview(audioTimelinePlayheadSeconds,true);assemblyVideoSyncRaf=window.requestAnimationFrame(tick);};
 tick();
}

function renderSubtitleOverlay(seconds){
 const overlay=document.getElementById('subtitlePreviewOverlay');
 if(!overlay)return;
 const enabled=document.getElementById('subtitlesEnabled')?.checked;
 const time=Number(seconds)||0;
 const cues=Array.from(document.querySelectorAll('.subtitle-cue')).map(row=>({
  start:Number(row.querySelector('[data-subtitle-start]')?.value),
  end:Number(row.querySelector('[data-subtitle-end]')?.value),
  text:row.querySelector('[data-subtitle-text]')?.value||''
 })).filter(cue=>enabled&&Number.isFinite(cue.start)&&Number.isFinite(cue.end)&&cue.end>cue.start&&time>=cue.start&&time<cue.end&&cue.text.trim());
 const frame=overlay.parentElement;
 const position=document.getElementById('subtitlePosition')?.value||'bottom';
 const color=document.getElementById('subtitleColor')?.value||'white';
 const ratio=Number(document.getElementById('subtitleSize')?.value||4.5)/100;
 overlay.textContent=cues.map(cue=>cue.text.trim()).join('\n');
 overlay.style.display=cues.length?'block':'none';
 overlay.style.color=({white:'#ffffff',yellow:'#fff07a',cyan:'#7df5f0'})[color]||'#ffffff';
 overlay.style.fontSize=Math.max(12,(frame?.clientHeight||240)*ratio)+'px';
 overlay.style.top=position==='top'?'6%':(position==='middle'?'50%':'auto');
 overlay.style.bottom=position==='bottom'?'7%':'auto';
 overlay.style.transform=position==='middle'?'translateY(-50%)':'none';
}
function addSubtitleCue(){
 const list=document.getElementById('subtitleCueList');
 if(!list)return;
 if(list.querySelectorAll('.subtitle-cue').length>=200){
  const status=document.getElementById('assemblyStatus');
  if(status)status.textContent='A maximum of 200 subtitle cues can be added to one export.';
  return;
 }
 const row=document.createElement('div');
 row.className='subtitle-cue';
 row.innerHTML='<div class="subtitle-cue-fields"><label>START (SEC)<input type="number" data-subtitle-start min="0" max="3600" step="0.1" value="0"></label><label>END (SEC)<input type="number" data-subtitle-end min="0" max="3600" step="0.1" value="2.5"></label><label class="subtitle-text-label">CAPTION TEXT<textarea data-subtitle-text maxlength="220" rows="2" placeholder="Type the caption shown on screen"></textarea></label></div><button type="button" class="secondary subtitle-remove">Remove</button>';
 row.querySelector('.subtitle-remove').addEventListener('click',()=>{row.remove();renderSubtitleOverlay(audioTimelinePlayheadSeconds);});
 list.appendChild(row);
 renderSubtitleOverlay(audioTimelinePlayheadSeconds);
}
function collectSubtitlePayload(finalDuration){
 const enabled=document.getElementById('subtitlesEnabled')?.checked;
 if(!enabled)return {payload:null};
 const rows=Array.from(document.querySelectorAll('.subtitle-cue'));
 const captions=[];
 for(let index=0;index<rows.length;index++){
  const row=rows[index];
  const text=(row.querySelector('[data-subtitle-text]')?.value||'').trim();
  if(!text)continue;
  const start=Number(row.querySelector('[data-subtitle-start]')?.value);
  const end=Number(row.querySelector('[data-subtitle-end]')?.value);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start){
   return {error:'Subtitle cue '+(index+1)+' needs valid start and end times, with end after start.'};
  }
  if(end>finalDuration+0.001){
   return {error:'Subtitle cue '+(index+1)+' ends after the '+finalDuration.toFixed(2)+' second export timeline.'};
  }
  if(text.length>220||text.split('\n').length>2||text.split('\n').some(line=>line.length>100)){
   return {error:'Subtitle cue '+(index+1)+' must be at most 220 characters and two lines of 100 characters each.'};
  }
  captions.push({start_seconds:start,end_seconds:end,text});
 }
 if(!captions.length)return {error:'Enable subtitles only after adding at least one caption with text.'};
 if(captions.length>200)return {error:'Use no more than 200 subtitle cues.'};
 return {payload:{
  captions,
  style:{
   position:document.getElementById('subtitlePosition')?.value||'bottom',
   color:document.getElementById('subtitleColor')?.value||'white',
   font_size_ratio:Number(document.getElementById('subtitleSize')?.value||4.5)/100
  }
 }};
}

function renderAssemblyVideoPreview(){
 const panel=document.getElementById('assemblyVideoPreviewPanel');if(!panel)return;
 pauseAssemblyVideoPreview();
 const plan=window.Reference2VideoVideoPreview.buildVideoSequencePlan(
  assemblyQueue.map(id=>recentJobsById[id]),assemblyEditsById
 );
 if(!plan.segments.length){assemblyVideoPreviewState=null;panel.innerHTML='<div class="video-preview-empty">Add available completed clips from history to preview the scene sequence.</div>';return;}
 const segments=plan.segments.map(segment=>'<span class="video-sequence-segment" style="left:'+segment.startPercent+'%;width:'+segment.widthPercent+'%" title="'+esc(segment.title)+' · '+window.Reference2VideoTimeline.formatTime(segment.durationSeconds)+' · '+segment.durationSource+' duration">'+esc(segment.title)+'</span>').join('');
 const timingNote=(plan.requestedFallbackCount===0
  ?'All source lengths use ffprobe-measured MP4 durations.'
  :'Measured duration for '+plan.measuredCount+' of '+plan.segments.length+' clips; '+plan.requestedFallbackCount+' clip(s) use the requested duration.')
  +(plan.transitionCount?' '+plan.transitionCount+' crossfade(s) use a true two-layer opacity blend in this browser preview and in the FFmpeg export.':'')
  +(plan.errors.length?' Edit warning: '+plan.errors.join(' '):'');
 const aspect=document.getElementById('assemblyAspect')?.value||'16:9';
 const frameRatio=aspect==='9:16'?'9 / 16':'16 / 9';
 const frameWidth=aspect==='9:16'?'min(100%, 236px)':'min(100%, 746px)';
 panel.innerHTML='<div class="assembly-video-frame" style="aspect-ratio:'+frameRatio+';width:'+frameWidth+'"><video id="assemblyVideoMonitor" class="assembly-video-layer layer-primary" muted playsinline preload="metadata" aria-label="Outgoing scene preview"></video><video id="assemblyVideoMonitorSecondary" class="assembly-video-layer layer-secondary" muted playsinline preload="metadata" aria-label="Incoming scene preview"></video><div class="subtitle-preview-overlay" id="subtitlePreviewOverlay" aria-hidden="true"></div></div><div class="video-sequence-track">'+segments+'<span class="video-sequence-playhead" id="videoSequencePlayhead"></span></div><small id="assemblyVideoStatus">Ready · '+plan.segments.length+' scene clip(s) queued. Use “Play video + audio” in the audio timeline below.</small><small class="video-preview-note">'+timingNote+' Source clip audio is muted to avoid double playback.</small>';
 const videos=[panel.querySelector('#assemblyVideoMonitor'),panel.querySelector('#assemblyVideoMonitorSecondary')];
 videos.forEach(video=>{video.muted=true;video.playsInline=true;});
 assemblyVideoPreviewState={
  plan,
  layers:videos.map(video=>({video,jobId:null,lastSyncAt:0,loading:false,playBlocked:false,playPending:false})),
  status:panel.querySelector('#assemblyVideoStatus'),
  currentSeconds:0,
  shouldPlay:false
 };
 syncAssemblyVideoPreview(0,false);
}

function drawAudioWaveform(canvas,buffer,spec,lane){
 if(!canvas||!buffer||!window.Reference2VideoAudioPreview)return;
 const peaks=window.Reference2VideoAudioPreview.computeWaveformPeaks(
  buffer,spec.trimStartSeconds,spec.trimEndSeconds,220
 );
 if(!peaks.length)return;
 const rect=canvas.getBoundingClientRect();
 if(!rect.width||!rect.height)return;
 const ratio=Math.min(2,window.devicePixelRatio||1);
 const width=Math.max(1,Math.round(rect.width*ratio));
 const height=Math.max(1,Math.round(rect.height*ratio));
 canvas.width=width;
 canvas.height=height;
 const context=canvas.getContext('2d');
 if(!context)return;
 context.clearRect(0,0,width,height);
 context.strokeStyle=spec.kind==='music'?'rgba(190,207,255,.9)':(spec.kind==='sfx'?'rgba(255,220,169,.95)':'rgba(190,255,238,.95)');
 context.lineWidth=Math.max(1,ratio);
 context.lineCap='round';
 const trimEnd=spec.trimEndSeconds>0?Math.min(buffer.duration,spec.trimEndSeconds):buffer.duration;
 const sourceLength=Math.max(0,trimEnd-spec.trimStartSeconds);
 const visibleDuration=lane.visibleDurationSeconds||sourceLength;
 const step=Math.max(1,Math.floor(ratio*2));
 for(let x=0;x<width;x+=step){
  let fraction=x/width;
  if(spec.loop&&sourceLength>0&&visibleDuration>0){
   const seconds=fraction*visibleDuration;
   fraction=(seconds%sourceLength)/sourceLength;
  }
  const index=Math.min(peaks.length-1,Math.floor(fraction*peaks.length));
  const amplitude=peaks[index]||0;
  const half=Math.max(ratio,amplitude*height*.43);
  const center=height/2;
  context.beginPath();
  context.moveTo(x,center-half);
  context.lineTo(x,center+half);
  context.stroke();
 }
}

function envelopeAt(seconds,fadeIn,fadeOutStart,fadeOut){
 let value=1;
 if(fadeIn>0&&seconds<fadeIn)value=Math.max(0,seconds/fadeIn);
 if(fadeOut>0){
  const fadeEnd=fadeOutStart+fadeOut;
  if(seconds>=fadeEnd)return 0;
  if(seconds>fadeOutStart)value=Math.min(value,Math.max(0,1-(seconds-fadeOutStart)/fadeOut));
 }
 return value;
}

function schedulePreviewGain(parameter,track,when){
 const base=track.gain;
 const elapsed=track.elapsedSeconds;
 const fadeIn=track.fadeInSeconds;
 const fadeOutStart=track.fadeOutStartSeconds;
 const fadeOut=track.fadeOutSeconds;
 parameter.setValueAtTime(base*envelopeAt(elapsed,fadeIn,fadeOutStart,fadeOut),when);
 const points=[fadeIn,fadeOutStart,fadeOutStart+fadeOut]
  .filter(value=>Number.isFinite(value)&&value>elapsed+0.00001&&value<=elapsed+track.playbackDurationSeconds+0.001)
  .sort((a,b)=>a-b);
 let previous=null;
 points.forEach(point=>{
  if(previous!==null&&Math.abs(point-previous)<0.00001)return;
  parameter.linearRampToValueAtTime(
   base*envelopeAt(point,fadeIn,fadeOutStart,fadeOut),
   when+(point-elapsed)
  );
  previous=point;
 });
}

async function startAudioPreview(durationSeconds,specs,buffers,seek,updatePlayhead,status){
 stopAudioPreview(false);
 const context=getAudioPreviewContext();
 if(!context)throw Error('This browser does not support Web Audio playback. You can still export the tracks with FFmpeg.');
 await context.resume();
 const playhead=Math.max(0,Math.min(durationSeconds,Number(seek.value)||0));
 const tracks=specs.map((spec,index)=>({
  id:spec.id,kind:spec.kind,hasFile:Boolean(spec.file),
  sourceDurationSeconds:buffers[index]?.duration||null,
  startSeconds:spec.startSeconds||0,trimStartSeconds:spec.trimStartSeconds||0,
  trimEndSeconds:spec.trimEndSeconds||0,loop:spec.loop,
  fadeInSeconds:spec.fadeInSeconds||0,fadeOutStartSeconds:spec.fadeOutStartSeconds||0,
  fadeOutSeconds:spec.fadeOutSeconds||0,gain:spec.gain
 }));
 const plan=window.Reference2VideoAudioPreview.buildAudioPreviewPlan({
  durationSeconds,playheadSeconds:playhead,tracks
 });
 const playable=plan.tracks.filter(track=>track.shouldPlay&&buffers[track.index]);
 // Keep the Web Audio clock running for video-only previews too.
 const master=context.createDynamicsCompressor();
 master.threshold.value=-4;
 master.knee.value=4;
 master.ratio.value=12;
 master.attack.value=.004;
 master.release.value=.22;
 master.connect(context.destination);
 const sources=[];
 const baseTime=context.currentTime+.05;
 try{
  playable.forEach(track=>{
   const spec=specs[track.index],buffer=buffers[track.index];
   const source=context.createBufferSource();
   const gain=context.createGain();
   source.buffer=buffer;
   source.loop=track.loop;
   if(track.loop){
    source.loopStart=track.sourceStartSeconds;
    source.loopEnd=track.sourceEndSeconds;
   }
   const when=baseTime+track.startDelaySeconds;
   schedulePreviewGain(gain.gain,track,when);
   source.connect(gain);
   gain.connect(master);
   if(track.loop){
    source.start(when,track.sourceOffsetSeconds);
    source.stop(baseTime+(durationSeconds-playhead)+.1);
   }else{
    source.start(when,track.sourceOffsetSeconds,track.playbackDurationSeconds);
   }
   sources.push(source);
  });
 }catch(error){
  sources.forEach(source=>{try{source.stop();}catch(_){}});
  try{master.disconnect();}catch(_){}
  throw error;
 }
 const state={
  context,sources,master,startContextTime:baseTime,startTimelineSeconds:playhead,
  durationSeconds,seek,updatePlayhead,rafId:0
 };
 audioPreviewState=state;
 const play=document.getElementById('audioPreviewPlay');
 const stop=document.getElementById('audioPreviewStop');
 if(play){play.disabled=true;play.textContent='Playing audio…';}
 if(stop)stop.disabled=false;
 if(status)status.textContent='Playing scene video with '+playable.length+' synchronized local audio track(s). Browser preview may differ from the FFmpeg mix.';
 const tick=()=>{
  if(audioPreviewState!==state)return;
  const elapsed=Math.max(0,context.currentTime-state.startContextTime);
  const current=Math.min(durationSeconds,playhead+elapsed);
  seek.value=String(current);
  audioTimelinePlayheadSeconds=current;
  updatePlayhead();
  if(current>=durationSeconds){
   stopAudioPreview(false);
   seek.value=String(durationSeconds);
   audioTimelinePlayheadSeconds=durationSeconds;
   updatePlayhead();
   if(status)status.textContent='Audio preview reached the end of the selected scene sequence.';
   return;
  }
  state.rafId=window.requestAnimationFrame(tick);
 };
 state.rafId=window.requestAnimationFrame(tick);
}

async function renderAudioTimeline(){
 const root=document.getElementById('audioTimeline');
 if(!root)return;
 stopAudioPreview();
 const revision=++audioTimelineRevision;
 const scenePlan=window.Reference2VideoVideoPreview.buildVideoSequencePlan(
  assemblyQueue.map(id=>recentJobsById[id]),assemblyEditsById
 );
 const totalDuration=scenePlan.durationSeconds;
 if(!assemblyQueue.length){
  root.innerHTML='<div class="audio-timeline-empty">Add completed clips from history to build the timeline preview.</div>';
  return;
 }
 if(totalDuration<=0){
  root.innerHTML='<div class="audio-timeline-empty">Clip durations are unavailable. Reload generation history before previewing the timeline.</div>';
  return;
 }

 const voiceFile=document.getElementById('voiceoverFile')?.files?.[0]||null;
 const musicFile=document.getElementById('musicFile')?.files?.[0]||null;
 const specs=[
  {id:'voiceover',kind:'voiceover',label:'VOICEOVER',file:voiceFile,loop:false,startSeconds:0,gain:Number(document.getElementById('voiceoverGain')?.value||100)/100,...timelineAudioOptions('voiceover')},
  {id:'music',kind:'music',label:'MUSIC',file:musicFile,loop:true,startSeconds:0,gain:Number(document.getElementById('musicGain')?.value||18)/100,...timelineAudioOptions('music')}
 ];
 let cueIndex=0;
 for(const row of document.querySelectorAll('.sfx-cue')){
  cueIndex++;
  const file=row.querySelector('[data-sfx-file]')?.files?.[0]||null;
  const read=name=>Number(row.querySelector('[data-sfx-'+name.replaceAll('_','-')+']')?.value||0);
  specs.push({
   id:'sfx-'+cueIndex,kind:'sfx',label:'SFX '+String(cueIndex).padStart(2,'0'),
   file,loop:false,startSeconds:read('start'),gain:read('gain')/100,
   trimStartSeconds:read('trim_start'),trimEndSeconds:read('trim_end'),
   fadeInSeconds:read('fade_in'),fadeOutStartSeconds:read('fade_out_start'),
   fadeOutSeconds:read('fade_out')
  });
 }

 root.innerHTML='<div class="audio-timeline-loading">Reading local audio metadata and waveform previews…</div>';
 const loaded=await Promise.all(specs.map(async spec=>{
  const values=await Promise.all([readLocalAudioDuration(spec.file),decodeLocalAudioBuffer(spec.file)]);
  return {duration:values[1]?.duration||values[0],buffer:values[1]};
 }));
 if(revision!==audioTimelineRevision)return;
 const buffers=loaded.map(item=>item.buffer);
 const tracks=specs.map((spec,index)=>({
  id:spec.id,kind:spec.kind,label:spec.label,
  fileName:spec.file?.name||'',hasFile:Boolean(spec.file),
  sourceDurationSeconds:loaded[index].duration,loop:spec.loop,
  startSeconds:spec.startSeconds||0,
  trimStartSeconds:spec.trimStartSeconds||0,
  trimEndSeconds:spec.trimEndSeconds||0,
  fadeInSeconds:spec.fadeInSeconds||0,
  fadeOutStartSeconds:spec.fadeOutStartSeconds||0,
  fadeOutSeconds:spec.fadeOutSeconds||0
 }));
 const model=window.Reference2VideoTimeline.buildTimelineModel({durationSeconds:totalDuration,tracks});
 const time=window.Reference2VideoTimeline.formatTime;
 const tickHtml=model.ticks.map((tick,index)=>{
  const percent=tick/totalDuration*100;
  const edge=index===0?'tick-start':(tick===totalDuration?'tick-end':'');
  return '<span class="audio-timeline-tick '+edge+'" style="left:'+percent+'%">'+time(tick)+'</span>';
 }).join('');
 const gridHtml=model.ticks.map(tick=>'<span class="audio-timeline-gridline" style="left:'+(tick/totalDuration*100)+'%"></span>').join('');
 const laneHtml=model.lanes.map((lane,index)=>{
  const trackClass='audio-timeline-track track-'+lane.kind;
  let bar='';
  if(lane.hasFile&&lane.widthPercent>0){
   const waveform=buffers[index]?'<canvas class="audio-waveform" data-waveform-index="'+index+'" aria-hidden="true"></canvas>':'';
   bar='<div class="audio-timeline-bar '+(lane.unknownDuration?'bar-unknown':'')+'" style="left:'+lane.startPercent+'%;width:'+lane.widthPercent+'%" title="'+esc(lane.fileName)+'">'+waveform+
    '<span class="audio-timeline-fade fade-in" style="width:'+lane.fadeInPercent+'%"></span>'+
    '<span class="audio-timeline-fade fade-out" style="left:'+lane.fadeOutLeftPercent+'%;width:'+lane.fadeOutWidthPercent+'%"></span>'+
   '</div>';
  }else if(lane.hasFile&&lane.unknownDuration){
   bar='<div class="audio-timeline-marker" style="left:'+lane.startPercent+'%" title="Audio duration unavailable"></div>';
  }
  const meta=!lane.hasFile?'No file selected':
   (lane.unknownDuration?'Duration unavailable · marker only':
    (lane.loop?'Loops to export end':time(lane.visibleDurationSeconds)+' on timeline'));
  const warning=lane.outOfRange?' · starts after export end':'';
  return '<div class="audio-timeline-lane"><div class="audio-timeline-label"><b>'+esc(lane.label)+'</b><small title="'+esc(lane.fileName)+'">'+esc(lane.fileName||meta)+'</small></div><div class="'+trackClass+'" style="--playhead:0%">'+gridHtml+
   (lane.hasFile&&lane.widthPercent>0?bar:'<span class="audio-timeline-track-empty">'+(lane.hasFile?'No visible segment':'No file selected')+'</span>')+
   '<small class="audio-timeline-track-meta">'+esc(meta+warning)+'</small></div></div>';
 }).join('');
 const decodedCount=loaded.filter(item=>item.buffer).length;
 const selectedCount=specs.filter(spec=>spec.file).length;
 const decodeWarning=selectedCount>decodedCount?' '+(selectedCount-decodedCount)+' selected file(s) could not be decoded by this browser; those tracks may still export through FFmpeg.':'';
 root.innerHTML=
  '<div class="audio-timeline-head"><div><b>AUDIO TIMELINE PREVIEW</b><p>Waveforms and playback use local browser decoding. Audio files are not uploaded until you start assembly.</p></div><strong id="audioTimelineReadout">00:00 / '+time(totalDuration)+'</strong></div>'+
  '<div class="audio-preview-controls"><button type="button" class="secondary" id="audioPreviewPlay">▶ Play video + audio</button><button type="button" class="secondary" id="audioPreviewStop" disabled>Stop</button><span id="audioPreviewStatus">'+(decodedCount?'Ready to preview '+decodedCount+' decoded track(s).':'Choose supported audio files to preview the mix.')+esc(decodeWarning)+'</span></div>'+
  '<div class="audio-timeline-scroll"><div class="audio-timeline-canvas">'+
   '<div class="audio-timeline-ruler-row"><div class="audio-timeline-label ruler-label">TRACK</div><div class="audio-timeline-ruler-track">'+tickHtml+'</div></div>'+
   '<div class="audio-timeline-lanes">'+laneHtml+'</div>'+
  '</div></div>'+
  '<div class="audio-timeline-scrub"><label for="audioTimelineSeek">PLAYHEAD</label><input id="audioTimelineSeek" type="range" min="0" max="'+totalDuration+'" step="0.1" value="0"><span id="audioTimelinePosition">00:00</span></div>'+
  '<small class="audio-timeline-footnote">Waveforms are visual summaries of the selected source trims. Playback synchronizes voiceover, looping music and timed SFX; the final FFmpeg mix remains authoritative for music ducking, limiting and AAC encoding.</small>';
 const seek=root.querySelector('#audioTimelineSeek');
 const readout=root.querySelector('#audioTimelineReadout');
 const position=root.querySelector('#audioTimelinePosition');
 const updatePlayhead=()=>{
  const seconds=Number(seek.value)||0;
  audioTimelinePlayheadSeconds=seconds;
  const percent=seconds/totalDuration*100;
  root.querySelectorAll('.audio-timeline-track').forEach(track=>track.style.setProperty('--playhead',percent+'%'));
   const videoPlayhead=document.getElementById('videoSequencePlayhead');
   if(videoPlayhead)videoPlayhead.style.left=percent+'%';
  if(readout)readout.textContent=time(seconds)+' / '+time(totalDuration);
  if(position)position.textContent=time(seconds);
 };
 seek.value=String(Math.min(totalDuration,audioTimelinePlayheadSeconds));
 const updateCanvases=()=>{
  root.querySelectorAll('.audio-waveform').forEach(canvas=>{
   const index=Number(canvas.dataset.waveformIndex);
   if(buffers[index])drawAudioWaveform(canvas,buffers[index],specs[index],model.lanes[index]);
  });
 };
 window.requestAnimationFrame(updateCanvases);
 seek.addEventListener('input',()=>{
   if(audioPreviewState)stopAudioPreview(false);
   updatePlayhead();
   syncAssemblyVideoPreview(Number(seek.value)||0,false);
   const previewStatus=root.querySelector('#audioPreviewStatus');
   if(previewStatus)previewStatus.textContent='Preview stopped at the new playhead. Press Play to continue from here.';
  });
 const play=root.querySelector('#audioPreviewPlay');
 const stop=root.querySelector('#audioPreviewStop');
 const status=root.querySelector('#audioPreviewStatus');
 if(play)play.addEventListener('click',()=>{
   stopAudioPreview(false);
   startAudioPreview(totalDuration,specs,buffers,seek,updatePlayhead,status).then(()=>{syncAssemblyVideoPreview(Number(seek.value)||0,true);startAssemblyVideoSyncLoop();}).catch(error=>{if(status)status.textContent=error.message;stopAudioPreview(false);if(play)play.disabled=false;});
  });
 if(stop)stop.addEventListener('click',()=>stopAudioPreview());
 updatePlayhead();
}

function addSfxCue(){
 const list=document.getElementById('sfxCueList');
 if(!list)return;
 if(list.querySelectorAll('.sfx-cue').length>=6){
  const status=document.getElementById('assemblyStatus');
  if(status)status.textContent='A maximum of six timed SFX cues can be added to one export.';
  return;
 }
 const usedIds=new Set(Array.from(list.querySelectorAll('.sfx-cue')).map(item=>Number(item.dataset.sfxId)));
 const id=[0,1,2,3,4,5].find(value=>!usedIds.has(value));
 const row=document.createElement('div');
 row.className='sfx-cue';
 row.dataset.sfxId=String(id);
 row.innerHTML='<label>SFX FILE<input type="file" data-sfx-file accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,.aiff,audio/*"><small data-sfx-name>No file selected · max 10 MB</small></label><label>START TIME (SECONDS)<input type="number" data-sfx-start min="0" max="900" step="0.1" value="0"></label><label class="sfx-gain">LEVEL <input type="range" data-sfx-gain min="0" max="200" step="5" value="100"><span data-sfx-gain-value>100%</span></label><details class="sfx-processing"><summary>Trim & fades</summary><div class="processing-grid"><label>TRIM START<input type="number" data-sfx-trim-start min="0" max="3600" step="0.1" value="0"></label><label>TRIM END · 0 = full<input type="number" data-sfx-trim-end min="0" max="3600" step="0.1" value="0"></label><label>FADE IN<input type="number" data-sfx-fade-in min="0" max="10" step="0.1" value="0"></label><label>FADE OUT START<input type="number" data-sfx-fade-out-start min="0" max="3600" step="0.1" value="0"></label><label>FADE OUT LENGTH<input type="number" data-sfx-fade-out min="0" max="10" step="0.1" value="0"></label></div></details><button type="button" class="secondary sfx-remove">Remove</button>';
 const file=row.querySelector('[data-sfx-file]');
 file.addEventListener('change',()=>{row.querySelector('[data-sfx-name]').textContent=file.files?.[0]?.name||'No file selected · max 10 MB';});
 const gain=row.querySelector('[data-sfx-gain]');
 gain.addEventListener('input',()=>{row.querySelector('[data-sfx-gain-value]').textContent=gain.value+'%';});
 row.querySelector('.sfx-remove').addEventListener('click',()=>{row.remove();renderAudioTimeline();});
 list.appendChild(row);
 renderAudioTimeline();
}
document.getElementById('addSfxBtn')?.addEventListener('click',addSfxCue);
const audioEditor=document.querySelector('.assembly-panel');
audioEditor?.addEventListener('input',event=>{if(event.target.closest('.audio-track-control,.sfx-cue'))renderAudioTimeline();});
audioEditor?.addEventListener('change',event=>{if(event.target.matches('input[type="file"]')||event.target.closest('.audio-track-control,.sfx-cue'))renderAudioTimeline();});
document.getElementById('addSubtitleBtn')?.addEventListener('click',addSubtitleCue);
const subtitleEditor=document.querySelector('.subtitle-editor');
subtitleEditor?.addEventListener('input',()=>renderSubtitleOverlay(audioTimelinePlayheadSeconds));
subtitleEditor?.addEventListener('change',()=>renderSubtitleOverlay(audioTimelinePlayheadSeconds));

function readAudioProcessing(read,label){
 const values={
  trim_start_seconds:Number(read('trim_start')||0),
  trim_end_seconds:Number(read('trim_end')||0),
  fade_in_seconds:Number(read('fade_in')||0),
  fade_out_start_seconds:Number(read('fade_out_start')||0),
  fade_out_seconds:Number(read('fade_out')||0)
 };
 const limits={trim_start_seconds:3600,trim_end_seconds:3600,fade_in_seconds:10,fade_out_start_seconds:3600,fade_out_seconds:10};
 for(const [key,value] of Object.entries(values)){
  if(!Number.isFinite(value)||value<0||value>limits[key])return {error:label+' '+key.replaceAll('_',' ')+' must be between 0 and '+limits[key]+' seconds.'};
 }
 if(values.trim_end_seconds&&values.trim_end_seconds<=values.trim_start_seconds)return {error:label+' trim end must be greater than trim start.'};
 if(values.trim_end_seconds){
  const length=values.trim_end_seconds-values.trim_start_seconds;
  if(values.fade_in_seconds+values.fade_out_seconds>length)return {error:label+' fade durations cannot exceed the trimmed audio length.'};
  if(values.fade_out_seconds&&values.fade_out_start_seconds+values.fade_out_seconds>length)return {error:label+' fade-out must finish within the trimmed audio segment.'};
 }
 return {options:values};
}
async function createAssembly(){
 const button=document.getElementById('assembleBtn'),output=document.getElementById('assemblyOutput');
 const token=document.getElementById('videoAccessToken')?.value.trim()||'';
 const status=document.getElementById('assemblyStatus');
 if(!token){if(status)status.textContent='Enter the owner access token configured privately in Render first.';return;}
 if(!assemblyQueue.length){if(status)status.textContent='Add at least one completed clip to the assembly queue.';return;}
 const aspect=document.getElementById('assemblyAspect')?.value||'16:9';
 const voiceover=document.getElementById('voiceoverFile')?.files?.[0]||null;
 const music=document.getElementById('musicFile')?.files?.[0]||null;
 const soundEffects=[];
 for(const row of document.querySelectorAll('.sfx-cue')){
  const file=row.querySelector('[data-sfx-file]')?.files?.[0]||null;
  if(!file)continue;
  if(file.size>10*1024*1024){if(status)status.textContent='Each SFX cue must be 10 MB or smaller.';return;}
  const start=Number(row.querySelector('[data-sfx-start]')?.value||0);
  const gain=Number(row.querySelector('[data-sfx-gain]')?.value||100)/100;
  if(!Number.isFinite(start)||start<0||start>900){if(status)status.textContent='SFX start times must be between 0 and 900 seconds.';return;}
  if(!Number.isFinite(gain)||gain<0||gain>2){if(status)status.textContent='SFX levels must be between 0% and 200%.';return;}
  const processing=readAudioProcessing(name=>row.querySelector('[data-sfx-'+name.replaceAll('_','-')+']')?.value,'Sound-effect cue');
  if(processing.error){if(status)status.textContent=processing.error;return;}
  soundEffects.push({field_name:'sfx_'+row.dataset.sfxId,start_seconds:start,gain,...processing.options});
 }
 if(soundEffects.length>6){if(status)status.textContent='Use no more than six timed SFX cues.';return;}
 for(const file of [voiceover,music]){
  if(file&&file.size>20*1024*1024){if(status)status.textContent='Voiceover and music files must be 20 MB or smaller.';return;}
 }
 const sfxFiles=Array.from(document.querySelectorAll('.sfx-cue [data-sfx-file]')).map(input=>input.files?.[0]||null);
 const totalBytes=[voiceover,music,...sfxFiles].filter(Boolean).reduce((sum,file)=>sum+file.size,0);
 if(totalBytes>48*1024*1024){if(status)status.textContent='Keep all audio uploads together under 48 MB (the server request limit is 50 MB).';return;}
 const voiceoverGain=Number(document.getElementById('voiceoverGain')?.value||100)/100;
 const musicGain=Number(document.getElementById('musicGain')?.value||18)/100;
 const fieldSuffix={trim_start:'TrimStart',trim_end:'TrimEnd',fade_in:'FadeIn',fade_out_start:'FadeOutStart',fade_out:'FadeOut'};
 const voiceoverProcessing=readAudioProcessing(name=>document.getElementById('voiceover'+fieldSuffix[name])?.value,'Voiceover');
 const musicProcessing=readAudioProcessing(name=>document.getElementById('music'+fieldSuffix[name])?.value,'Music');
 if(voiceoverProcessing.error){if(status)status.textContent=voiceoverProcessing.error;return;}
 if(musicProcessing.error){if(status)status.textContent=musicProcessing.error;return;}
 const tracks=[voiceover?'voiceover':null,music?'background music':null,soundEffects.length?(soundEffects.length+' timed SFX cue(s)'):null].filter(Boolean);
 const sceneEdits=collectSceneEdits();
 const scenePlan=window.Reference2VideoVideoPreview.buildVideoSequencePlan(
  assemblyQueue.map(id=>recentJobsById[id]),assemblyEditsById
 );
 if(scenePlan.errors.length){if(status)status.textContent=scenePlan.errors.join(' ');return;}
 const subtitleResult=collectSubtitlePayload(scenePlan.durationSeconds);
 if(subtitleResult.error){if(status)status.textContent=subtitleResult.error;return;}
 const subtitles=subtitleResult.payload;
 if(subtitles)tracks.push(subtitles.captions.length+' subtitle cue(s)');
 const trackSummary=tracks.length?tracks.join(' + '):'silent audio';
 const crossfadeSummary=scenePlan.transitionCount?(' with '+scenePlan.transitionCount+' crossfade(s)'):' with hard cuts';
 if(!window.confirm('Assemble '+assemblyQueue.length+' clips as a '+aspect+' MP4'+crossfadeSummary+'?\n\nTrimmed timeline: '+scenePlan.durationSeconds.toFixed(2)+' seconds.\nTracks: '+trackSummary+'.\n\nFFmpeg uses the server and does not call a paid AI provider.'))return;
 button.disabled=true;
 output.innerHTML='<div class="generation-status"><span class="spinner"></span><span>Starting FFmpeg assembly…</span></div>';
 if(status)status.textContent='Preparing '+trackSummary+'. No paid video-generation request is sent.';
 try{
  const form=new FormData();
  form.append('job_ids',JSON.stringify(assemblyQueue.slice()));
  form.append('scene_edits',JSON.stringify(sceneEdits));
  form.append('aspect_ratio',aspect);
  form.append('voiceover_gain',String(voiceoverGain));
  form.append('music_gain',String(musicGain));
  for(const [prefix,processing] of [['voiceover',voiceoverProcessing.options],['music',musicProcessing.options]]){
   for(const [key,value] of Object.entries(processing))form.append(prefix+'_'+key,String(value));
  }
  form.append('sound_effects',JSON.stringify(soundEffects));
  if(subtitles)form.append('subtitles',JSON.stringify(subtitles));
  if(voiceover)form.append('voiceover',voiceover);
  if(music)form.append('music',music);
  for(const cue of soundEffects){
   const row=Array.from(document.querySelectorAll('.sfx-cue')).find(item=>String(item.dataset.sfxId)===cue.field_name.slice(4));
   const file=row?.querySelector('[data-sfx-file]')?.files?.[0];
   if(file)form.append(cue.field_name,file);
  }
  const response=await fetch('/api/assemble',{method:'POST',headers:{'X-Owner-Token':token},body:form});
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
output.innerHTML='<video controls playsinline preload="metadata" src="'+esc(data.video_url)+'"></video><div class="video-actions"><a href="'+esc(data.download_url)+'">Download finished MP4 ↓</a><span>'+esc(data.aspect_ratio)+' · '+esc(data.source_count)+' clips · '+(data.final_duration_seconds?Number(data.final_duration_seconds).toFixed(2)+' sec · ':'')+(data.crossfade_count?data.crossfade_count+' crossfade(s) · ':'')+([data.has_voiceover?'voiceover':null,data.has_music?'background music':null,data.sound_effect_count?(data.sound_effect_count+' timed SFX cue(s)'):null,data.subtitle_count?(data.subtitle_count+' subtitle cue(s)'):null].filter(Boolean).join(' + ')||'silent')+'</span></div>'+(data.error?'<p class="generation-error">Storage warning: '+esc(data.error)+'</p>':(data.storage_backend==='s3'?'<p class="assembly-note">Saved in durable private object storage.</p>':'<p class="assembly-note">Saved on temporary server storage. Download it before a Render restart or redeploy.</p>'));
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
document.getElementById('assemblyAspect')?.addEventListener('change',renderAssemblyVideoPreview);
const subtitleSize=document.getElementById('subtitleSize'),subtitleSizeValue=document.getElementById('subtitleSizeValue');
if(subtitleSize&&subtitleSizeValue)subtitleSize.addEventListener('input',()=>{subtitleSizeValue.textContent=subtitleSize.value+'%';renderSubtitleOverlay(audioTimelinePlayheadSeconds);});
[['voiceoverGain','voiceoverGainValue'],['musicGain','musicGainValue']].forEach(([inputId,valueId])=>{
const input=document.getElementById(inputId),value=document.getElementById(valueId);
if(input&&value){const update=()=>value.textContent=input.value+'%';input.addEventListener('input',update);update();}
});
[['voiceoverFile','voiceoverFileName'],['musicFile','musicFileName']].forEach(([inputId,labelId])=>{
const input=document.getElementById(inputId),label=document.getElementById(labelId);
if(input&&label)input.addEventListener('change',()=>{label.textContent=input.files?.[0]?.name||'No file selected';});
});
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
const el=document.getElementById('providerStatus'),storageEl=document.getElementById('mediaStorageStatus'),assemblyEl=document.getElementById('assemblyStatus');
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
if(assemblyEl){
assemblyEl.textContent=data.ffmpeg_available
?'FFmpeg is available. Select completed clips below to create a silent MP4 without calling the paid video provider.'
:data.ffmpeg_installable
?'FFmpeg will be installed from the bundled npm package when the first export starts. Assembly itself does not make a paid AI video request.'
:'FFmpeg is not installed. Set FFMPEG_PATH or install FFmpeg in the Render build environment before assembling clips.';
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
renderAudioTimeline();
document.getElementById('exportBtn').onclick=()=>{if(!currentData)return;const copy=JSON.parse(JSON.stringify(currentData)),idea=copy.ideas?.[selectedIdea];if(!idea)return;idea.scenes.forEach((s,i)=>document.querySelectorAll('.scene')[i]?.querySelectorAll('textarea').forEach(t=>s[t.dataset.k]=t.value));copy.selected_idea_storyboard={title:idea.title,scenes:idea.scenes};const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(copy,null,2)],{type:'application/json'}));a.href=url;a.download='reference2video-storyboard.json';a.click();URL.revokeObjectURL(url);};