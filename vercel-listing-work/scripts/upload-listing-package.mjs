import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { put } from '@vercel/blob';

function env(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => { const index = line.indexOf('='); return [line.slice(0, index).trim(), line.slice(index + 1).trim()]; }));
}

const [manifestFile, imageDirectory] = process.argv.slice(2);
if (!manifestFile || !imageDirectory) throw new Error('사용법: node scripts/upload-listing-package.mjs <manifest.json> <완성본 폴더>');
const appRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appRoot, '..');
const blobEnv = env(await readFile(path.join(appRoot, '.env.local'), 'utf8'));
const automationEnv = env(await readFile(path.join(repoRoot, '.env.automation.local'), 'utf8'));
const draft = JSON.parse(await readFile(path.resolve(manifestFile), 'utf8'));
const escapedPart = draft.partNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const names = (await readdir(path.resolve(imageDirectory))).filter((name) => name.endsWith('.png') && (name === `${draft.partNumber}.png` || new RegExp(`^${escapedPart}_\\d+\\.png$`).test(name)))
  .sort((a, b) => a === `${draft.partNumber}.png` ? -1 : b === `${draft.partNumber}.png` ? 1 : Number(a.match(/_(\d+)\.png$/)?.[1]) - Number(b.match(/_(\d+)\.png$/)?.[1]));
if (!names.length) throw new Error('완성 사진을 찾지 못했습니다.');
const images = [];
for (let index = 0; index < names.length; index += 1) {
  const expected = index === 0 ? `${draft.partNumber}.png` : `${draft.partNumber}_${index}.png`;
  if (names[index] !== expected) throw new Error(`사진 순서가 연속되지 않습니다: ${names[index]} (예상 ${expected})`);
  const bytes = await readFile(path.join(path.resolve(imageDirectory), names[index]));
  const blob = await put(`listing-packages/${draft.date}/${draft.itemId}/images/${names[index]}`, bytes, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'image/png', token: blobEnv.BLOB_READ_WRITE_TOKEN });
  images.push({ pathname: blob.pathname, url: blob.url, filename: names[index], size: bytes.byteLength });
}
const pkg = { ...draft, version: 1, images, preparedAt: new Date().toISOString() };
const response = await fetch(`${automationEnv.AUTOMATION_APP_URL.replace(/\/$/, '')}/api/automation/package`, { method: 'PUT', headers: { authorization: `Bearer ${automationEnv.AUTOMATION_ADMIN_SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify(pkg) });
const result = await response.text();
if (!response.ok) throw new Error(`등록 패키지 저장 실패 (${response.status}): ${result}`);
console.log(result);
