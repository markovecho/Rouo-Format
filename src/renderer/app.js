const $ = selector => document.querySelector(selector);

const config = {
  media: { eyebrow: 'MEDIA CONVERSION', headline: '把声音和画面<br>拖给它。', feed: '拖入图片、音频或视频', dog: '../../assets/02b-dog-black-transparent.png', dogClass: 'black-dog', formats: ['MP4', 'MP3', 'WAV', 'PNG', 'JPG', 'WEBP'], handoff: '文档请切换到「文档」处理。' },
  doc: { eyebrow: 'DOCUMENT CONVERSION', headline: '把文字和纸张<br>拖给它。', feed: '拖入文档、表格或 PDF', dog: '../../assets/01b-dog-white-transparent.png', dogClass: 'white-dog', formats: ['PDF', 'DOCX', 'XLSX', 'MD', 'TXT'], handoff: '图片、音频和视频请切换到「媒体」处理。' },
};

let state = { mode: 'media', paths: [], files: [], targets: [], outputDir: '', running: false, results: [] };
const mediaTargets = new Set(['mp4', 'webm', 'mkv', 'mov', 'gif']);
const imageTargets = new Set(['png', 'jpg', 'webp', 'avif', 'tiff']);

function setStatus(message, ready = 'READY') { $('#status').textContent = message; $('#ready').textContent = ready; }
function friendlySize(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function resetFiles() { state = { ...state, paths: [], files: [], targets: [], results: [] }; $('#empty').classList.remove('hidden'); $('#details').classList.add('hidden'); $('#convert').disabled = true; $('#convert').textContent = '开始转换'; $('#bar').style.setProperty('--p', '0%'); setStatus('文件不会上传到云端。'); }
function updateTargetOptions(targets) { $('#target').replaceChildren(...targets.map(value => { const option = document.createElement('option'); option.value = value; option.textContent = value.toUpperCase(); return option; })); }
function updateControls() { const target = $('#target').value; const allImages = state.files.length > 0 && state.files.every(file => file.category === 'image'); $('#quality-field').classList.toggle('hidden', !(allImages && imageTargets.has(target))); $('#codec-field').classList.toggle('hidden', !mediaTargets.has(target)); $('#convert').disabled = !state.paths.length || !target || !state.outputDir || state.running; }
function setMode(mode) { if (state.running || mode === state.mode) return; state = { ...state, mode }; const current = config[mode]; document.body.classList.toggle('doc-mode', mode === 'doc'); document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === mode)); $('#eyebrow').textContent = current.eyebrow; $('#headline').innerHTML = current.headline; $('#feed-title').textContent = current.feed; $('#dog').src = current.dog; $('#dog').className = current.dogClass; $('#dog').alt = mode === 'doc' ? '文档转换' : '媒体转换'; $('#formats').replaceChildren(...current.formats.map(value => { const node = document.createElement('b'); node.textContent = value; return node; })); $('#handoff').textContent = current.handoff; resetFiles(); }
async function inspect(paths) { if (!paths.length) return; try { const data = await window.rouo.inspectFiles(paths); const invalid = data.files.filter(file => file.category === 'unsupported'); if (invalid.length) throw new Error(`不支持：${invalid.map(file => file.name).join('、')}`); if (!data.commonTargets.length) throw new Error('这些文件没有共同的可转换格式。请分开处理。'); state = { ...state, paths, files: data.files, targets: data.commonTargets }; $('#file-name').textContent = data.files.length === 1 ? data.files[0].name : `${data.files.length} 个文件`; $('#file-meta').textContent = `${data.files.map(file => file.extension.toUpperCase()).join(' · ')} · ${friendlySize(data.files.reduce((sum, file) => sum + file.size, 0))} · 本地处理`; updateTargetOptions(data.commonTargets); $('#empty').classList.add('hidden'); $('#details').classList.remove('hidden'); $('#bar').style.setProperty('--p', '0%'); setStatus(state.outputDir ? '已识别，选择目标格式后即可开始。' : '已识别，请选择输出文件夹。'); updateControls(); } catch (error) { resetFiles(); setStatus(error.message || '无法读取文件。', 'ERROR'); } }
async function chooseFiles() { const paths = await window.rouo.chooseFiles(state.mode); await inspect(paths); }
async function loadDropped(files) { const paths = [...files].map(file => window.rouo.getPathForFile(file)).filter(Boolean); await inspect(paths); }
async function chooseOutput() { const outputDir = await window.rouo.chooseOutput(); if (!outputDir) return; state = { ...state, outputDir }; $('#output-path').textContent = outputDir; setStatus(state.paths.length ? '输出位置已选择，可以开始转换。' : '输出位置已选择。'); updateControls(); }
async function convert() { if (state.running) return; if (state.results.length) { const first = state.results.find(result => result.success); if (first) await window.rouo.revealOutput(first.output); return; } state = { ...state, running: true }; $('#convert').disabled = true; $('#convert').textContent = '转换中…'; setStatus('正在转换，请保持窗口开启。', 'WORKING'); try { const result = await window.rouo.convert({ paths: state.paths, target: $('#target').value, outputDir: state.outputDir, options: { quality: Number($('#quality').value), codec: $('#codec').value } }); state = { ...state, running: false, results: result.results }; const note = result.failureCount ? `完成 ${result.successCount} 个，失败 ${result.failureCount} 个。` : `已完成 ${result.successCount} 个文件。`; setStatus(note, result.failureCount ? 'CHECK' : 'DONE'); $('#convert').textContent = result.successCount ? '定位结果' : '开始转换'; $('#convert').disabled = result.successCount === 0; } catch (error) { state = { ...state, running: false }; setStatus(error.message || '转换失败。', 'ERROR'); $('#convert').textContent = '开始转换'; updateControls(); } }

document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
$('#feed').addEventListener('click', chooseFiles);
$('#file').addEventListener('change', event => loadDropped(event.target.files));
$('#feed').addEventListener('dragover', event => { event.preventDefault(); $('#feed').classList.add('dragging'); });
$('#feed').addEventListener('dragleave', () => $('#feed').classList.remove('dragging'));
$('#feed').addEventListener('drop', event => { event.preventDefault(); $('#feed').classList.remove('dragging'); loadDropped(event.dataTransfer.files); });
$('#choose-output').addEventListener('click', chooseOutput);
$('#clear-files').addEventListener('click', resetFiles);
$('#target').addEventListener('change', updateControls);
$('#quality').addEventListener('input', event => { $('#quality-value').textContent = event.target.value; });
$('#convert').addEventListener('click', convert);
window.rouo.onProgress(progress => { $('#bar').style.setProperty('--p', `${progress.percent}%`); setStatus(`${progress.state === 'converting' ? '正在转换' : '已完成'} ${progress.index}/${progress.total} · ${progress.name}`, progress.state === 'converting' ? 'WORKING' : 'WORKING'); });
setMode('media');
