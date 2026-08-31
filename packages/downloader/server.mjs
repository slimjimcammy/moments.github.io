import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const PORT = 8765;
const DOWNLOAD_DIR = path.join(homedir(), 'Downloads', 'Moments');

await mkdir(DOWNLOAD_DIR, { recursive: true });

function setCorsHeaders(res) {
  res.setHeader(
    'Access-Control-Allow-Origin',
    'https://slimjimcammy.github.io',
  );
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, body) {
  setCorsHeaders(res);

  res.writeHead(status, {
    'Content-Type': 'application/json',
  });

  res.end(JSON.stringify(body));
}

function sanitizeFilename(note) {
  const cleaned = (note || 'clip')
    .slice(0, 50)
    .replace(/[\/\\?%*:|"<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || 'clip';
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function runYtDlp({ url, start, end, filename }) {
  const outputPath = path.join(DOWNLOAD_DIR, `${filename}.mp4`);

  const args = [
    '--download-sections',
    `*${formatTime(start)}-${formatTime(end)}`,
    '-f',
    'bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/bv*[vcodec^=avc1]+ba/b[ext=mp4]/best',
    '--merge-output-format',
    'mp4',
    '--force-keyframes-at-cuts',
    '-o',
    outputPath,
    url,
  ];

  console.log('\n========================================');
  console.log('[yt-dlp] Starting download');
  console.log('[yt-dlp] URL:', url);
  console.log('[yt-dlp] Start:', start);
  console.log('[yt-dlp] End:', end);
  console.log('[yt-dlp] Output:', outputPath);
  console.log('[yt-dlp] Command: yt-dlp', args.join(' '));
  console.log('========================================');

  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', args);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      process.stdout.write(`[yt-dlp stdout] ${text}`);
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      process.stderr.write(`[yt-dlp stderr] ${text}`);
    });

    child.on('error', (error) => {
      console.error('[yt-dlp] Process error:', error);

      reject(
        new Error(
          `Could not start yt-dlp. Make sure yt-dlp is installed and available in PATH. ${error.message}`,
        ),
      );
    });

    child.on('close', (code) => {
      console.log('[yt-dlp] Exit code:', code);

      if (code === 0) {
        console.log('[yt-dlp] Successfully downloaded:', outputPath);
        resolve(outputPath);
      } else {
        console.error('[yt-dlp] Download failed');
        console.error('[yt-dlp] stdout:', stdout);
        console.error('[yt-dlp] stderr:', stderr);

        reject(
          new Error(
            stderr || `yt-dlp exited with code ${code}`,
          ),
        );
      }
    });
  });
}

async function handleDownload(req, res) {
  let body = '';

  for await (const chunk of req) {
    body += chunk;
  }

  let payload;

  try {
    payload = JSON.parse(body);
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON' });
  }

  if (!Array.isArray(payload.clips) || payload.clips.length === 0) {
    return sendJson(res, 400, { error: 'No clips provided' });
  }

  const results = [];

  for (const clip of payload.clips) {
    try {
      const start = Number(clip.startSeconds);

      if (!Number.isFinite(start) || start < 0) {
        throw new Error('Invalid start timestamp');
      }

      const suppliedEnd = Number(clip.endSeconds);

      const end =
        Number.isFinite(suppliedEnd) && suppliedEnd > start
          ? suppliedEnd
          : start + 30;

      const filename = sanitizeFilename(clip.note);

      const outputPath = await runYtDlp({
        url: clip.youtubeUrl,
        start,
        end,
        filename,
      });

      results.push({
        id: clip.id,
        success: true,
        path: outputPath,
      });
    } catch (error) {
      results.push({
        id: clip.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return sendJson(res, 200, { results });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'POST' && req.url === '/download') {
    return handleDownload(req, res);
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Moments downloader running at http://127.0.0.1:${PORT}`);
  console.log(`Clips will be saved to ${DOWNLOAD_DIR}`);
});
