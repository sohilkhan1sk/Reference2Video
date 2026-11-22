import test from "node:test";
import assert from "node:assert/strict";
import "../static/assembly_video_preview.js";
const {buildVideoSequencePlan,locateSegmentAtTime,isGeneratedVideoPath,resolveClipDuration}=globalThis.Reference2VideoVideoPreview;
function job(id,duration,overrides={}){return {job_id:id,status:"COMPLETED",artifact_available:true,video_url:"/api/generated/"+id,duration,...overrides};}
test("sequence preserves queue order and cumulative positions",()=>{
 const p=buildVideoSequencePlan([job("a",5),job("b",8),job("c",10)]);
 assert.equal(p.durationSeconds,23);assert.deepEqual(p.segments.map(x=>x.startSeconds),[0,5,13]);assert.deepEqual(p.segments.map(x=>x.endSeconds),[5,13,23]);assert.deepEqual(p.segments.map(x=>x.title),["Scene 01","Scene 02","Scene 03"]);assert.ok(Math.abs(p.segments[1].widthPercent-8/23*100)<1e-9);
});
test("unavailable, unfinished, invalid URL and invalid duration clips are excluded",()=>{
 const p=buildVideoSequencePlan([job("missing",5,{artifact_available:false}),job("working",5,{status:"PROCESSING"}),job("external",5,{video_url:"https://example.com/a.mp4"}),job("zero",0),job("good",4)]);
 assert.equal(p.durationSeconds,4);assert.equal(p.segments.length,1);assert.equal(p.segments[0].jobId,"good");
});
test("lookup switches scenes exactly at a clip boundary",()=>{
 const p=buildVideoSequencePlan([job("a",5),job("b",8)]);assert.equal(locateSegmentAtTime(p,4).segment.jobId,"a");assert.equal(locateSegmentAtTime(p,5).segment.jobId,"b");assert.equal(locateSegmentAtTime(p,5).offsetSeconds,0);
});
test("lookup clamps negative and past-end positions",()=>{
 const p=buildVideoSequencePlan([job("a",5),job("b",8)]);assert.equal(locateSegmentAtTime(p,-5).offsetSeconds,0);const end=locateSegmentAtTime(p,99);assert.equal(end.segment.jobId,"b");assert.equal(end.offsetSeconds,8);
});
test("only generated same-origin paths are accepted",()=>{
 assert.equal(isGeneratedVideoPath("/api/generated/abc-123"),true);assert.equal(isGeneratedVideoPath("https://example.com/api/generated/abc"),false);assert.equal(isGeneratedVideoPath("/api/generated/abc?download=1"),false);assert.equal(isGeneratedVideoPath("/uploads/a.mp4"),false);
});
test("measured MP4 duration takes precedence over the requested duration",()=>{
 const timing=resolveClipDuration(job("a",5,{actual_duration_seconds:5.437}));
 assert.deepEqual(timing,{durationSeconds:5.437,source:"measured"});
 const p=buildVideoSequencePlan([job("a",5,{actual_duration_seconds:5.437}),job("b",8)]);
 assert.equal(p.durationSeconds,13.437);assert.equal(p.measuredCount,1);assert.equal(p.requestedFallbackCount,1);
 assert.equal(p.segments[1].startSeconds,5.437);
});
test("requested duration remains a backward-compatible fallback for old jobs",()=>{
 const timing=resolveClipDuration(job("legacy",6));
 assert.deepEqual(timing,{durationSeconds:6,source:"requested"});
 const p=buildVideoSequencePlan([job("legacy",6)]);
 assert.equal(p.segments[0].durationSource,"requested");assert.equal(p.requestedFallbackCount,1);
});
test("invalid or missing requested and measured durations are not guessed",()=>{
 assert.equal(resolveClipDuration(job("bad",0,{actual_duration_seconds:-1})),null);
 assert.equal(resolveClipDuration(null),null);
});

test("scene trims shorten the preview sequence and seek into the source clip",()=>{
 const plan=buildVideoSequencePlan([job("a",8),job("b",6)],{
  a:{trim_start_seconds:1,trim_end_seconds:5},
  b:{trim_start_seconds:2,trim_end_seconds:0}
 });
 assert.equal(plan.durationSeconds,8);
 assert.equal(plan.segments[0].durationSeconds,4);
 assert.equal(plan.segments[0].trimStartSeconds,1);
 assert.equal(locateSegmentAtTime(plan,2).offsetSeconds,3);
 assert.equal(locateSegmentAtTime(plan,4).segment.jobId,"b");
 assert.equal(locateSegmentAtTime(plan,4).offsetSeconds,2);
});

test("crossfades overlap adjacent scenes and shorten final duration",()=>{
 const plan=buildVideoSequencePlan([job("a",5),job("b",7),job("c",4)],{
  a:{transition_after:"crossfade",transition_duration_seconds:0.5},
  b:{transition_after:"crossfade",transition_duration_seconds:1},
  c:{}
 });
 assert.equal(plan.transitionCount,2);
 assert.equal(plan.durationSeconds,14.5);
 assert.equal(plan.segments[1].startSeconds,4.5);
 assert.equal(plan.segments[2].startSeconds,10.5);
 assert.equal(locateSegmentAtTime(plan,4.6).segment.jobId,"a");
 assert.equal(locateSegmentAtTime(plan,4.8).segment.jobId,"b");
});

test("invalid trims and impossible final-scene crossfades are reported",()=>{
 const trim=buildVideoSequencePlan([job("a",5)],{a:{trim_start_seconds:6}});
 assert.ok(trim.errors.some(error=>error.includes("trim")));
 const transition=buildVideoSequencePlan([job("a",5)],{a:{transition_after:"crossfade"}});
 assert.ok(transition.errors.some(error=>error.includes("final scene")));
});

test("crossfade duration is checked against incoming and outgoing overlaps",()=>{
 const plan=buildVideoSequencePlan([job("a",2.5),job("b",2.5),job("c",5)],{
  a:{transition_after:"crossfade",transition_duration_seconds:1.5},
  b:{transition_after:"crossfade",transition_duration_seconds:1.5}
 });
 assert.ok(plan.errors.some(error=>error.includes("too short")));
});

test("negative scene trim values are reported instead of silently normalized",()=>{
 const plan=buildVideoSequencePlan([job("a",5)],{a:{trim_start_seconds:-1}});
 assert.ok(plan.errors.some(error=>error.includes("finite non-negative")));
});
