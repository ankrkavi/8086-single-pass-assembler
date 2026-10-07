/**
 * 8086 Single Pass Assembler - Educational PBL Implementation
 * Strict Architectural Implementation & Full Test Bench Validation
 * 
 * Features:
 * - Line-by-line single-pass translation
 * - Location Counter (LC) tracking
 * - Real 8086 machine code encodings for educational subset
 * - Complete Symbol Table with status, line definition, and reference tracking
 * - Explicit Forward Reference Table with patch addresses & displacement formulas
 * - Dynamic Backpatching in memory buffer upon label definition
 * - Multi-label support on single lines (e.g. L1: L2: MOV AX, BX)
 * - Quote-aware comment stripping
 * - Strict error detection: syntax, duplicate labels, invalid mnemonics, invalid registers,
 *   invalid hex/binary numbers, operand count/size mismatches, undefined symbols at EOF/END.
 */

// ==========================================
// 1. 8086 ARCHITECTURE TABLES & CONSTANTS
// ==========================================

const REGISTERS_16 = {
  'AX': 0b000,
  'CX': 0b001,
  'DX': 0b010,
  'BX': 0b011,
  'SP': 0b100,
  'BP': 0b101,
  'SI': 0b110,
  'DI': 0b111
};

const REGISTERS_8 = {
  'AL': 0b000,
  'CL': 0b001,
  'DL': 0b010,
  'BL': 0b011,
  'AH': 0b100,
  'CH': 0b101,
  'DH': 0b110,
  'BH': 0b111
};

const RESERVED_WORDS = new Set([
  'MOV', 'ADD', 'SUB', 'INC', 'DEC', 'CMP', 'JMP', 'JE', 'JNE', 'HLT',
  'AX', 'BX', 'CX', 'DX', 'SP', 'BP', 'SI', 'DI',
  'AL', 'BL', 'CL', 'DL', 'AH', 'BH', 'CH', 'DH'
]);

// ==========================================
// 2. HELPER UTILITIES & NUMBER VALIDATION
// ==========================================

function toHex(value, digits = 4) {
  if (value === undefined || value === null || isNaN(value)) return '????';
  let hex = (value >>> 0).toString(16).toUpperCase();
  if (hex.length < digits) {
    hex = '0'.repeat(digits - hex.length) + hex;
  } else if (hex.length > digits) {
    hex = hex.slice(-digits);
  }
  return hex + 'H';
}

function byteToHex(b) {
  let hex = (b & 0xFF).toString(16).toUpperCase();
  return hex.length === 1 ? '0' + hex : hex;
}

function isRegister16(name) {
  return typeof name === 'string' && REGISTERS_16.hasOwnProperty(name.toUpperCase());
}

function isRegister8(name) {
  return typeof name === 'string' && REGISTERS_8.hasOwnProperty(name.toUpperCase());
}

function isRegister(name) {
  return isRegister16(name) || isRegister8(name);
}

function isValidSymbolName(name) {
  if (!name || typeof name !== 'string') return false;
  const upper = name.toUpperCase();
  if (RESERVED_WORDS.has(upper)) return false;
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Validates numeric operand syntax.
 * Catches invalid hex numbers like '12GH', 'FFGH', '0x12G', invalid binary like '102B',
 * while correctly parsing valid numbers.
 */
function validateNumericToken(token) {
  if (!token) return { isNumber: false, valid: false, error: 'Empty operand' };
  token = token.trim();

  // If token is a register, it is not a numeric literal
  if (isRegister(token)) {
    return { isNumber: false, isRegister: true };
  }

  // Hexadecimal ending with H or h (e.g. 05H, 1000H, FFH, 0AH)
  if (/^[0-9A-Za-z]+[Hh]$/.test(token)) {
    const body = token.slice(0, -1);
    const invalidCharMatch = body.match(/[^0-9A-Fa-f]/);
    if (invalidCharMatch) {
      return {
        isNumber: true,
        valid: false,
        error: `Invalid hexadecimal literal '${token}': illegal character '${invalidCharMatch[0]}' (hex digits must be 0-9, A-F)`
      };
    }
    return { isNumber: true, valid: true, value: parseInt(body, 16) };
  }

  // Hexadecimal starting with 0x (e.g. 0x1F, 0x1000)
  if (/^0x/i.test(token)) {
    const body = token.slice(2);
    if (!body) {
      return { isNumber: true, valid: false, error: `Invalid hexadecimal literal '${token}': missing digits after '0x'` };
    }
    const invalidCharMatch = body.match(/[^0-9A-Fa-f]/);
    if (invalidCharMatch) {
      return {
        isNumber: true,
        valid: false,
        error: `Invalid hexadecimal literal '${token}': illegal character '${invalidCharMatch[0]}'`
      };
    }
    return { isNumber: true, valid: true, value: parseInt(body, 16) };
  }

  // Binary ending with B or b (e.g. 1010B, 01B) - must start with digit
  if (/^[0-9][0-9A-Za-z]*[Bb]$/.test(token)) {
    const body = token.slice(0, -1);
    const invalidBinMatch = body.match(/[^01]/);
    if (invalidBinMatch) {
      return {
        isNumber: true,
        valid: false,
        error: `Invalid binary literal '${token}': illegal digit '${invalidBinMatch[0]}' (binary digits must be 0 or 1)`
      };
    }
    return { isNumber: true, valid: true, value: parseInt(body, 2) };
  }

  // Decimal number
  if (/^-?[0-9]+$/.test(token)) {
    return { isNumber: true, valid: true, value: parseInt(token, 10) };
  }

  // Starts with digit but contains invalid letters (e.g. 123XYZ)
  if (/^[0-9]+[a-zA-Z]+/.test(token)) {
    return {
      isNumber: true,
      valid: false,
      error: `Invalid numeric literal '${token}': contains illegal trailing characters`
    };
  }

  // ASCII character literal (e.g. 'A' or "A")
  if ((token.startsWith("'") && token.endsWith("'") && token.length === 3) ||
      (token.startsWith('"') && token.endsWith('"') && token.length === 3)) {
    return { isNumber: true, valid: true, value: token.charCodeAt(1) };
  }

  return { isNumber: false };
}

function parseNumber(token) {
  const result = validateNumericToken(token);
  if (result.isNumber) {
    if (!result.valid) {
      throw new Error(result.error);
    }
    return result.value;
  }
  return null;
}

// ==========================================
// 3. CORE SINGLE-PASS ASSEMBLER CLASS
// ==========================================

class SinglePassAssembler {
  constructor() {
    this.reset();
  }

  reset() {
    this.sourceLines = [];
    this.currentLineIndex = 0;
    this.locationCounter = 0x1000;
    this.startAddress = 0x1000;
    
    // Symbol Table: Map<name, { symbol, address, defined, lineDefined, references, type }>
    this.symbolTable = new Map();
    
    // Forward Reference Table: Array of fixup objects
    this.forwardRefTable = [];
    this.nextRefId = 1;
    
    // Location Counter Table for display & object code mapping
    this.lcTable = [];
    
    // Assembly Trace Log
    this.traceLog = [];
    
    // In-memory machine code buffer: Map<address, byte>
    this.memoryBuffer = new Map();
    
    // Errors encountered
    this.errors = [];
    this.isFinished = false;
    this.hasEnded = false;
  }

  loadSource(code) {
    this.reset();
    const rawLines = code.split(/\r?\n/);
    this.sourceLines = rawLines.map((line, idx) => ({
      raw: line,
      lineNum: idx + 1,
      clean: this.stripComment(line).trim()
    }));
    this.addTrace('info', 0, 'INITIALIZE', `Single Pass Assembler initialized. Initial LC = ${toHex(this.locationCounter)}`);
  }

  /**
   * Quote-aware comment stripping: semicolons inside quotes are preserved as string literals.
   */
  stripComment(line) {
    let inSingleQuote = false;
    let inDoubleQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
      else if (ch === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote;
      else if (ch === ';' && !inSingleQuote && !inDoubleQuote) {
        return line.slice(0, i);
      }
    }
    return line;
  }

  addTrace(type, lineNum, action, message, explanation = '') {
    this.traceLog.push({
      type,
      lineNum,
      action,
      message,
      explanation
    });
  }

  step() {
    if (this.isFinished || this.errors.length > 0) {
      return false;
    }

    if (this.currentLineIndex >= this.sourceLines.length) {
      this.finalize();
      return false;
    }

    const currentLine = this.sourceLines[this.currentLineIndex];
    this.currentLineIndex++;

    const text = currentLine.clean;
    if (!text) {
      // Empty line or comment-only line: valid, advance to next line
      return true;
    }

    try {
      this.processLine(currentLine.lineNum, text, currentLine.raw);
    } catch (err) {
      this.errors.push({
        line: currentLine.lineNum,
        message: err.message
      });
      this.addTrace('error', currentLine.lineNum, 'ERROR', err.message);
      this.isFinished = true;
      return false;
    }

    if (this.currentLineIndex >= this.sourceLines.length) {
      this.finalize();
    }

    return true;
  }

  runAll() {
    while (!this.isFinished && this.errors.length === 0) {
      if (!this.step()) break;
    }
    return this.errors.length === 0;
  }

  finalize() {
    if (this.isFinished) return;
    this.isFinished = true;

    // Check all unresolved forward references
    let unresolvedCount = 0;
    for (const ref of this.forwardRefTable) {
      if (ref.status === 'Unresolved') {
        unresolvedCount++;
        this.errors.push({
          line: ref.sourceLine,
          message: `Undefined symbol '${ref.symbol}' referenced at Line ${ref.sourceLine}`
        });
        this.addTrace('error', ref.sourceLine, 'UNDEFINED SYMBOL', `Forward reference '${ref.symbol}' was never defined!`);
      }
    }

    if (unresolvedCount === 0 && this.errors.length === 0) {
      this.addTrace('backpatch', 0, 'SUCCESS', 'Assembly completed successfully with 0 errors.', 'All forward references resolved and backpatched.');
    }
  }

  // ==========================================
  // 4. PARSER & MULTI-LABEL PROCESSOR
  // ==========================================

  processLine(lineNum, text, rawSource) {
    let remaining = text;
    let definedLabels = [];

    // Check for syntax error: line starting with colon or consecutive colons
    if (remaining.startsWith(':')) {
      throw new Error(`Syntax Error: unexpected ':' at start of line`);
    }

    // Check for invalid label syntax (e.g. starting with numeric digit: '123LOOP:')
    const invalidLabelPrefix = remaining.match(/^([0-9][a-zA-Z0-9_]*)\s*:/);
    if (invalidLabelPrefix) {
      throw new Error(`Invalid label name '${invalidLabelPrefix[1]}': labels cannot begin with a numeric digit`);
    }

    // MULTIPLE LABELS: Loop to handle all labels on the same line (e.g. L1: L2: MOV AX, BX)
    while (true) {
      const labelMatch = remaining.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
      if (!labelMatch) break;

      const label = labelMatch[1].toUpperCase();

      // Check if label uses a reserved word
      if (RESERVED_WORDS.has(label)) {
        throw new Error(`Invalid label name '${label}': cannot use reserved 8086 mnemonic, directive, or register as a label`);
      }

      this.handleLabelDefinition(label, lineNum, this.locationCounter, 'label');
      definedLabels.push(label);
      remaining = remaining.slice(labelMatch[0].length).trim();

      // Check if followed by stray colon (e.g. LOOP::)
      if (remaining.startsWith(':')) {
        throw new Error(`Syntax Error: unexpected consecutive colon ':' after label '${label}'`);
      }
    }

    // Check for Directive with Label (e.g. "VAR1 DB 05H", "NUM DW 1000H", "MAX EQU 50H")
    if (definedLabels.length === 0) {
      const dirMatch = remaining.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(DB|DW|EQU)\s+(.+)$/i);
      if (dirMatch) {
        const label = dirMatch[1].toUpperCase();
        const directive = dirMatch[2].toUpperCase();
        const operandStr = dirMatch[3].trim();

        if (RESERVED_WORDS.has(label)) {
          throw new Error(`Invalid label name '${label}': cannot use reserved keyword as identifier`);
        }

        if (directive === 'EQU') {
          const numVal = parseNumber(operandStr);
          if (numVal === null) throw new Error(`Invalid numeric value for EQU directive: '${operandStr}'`);
          this.handleLabelDefinition(label, lineNum, numVal, 'equ');
          this.lcTable.push({
            lineNum,
            address: this.locationCounter,
            source: rawSource.trim(),
            size: 0,
            bytes: []
          });
          this.addTrace('symbol', lineNum, 'EQU DIRECTIVE', `Symbol '${label}' equated to constant ${toHex(numVal)}`);
          return;
        } else {
          // DB or DW
          this.handleLabelDefinition(label, lineNum, this.locationCounter, 'var');
          remaining = `${directive} ${operandStr}`;
        }
      }
    }

    // If the line had only labels and nothing else, record LC row and exit
    if (!remaining) {
      this.lcTable.push({
        lineNum,
        address: this.locationCounter,
        source: rawSource.trim(),
        size: 0,
        bytes: []
      });
      return;
    }

    // Split mnemonic and remainder
    const parts = remaining.split(/\s+(.+)/);
    const mnemonic = parts[0].toUpperCase();
    const operandStr = parts[1] ? parts[1].trim() : '';

    // Handle Directives
    if (mnemonic === 'START') {
      let addr = 0x1000;
      const cleanOperand = operandStr ? operandStr.replace(/:$/, '').trim() : '';
      if (cleanOperand) {
        if (cleanOperand.includes(',')) throw new Error(`Syntax error in START directive: expected at most 1 address argument`);
        const numVal = parseNumber(cleanOperand);
        if (numVal === null) throw new Error(`Invalid start address: '${cleanOperand}'`);
        addr = numVal;
      }
      this.locationCounter = addr;
      this.startAddress = addr;
      this.lcTable.push({
        lineNum,
        address: addr,
        source: rawSource.trim(),
        size: 0,
        bytes: []
      });
      this.addTrace('lc', lineNum, 'START DIRECTIVE', `Location Counter initialized to ${toHex(addr)}`);
      return;
    }

    if (mnemonic === 'END') {
      this.hasEnded = true;
      this.lcTable.push({
        lineNum,
        address: this.locationCounter,
        source: rawSource.trim(),
        size: 0,
        bytes: []
      });
      this.addTrace('info', lineNum, 'END DIRECTIVE', `Assembly END reached at LC = ${toHex(this.locationCounter)}`);
      this.finalize();
      return;
    }

    if (mnemonic === 'DB' || mnemonic === 'DW') {
      this.handleDataDirective(mnemonic, operandStr, lineNum, rawSource);
      return;
    }

    // Handle Instructions
    this.handleInstruction(mnemonic, operandStr, lineNum, rawSource);
  }

  // ==========================================
  // 5. OPERAND PARSER WITH SYNTAX CHECKING
  // ==========================================

  parseOperands(mnemonic, operandStr) {
    if (!operandStr) return [];

    // Check for leading comma
    if (operandStr.startsWith(',')) {
      throw new Error(`Syntax error in ${mnemonic}: unexpected leading comma before first operand`);
    }

    // Check for trailing comma
    if (operandStr.endsWith(',')) {
      throw new Error(`Syntax error in ${mnemonic}: missing operand after trailing comma`);
    }

    // Check for consecutive commas
    if (/,,/.test(operandStr)) {
      throw new Error(`Syntax error in ${mnemonic}: consecutive commas encountered`);
    }

    const rawTokens = operandStr.split(',').map(t => t.trim());

    // Check for missing comma between space-separated tokens when 2 operands are expected
    if (rawTokens.length === 1 && /\s+/.test(rawTokens[0])) {
      const subTokens = rawTokens[0].split(/\s+/);
      if (['MOV', 'ADD', 'SUB', 'CMP'].includes(mnemonic) && subTokens.length >= 2) {
        throw new Error(`Syntax error in ${mnemonic}: missing comma between operands (found '${operandStr}')`);
      }
    }

    // Check for empty tokens
    for (const t of rawTokens) {
      if (!t) throw new Error(`Syntax error in ${mnemonic}: empty operand between commas`);
    }

    return rawTokens;
  }

  // ==========================================
  // 6. SYMBOL & FORWARD REFERENCE MANAGEMENT
  // ==========================================

  handleLabelDefinition(label, lineNum, address, type) {
    if (!isValidSymbolName(label)) {
      throw new Error(`Invalid label name: '${label}'`);
    }

    if (this.symbolTable.has(label)) {
      const existing = this.symbolTable.get(label);
      if (existing.defined) {
        throw new Error(`Duplicate label definition: '${label}' was already defined at Line ${existing.lineDefined}`);
      }
      // Symbol was previously forward-referenced!
      existing.defined = true;
      existing.address = address;
      existing.lineDefined = lineNum;
      existing.type = type;
    } else {
      this.symbolTable.set(label, {
        symbol: label,
        address,
        defined: true,
        lineDefined: lineNum,
        references: [],
        type
      });
    }

    this.addTrace('symbol', lineNum, 'LABEL DEFINED',
      `Label '${label}' defined at address ${toHex(address)}`,
      `Inserted into Symbol Table as DEFINED.`);

    // BACKPATCHING: Resolve all pending forward references to this label
    this.resolveForwardReferences(label, address, lineNum);
  }

  resolveForwardReferences(label, targetAddress, lineNum) {
    const pendingRefs = this.forwardRefTable.filter(ref => ref.symbol === label && ref.status === 'Unresolved');
    if (pendingRefs.length === 0) return;

    for (const ref of pendingRefs) {
      let patchedBytes = [];
      let formula = '';

      if (ref.type === 'rel16') {
        // 8086 Near Jump displacement = targetAddress - nextIP
        const displacement = targetAddress - ref.nextIP;
        const dispSigned16 = displacement & 0xFFFF;
        const lowByte = dispSigned16 & 0xFF;
        const highByte = (dispSigned16 >> 8) & 0xFF;
        patchedBytes = [lowByte, highByte];
        formula = `Displacement = Target (${toHex(targetAddress)}) - NextIP (${toHex(ref.nextIP)}) = ${displacement >= 0 ? '+' : ''}${displacement} (${byteToHex(lowByte)} ${byteToHex(highByte)})`;
      } else if (ref.type === 'rel8') {
        // 8086 Short Branch (JE, JNE) displacement = targetAddress - nextIP
        const displacement = targetAddress - ref.nextIP;
        if (displacement < -128 || displacement > 127) {
          throw new Error(`Jump displacement out of range for 8-bit branch to '${label}' at Line ${ref.sourceLine} (displacement: ${displacement})`);
        }
        const dispSigned8 = displacement & 0xFF;
        patchedBytes = [dispSigned8];
        formula = `Displacement = Target (${toHex(targetAddress)}) - NextIP (${toHex(ref.nextIP)}) = ${displacement >= 0 ? '+' : ''}${displacement} (${byteToHex(dispSigned8)})`;
      } else if (ref.type === 'abs16') {
        // 16-bit Absolute address / equate constant (little-endian)
        const lowByte = targetAddress & 0xFF;
        const highByte = (targetAddress >> 8) & 0xFF;
        patchedBytes = [lowByte, highByte];
        formula = `Absolute Value = ${toHex(targetAddress)} (${byteToHex(lowByte)} ${byteToHex(highByte)})`;
      }

      // Backpatch into memory buffer
      for (let i = 0; i < patchedBytes.length; i++) {
        this.memoryBuffer.set(ref.patchAddress + i, patchedBytes[i]);
      }

      // Update intermediate LC Table entry
      const lcRow = this.lcTable.find(row => row.lineNum === ref.sourceLine);
      if (lcRow) {
        const offsetInInst = ref.patchAddress - lcRow.address;
        for (let i = 0; i < patchedBytes.length; i++) {
          if (offsetInInst + i < lcRow.bytes.length) {
            lcRow.bytes[offsetInInst + i] = patchedBytes[i];
          }
        }
      }

      // Update Forward Reference Table entry
      ref.status = 'Resolved';
      ref.patchedValue = patchedBytes.map(b => byteToHex(b)).join(' ');
      ref.formula = formula;

      this.addTrace('backpatch', lineNum, 'BACKPATCH COMPLETED',
        `Backpatched Line ${ref.sourceLine} at address ${toHex(ref.patchAddress)}: [${ref.patchedValue}]`,
        formula);
    }
  }

  addForwardReference(symbol, lineNum, patchAddress, instructionLC, nextIP, size, type) {
    if (!this.symbolTable.has(symbol)) {
      this.symbolTable.set(symbol, {
        symbol,
        address: null,
        defined: false,
        lineDefined: null,
        references: [lineNum],
        type: 'label'
      });
    } else {
      this.symbolTable.get(symbol).references.push(lineNum);
    }

    const refEntry = {
      id: this.nextRefId++,
      symbol,
      sourceLine: lineNum,
      patchAddress,
      instructionLC,
      nextIP,
      size,
      type,
      status: 'Unresolved',
      patchedValue: 'Pending',
      formula: 'Waiting for label definition'
    };

    this.forwardRefTable.push(refEntry);

    this.addTrace('forward', lineNum, 'FORWARD REFERENCE CREATED',
      `Symbol '${symbol}' is not yet defined. Reference entry #${refEntry.id} logged.`,
      `Patch location: ${toHex(patchAddress)}, size: ${size} byte(s). Placeholder 00 written.`);

    return refEntry;
  }

  // ==========================================
  // 7. INSTRUCTION TRANSLATION (8086 SUBSET)
  // ==========================================

  handleInstruction(mnemonic, operandStr, lineNum, rawSource) {
    const startLC = this.locationCounter;
    let generatedBytes = [];
    let size = 0;

    const operands = this.parseOperands(mnemonic, operandStr);

    switch (mnemonic) {
      case 'HLT': {
        if (operands.length > 0) throw new Error(`Syntax error in HLT: instruction takes no operands`);
        generatedBytes = [0xF4];
        size = 1;
        break;
      }

      case 'MOV': {
        if (operands.length !== 2) {
          throw new Error(`Syntax error in MOV: expected 2 operands (destination, source), found ${operands.length}`);
        }
        const [dest, src] = operands;

        // Check for direct memory transfers: MOV AX, [disp16] and MOV [disp16], AX
        if (dest.toUpperCase() === 'AX' && src.startsWith('[') && src.endsWith(']')) {
          const inner = src.slice(1, -1).trim();
          const numVal = parseNumber(inner);
          if (numVal === null) throw new Error(`Invalid memory address in MOV AX, [${inner}]`);
          generatedBytes = [0xA1, numVal & 0xFF, (numVal >> 8) & 0xFF];
          size = 3;
          break;
        }
        if (src.toUpperCase() === 'AX' && dest.startsWith('[') && dest.endsWith(']')) {
          const inner = dest.slice(1, -1).trim();
          const numVal = parseNumber(inner);
          if (numVal === null) throw new Error(`Invalid memory address in MOV [${inner}], AX`);
          generatedBytes = [0xA3, numVal & 0xFF, (numVal >> 8) & 0xFF];
          size = 3;
          break;
        }

        // Validate destination must be a register
        if (!isRegister(dest)) {
          throw new Error(`Invalid destination register '${dest}' in MOV: destination must be a valid 8086 register (AX, BX, CX, DX, SI, DI, SP, BP, AL, BL, CL, DL, AH, BH, CH, DH)`);
        }

        // Check for operand size mismatch
        if ((isRegister16(dest) && isRegister8(src)) || (isRegister8(dest) && isRegister16(src))) {
          throw new Error(`Operand size mismatch in MOV: cannot move between 16-bit register '${dest}' and 8-bit register '${src}'`);
        }

        // Form 1: MOV reg16, reg16
        if (isRegister16(dest) && isRegister16(src)) {
          const destCode = REGISTERS_16[dest.toUpperCase()];
          const srcCode = REGISTERS_16[src.toUpperCase()];
          const modrm = 0b11000000 | (destCode << 3) | srcCode;
          generatedBytes = [0x8B, modrm];
          size = 2;
        }
        // Form 2: MOV reg8, reg8
        else if (isRegister8(dest) && isRegister8(src)) {
          const destCode = REGISTERS_8[dest.toUpperCase()];
          const srcCode = REGISTERS_8[src.toUpperCase()];
          const modrm = 0b11000000 | (destCode << 3) | srcCode;
          generatedBytes = [0x8A, modrm];
          size = 2;
        }
        // Form 3: MOV reg16, imm16 / symbol
        else if (isRegister16(dest)) {
          const destCode = REGISTERS_16[dest.toUpperCase()];
          const opcode = 0xB8 + destCode;
          const numResult = validateNumericToken(src);

          if (numResult.isNumber) {
            if (!numResult.valid) throw new Error(numResult.error);
            const numVal = numResult.value;
            generatedBytes = [opcode, numVal & 0xFF, (numVal >> 8) & 0xFF];
            size = 3;
          } else if (isValidSymbolName(src)) {
            const sym = this.symbolTable.get(src.toUpperCase());
            if (sym && sym.defined) {
              const val = sym.address;
              generatedBytes = [opcode, val & 0xFF, (val >> 8) & 0xFF];
              sym.references.push(lineNum);
            } else {
              generatedBytes = [opcode, 0x00, 0x00];
              this.addForwardReference(src.toUpperCase(), lineNum, startLC + 1, startLC, startLC + 3, 2, 'abs16');
            }
            size = 3;
          } else {
            throw new Error(`Invalid register or immediate operand '${src}' for MOV 16-bit register`);
          }
        }
        // Form 4: MOV reg8, imm8
        else if (isRegister8(dest)) {
          const destCode = REGISTERS_8[dest.toUpperCase()];
          const opcode = 0xB0 + destCode;
          const numResult = validateNumericToken(src);

          if (numResult.isNumber) {
            if (!numResult.valid) throw new Error(numResult.error);
            const numVal = numResult.value;
            if (numVal > 255 || numVal < -128) {
              throw new Error(`Immediate value out of 8-bit range for register '${dest}': ${src} (must fit in 1 byte, 0-255 or -128 to 127)`);
            }
            generatedBytes = [opcode, numVal & 0xFF];
            size = 2;
          } else {
            throw new Error(`Invalid immediate operand '${src}' for 8-bit register '${dest}'`);
          }
        }
        break;
      }

      case 'ADD':
      case 'SUB':
      case 'CMP': {
        if (operands.length !== 2) {
          throw new Error(`Syntax error in ${mnemonic}: expected 2 operands (destination, source), found ${operands.length}`);
        }
        const [dest, src] = operands;

        if (!isRegister(dest)) {
          throw new Error(`Invalid destination register '${dest}' in ${mnemonic}: destination must be a valid 8086 register`);
        }

        if ((isRegister16(dest) && isRegister8(src)) || (isRegister8(dest) && isRegister16(src))) {
          throw new Error(`Operand size mismatch in ${mnemonic}: cannot operate between 16-bit register '${dest}' and 8-bit register '${src}'`);
        }

        const isAdd = mnemonic === 'ADD';
        const isSub = mnemonic === 'SUB';
        const isCmp = mnemonic === 'CMP';

        // Register to Register
        if (isRegister16(dest) && isRegister16(src)) {
          const destCode = REGISTERS_16[dest.toUpperCase()];
          const srcCode = REGISTERS_16[src.toUpperCase()];
          const modrm = 0b11000000 | (destCode << 3) | srcCode;
          const op = isAdd ? 0x03 : (isSub ? 0x2B : 0x3B);
          generatedBytes = [op, modrm];
          size = 2;
        } else if (isRegister8(dest) && isRegister8(src)) {
          const destCode = REGISTERS_8[dest.toUpperCase()];
          const srcCode = REGISTERS_8[src.toUpperCase()];
          const modrm = 0b11000000 | (destCode << 3) | srcCode;
          const op = isAdd ? 0x02 : (isSub ? 0x2A : 0x3A);
          generatedBytes = [op, modrm];
          size = 2;
        }
        // Immediate to 16-bit register
        else if (isRegister16(dest)) {
          const numResult = validateNumericToken(src);
          if (!numResult.isNumber) {
            throw new Error(`Invalid register or immediate value '${src}' for ${mnemonic} ${dest}`);
          }
          if (!numResult.valid) throw new Error(numResult.error);
          const numVal = numResult.value;

          if (dest.toUpperCase() === 'AX') {
            const op = isAdd ? 0x05 : (isSub ? 0x2D : 0x3D);
            generatedBytes = [op, numVal & 0xFF, (numVal >> 8) & 0xFF];
            size = 3;
          } else {
            // General 16-bit register immediate: 81 /op
            const destCode = REGISTERS_16[dest.toUpperCase()];
            const subOpcode = isAdd ? 0 : (isSub ? 5 : 7);
            const modrm = 0b11000000 | (subOpcode << 3) | destCode;
            generatedBytes = [0x81, modrm, numVal & 0xFF, (numVal >> 8) & 0xFF];
            size = 4;
          }
        }
        // Immediate to 8-bit register
        else if (isRegister8(dest)) {
          const numResult = validateNumericToken(src);
          if (!numResult.isNumber) {
            throw new Error(`Invalid register or immediate value '${src}' for ${mnemonic} ${dest}`);
          }
          if (!numResult.valid) throw new Error(numResult.error);
          const numVal = numResult.value;
          if (numVal > 255 || numVal < -128) {
            throw new Error(`Immediate value out of range for 8-bit ${mnemonic}: ${src}`);
          }

          if (dest.toUpperCase() === 'AL') {
            const op = isAdd ? 0x04 : (isSub ? 0x2C : 0x3C);
            generatedBytes = [op, numVal & 0xFF];
            size = 2;
          } else {
            // General 8-bit register immediate: 80 /op
            const destCode = REGISTERS_8[dest.toUpperCase()];
            const subOpcode = isAdd ? 0 : (isSub ? 5 : 7);
            const modrm = 0b11000000 | (subOpcode << 3) | destCode;
            generatedBytes = [0x80, modrm, numVal & 0xFF];
            size = 3;
          }
        }
        break;
      }

      case 'INC':
      case 'DEC': {
        if (operands.length !== 1) {
          throw new Error(`Syntax error in ${mnemonic}: expected 1 register operand, found ${operands.length}`);
        }
        const reg = operands[0].toUpperCase();
        if (!isRegister(reg)) {
          throw new Error(`Invalid register '${reg}' for ${mnemonic}: operand must be a valid 8086 register`);
        }

        const isInc = mnemonic === 'INC';
        if (isRegister16(reg)) {
          generatedBytes = [(isInc ? 0x40 : 0x48) + REGISTERS_16[reg]];
          size = 1;
        } else {
          generatedBytes = [0xFE, (isInc ? 0xC0 : 0xC8) + REGISTERS_8[reg]];
          size = 2;
        }
        break;
      }

      case 'JMP': {
        if (operands.length !== 1) throw new Error(`Syntax error in JMP: expected 1 target label, found ${operands.length}`);
        const target = operands[0].toUpperCase();
        if (!isValidSymbolName(target)) {
          throw new Error(`Invalid target label '${target}' in JMP`);
        }

        size = 3;
        const nextIP = startLC + size;
        const sym = this.symbolTable.get(target);

        if (sym && sym.defined) {
          // Backward Jump: target address is already known
          const disp = sym.address - nextIP;
          const disp16 = disp & 0xFFFF;
          generatedBytes = [0xE9, disp16 & 0xFF, (disp16 >> 8) & 0xFF];
          sym.references.push(lineNum);
          this.addTrace('info', lineNum, 'BACKWARD JUMP',
            `JMP to known symbol '${target}' at ${toHex(sym.address)}. Disp = ${disp >= 0 ? '+' : ''}${disp}`);
        } else {
          // Forward Jump: target address is unresolved
          generatedBytes = [0xE9, 0x00, 0x00];
          this.addForwardReference(target, lineNum, startLC + 1, startLC, nextIP, 2, 'rel16');
        }
        break;
      }

      case 'JE':
      case 'JNE': {
        if (operands.length !== 1) throw new Error(`Syntax error in ${mnemonic}: expected 1 target label, found ${operands.length}`);
        const target = operands[0].toUpperCase();
        if (!isValidSymbolName(target)) {
          throw new Error(`Invalid target label '${target}' in ${mnemonic}`);
        }

        size = 2;
        const nextIP = startLC + size;
        const sym = this.symbolTable.get(target);
        const op = mnemonic === 'JE' ? 0x74 : 0x75;

        if (sym && sym.defined) {
          const disp = sym.address - nextIP;
          if (disp < -128 || disp > 127) throw new Error(`Jump displacement out of range for 8-bit ${mnemonic} to '${target}'`);
          generatedBytes = [op, disp & 0xFF];
          sym.references.push(lineNum);
          this.addTrace('info', lineNum, `BACKWARD ${mnemonic}`,
            `${mnemonic} to known symbol '${target}' at ${toHex(sym.address)}. Disp = ${disp >= 0 ? '+' : ''}${disp}`);
        } else {
          generatedBytes = [op, 0x00];
          this.addForwardReference(target, lineNum, startLC + 1, startLC, nextIP, 1, 'rel8');
        }
        break;
      }

      default:
        throw new Error(`Unknown or unsupported mnemonic '${mnemonic}'. Supported instructions: MOV, ADD, SUB, INC, DEC, CMP, JMP, JE, JNE, HLT, START, END, DB, DW, EQU`);
    }

    // Write bytes to in-memory buffer
    for (let i = 0; i < generatedBytes.length; i++) {
      this.memoryBuffer.set(startLC + i, generatedBytes[i]);
    }

    // Record in Location Counter Table
    this.lcTable.push({
      lineNum,
      address: startLC,
      source: rawSource.trim(),
      size,
      bytes: [...generatedBytes]
    });

    // Advance Location Counter
    this.locationCounter += size;

    this.addTrace('lc', lineNum, 'INSTRUCTION ASSEMBLED',
      `${mnemonic} ${operandStr} → Size: ${size} byte(s). Bytes: [${generatedBytes.map(b => byteToHex(b)).join(' ')}]`,
      `LC updated: ${toHex(startLC)} → ${toHex(this.locationCounter)}`);
  }

  handleDataDirective(mnemonic, operandStr, lineNum, rawSource) {
    if (!operandStr) throw new Error(`Syntax error in ${mnemonic} directive: expected at least one value`);

    const values = this.parseOperands(mnemonic, operandStr);
    const startLC = this.locationCounter;
    let generatedBytes = [];

    for (const valStr of values) {
      const num = parseNumber(valStr);
      if (num === null) throw new Error(`Invalid numeric constant in ${mnemonic}: '${valStr}'`);

      if (mnemonic === 'DB') {
        if (num > 255 || num < -128) throw new Error(`Byte value out of bounds in DB: '${valStr}' (must fit in 8 bits, 0-255 or -128 to 127)`);
        generatedBytes.push(num & 0xFF);
      } else if (mnemonic === 'DW') {
        if (num > 65535 || num < -32768) throw new Error(`Word value out of bounds in DW: '${valStr}' (must fit in 16 bits, 0-65535 or -32768 to 32767)`);
        generatedBytes.push(num & 0xFF);
        generatedBytes.push((num >> 8) & 0xFF);
      }
    }

    const size = generatedBytes.length;
    for (let i = 0; i < size; i++) {
      this.memoryBuffer.set(startLC + i, generatedBytes[i]);
    }

    this.lcTable.push({
      lineNum,
      address: startLC,
      source: rawSource.trim(),
      size,
      bytes: [...generatedBytes]
    });

    this.locationCounter += size;

    this.addTrace('lc', lineNum, `${mnemonic} ALLOCATION`,
      `Allocated ${size} byte(s) at ${toHex(startLC)}: [${generatedBytes.map(b => byteToHex(b)).join(' ')}]`,
      `LC updated: ${toHex(startLC)} → ${toHex(this.locationCounter)}`);
  }

  getMemoryHexDump() {
    if (this.memoryBuffer.size === 0) return 'No machine code generated.';

    const addresses = Array.from(this.memoryBuffer.keys()).sort((a, b) => a - b);
    if (addresses.length === 0) return 'No machine code generated.';

    const minAddr = addresses[0];
    const maxAddr = addresses[addresses.length - 1];

    let lines = [];
    const base = minAddr - (minAddr % 16);

    for (let rowAddr = base; rowAddr <= maxAddr; rowAddr += 16) {
      let hexPart = [];
      let asciiPart = [];

      for (let offset = 0; offset < 16; offset++) {
        const addr = rowAddr + offset;
        if (this.memoryBuffer.has(addr)) {
          const byte = this.memoryBuffer.get(addr);
          hexPart.push(byteToHex(byte));
          asciiPart.push(byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.');
        } else {
          hexPart.push('..');
          asciiPart.push(' ');
        }
      }

      lines.push(`${toHex(rowAddr)}:  ${hexPart.slice(0, 8).join(' ')}  ${hexPart.slice(8).join(' ')}  |${asciiPart.join('')}|`);
    }

    return lines.join('\n');
  }

  getDisassemblyListing() {
    if (this.lcTable.length === 0) return 'No output.';

    let lines = [];
    lines.push('Line  Address  Machine Code      Source Statement');
    lines.push('----  -------  ----------------  ------------------------------');

    for (const item of this.lcTable) {
      const lineStr = String(item.lineNum).padStart(4, ' ');
      const addrStr = toHex(item.address).padEnd(7, ' ');
      const bytesStr = item.bytes.map(b => byteToHex(b)).join(' ').padEnd(16, ' ');
      lines.push(`${lineStr}  ${addrStr}  ${bytesStr}  ${item.source}`);
    }

    return lines.join('\n');
  }
}

// ==========================================
// 8. PRESET EXAMPLES
// ==========================================

const EXAMPLES = {
  forward_ref: `; 8086 Single Pass Assembler
; Classic Forward Reference & Backpatching PBL Demo
START:
    MOV AX, 05H
    JMP LOOP
    ADD AX, BX

LOOP:
    MOV BX, AX
    HLT
    END`,

  branching: `; Multiple Forward References & Two-Way Branching
START 1000H
    MOV AX, 0AH
    MOV BX, 0AH
    CMP AX, BX
    JE EQUAL_BRANCH
    JNE EQUAL_BRANCH     ; Multiple forward references to EQUAL_BRANCH!
    MOV CX, 01H
    JMP DONE

EQUAL_BRANCH:
    MOV CX, 02H
    INC CX

DONE:
    HLT
    END`,

  data_vars: `; Data Directives (DB, DW, EQU) & Variables
MAX_VAL EQU 50H

START 2000H
    MOV AX, MAX_VAL
    ADD AX, 05H
    MOV BX, AX
    HLT

DATA_BYTE DB 12H, 34H
DATA_WORD DW 1000H
    END`,

  loop_counter: `; Down-Counter Loop with Backward and Forward References
START:
    MOV CX, 05H
    MOV AX, 00H

COUNT_LOOP:
    ADD AX, CX
    DEC CX
    CMP CX, 00H
    JNE COUNT_LOOP
    JMP EXIT_PROGRAM

EXIT_PROGRAM:
    HLT
    END`,

  multi_label: `; Multi-Label Demonstration
; Tests multiple labels on the same line and empty label lines
START:
L1: L2: MOV AX, 05H
L3:
L4:
    ADD AX, 10H
    JMP L1
    HLT
    END`,

  error_demo: `; Error Detection Test Bench
; Tests invalid mnemonic, invalid hex, invalid register, duplicate label, and undefined label
START:
    MOV AX, 12GH        ; Invalid hex number (contains G)
    MOV ZX, 05H         ; Invalid register (ZX)
    FOOBAR AX, BX       ; Invalid mnemonic
    MOV AX,             ; Missing operand syntax error

START:                  ; Duplicate label definition
    JMP NEVER_DEFINED   ; Undefined label at END
    HLT
    END`
};

// ==========================================
// 9. USER INTERFACE CONTROLLER
// ==========================================

class UIController {
  constructor() {
    this.assembler = new SinglePassAssembler();
    this.activeTab = 'lc';

    // DOM Elements
    this.codeEditor = document.getElementById('codeEditor');
    this.lineNumbers = document.getElementById('lineNumbers');
    this.exampleSelect = document.getElementById('exampleSelect');

    this.btnAssemble = document.getElementById('btnAssemble');
    this.btnStep = document.getElementById('btnStep');
    this.btnReset = document.getElementById('btnReset');
    this.btnClear = document.getElementById('btnClear');

    // Stat chips
    this.statLC = document.getElementById('statLC');
    this.statInstructions = document.getElementById('statInstructions');
    this.statSymbols = document.getElementById('statSymbols');
    this.statForwardRefs = document.getElementById('statForwardRefs');
    this.statErrors = document.getElementById('statErrors');
    this.statusText = document.getElementById('statusText');

    // Tables & containers
    this.lcTableBody = document.getElementById('lcTableBody');
    this.symbolTableBody = document.getElementById('symbolTableBody');
    this.forwardTableBody = document.getElementById('forwardTableBody');
    this.traceContainer = document.getElementById('traceContainer');
    this.hexDumpOutput = document.getElementById('hexDumpOutput');
    this.disasmOutput = document.getElementById('disasmOutput');
    this.alertContainer = document.getElementById('alertContainer');

    // Badges on tabs
    this.badgeLC = document.getElementById('badgeLC');
    this.badgeSymbol = document.getElementById('badgeSymbol');
    this.badgeForward = document.getElementById('badgeForward');
    this.badgeTrace = document.getElementById('badgeTrace');

    this.initEventListeners();
    this.loadExample('forward_ref');
  }

  initEventListeners() {
    this.codeEditor.addEventListener('input', () => {
      this.updateLineNumbers();
      this.resetAssemblerState();
    });

    this.codeEditor.addEventListener('scroll', () => {
      this.lineNumbers.scrollTop = this.codeEditor.scrollTop;
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.dataset.tab);
      });
    });

    this.btnAssemble.addEventListener('click', () => this.handleRunAll());
    this.btnStep.addEventListener('click', () => this.handleStep());
    this.btnReset.addEventListener('click', () => this.resetAssemblerState());
    this.btnClear.addEventListener('click', () => {
      this.codeEditor.value = '';
      this.updateLineNumbers();
      this.resetAssemblerState();
    });

    this.exampleSelect.addEventListener('change', (e) => {
      this.loadExample(e.target.value);
    });
  }

  switchTab(tabId) {
    this.activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `tab-${tabId}`);
    });
  }

  loadExample(key) {
    if (EXAMPLES[key]) {
      this.codeEditor.value = EXAMPLES[key];
      this.updateLineNumbers();
      this.resetAssemblerState();
    }
  }

  updateLineNumbers() {
    const lines = this.codeEditor.value.split('\n');
    let html = '';
    const activeLine = this.assembler.isFinished ? -1 : (this.assembler.currentLineIndex < this.assembler.sourceLines.length ? this.assembler.sourceLines[this.assembler.currentLineIndex]?.lineNum : -1);

    for (let i = 1; i <= lines.length; i++) {
      const isActive = i === activeLine;
      html += `<div class="line-number-row ${isActive ? 'active-line' : ''}" data-line="${i}">${i}</div>`;
    }
    this.lineNumbers.innerHTML = html;
  }

  resetAssemblerState() {
    this.assembler.loadSource(this.codeEditor.value);
    this.btnStep.disabled = false;
    this.btnAssemble.disabled = false;
    this.statusText.textContent = 'Ready';
    this.render();
  }

  handleStep() {
    if (this.assembler.sourceLines.length === 0) {
      this.assembler.loadSource(this.codeEditor.value);
    }

    const moreToRun = this.assembler.step();
    this.render();

    if (!moreToRun || this.assembler.isFinished) {
      this.btnStep.disabled = true;
      this.btnAssemble.disabled = true;
      this.statusText.textContent = this.assembler.errors.length > 0 ? 'Halted on Error' : 'Assembly Completed';
    } else {
      this.statusText.textContent = `Stepping (Line ${this.assembler.currentLineIndex} of ${this.assembler.sourceLines.length})`;
    }
  }

  handleRunAll() {
    if (this.assembler.sourceLines.length === 0 || this.assembler.currentLineIndex > 0) {
      this.assembler.loadSource(this.codeEditor.value);
    }

    this.assembler.runAll();
    this.btnStep.disabled = true;
    this.btnAssemble.disabled = true;
    this.statusText.textContent = this.assembler.errors.length > 0 ? 'Halted on Error' : 'Assembly Completed';
    this.render();
  }

  render() {
    this.updateLineNumbers();
    this.renderStats();
    this.renderLCTable();
    this.renderSymbolTable();
    this.renderForwardTable();
    this.renderTraceLog();
    this.renderOutputs();
    this.renderAlerts();
  }

  renderStats() {
    this.statLC.textContent = toHex(this.assembler.locationCounter);
    this.statInstructions.textContent = this.assembler.lcTable.filter(r => r.size > 0).length;
    this.statSymbols.textContent = this.assembler.symbolTable.size;

    const resolved = this.assembler.forwardRefTable.filter(r => r.status === 'Resolved').length;
    const totalRefs = this.assembler.forwardRefTable.length;
    this.statForwardRefs.textContent = `${resolved}/${totalRefs}`;

    this.statErrors.textContent = this.assembler.errors.length;

    this.badgeLC.textContent = this.assembler.lcTable.length;
    this.badgeSymbol.textContent = this.assembler.symbolTable.size;
    this.badgeForward.textContent = this.assembler.forwardRefTable.length;
    this.badgeTrace.textContent = this.assembler.traceLog.length;
  }

  renderLCTable() {
    if (this.assembler.lcTable.length === 0) {
      this.lcTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No instructions assembled yet. Click "Step" or "Assemble".</td></tr>`;
      return;
    }

    let rows = '';
    this.assembler.lcTable.forEach((item) => {
      const bytesFormatted = item.bytes.map(b => `<span class="byte-pill">${byteToHex(b)}</span>`).join('');
      rows += `
        <tr>
          <td><span style="color: var(--accent-cyan); font-weight: 700;">#${item.lineNum}</span></td>
          <td><code>${toHex(item.address)}</code></td>
          <td style="color: #f8fafc;"><code>${escapeHtml(item.source)}</code></td>
          <td>${item.size} B</td>
          <td>${bytesFormatted || '<span style="color: var(--text-muted);">-</span>'}</td>
        </tr>
      `;
    });
    this.lcTableBody.innerHTML = rows;
  }

  renderSymbolTable() {
    if (this.assembler.symbolTable.size === 0) {
      this.symbolTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Symbol table is currently empty.</td></tr>`;
      return;
    }

    let rows = '';
    this.assembler.symbolTable.forEach((sym) => {
      const statusBadge = sym.defined
        ? `<span class="badge badge-defined">DEFINED</span>`
        : `<span class="badge badge-unresolved">UNRESOLVED</span>`;

      const addrStr = sym.defined ? toHex(sym.address) : '<span style="color: var(--accent-amber);">Pending</span>';
      const refsStr = sym.references.length > 0 ? sym.references.map(r => `Line ${r}`).join(', ') : 'None';

      rows += `
        <tr>
          <td><strong style="color: var(--accent-purple);">${escapeHtml(sym.symbol)}</strong></td>
          <td><code>${addrStr}</code></td>
          <td>${statusBadge}</td>
          <td><span style="text-transform: uppercase; font-size: 0.72rem; color: var(--text-secondary);">${sym.type}</span></td>
          <td style="font-size: 0.75rem; color: var(--text-muted);">${refsStr}</td>
        </tr>
      `;
    });
    this.symbolTableBody.innerHTML = rows;
  }

  renderForwardTable() {
    if (this.assembler.forwardRefTable.length === 0) {
      this.forwardTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No forward references encountered.</td></tr>`;
      return;
    }

    let rows = '';
    this.assembler.forwardRefTable.forEach(ref => {
      const statusBadge = ref.status === 'Resolved'
        ? `<span class="badge badge-backpatched">RESOLVED / PATCHED</span>`
        : `<span class="badge badge-unresolved">PENDING FIXUP</span>`;

      rows += `
        <tr>
          <td><strong style="color: var(--accent-amber);">${escapeHtml(ref.symbol)}</strong></td>
          <td>Line ${ref.sourceLine} (at <code>${toHex(ref.instructionLC)}</code>)</td>
          <td><code>${toHex(ref.patchAddress)}</code> (${ref.size}B)</td>
          <td>${statusBadge}</td>
          <td><code>${escapeHtml(ref.patchedValue)}</code></td>
          <td style="font-size: 0.75rem; color: var(--text-secondary);">${escapeHtml(ref.formula)}</td>
        </tr>
      `;
    });
    this.forwardTableBody.innerHTML = rows;
  }

  renderTraceLog() {
    if (this.assembler.traceLog.length === 0) {
      this.traceContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">No assembly events recorded yet.</div>`;
      return;
    }

    let items = '';
    this.assembler.traceLog.forEach(trace => {
      let typeClass = 'trace-lc';
      if (trace.type === 'symbol') typeClass = 'trace-symbol';
      if (trace.type === 'forward') typeClass = 'trace-forward';
      if (trace.type === 'backpatch') typeClass = 'trace-backpatch';
      if (trace.type === 'error') typeClass = 'trace-error';

      const lineMeta = trace.lineNum > 0 ? `Line ${trace.lineNum}` : 'Assembler Engine';

      items += `
        <div class="trace-item ${typeClass}">
          <div class="trace-meta">
            <span><strong>${trace.action}</strong></span>
            <span>${lineMeta}</span>
          </div>
          <div class="trace-msg">${escapeHtml(trace.message)}</div>
          ${trace.explanation ? `<div class="trace-explanation">↪ ${escapeHtml(trace.explanation)}</div>` : ''}
        </div>
      `;
    });
    this.traceContainer.innerHTML = items;
    this.traceContainer.scrollTop = this.traceContainer.scrollHeight;
  }

  renderOutputs() {
    this.hexDumpOutput.textContent = this.assembler.getMemoryHexDump();
    this.disasmOutput.textContent = this.assembler.getDisassemblyListing();
  }

  renderAlerts() {
    if (this.assembler.errors.length > 0) {
      let errHtml = `<div class="alert-banner alert-danger"><div>`;
      errHtml += `<strong>⚠️ Assembly Halted with ${this.assembler.errors.length} Error(s):</strong><ul style="margin: 4px 0 0 16px;">`;
      this.assembler.errors.forEach(e => {
        errHtml += `<li>Line ${e.line}: ${escapeHtml(e.message)}</li>`;
      });
      errHtml += `</ul></div></div>`;
      this.alertContainer.innerHTML = errHtml;
    } else if (this.assembler.isFinished) {
      const totalBytes = Array.from(this.assembler.lcTable).reduce((acc, row) => acc + row.size, 0);
      this.alertContainer.innerHTML = `
        <div class="alert-banner alert-success">
          <div>
            <strong>✓ Assembly Succeeded:</strong> ${totalBytes} bytes generated across ${this.assembler.lcTable.length} statements. All symbols resolved.
          </div>
        </div>
      `;
    } else {
      this.alertContainer.innerHTML = '';
    }
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function initApp() {
  if (typeof window !== 'undefined' && !window.appController) {
    window.appController = new UIController();
  }
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}
