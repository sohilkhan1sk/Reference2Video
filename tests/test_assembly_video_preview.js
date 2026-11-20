import test from "node:test";
import assert from "node:assert/strict";
import "../static/assembly_video_preview.js";
const {buildVideoSequencePlan,locateSegmentAtTime,isGeneratedVideoPath}=globalThis.Reference2VideoVideoPreview;
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
