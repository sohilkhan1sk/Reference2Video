(function(root,factory){const api=factory();if(typeof module!=="undefined"&&module.exports)module.exports=api;if(root)root.Reference2VideoVideoPreview=api;})(typeof window!=="undefined"?window:globalThis,function(){
"use strict";
function finitePositive(value){const n=Number(value);return Number.isFinite(n)&&n>0?n:null;}
function isGeneratedVideoPath(value){return typeof value==="string"&&/^\/api\/generated\/[A-Za-z0-9_-]+$/.test(value);}
function buildVideoSequencePlan(jobs){
 let cursor=0;const segments=[];
 (Array.isArray(jobs)?jobs:[]).forEach(job=>{
  if(!job||job.status!=="COMPLETED"||!job.artifact_available||!isGeneratedVideoPath(job.video_url))return;
  const duration=finitePositive(job.duration);if(!duration)return;
  const index=segments.length;
  segments.push({jobId:String(job.job_id||""),index,title:"Scene "+String(index+1).padStart(2,"0"),url:job.video_url,durationSeconds:duration,startSeconds:cursor,endSeconds:cursor+duration,startPercent:0,widthPercent:0});
  cursor+=duration;
 });
 segments.forEach(segment=>{segment.startPercent=cursor?segment.startSeconds/cursor*100:0;segment.widthPercent=cursor?segment.durationSeconds/cursor*100:0;});
 return {durationSeconds:cursor,segments};
}
function locateSegmentAtTime(plan,seconds){
 const segments=plan&&Array.isArray(plan.segments)?plan.segments:[];if(!segments.length)return null;
 const total=Math.max(0,Number(plan.durationSeconds)||0),n=Number(seconds),time=Math.min(total,Math.max(0,Number.isFinite(n)?n:0));
 let segment=segments[segments.length-1];
 for(let i=0;i<segments.length;i++){if(time<segments[i].endSeconds||i===segments.length-1){segment=segments[i];break;}}
 return {segment,timelineSeconds:time,offsetSeconds:Math.min(segment.durationSeconds,Math.max(0,time-segment.startSeconds))};
}
return {buildVideoSequencePlan,locateSegmentAtTime,isGeneratedVideoPath};
});
