(function(root,factory){const api=factory();if(typeof module!=="undefined"&&module.exports)module.exports=api;if(root)root.Reference2VideoVideoPreview=api;})(typeof window!=="undefined"?window:globalThis,function(){
"use strict";
function finitePositive(value){const n=Number(value);return Number.isFinite(n)&&n>0?n:null;}
function finiteNonNegative(value,fallback=0){const n=Number(value);return Number.isFinite(n)&&n>=0?n:fallback;}
function resolveClipDuration(job){
 if(!job||typeof job!=="object")return null;
 const measured=finitePositive(job.actual_duration_seconds);
 if(measured)return {durationSeconds:measured,source:"measured"};
 const requested=finitePositive(job.duration);
 if(requested)return {durationSeconds:requested,source:"requested"};
 return null;
}
function isGeneratedVideoPath(value){return typeof value==="string"&&/^\/api\/generated\/[A-Za-z0-9_-]+$/.test(value);}
function buildVideoSequencePlan(jobs,editsById){
 const edits=editsById&&typeof editsById==="object"?editsById:{};
 const segments=[],errors=[];
 (Array.isArray(jobs)?jobs:[]).forEach(job=>{
  if(!job||job.status!=="COMPLETED"||!job.artifact_available||!isGeneratedVideoPath(job.video_url))return;
  const timing=resolveClipDuration(job);if(!timing)return;
  const jobId=String(job.job_id||"");
  const edit=edits[jobId]&&typeof edits[jobId]==="object"?edits[jobId]:{};
  const sourceDuration=timing.durationSeconds;
  const trimStart=finiteNonNegative(edit.trim_start_seconds,0);
  const requestedEnd=finiteNonNegative(edit.trim_end_seconds,0);
  const trimEnd=requestedEnd===0?sourceDuration:requestedEnd;
  let valid=trimStart<trimEnd&&trimEnd<=sourceDuration+0.001;
  if(!valid)errors.push("Scene "+(segments.length+1)+" trim must stay within its "+sourceDuration.toFixed(2)+" second source clip.");
  const safeStart=valid?trimStart:0;
  const safeEnd=valid?Math.min(trimEnd,sourceDuration):sourceDuration;
  const transition=String(edit.transition_after||"cut").toLowerCase();
  let transitionDuration=transition==="crossfade"?finiteNonNegative(edit.transition_duration_seconds,0.5):0;
  if(!["cut","crossfade"].includes(transition)){
   errors.push("Scene "+(segments.length+1)+" transition must be cut or crossfade.");
   transitionDuration=0;
  }
  if(transition==="crossfade"&&(transitionDuration<0.25||transitionDuration>2)){
   errors.push("Scene "+(segments.length+1)+" crossfade must be between 0.25 and 2 seconds.");
   transitionDuration=0;
  }
  segments.push({
   jobId,index:segments.length,title:"Scene "+String(segments.length+1).padStart(2,"0"),
   url:job.video_url,sourceDurationSeconds:sourceDuration,
   durationSeconds:Math.round((safeEnd-safeStart)*1000)/1000,
   durationSource:timing.source,trimStartSeconds:safeStart,trimEndSeconds:safeEnd,
   transitionAfter:transition,transitionDurationSeconds:transitionDuration,
   startSeconds:0,endSeconds:0,startPercent:0,widthPercent:0
  });
 });
 segments.forEach((segment,index)=>{
  if(index===segments.length-1&&segment.transitionAfter==="crossfade"){
   errors.push("The final scene cannot crossfade to a following scene.");
   segment.transitionAfter="cut";segment.transitionDurationSeconds=0;
  }
 });
 segments.forEach((segment,index)=>{
  const incoming=index>0&&segments[index-1].transitionAfter==="crossfade"?segments[index-1].transitionDurationSeconds:0;
  const outgoing=segment.transitionAfter==="crossfade"?segment.transitionDurationSeconds:0;
  if(segment.durationSeconds<=incoming+outgoing+0.01)errors.push("Scene "+(index+1)+" is too short for its incoming and outgoing crossfades.");
 });
 let cursor=0;
 segments.forEach(segment=>{
  segment.startSeconds=Math.round(cursor*1000)/1000;
  segment.endSeconds=Math.round((cursor+segment.durationSeconds)*1000)/1000;
  cursor=segment.endSeconds-(segment.transitionAfter==="crossfade"?segment.transitionDurationSeconds:0);
 });
 const total=segments.length?segments[segments.length-1].endSeconds:0;
 segments.forEach(segment=>{
  segment.startPercent=total?segment.startSeconds/total*100:0;
  segment.widthPercent=total?segment.durationSeconds/total*100:0;
 });
 const measuredCount=segments.filter(segment=>segment.durationSource==="measured").length;
 const transitionCount=segments.filter(segment=>segment.transitionAfter==="crossfade").length;
 return {durationSeconds:total,segments,measuredCount,requestedFallbackCount:segments.length-measuredCount,transitionCount,errors};
}
function locateSegmentAtTime(plan,seconds){
 const segments=plan&&Array.isArray(plan.segments)?plan.segments:[];
 if(!segments.length)return null;
 const total=Math.max(0,Number(plan.durationSeconds)||0),n=Number(seconds);
 const time=Math.min(total,Math.max(0,Number.isFinite(n)?n:0));
 let chosen=segments[segments.length-1];
 for(let i=0;i<segments.length;i++){
  const current=segments[i],next=segments[i+1];
  if(next&&current.transitionAfter==="crossfade"){
   const overlapStart=next.startSeconds,overlapEnd=current.endSeconds;
   if(time<overlapStart){chosen=current;break;}
   if(time<overlapEnd){
    chosen=time<(overlapStart+overlapEnd)/2?current:next;
    break;
   }
  }else if(time<current.endSeconds||i===segments.length-1){
   chosen=current;break;
  }
 }
 const offset=Math.max(0,Math.min(chosen.durationSeconds,time-chosen.startSeconds));
 return {segment:chosen,timelineSeconds:time,offsetSeconds:chosen.trimStartSeconds+offset};
}
return {buildVideoSequencePlan,locateSegmentAtTime,isGeneratedVideoPath,resolveClipDuration};
});
