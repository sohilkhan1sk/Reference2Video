import fs from 'node:fs/promises';
import { experimental_generateVideo as generateVideo } from 'ai';

const [inputPath, outputPath] = process.argv.slice(2);
if (!process.env.AI_GATEWAY_API_KEY) {
  throw new Error('AI_GATEWAY_API_KEY is not configured in the server environment.');
}
if (!inputPath || !outputPath) {
  throw new Error('Expected an input JSON path and output MP4 path.');
}

const input = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const result = await generateVideo({
  model: 'alibaba/wan-v3.0-video',
  prompt: input.prompt,
  duration: input.duration,
  aspectRatio: input.aspectRatio,
  resolution: input.resolution,
  providerOptions: {
    alibaba: {
      pollIntervalMs: 5000,
      pollTimeoutMs: 600000
    }
  }
});

const video = result.videos?.[0];
if (!video?.uint8Array) {
  throw new Error('The AI Gateway response did not contain a generated video.');
}
await fs.writeFile(outputPath, video.uint8Array);
process.stdout.write('Video saved successfully.\n');
