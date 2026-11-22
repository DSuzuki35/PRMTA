import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function buildMacOSSpeech(arch = process.arch) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Native macOS speech supports arm64 or x64.');
  if (process.platform !== 'darwin') throw new Error('Build the Apple Speech helper on macOS with Xcode command line tools.');
  const directory = join(root, '.tools', 'system-speech', arch);
  mkdirSync(directory, { recursive: true });
  const output = join(directory, 'prmta-speech');
  const sdk = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' }).trim();
  execFileSync('xcrun', ['--sdk', 'macosx', 'swiftc', '-swift-version', '5', '-O', '-target', `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macos12.0`, '-sdk', sdk,
    '-framework', 'Speech', '-framework', 'AVFoundation',
    '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', join(root, 'scripts', 'system-speech-macos-Info.plist'),
    join(root, 'scripts', 'system-speech-macos.swift'), '-o', output], { stdio: 'inherit' });
  // Ad-hoc signing supports local builds. Distribution must replace this signature
  // with the application's Developer ID and sign this nested executable too.
  execFileSync('codesign', ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', join(root, 'scripts', 'system-speech-macos-entitlements.plist'), output], { stdio: 'inherit' });
  return output;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const index = process.argv.indexOf('--arch');
  console.log(buildMacOSSpeech(index < 0 ? process.arch : process.argv[index + 1]));
}
