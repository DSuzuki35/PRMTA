// HTTP Fetch rejects these reserved ports: https://fetch.spec.whatwg.org/#port-blocking
const blockedPorts = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995,
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

export function whisperEndpoint(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Enter a local HTTP Whisper address with a port from 1 to 65535.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error('Whisper requires a local HTTP address, e.g. http://127.0.0.1:8080.');
  }
  if (Number(url.port || 80) < 1) throw new Error('Whisper port must be from 1 to 65535.');
  if (blockedPorts.has(Number(url.port || 80))) throw new Error(`Whisper port ${url.port} is reserved and cannot be used for HTTP. Choose another port, such as 18080.`);
  return url;
}

export function isManagedWhisperUrl(value: string): boolean {
  try { return whisperEndpoint(value).hostname === '127.0.0.1'; } catch { return false; }
}
