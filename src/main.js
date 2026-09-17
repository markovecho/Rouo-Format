const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const engine = require('./conversion-engine');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 700,
    backgroundColor: '#090909',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'rouo-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
}

function filtersForMode(mode) {
  if (mode === 'doc') {
    return [{ name: '文档', extensions: engine.DOCUMENT_INPUTS }];
  }
  return [{ name: '图片、音频和视频', extensions: engine.MEDIA_INPUTS }];
}

async function renderHtmlToPdf(html, outputPath) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rouo-format-'));
  const htmlPath = path.join(tempRoot, 'document.html');
  await fs.writeFile(htmlPath, html, 'utf8');
  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  try {
    await pdfWindow.loadURL(pathToFileURL(htmlPath).href);
    const data = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.5, bottom: 0.5, left: 0.55, right: 0.55 },
    });
    await fs.writeFile(outputPath, data);
  } finally {
    if (!pdfWindow.isDestroyed()) pdfWindow.destroy();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function registerIpc() {
  ipcMain.handle('app:info', async () => ({
    version: app.getVersion(),
    engines: engine.getEngineStatus(),
  }));

  ipcMain.handle('files:choose', async (_event, mode) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: mode === 'doc' ? '选择文档' : '选择媒体文件',
      properties: ['openFile', 'multiSelections'],
      filters: filtersForMode(mode),
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('output:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择输出文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('files:inspect', async (_event, paths) => engine.inspectFiles(paths));

  ipcMain.handle('conversion:run', async (event, payload) => {
    return engine.convertBatch(payload, {
      renderHtmlToPdf,
      onProgress(progress) {
        if (!event.sender.isDestroyed()) event.sender.send('conversion:progress', progress);
      },
    });
  });

  ipcMain.handle('output:reveal', async (_event, filePath) => {
    if (typeof filePath !== 'string') return false;
    shell.showItemInFolder(path.resolve(filePath));
    return true;
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

