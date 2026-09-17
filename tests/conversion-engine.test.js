const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const engine = require('../src/conversion-engine');

async function fixtureRoot() { return fs.mkdtemp(path.join(os.tmpdir(), 'rouo-format-test-')); }
async function exists(file) { await fs.access(file); return true; }
function mediaBinary() { return require('@ffmpeg-installer/ffmpeg').path; }
function ffmpeg(args) { return new Promise((resolve, reject) => { const child = spawn(mediaBinary(), args); child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))); }); }
const helpers = { renderHtmlToPdf: async (_html, output) => fs.writeFile(output, '%PDF-1.4\n% Rouo test\n') };

test('converts PNG to WebP', async () => {
  const root = await fixtureRoot();
  const input = path.join(root, 'sample.png');
  await sharp({ create: { width: 18, height: 18, channels: 4, background: '#b9ff33' } }).png().toFile(input);
  const result = await engine.convertBatch({ paths: [input], target: 'webp', outputDir: root, options: { quality: 80 } }, helpers);
  assert.equal(result.successCount, 1);
  assert.equal(await exists(result.results[0].output), true);
  assert.equal((await sharp(result.results[0].output).metadata()).format, 'webp');
});

test('converts WAV to MP3 using bundled FFmpeg', async () => {
  const root = await fixtureRoot();
  const input = path.join(root, 'tone.wav');
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.15', input]);
  const result = await engine.convertBatch({ paths: [input], target: 'mp3', outputDir: root, options: {} }, helpers);
  assert.equal(result.successCount, 1);
  assert.equal(await exists(result.results[0].output), true);
});

test('converts TXT to HTML and DOCX', async () => {
  const root = await fixtureRoot();
  const input = path.join(root, 'notes.txt');
  await fs.writeFile(input, '# 标题\nRouo Format', 'utf8');
  const html = await engine.convertBatch({ paths: [input], target: 'html', outputDir: root, options: {} }, helpers);
  const docx = await engine.convertBatch({ paths: [input], target: 'docx', outputDir: root, options: {} }, helpers);
  assert.equal(html.successCount, 1);
  assert.equal(docx.successCount, 1);
  assert.match(await fs.readFile(html.results[0].output, 'utf8'), /Rouo Format/);
  assert.equal(await exists(docx.results[0].output), true);
});

test('converts CSV to XLSX', async () => {
  const root = await fixtureRoot();
  const input = path.join(root, 'data.csv');
  await fs.writeFile(input, 'name,value\nRouo,42\n', 'utf8');
  const result = await engine.convertBatch({ paths: [input], target: 'xlsx', outputDir: root, options: {} }, helpers);
  assert.equal(result.successCount, 1);
  assert.equal(await exists(result.results[0].output), true);
});

test('reports no common targets for unrelated input types', async () => {
  const root = await fixtureRoot();
  const image = path.join(root, 'image.png');
  const text = path.join(root, 'notes.txt');
  await sharp({ create: { width: 4, height: 4, channels: 3, background: '#111111' } }).png().toFile(image);
  await fs.writeFile(text, 'text', 'utf8');
  const inspected = await engine.inspectFiles([image, text]);
  assert.deepEqual(inspected.commonTargets, []);
});

test('recognizes legacy document formats for PDF conversion', () => {
  for (const extension of ['doc', 'odt', 'rtf', 'wps', 'wpt', 'wpd']) {
    assert.equal(engine.categoryOf(extension), 'document');
    assert.ok(engine.targetsFor(extension).includes('pdf'));
  }
});
