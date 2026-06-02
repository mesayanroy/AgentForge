const fs = require('fs');
const path = require('path');

function readVarUint(buffer, offset) {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  while (true) {
    const byte = buffer[offset + bytesRead];
    bytesRead++;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      break;
    }
    shift += 7;
  }
  return { value, bytesRead };
}

function writeVarUint(value) {
  const bytes = [];
  while (true) {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
    if (value === 0) {
      break;
    }
  }
  return Buffer.from(bytes);
}

function stripWasm(inputPath, outputPath) {
  const wasm = fs.readFileSync(inputPath);
  
  // Verify header
  if (wasm.readUInt32BE(0) !== 0x0061736d || wasm.readUInt32LE(4) !== 1) {
    throw new Error('Invalid WASM header');
  }
  
  const chunks = [wasm.subarray(0, 8)];
  let offset = 8;
  
  while (offset < wasm.length) {
    const sectionId = wasm[offset];
    offset += 1;
    
    const lenRes = readVarUint(wasm, offset);
    const sectionLen = lenRes.value;
    offset += lenRes.bytesRead;
    
    const sectionPayload = wasm.subarray(offset, offset + sectionLen);
    offset += sectionLen;
    
    if (sectionId === 0) {
      // Custom section — check if it is contractspec or contractenvmeta
      // The first part of custom section payload is the name of the section as a varuint length + string bytes
      const nameLenRes = readVarUint(sectionPayload, 0);
      const nameLen = nameLenRes.value;
      const name = sectionPayload.subarray(nameLenRes.bytesRead, nameLenRes.bytesRead + nameLen).toString('utf8');
      
      if (name === 'contractmetav0') {
        console.log(`Skipping custom section: "${name}" (${sectionLen} bytes)`);
        continue;
      }
    }
    
    // Write section ID
    chunks.push(Buffer.from([sectionId]));
    // Write section length
    chunks.push(writeVarUint(sectionLen));
    // Write payload
    chunks.push(sectionPayload);
  }
  
  const output = Buffer.concat(chunks);
  fs.writeFileSync(outputPath, output);
  console.log(`Stripped WASM written to: ${outputPath} (${output.length} bytes, was ${wasm.length} bytes)`);
}

const wasmPath = path.join(process.cwd(), 'contracts/target/wasm32-unknown-unknown/release/agent_wallet.optimized.wasm');
const strippedPath = path.join(process.cwd(), 'contracts/target/wasm32-unknown-unknown/release/agent_wallet.stripped.wasm');

stripWasm(wasmPath, strippedPath);
