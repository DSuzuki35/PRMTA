# Contributing

PRMTA is licensed under MIT. Third-party components and model weights retain their own licenses. Discuss substantial contributions with the maintainer.

Use Node.js 24 and the setup instructions in docs/ARCHITECTURE.md. Keep user-facing text and documentation in English, while preserving multilingual script content. Follow the Dan Suzuki UI Kit tokens in src/theme.css. Keep the output profiles independent and preserve compatibility with existing TXT/JSON revisions.

For changes affecting playback, saving, cloud reconciliation, authentication, models or microphone lifecycle, add a meaningful regression test. Run npm run build, npm test and npm run test:e2e. Native display, microphone or shutdown changes should also run the applicable Electron smoke script. Describe exactly which physical hardware you tested.

Do not commit scripts from a real library, cloud-folder contents, bearer links, API keys, local review logs, node_modules, downloaded models or build artifacts. Screenshots should use synthetic sample scripts and hide access links and machine-specific paths.

A pull request should explain the concrete problem, resulting behavior, tests run and remaining limits. Avoid claims about headset support or model speed that have not been measured.
