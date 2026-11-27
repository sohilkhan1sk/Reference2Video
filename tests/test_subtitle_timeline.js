import test from "node:test";
import assert from "node:assert/strict";
import "../static/subtitle_timeline.js";
const api = globalThis.Reference2VideoSubtitleTimeline;

test("lays out overlapping captions on separate lanes", () => {
  const layout = api.layoutCues([
    {id:"a",start:0,end:3,text:"first"},
    {id:"b",start:1,end:2,text:"overlap"},
    {id:"c",start:3,end:4,text:"next"}
  ], 10);
  assert.deepEqual(layout.map(cue => cue.lane), [0,1,0]);
  assert.equal(layout[0].leftPercent, 0);
  assert.equal(layout[0].widthPercent, 30);
});

test("moves a cue without changing its duration and clamps it to the timeline", () => {
  assert.deepEqual(api.moveCue({id:"a",start:1.04,end:3.04,text:"x"}, 1.06, 5), {id:"a",start:2.1,end:4.1,text:"x"});
  assert.deepEqual(api.moveCue({id:"a",start:1,end:3,text:"x"}, 10, 5), {id:"a",start:3,end:5,text:"x"});
  assert.match(api.moveCue({id:"a",start:0,end:4,text:"x"}, 1, 2).error,/longer than the timeline/);
});

test("resizes either edge while preserving the minimum caption duration", () => {
  assert.deepEqual(api.resizeCue({id:"a",start:1,end:3,text:"x"}, "start", 4, 5), {id:"a",start:2.9,end:3,text:"x"});
  assert.deepEqual(api.resizeCue({id:"a",start:1,end:3,text:"x"}, "end", 10, 5), {id:"a",start:1,end:5,text:"x"});
});

test("splits a caption at the playhead and keeps whole words", () => {
  const result = api.splitCue({id:"a",start:0,end:4,text:"A short caption for editing"}, 2);
  assert.equal(result.first.end, 2);
  assert.equal(result.second.start, 2);
  assert.equal(result.first.text + " " + result.second.text, "A short caption for editing");
});

test("rejects splits too close to an edge and one-word captions", () => {
  assert.match(api.splitCue({id:"a",start:0,end:2,text:"one two"}, 0.04).error,/0.1 seconds/);
  assert.match(api.splitCue({id:"a",start:0,end:2,text:"single"}, 1).error,/two words/);
});

test("merges exactly two neighboring cues and preserves the full range", () => {
  const result = api.mergeCues([
    {id:"a",start:0,end:1,text:"Hello"},
    {id:"b",start:1.2,end:2,text:"world"}
  ], ["a","b"]);
  assert.deepEqual(result.cue, {id:"a",start:0,end:2,text:"Hello world"});
});

test("rejects non-neighboring selections and merged text over the cue limit", () => {
  const cues = [
    {id:"a",start:0,end:1,text:"A"},
    {id:"b",start:1,end:2,text:"middle"},
    {id:"c",start:2,end:3,text:"C"}
  ];
  assert.match(api.mergeCues(cues,["a","c"]).error,/neighboring/);
  assert.match(api.mergeCues([
    {id:"a",start:0,end:1,text:"A".repeat(120)},
    {id:"b",start:1,end:2,text:"B".repeat(120)}
  ],["a","b"]).error,/220-character/);
});
