import test from "node:test";
import assert from "node:assert/strict";
import "../static/storyboard_captions.js";

const api = globalThis.Reference2VideoStoryboardCaptions;

test("parses storyboard mm:ss, seconds and mixed scene labels", () => {
  assert.deepEqual(api.parseSceneTimeRange({time:"Scene 02 · 00:05–00:12"}), {startSeconds:5,endSeconds:12});
  assert.deepEqual(api.parseSceneTimeRange({time:"5s to 9.5 seconds"}), {startSeconds:5,endSeconds:9.5});
  assert.deepEqual(api.parseSceneTimeRange({start_seconds:"1:02",end_seconds:"1:08"}), {startSeconds:62,endSeconds:68});
});

test("rejects invalid, reversed and over-one-hour scene ranges", () => {
  assert.equal(api.parseSceneTimeRange({time:"00:10–00:05"}), null);
  assert.equal(api.parseSceneTimeRange({time:"Scene timing TBD"}), null);
  assert.equal(api.parseSceneTimeRange({time:"59:59–60:01"}), null);
});

test("creates separate voice-over and on-screen text draft cues", () => {
  const result = api.buildStoryboardCaptionDrafts([
    {time:"00:00–00:05",voiceover:"A new story begins.",on_screen_text:"THE BEGINNING"}
  ]);
  assert.equal(result.captions.length,2);
  assert.deepEqual(result.captions.map(c=>c.source).sort(),["On-screen text","Voice-over"]);
  assert.equal(result.captions[0].start_seconds,0);
  assert.equal(result.captions[0].end_seconds,5);
});

test("can omit on-screen text and ignores placeholder narration", () => {
  const result = api.buildStoryboardCaptionDrafts([
    {time:"0–5 sec",voiceover:"No voiceover",on_screen_text:"TITLE CARD"}
  ], {includeOnScreenText:false});
  assert.equal(result.captions.length,0);
});

test("splits long narration into readable two-line cues distributed over the scene", () => {
  const narration = "A long documentary sentence explains how ancient people crossed the frozen landscape while searching for shelter and food before the dangerous winter storm arrived.";
  const result = api.buildStoryboardCaptionDrafts([
    {time:"00:00–00:08",voiceover:narration,on_screen_text:""}
  ], {includeOnScreenText:false});
  assert.ok(result.captions.length > 1);
  assert.equal(result.captions[0].start_seconds,0);
  assert.equal(result.captions.at(-1).end_seconds,8);
  for (const cue of result.captions) {
    assert.ok(cue.text.split("\n").length <= 2);
    assert.ok(cue.text.split("\n").every(line=>line.length<=42));
    assert.ok(cue.end_seconds>cue.start_seconds);
  }
});

test("maps storyboard cue ranges onto measured trimmed and crossfaded clip segments", () => {
  const result = api.buildStoryboardCaptionDrafts([
    {time:"00:00–00:05",voiceover:"Opening line",on_screen_text:""},
    {time:"00:05–00:10",voiceover:"Second line",on_screen_text:""}
  ], {includeOnScreenText:false,timelineSegments:[
    {startSeconds:0,durationSeconds:4},
    {startSeconds:3.5,durationSeconds:6}
  ]});
  assert.equal(result.usedTimelineMapping,true);
  assert.deepEqual(result.captions.map(c=>[c.start_seconds,c.end_seconds]),[[0,4],[3.5,9.5]]);
});

test("skips scenes without parseable timing and reports the reason", () => {
  const result = api.buildStoryboardCaptionDrafts([
    {time:"timing unavailable",voiceover:"Keep this line"},
    {time:"00:02–00:04",voiceover:"This line remains"}
  ], {includeOnScreenText:false});
  assert.equal(result.captions.length,1);
  assert.equal(result.captions[0].scene_number,2);
  assert.equal(result.warnings.length,1);
});

test("caps generated draft cues at the backend limit", () => {
  const scenes = Array.from({length:205},(_,i)=>({time:(i*2)+"–"+(i*2+1)+" sec",voiceover:"Caption "+i}));
  const result = api.buildStoryboardCaptionDrafts(scenes,{includeOnScreenText:false});
  assert.equal(result.captions.length,200);
  assert.ok(result.warnings.some(message=>message.includes("200 cues")));
});