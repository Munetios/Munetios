const gfExp = new Uint8Array(512);
const gfLog = new Uint8Array(256);
let value = 1;
for (let index = 0; index < 255; index += 1) {
  gfExp[index] = value;
  gfLog[value] = index;
  value <<= 1;
  if (value & 0x100) value ^= 0x11d;
}
for (let index = 255; index < 512; index += 1) {
  gfExp[index] = gfExp[index - 255];
}

function multiply(left, right) {
  return left && right ? gfExp[gfLog[left] + gfLog[right]] : 0;
}

function generatorPolynomial(degree) {
  let polynomial = [1];
  for (let index = 0; index < degree; index += 1) {
    const next = new Array(polynomial.length + 1).fill(0);
    for (let term = 0; term < polynomial.length; term += 1) {
      next[term] ^= polynomial[term];
      next[term + 1] ^= multiply(polynomial[term], gfExp[index]);
    }
    polynomial = next;
  }
  return polynomial;
}

function errorCorrection(data, degree) {
  const generator = generatorPolynomial(degree);
  const result = [...data, ...new Array(degree).fill(0)];
  for (let index = 0; index < data.length; index += 1) {
    const coefficient = result[index];
    if (!coefficient) continue;
    for (let term = 0; term < generator.length; term += 1) {
      result[index + term] ^= multiply(generator[term], coefficient);
    }
  }
  return result.slice(data.length);
}

function appendBits(bits, number, length) {
  for (let index = length - 1; index >= 0; index -= 1) {
    bits.push((number >>> index) & 1);
  }
}

function buildCodewords(text) {
  const bytes = [...new TextEncoder().encode(text)];
  if (bytes.length > 271) throw new Error("qr_data_too_long");
  const bits = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 16);
  for (const byte of bytes) appendBits(bits, byte, 8);
  appendBits(bits, 0, Math.min(4, 274 * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let index = 0; index < bits.length; index += 8) {
    data.push(
      bits.slice(index, index + 8).reduce((byte, bit) => (byte << 1) | bit, 0),
    );
  }
  let pad = 0xec;
  while (data.length < 274) {
    data.push(pad);
    pad = pad === 0xec ? 0x11 : 0xec;
  }

  const blocks = [];
  let offset = 0;
  for (const length of [68, 68, 69, 69]) {
    const block = data.slice(offset, offset + length);
    blocks.push({ data: block, error: errorCorrection(block, 18) });
    offset += length;
  }
  const codewords = [];
  for (let index = 0; index < 69; index += 1) {
    for (const block of blocks) {
      if (index < block.data.length) codewords.push(block.data[index]);
    }
  }
  for (let index = 0; index < 18; index += 1) {
    for (const block of blocks) codewords.push(block.error[index]);
  }
  return codewords;
}

function bchRemainder(value, polynomial) {
  const polynomialDegree = Math.floor(Math.log2(polynomial));
  while (value && Math.floor(Math.log2(value)) >= polynomialDegree) {
    value ^= polynomial << (Math.floor(Math.log2(value)) - polynomialDegree);
  }
  return value;
}

function createMatrix(codewords) {
  const version = 10;
  const size = 57;
  const modules = Array.from({ length: size }, () =>
    new Array(size).fill(false),
  );
  const reserved = Array.from({ length: size }, () =>
    new Array(size).fill(false),
  );
  const set = (row, column, dark, reserve = true) => {
    if (row < 0 || column < 0 || row >= size || column >= size) return;
    modules[row][column] = dark;
    if (reserve) reserved[row][column] = true;
  };

  const finder = (top, left) => {
    for (let row = -1; row <= 7; row += 1) {
      for (let column = -1; column <= 7; column += 1) {
        const inside = row >= 0 && row <= 6 && column >= 0 && column <= 6;
        const dark =
          inside &&
          (row === 0 ||
            row === 6 ||
            column === 0 ||
            column === 6 ||
            (row >= 2 && row <= 4 && column >= 2 && column <= 4));
        set(top + row, left + column, dark);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  for (let index = 8; index < size - 8; index += 1) {
    set(6, index, index % 2 === 0);
    set(index, 6, index % 2 === 0);
  }

  for (const row of [6, 28, 50]) {
    for (const column of [6, 28, 50]) {
      if (reserved[row][column]) continue;
      for (let y = -2; y <= 2; y += 1) {
        for (let x = -2; x <= 2; x += 1) {
          set(row + y, column + x, Math.max(Math.abs(x), Math.abs(y)) !== 1);
        }
      }
    }
  }

  for (let index = 0; index < 9; index += 1) {
    if (index !== 6) {
      set(8, index, false);
      set(index, 8, false);
    }
  }
  for (let index = 0; index < 8; index += 1) {
    set(8, size - 1 - index, false);
    set(size - 1 - index, 8, false);
  }
  set(size - 8, 8, true);

  const versionBits = (version << 12) | bchRemainder(version << 12, 0x1f25);
  for (let index = 0; index < 18; index += 1) {
    const dark = ((versionBits >>> index) & 1) === 1;
    const row = Math.floor(index / 3);
    const column = (index % 3) + size - 11;
    set(row, column, dark);
    set(column, row, dark);
  }

  const dataBits = [];
  for (const codeword of codewords) appendBits(dataBits, codeword, 8);
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vertical = 0; vertical < size; vertical += 1) {
      const row = upward ? size - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const column = right - offset;
        if (reserved[row][column]) continue;
        const bit = dataBits[bitIndex] || 0;
        bitIndex += 1;
        modules[row][column] = Boolean(bit ^ ((row + column) % 2 === 0));
      }
    }
    upward = !upward;
  }

  const formatData = 0b01 << 3;
  const formatBits =
    ((formatData << 10) | bchRemainder(formatData << 10, 0x537)) ^ 0x5412;
  const first = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];
  const second = [
    [size - 1, 8],
    [size - 2, 8],
    [size - 3, 8],
    [size - 4, 8],
    [size - 5, 8],
    [size - 6, 8],
    [size - 7, 8],
    [8, size - 8],
    [8, size - 7],
    [8, size - 6],
    [8, size - 5],
    [8, size - 4],
    [8, size - 3],
    [8, size - 2],
    [8, size - 1],
  ];
  for (let index = 0; index < 15; index += 1) {
    const dark = ((formatBits >>> index) & 1) === 1;
    set(first[index][0], first[index][1], dark);
    set(second[index][0], second[index][1], dark);
  }
  return modules;
}

export function createQrCodeSvg(text, { foreground = "#111111" } = {}) {
  const matrix = createMatrix(buildCodewords(String(text)));
  const quietZone = 4;
  const size = matrix.length + quietZone * 2;
  const path = [];
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column < matrix.length; column += 1) {
      if (matrix[row][column]) {
        path.push(`M${column + quietZone} ${row + quietZone}h1v1h-1z`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path.join("")}" fill="${foreground}"/></svg>`;
}
