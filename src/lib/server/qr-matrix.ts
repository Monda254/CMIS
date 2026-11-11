/**
 * Pure TypeScript ISO/IEC 18004 QR Code matrix generator (Byte mode, ECC Level M)
 * for server-side vector PDF rendering without native canvas dependencies.
 */

// GF(256) exponent & log tables (primitive polynomial 0x11d)
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    EXP[i] = EXP[i - 255]!;
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = EXP[i]!;
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]!;
      next[j + 1] ^= gfMul(poly[j]!, factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i]! ^ rem[0]!;
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    for (let j = 0; j < ecLen; j++) {
      rem[j] ^= gfMul(gen[j + 1]!, factor);
    }
  }
  return rem;
}

type VersionSpec = {
  version: number;
  totalDataBytes: number;
  ecBytesPerBlock: number;
  numBlocks1: number;
  dataPerBlock1: number;
  numBlocks2: number;
  dataPerBlock2: number;
  alignment: number[];
};

// Versions 1..6 (ECC Level L) — covers URLs up to 134 bytes
const VERSIONS_L: VersionSpec[] = [
  { version: 1, totalDataBytes: 19, ecBytesPerBlock: 7, numBlocks1: 1, dataPerBlock1: 19, numBlocks2: 0, dataPerBlock2: 0, alignment: [] },
  { version: 2, totalDataBytes: 34, ecBytesPerBlock: 10, numBlocks1: 1, dataPerBlock1: 34, numBlocks2: 0, dataPerBlock2: 0, alignment: [6, 18] },
  { version: 3, totalDataBytes: 55, ecBytesPerBlock: 15, numBlocks1: 1, dataPerBlock1: 55, numBlocks2: 0, dataPerBlock2: 0, alignment: [6, 22] },
  { version: 4, totalDataBytes: 80, ecBytesPerBlock: 20, numBlocks1: 1, dataPerBlock1: 80, numBlocks2: 0, dataPerBlock2: 0, alignment: [6, 26] },
  { version: 5, totalDataBytes: 108, ecBytesPerBlock: 26, numBlocks1: 1, dataPerBlock1: 108, numBlocks2: 0, dataPerBlock2: 0, alignment: [6, 30] },
  { version: 6, totalDataBytes: 136, ecBytesPerBlock: 18, numBlocks1: 2, dataPerBlock1: 68, numBlocks2: 0, dataPerBlock2: 0, alignment: [6, 34] },
];

export function encodeQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const spec = VERSIONS_L.find((v) => bytes.length + 3 <= v.totalDataBytes) ?? VERSIONS_L[VERSIONS_L.length - 1]!;
  const payload = bytes.slice(0, spec.totalDataBytes - 3);

  // Build bit stream: 4-bit mode (0100 = Byte), 8-bit length, payload bytes, terminator, pad bytes
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(payload.length, 8);
  for (const b of payload) pushBits(b, 8);
  const maxBits = spec.totalDataBytes * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataWords = new Uint8Array(spec.totalDataBytes);
  for (let i = 0; i < bits.length / 8; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b]!;
    dataWords[i] = byte;
  }
  const pads = [0xec, 0x11];
  for (let i = bits.length / 8, p = 0; i < spec.totalDataBytes; i++, p ^= 1) {
    dataWords[i] = pads[p]!;
  }

  // Split into blocks & compute Reed-Solomon EC
  const blocksData: Uint8Array[] = [];
  const blocksEc: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < spec.numBlocks1; i++) {
    const block = dataWords.slice(offset, offset + spec.dataPerBlock1);
    offset += spec.dataPerBlock1;
    blocksData.push(block);
    blocksEc.push(rsEncode(block, spec.ecBytesPerBlock));
  }
  for (let i = 0; i < spec.numBlocks2; i++) {
    const block = dataWords.slice(offset, offset + spec.dataPerBlock2);
    offset += spec.dataPerBlock2;
    blocksData.push(block);
    blocksEc.push(rsEncode(block, spec.ecBytesPerBlock));
  }

  const finalBytes: number[] = [];
  const maxDataLen = Math.max(spec.dataPerBlock1, spec.dataPerBlock2);
  for (let i = 0; i < maxDataLen; i++) {
    for (const b of blocksData) {
      if (i < b.length) finalBytes.push(b[i]!);
    }
  }
  for (let i = 0; i < spec.ecBytesPerBlock; i++) {
    for (const ec of blocksEc) {
      finalBytes.push(ec[i]!);
    }
  }

  const size = spec.version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));

  const setFunctionModule = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      modules[r]![c] = dark;
      isFunction[r]![c] = true;
    }
  };

  // Finder patterns + separators
  const drawFinder = (r0: number, c0: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r0 + dr;
        const cc = c0 + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(rr, cc, inOuter && (onBorder || inInner));
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const align = spec.alignment;
  for (const r of align) {
    for (const c of align) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunctionModule(r + dr, c + dc, dark);
        }
      }
    }
  }

  // Reserve format info areas & dark module
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      isFunction[8]![i] = true;
      isFunction[i]![8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    isFunction[8]![size - 1 - i] = true;
    isFunction[size - 1 - i]![8] = true;
  }
  setFunctionModule(size - 8, 8, true);

  // Place data bits in upward/downward 2-column zigzags
  let bitIdx = 0;
  const totalBits = finalBytes.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!isFunction[r]![c]) {
          let dark = false;
          if (bitIdx < totalBits) {
            dark = ((finalBytes[bitIdx >>> 3]! >>> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          // Mask 0: (r + c) % 2 === 0
          if ((r + c) % 2 === 0) dark = !dark;
          modules[r]![c] = dark;
        }
      }
    }
  }

  // Format information for ECC Level L (01) + Mask 0 (000) -> 0x77c4
  const formatBits = 0x77c4;
  for (let i = 0; i <= 5; i++) setFunctionModule(8, i, ((formatBits >>> i) & 1) === 1);
  setFunctionModule(8, 7, ((formatBits >>> 6) & 1) === 1);
  setFunctionModule(8, 8, ((formatBits >>> 7) & 1) === 1);
  setFunctionModule(7, 8, ((formatBits >>> 8) & 1) === 1);
  for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, ((formatBits >>> i) & 1) === 1);

  for (let i = 0; i < 8; i++) setFunctionModule(size - 1 - i, 8, ((formatBits >>> i) & 1) === 1);
  for (let i = 8; i < 15; i++) setFunctionModule(8, size - 15 + i, ((formatBits >>> i) & 1) === 1);

  return modules;
}
