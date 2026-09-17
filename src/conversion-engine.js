const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const sharp = require('sharp');
const mammoth = require('mammoth');
const ExcelJS = require('exceljs');
const MarkdownIt = require('markdown-it');
const TurndownService = require('turndown');
const { Document, Packer, Paragraph, HeadingLevel } = require('docx');

const DOCUMENT_INPUTS = ['txt', 'md', 'markdown', 'html', 'htm', 'doc', 'docx', 'rtf', 'odt', 'wps', 'wpt', 'wpd', 'xlsx', 'csv', 'pdf', 'ppt', 'pptx', 'odt', 'ods', 'odp'];
const LIBREOFFICE_PDF_INPUTS = new Set(['doc', 'docx', 'rtf', 'odt', 'wps', 'wpt', 'wpd', 'xlsx', 'ppt', 'pptx', 'ods', 'odp']);
const IMAGE_INPUTS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tif', 'tiff', 'gif', 'bmp'];
const AUDIO_INPUTS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma'];
const VIDEO_INPUTS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'wmv', 'flv'];
const MEDIA_INPUTS = [...IMAGE_INPUTS, ...AUDIO_INPUTS, ...VIDEO_INPUTS];

const IMAGE_TARGETS = ['png', 'jpg', 'webp', 'avif', 'tiff'];
const AUDIO_TARGETS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'];
const VIDEO_TARGETS = ['mp4', 'webm', 'mkv', 'mov', 'gif', 'mp3', 'wav', 'flac', 'm4a', 'ogg', 'opus'];

function extensionOf(filePath) {
  return path.extname(filePath).slice(1).toLowerCase();
}

function categoryOf(extension) {
  if (DOCUMENT_INPUTS.includes(extension)) return 'document';
  if (IMAGE_INPUTS.includes(extension)) return 'image';
  if (AUDIO_INPUTS.includes(extension)) return 'audio';
  if (VIDEO_INPUTS.includes(extension)) return 'video';
  return 'unsupported';
}

function unpackedPath(value) {
  return value.replace(/app\.asar([/\\])/i, 'app.asar.unpacked$1');
}

function ffmpegPath() {
  try {
    return unpackedPath(require('@ffmpeg-installer/ffmpeg').path);
  } catch {
    return null;
  }
}

function findLibreOffice() {
  const candidates = [
    process.env.ROUO_LIBREOFFICE,
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const lookup = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['soffice'], { encoding: 'utf8' });
  if (lookup.status === 0) return lookup.stdout.trim().split(/\r?\n/)[0];
  return null;
}

function getEngineStatus() {
  const ffmpeg = ffmpegPath();
  const libreOffice = findLibreOffice();
  return {
    ffmpeg: { available: Boolean(ffmpeg), bundled: Boolean(ffmpeg) },
    sharp: { available: true, bundled: true },
    libreOffice: { available: Boolean(libreOffice), bundled: false },
  };
}

function targetsFor(extension) {
  const category = categoryOf(extension);
  if (category === 'image') return IMAGE_TARGETS.filter(target => target !== (extension === 'jpeg' ? 'jpg' : extension));
  if (category === 'audio') return AUDIO_TARGETS.filter(target => target !== extension);
  if (category === 'video') return VIDEO_TARGETS.filter(target => target !== extension);
  // The PDF option remains visible even when LibreOffice is absent so users
  // can discover the capability; conversion then reports the missing engine.
  const officePdf = ['pdf'];
  const map = {
    txt: ['md', 'html', 'docx', 'pdf'],
    md: ['txt', 'html', 'docx', 'pdf'],
    markdown: ['txt', 'html', 'docx', 'pdf'],
    html: ['txt', 'md', 'docx', 'pdf'],
    htm: ['txt', 'md', 'docx', 'pdf'],
    doc: officePdf,
    docx: ['txt', 'html', 'md', ...officePdf],
    rtf: officePdf,
    odt: officePdf,
    wps: officePdf,
    wpt: officePdf,
    wpd: officePdf,
    csv: ['xlsx', 'html', 'pdf'],
    xlsx: ['csv', 'html', ...officePdf],
    pdf: ['txt'],
    ppt: officePdf,
    pptx: officePdf,
    ods: officePdf,
    odp: officePdf,
  };
  return map[extension] || [];
}

async function inspectFiles(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return { files: [], commonTargets: [] };
  const files = [];
  for (const filePath of paths) {
    const resolved = path.resolve(String(filePath));
    const stats = await fsp.stat(resolved);
    if (!stats.isFile()) throw new Error(`不是文件：${path.basename(resolved)}`);
    const extension = extensionOf(resolved);
    files.push({
      path: resolved,
      name: path.basename(resolved),
      extension,
      category: categoryOf(extension),
      size: stats.size,
      targets: targetsFor(extension),
    });
  }
  const common = new Set(files[0].targets);
  for (const file of files.slice(1)) {
    for (const target of [...common]) if (!file.targets.includes(target)) common.delete(target);
  }
  return { files, commonTargets: [...common], engines: getEngineStatus() };
}

function safeBaseName(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'converted';
}

async function uniqueOutputPath(outputDir, inputPath, target) {
  const sourceExt = extensionOf(inputPath);
  const normalizedTarget = target === 'jpg' ? 'jpg' : target;
  const base = safeBaseName(inputPath);
  let candidate = path.join(outputDir, `${base}.${normalizedTarget}`);
  if (sourceExt === normalizedTarget || fs.existsSync(candidate)) candidate = path.join(outputDir, `${base}-converted.${normalizedTarget}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(outputDir, `${base}-converted-${index}.${normalizedTarget}`);
    index += 1;
  }
  return candidate;
}

async function convertImage(input, output, target, options) {
  const quality = Math.max(1, Math.min(100, Number(options.quality || 86)));
  let pipeline = sharp(input, { animated: true }).rotate();
  if (target === 'jpg') pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true });
  if (target === 'png') pipeline = pipeline.png({ compressionLevel: 9 });
  if (target === 'webp') pipeline = pipeline.webp({ quality });
  if (target === 'avif') pipeline = pipeline.avif({ quality, effort: 5 });
  if (target === 'tiff') pipeline = pipeline.tiff({ quality });
  await pipeline.toFile(output);
}

function ffmpegArgs(input, output, target, options) {
  const codec = String(options.codec || 'h264').toLowerCase();
  const common = ['-y', '-i', input];
  if (target === 'mp4' || target === 'mov' || target === 'mkv') {
    const videoCodec = codec === 'h265' ? 'libx265' : codec === 'av1' ? 'libsvtav1' : 'libx264';
    return [...common, '-c:v', videoCodec, '-preset', 'medium', '-crf', codec === 'av1' ? '32' : '23', '-c:a', 'aac', '-b:a', '192k', ...(target === 'mp4' ? ['-movflags', '+faststart'] : []), output];
  }
  if (target === 'webm') return [...common, '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-c:a', 'libopus', output];
  if (target === 'gif') return [...common, '-vf', "fps=15,scale='min(960,iw)':-2:flags=lanczos", '-loop', '0', output];
  const audio = {
    mp3: ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'],
    wav: ['-vn', '-c:a', 'pcm_s16le'],
    flac: ['-vn', '-c:a', 'flac'],
    m4a: ['-vn', '-c:a', 'aac', '-b:a', '192k'],
    aac: ['-vn', '-c:a', 'aac', '-b:a', '192k'],
    ogg: ['-vn', '-c:a', 'libvorbis', '-q:a', '6'],
    opus: ['-vn', '-c:a', 'libopus', '-b:a', '160k'],
  };
  if (!audio[target]) throw new Error(`不支持的媒体目标格式：${target}`);
  return [...common, ...audio[target], output];
}

async function convertMedia(input, output, target, options) {
  const binary = ffmpegPath();
  if (!binary) throw new Error('FFmpeg 引擎不可用。');
  await new Promise((resolve, reject) => {
    const child = spawn(binary, ffmpegArgs(input, output, target, options), { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-8000); });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg 转换失败（代码 ${code}）：${stderr.split(/\r?\n/).slice(-3).join(' ')}`));
    });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function documentHtml(title, body) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>@page{size:A4;margin:15mm}body{font-family:"Microsoft YaHei","Segoe UI",sans-serif;color:#151515;font-size:11pt;line-height:1.65}h1,h2,h3{line-height:1.25}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:6px;text-align:left}pre{white-space:pre-wrap;background:#f3f3f3;padding:12px}</style><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`;
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/h\d>|<\/li>|<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function textToDocx(text) {
  const children = String(text).split(/\r?\n/).map(line => {
    if (/^###\s+/.test(line)) return new Paragraph({ text: line.replace(/^###\s+/, ''), heading: HeadingLevel.HEADING_3 });
    if (/^##\s+/.test(line)) return new Paragraph({ text: line.replace(/^##\s+/, ''), heading: HeadingLevel.HEADING_2 });
    if (/^#\s+/.test(line)) return new Paragraph({ text: line.replace(/^#\s+/, ''), heading: HeadingLevel.HEADING_1 });
    return new Paragraph({ text: line || ' ' });
  });
  return new Document({ sections: [{ children }] });
}

async function readDocumentAsHtml(input, extension) {
  if (extension === 'docx') return (await mammoth.convertToHtml({ path: input })).value;
  const text = await fsp.readFile(input, 'utf8');
  if (extension === 'md' || extension === 'markdown') return new MarkdownIt({ html: false, linkify: true, typographer: true }).render(text);
  if (extension === 'html' || extension === 'htm') return text;
  return `<pre>${escapeHtml(text)}</pre>`;
}

async function workbookToHtml(input, extension) {
  const workbook = new ExcelJS.Workbook();
  if (extension === 'csv') await workbook.csv.readFile(input);
  else await workbook.xlsx.readFile(input);
  const sheet = workbook.worksheets[0];
  if (!sheet) return '<p>空表格</p>';
  const rows = [];
  sheet.eachRow(row => {
    rows.push(`<tr>${row.values.slice(1).map(value => `<td>${escapeHtml(value && value.text ? value.text : value ?? '')}</td>`).join('')}</tr>`);
  });
  return `<table>${rows.join('')}</table>`;
}

async function pdfToText(input) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await fsp.readFile(input));
  const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(' '));
  }
  return pages.join('\n\n');
}

async function convertWithLibreOffice(input, output, target) {
  const binary = findLibreOffice();
  if (!binary) throw new Error('此转换需要 LibreOffice，本机尚未安装。');
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rouo-lo-'));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(binary, ['--headless', '--convert-to', target, '--outdir', tempDir, input], { windowsHide: true });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error(`LibreOffice 转换失败：${stderr}`)));
    });
    const expected = path.join(tempDir, `${path.basename(input, path.extname(input))}.${target}`);
    const generated = fs.existsSync(expected)
      ? expected
      : (await fsp.readdir(tempDir)).map(name => path.join(tempDir, name)).find(file => extensionOf(file) === target);
    if (!generated) throw new Error('LibreOffice 未生成目标文件。');
    await fsp.copyFile(generated, output);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

async function convertDocument(input, output, target, options, helpers) {
  const extension = extensionOf(input);
  if (target === 'pdf' && LIBREOFFICE_PDF_INPUTS.has(extension)) {
    return convertWithLibreOffice(input, output, target);
  }
  if (extension === 'pdf' && target === 'txt') {
    return fsp.writeFile(output, await pdfToText(input), 'utf8');
  }
  if (extension === 'csv' && target === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    await workbook.csv.readFile(input);
    return workbook.xlsx.writeFile(output);
  }
  if (extension === 'xlsx' && target === 'csv') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(input);
    return workbook.csv.writeFile(output, { sheetName: workbook.worksheets[0]?.name });
  }
  if (['csv', 'xlsx'].includes(extension)) {
    const body = await workbookToHtml(input, extension);
    if (target === 'html') return fsp.writeFile(output, documentHtml(path.basename(input), body), 'utf8');
    if (target === 'pdf') return helpers.renderHtmlToPdf(documentHtml(path.basename(input), body), output);
  }
  const html = await readDocumentAsHtml(input, extension);
  if (target === 'html') return fsp.writeFile(output, documentHtml(path.basename(input), html), 'utf8');
  if (target === 'txt') return fsp.writeFile(output, stripHtml(html), 'utf8');
  if (target === 'md') return fsp.writeFile(output, new TurndownService().turndown(html), 'utf8');
  if (target === 'docx') {
    const document = textToDocx(extension === 'md' || extension === 'markdown' ? await fsp.readFile(input, 'utf8') : stripHtml(html));
    return fsp.writeFile(output, await Packer.toBuffer(document));
  }
  if (target === 'pdf') return helpers.renderHtmlToPdf(documentHtml(path.basename(input), html), output);
  throw new Error(`不支持的文档转换：${extension} → ${target}`);
}

async function convertOne(input, output, target, options, helpers) {
  const category = categoryOf(extensionOf(input));
  if (category === 'image' && IMAGE_TARGETS.includes(target)) return convertImage(input, output, target, options);
  if (category === 'image' || category === 'audio' || category === 'video') return convertMedia(input, output, target, options);
  if (category === 'document') return convertDocument(input, output, target, options, helpers);
  throw new Error(`不支持的输入格式：${extensionOf(input) || '未知'}`);
}

async function convertBatch(payload, helpers) {
  const reportProgress = typeof helpers?.onProgress === 'function' ? helpers.onProgress : () => {};
  const paths = Array.isArray(payload?.paths) ? payload.paths.map(item => path.resolve(String(item))) : [];
  const target = String(payload?.target || '').toLowerCase();
  const outputDir = path.resolve(String(payload?.outputDir || ''));
  const options = payload?.options || {};
  if (!paths.length) throw new Error('请先选择文件。');
  if (!target) throw new Error('请选择目标格式。');
  const outputStats = await fsp.stat(outputDir);
  if (!outputStats.isDirectory()) throw new Error('输出位置不是文件夹。');
  const inspected = await inspectFiles(paths);
  if (!inspected.commonTargets.includes(target)) throw new Error('所选文件不能共同转换为该格式。');

  const results = [];
  for (let index = 0; index < paths.length; index += 1) {
    const input = paths[index];
    const output = await uniqueOutputPath(outputDir, input, target);
    reportProgress({ index, total: paths.length, percent: Math.round((index / paths.length) * 100), name: path.basename(input), state: 'converting' });
    try {
      await convertOne(input, output, target, options, helpers);
      results.push({ input, output, success: true });
    } catch (error) {
      results.push({ input, output: null, success: false, error: error.message });
    }
    reportProgress({ index: index + 1, total: paths.length, percent: Math.round(((index + 1) / paths.length) * 100), name: path.basename(input), state: 'done' });
  }
  return { results, successCount: results.filter(item => item.success).length, failureCount: results.filter(item => !item.success).length };
}

module.exports = {
  DOCUMENT_INPUTS,
  MEDIA_INPUTS,
  categoryOf,
  extensionOf,
  getEngineStatus,
  inspectFiles,
  targetsFor,
  convertBatch,
  convertImage,
  convertMedia,
};
