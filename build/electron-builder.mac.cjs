const { build: base } = require('../package.json');
const { Arch } = require('builder-util');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');

const signed = process.env.PRMTA_MAC_SIGNED === '1';
const resources = (base.extraResources || []).filter(resource => typeof resource === 'string' || !['whisper', 'parakeet', 'system-speech'].includes(resource.to));

module.exports = {
  ...base,
  directories: { ...base.directories, output: 'release-macos' },
  // SDL background input is Windows-only. Do not ship a host-architecture native
  // module in the other Mac architecture; foreground browser input remains usable.
  files: [...base.files, '!node_modules/@kmamal/sdl/**/*'],
  asarUnpack: (base.asarUnpack || []).filter(pattern => !pattern.includes('@kmamal/sdl')),
  extraResources: [...resources, {
    from: '.tools/system-speech/${arch}', to: 'system-speech', filter: ['prmta-speech'],
  }],
  npmRebuild: false,
  publish: null,
  forceCodeSigning: signed,
  beforePack: async context => {
    const arch = Arch[context.arch];
    const { buildMacOSSpeech } = await import(pathToFileURL(resolve(__dirname, '../scripts/build-macos-speech.mjs')).href);
    buildMacOSSpeech(arch);
  },
  mac: {
    target: ['dmg', 'zip'],
    artifactName: 'PRMTA-${version}-macOS-${arch}.${ext}',
    category: 'public.app-category.productivity',
    minimumSystemVersion: '13.0',
    identity: signed ? undefined : '-',
    hardenedRuntime: signed,
    notarize: signed,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    binaries: ['Contents/Resources/system-speech/prmta-speech'],
    extendInfo: {
      NSMicrophoneUsageDescription: 'PRMTA uses your microphone to follow your script and recognize voice commands when you connect it.',
      NSSpeechRecognitionUsageDescription: 'PRMTA uses on-device speech recognition to follow your script and recognize voice commands. Audio stays on your Mac.',
    },
  },
};
