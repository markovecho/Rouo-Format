<p align="center">
  <img src="assets/rouo-icon.png" width="96" alt="Rouo Format">
</p>

<h1 align="center">Rouo Format</h1>

<p align="center">简约、安全、完全本地运行的 Windows 文档与媒体格式转换工具。</p>

## 功能

- 文档与媒体双模式，支持拖放、批量转换和输出目录选择。
- 图片：PNG、JPG、WebP、AVIF、TIFF 等格式互转，可调节质量。
- 音频：MP3、WAV、FLAC、M4A、AAC、OGG、OPUS 等格式互转。
- 视频：MP4、WebM、MKV、MOV、GIF，并可从视频导出音频。
- 文档：TXT、Markdown、HTML、DOCX、CSV、XLSX 和 PDF 的常用转换。
- PDF 导出：DOC、DOCX、ODT、RTF、WPS、WPT、WPD、PPT、PPTX、XLSX、ODS、ODP 等可转 PDF。
- 文件只在本机处理，不上传云端。

## 使用

在仓库的 [Releases](https://github.com/markovecho/Rouo-Format/releases) 页面下载：

- `Rouo-Format-Portable`：便携版，直接运行。
- `Rouo-Format-Setup`：安装版，可创建桌面快捷方式。

传统 Office 文档转 PDF 需要本机安装 [LibreOffice](https://www.libreoffice.org/)。OFD 与扫描 PDF OCR 暂未支持。

## 本地开发

需要 Node.js 22 或更高版本，以及 pnpm。

```bash
pnpm install
pnpm start
```

运行测试：

```bash
pnpm test
```

构建 Windows 版本：

```bash
pnpm dist
```

## 技术栈

Electron、Sharp、FFmpeg、Mammoth、ExcelJS、docx、PDF.js、Markdown-It 与 Turndown。

## 隐私

Rouo Format 不会将待转换文件发送到服务器。所有转换均在用户自己的电脑上完成。
