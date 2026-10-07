# 8086 Single Pass Assembler

A comprehensive web-based educational simulation of a **Single-Pass Assembler** for a supported educational subset of the Intel 8086 microprocessor architecture. Built specifically for college-level **Project-Based Learning (PBL)**, System Programming, and Compiler Design courses.

---

## 1. Project Title
**Educational 8086 Single-Pass Assembler with Dynamic Backpatching & Execution Tracing**

---

## 2. Problem Statement
In traditional System Programming curricula, students study the theory of assemblers through textbooks and static diagrams. While two-pass assemblers are intuitive, single-pass assemblers introduce challenging concepts such as **forward references**, **fixup tables**, and **dynamic backpatching in memory**. Students often struggle to visualize how unresolved target addresses are temporarily buffered and subsequently patched into previously generated machine code upon encountering label definitions. 

Existing command-line assemblers (such as NASM, MASM, or TASM) produce final binaries directly without exposing their intermediate data structures, location counter transitions, or step-by-step patch operations. This project bridges that gap by creating an interactive, transparent simulation where every internal transition is visible in real time.

---

## 3. Objective
1. **Demonstrate Single-Pass Translation:** Show how assembly source statements are converted to machine code in a single traversal from top to bottom.
2. **Visualize Dynamic Forward References:** Display how branch targets or symbols not yet defined are captured in a Forward Reference Table with placeholder machine code bytes.
3. **Illustrate Backpatching:** Demonstrate the mathematical displacement calculation (`Target Address - Next IP`) and dynamic replacement of placeholder bytes when the destination label is defined.
4. **Inspect Core Data Structures:** Provide real-time inspection of the Location Counter (LC), Symbol Table, Forward Reference Table, Memory Buffer Hex Dump, and Chronological Assembly Trace.
5. **Prepare Students for Viva Voce:** Provide a self-contained academic reference and viva preparation module answering common examiner questions.

---

## 4. What is an Assembler?
An **assembler** is a foundational system program that translates symbolic assembly language programs into binary machine code that can be directly executed by the target processor.

An assembler performs three primary duties:
1. **Mnemonic Translation:** Maps mnemonic opcodes (e.g., `MOV`, `ADD`, `SUB`, `JMP`) to their corresponding binary/hex machine language opcodes.
2. **Symbol Resolution:** Assigns memory addresses to symbolic labels and variables.
3. **Data Allocation & Directives:** Allocates memory storage for variables (`DB`, `DW`) and manages assembler directives (`START`, `END`, `EQU`).

---

## 5. What is a Single-Pass Assembler?
A **Single-Pass Assembler** translates assembly source statements into object code in **one single reading (pass)** of the source file. 

Because it reads the source file only once:
- When a backward jump occurs (the target label is already defined in the Symbol Table), the assembler resolves the address immediately.
- When a **forward jump** or **forward reference** occurs (the target label has not yet appeared in the source), the assembler cannot immediately resolve the target address.
- Instead of making a second pass over the source code, the assembler writes temporary placeholder bytes (such as `00` or `00 00`) into the object code buffer, enters a fixup entry into a **Forward Reference Table**, and continues.
- As soon as the target label is defined later in the source code, the assembler calculates the address/displacement and **backpatches** the previously generated machine code directly in memory.

---

## 6. Single Pass vs Two Pass Assembler

| Evaluation Metric | Single-Pass Assembler | Two-Pass Assembler |
| :--- | :--- | :--- |
| **Pass Count** | Exactly **1 pass** over the source text. | **2 passes** over the source text (or intermediate file). |
| **Forward Reference Mechanism** | Handled via **Backpatching** (in-memory fixup table). | Handled naturally: Pass 1 builds the complete Symbol Table; Pass 2 generates code. |
| **Memory Buffer Requirement** | High: Must maintain object code buffer in random-access memory (RAM) to allow seeking back and overwriting bytes. | Low: Can stream machine code directly to disk/output in Pass 2 without seeking backwards. |
| **I/O Speed** | Faster file I/O: Source file is read only once. | Slower file I/O: Source file or intermediate token stream must be read twice. |
| **Implementation Complexity** | Requires fixup management, displacement recalculation, and linked/array fixup tracking. | Algorithmically simpler separation of concerns (Pass 1 = analysis, Pass 2 = synthesis). |

---

## 7. Architecture
The single-pass assembler architecture is organized into modular phases:

```
[ Source Code Input ]
        │
        ▼
[ Preprocessor ] ──► Strips comments (';') and normalizes whitespace
        │
        ▼
[ Tokenizer / Parser ] ──► Separates Labels, Mnemonics, and Operands
        │
   ┌────┴──────────────────────────┐
   ▼                               ▼
[ Label Definition? ]      [ Instruction / Directive ]
   │                               │
   ├─► Update Symbol Table         ├─► Query OPTAB & REGTAB
   │                               ├─► Check Operands
   └─► Trigger Backpatching ◄──────┼─► If symbol undefined:
          on Forward Ref Table     │     Record Forward Reference
                                   │     Reserve Placeholder Bytes
                                   ▼
                         [ Object Code Generator ]
                                   │
                                   ▼
                   [ Memory Buffer / Hex Dump / LC Table ]
```

### Core Data Structures
1. **Location Counter (LC):** A 16-bit register initialized by `START` (default `1000H`) tracking the current memory offset.
2. **OPTAB (Opcode Table):** Contains valid mnemonics, allowable operand formats, machine opcodes, and size formulas.
3. **REGTAB (Register Table):** Maps 8-bit registers (`AL`, `BL`, `CL`, `DL`, `AH`, `BH`, `CH`, `DH`) and 16-bit registers (`AX`, `BX`, `CX`, `DX`, `SP`, `BP`, `SI`, `DI`) to their 3-bit binary hardware codes.
4. **Symbol Table (ST):** Hash table storing `Symbol Name -> { Address, Defined Status, Line Defined, References, Type }`.
5. **Forward Reference Table (FRT):** List storing unresolved references: `{ Symbol, Source Line, Patch Address, Size, Type, Next IP, Status, Patched Value }`.
6. **Intermediate Trace Log:** Real-time chronological log capturing tokenization events, LC shifts, and backpatch actions.

---

## 8. Algorithm

```text
Algorithm SinglePassAssemble:
1. Initialize LocationCounter = 1000H (or specified by START directive).
2. Initialize SymbolTable = Empty, ForwardRefTable = Empty, MemoryBuffer = Empty.
3. For each line in source code:
     a. Strip comments (everything after ';') and trim whitespace.
     b. If line is blank, continue to next line.
     c. Check for Label Definition (e.g., 'LABEL:' or 'LABEL EQU/DB/DW'):
          i. Extract label name.
          ii. If label exists in SymbolTable and isDefined == true:
                Signal Error: "Duplicate label definition".
          iii. If label exists in SymbolTable and isDefined == false:
                Update SymbolTable[label] = { Address: LocationCounter, isDefined: true }.
          iv. Else:
                Insert SymbolTable[label] = { Address: LocationCounter, isDefined: true }.
          v. BACKPATCHING STEP:
                For each entry in ForwardRefTable where entry.symbol == label and entry.status == 'Unresolved':
                     If entry.type == 'rel16':
                          Displacement = LocationCounter - entry.nextIP
                          Bytes = [Displacement.lowByte, Displacement.highByte]
                     Else if entry.type == 'rel8':
                          Displacement = LocationCounter - entry.nextIP
                          Bytes = [Displacement.lowByte]
                     Else if entry.type == 'abs16':
                          Bytes = [LocationCounter.lowByte, LocationCounter.highByte]
                     Write Bytes into MemoryBuffer at entry.patchAddress.
                     Update entry.status = 'Resolved', entry.patchedValue = Bytes.
     d. Parse Mnemonic and Operands:
          i. If Directive:
                - START: LocationCounter = startAddress.
                - END: Stop processing and verify all forward references are resolved.
                - DB / DW: Allocate byte(s) or word(s), advance LocationCounter.
                - EQU: Assign constant value to symbol (LC unchanged).
          ii. If Machine Instruction (MOV, ADD, SUB, INC, DEC, CMP, JMP, JE, JNE, HLT):
                - Calculate instruction length.
                - If operand refers to an undefined symbol:
                     - Generate machine code with placeholder 00s.
                     - Add entry to ForwardRefTable(symbol, patchAddress, nextIP, type).
                - Else:
                     - Generate machine code with fully resolved operand values.
                - Write generated bytes into MemoryBuffer at LocationCounter.
                - Advance LocationCounter by instruction length.
                - Record event in Trace Log.
4. Finalization:
     For each entry in ForwardRefTable:
          If entry.status == 'Unresolved':
               Signal Error: "Undefined symbol referenced at line [entry.sourceLine]".
     If no errors: Assembly Completed Successfully.
```

---

## 9. Forward Reference
A **Forward Reference** occurs when a program instruction references a symbol that appears later in the source text.

Consider this standard program:
```assembly
START:
    MOV AX, 05H
    JMP LOOP        ; Line 3: 'LOOP' is not yet known!
    ADD AX, BX
LOOP:               ; Line 5: 'LOOP' is defined here!
    MOV BX, AX
    HLT
```

At **Line 3**, the assembler processes `JMP LOOP`. The symbol `LOOP` does not exist in the Symbol Table.
The assembler handles this without failing:
1. It looks up `JMP` in the Opcode Table: Near jump opcode is `E9` (3 bytes total: 1 opcode byte + 2 displacement bytes).
2. It writes `E9 00 00` into the memory buffer at address `1003H`.
3. It creates an unresolved forward reference entry for `LOOP`:
   - Patch Address: `1004H` (points to the 2 displacement bytes)
   - Instruction LC: `1003H`
   - Next Instruction IP: `1006H` (`1003H + 3`)
   - Patch Size: 2 bytes
   - Type: `rel16` (16-bit relative displacement)

---

## 10. Backpatching
**Backpatching** is the algorithmic action of filling in address or displacement fields of previously generated instructions once the target label's address is discovered.

Continuing the example above:
1. At **Line 5**, the assembler encounters `LOOP:` at Location Counter `1008H`.
2. `LOOP` is entered into the Symbol Table with address `1008H`.
3. The assembler searches the Forward Reference Table for pending references to `LOOP`.
4. It finds the entry from Line 3.
5. In 8086 architecture, jump displacements are measured relative to the instruction pointer **after** the branch instruction has been fetched:
   $$\text{Displacement} = \text{Target Address} - \text{Next IP} = 1008\text{H} - 1006\text{H} = +0002\text{H}$$
6. Stored in Intel little-endian format:
   - Low byte = `02H`
   - High byte = `00H`
7. The assembler **backpatches** memory addresses `1004H` and `1005H`, changing `00 00` to `02 00`.
8. The final machine code for `JMP LOOP` becomes `E9 02 00`.

---

## 11. Symbol Table
The Symbol Table tracks identifiers throughout execution:

| Column | Purpose |
| :--- | :--- |
| **Symbol** | Name of the identifier (e.g., `START`, `LOOP`, `MAX_VAL`). |
| **Address** | Resolved memory location or equate constant (hex). |
| **Status** | `DEFINED` or `UNRESOLVED`. |
| **Type** | Label (`label`), Variable (`var`), or Equate Constant (`equ`). |
| **References** | List of source line numbers where the symbol is referenced. |

---

## 12. Location Counter (LC)
The **Location Counter** is the assembler's internal pointer that tracks the memory address at which the next instruction or data byte will be stored.
- Initialized by default to `1000H` or by `START [address]` (e.g., `START 2000H`).
- Incremented after each instruction by that instruction's byte length.
- Incremented by `1` for each byte allocated via `DB`.
- Incremented by `2` for each word allocated via `DW`.
- **Not incremented** for pseudo-op directives such as `EQU` or label-only lines (`LOOP:`).

---

## 13. Supported 8086 Educational Instruction Subset

The simulator supports real 8086 machine code encodings for the following subset:

| Mnemonic | Operand Formats | Example | Opcode / Encoding Rule | Size |
| :--- | :--- | :--- | :--- | :--- |
| `HLT` | None | `HLT` | `F4` | 1 Byte |
| `MOV` | reg16, reg16 | `MOV BX, AX` | `8B /r` with ModR/M (`11 reg r/m`) | 2 Bytes |
| `MOV` | reg8, reg8 | `MOV BL, AL` | `8A /r` with ModR/M (`11 reg r/m`) | 2 Bytes |
| `MOV` | reg16, imm16 / sym | `MOV AX, 05H` | `(B8 + reg)` + imm16 (little endian) | 3 Bytes |
| `MOV` | reg8, imm8 | `MOV AL, 05H` | `(B0 + reg)` + imm8 | 2 Bytes |
| `ADD` | reg16, reg16 | `ADD AX, BX` | `03` + ModR/M | 2 Bytes |
| `ADD` | reg8, reg8 | `ADD AL, BL` | `02` + ModR/M | 2 Bytes |
| `ADD` | AX, imm16 | `ADD AX, 1000H` | `05` + imm16 | 3 Bytes |
| `ADD` | AL, imm8 | `ADD AL, 05H` | `04` + imm8 | 2 Bytes |
| `SUB` | reg16, reg16 | `SUB AX, BX` | `2B` + ModR/M | 2 Bytes |
| `SUB` | reg8, reg8 | `SUB AL, BL` | `2A` + ModR/M | 2 Bytes |
| `SUB` | AX, imm16 | `SUB AX, 0010H` | `2D` + imm16 | 3 Bytes |
| `SUB` | AL, imm8 | `SUB AL, 02H` | `2C` + imm8 | 2 Bytes |
| `CMP` | reg16, reg16 | `CMP AX, BX` | `3B` + ModR/M | 2 Bytes |
| `CMP` | reg8, reg8 | `CMP AL, BL` | `3A` + ModR/M | 2 Bytes |
| `INC` | reg16 | `INC AX` | `40 + reg` | 1 Byte |
| `INC` | reg8 | `INC AL` | `FE` + (`C0 + reg`) | 2 Bytes |
| `DEC` | reg16 | `DEC CX` | `48 + reg` | 1 Byte |
| `DEC` | reg8 | `DEC CL` | `FE` + (`C8 + reg`) | 2 Bytes |
| `JMP` | label | `JMP LOOP` | `E9` + rel16 displacement | 3 Bytes |
| `JE` | label | `JE TARGET` | `74` + rel8 displacement | 2 Bytes |
| `JNE` | label | `JNE TARGET` | `75` + rel8 displacement | 2 Bytes |
| `START` | [address] | `START 1000H` | Sets initial Location Counter | 0 Bytes |
| `END` | [label] | `END` | Verifies symbol resolution and terminates | 0 Bytes |
| `DB` | value(s) | `DB 12H, 34H` | Allocates bytes in memory | 1 Byte / val |
| `DW` | value(s) | `DW 1000H` | Allocates 16-bit words (little endian) | 2 Bytes / val |
| `EQU` | constant | `MAX EQU 50H` | Assigns symbolic constant | 0 Bytes |

---

## 14. How to Run
This application is completely client-side and requires no complex build tools or backend servers.

### Option A: Direct Browser Execution
1. Clone or download the project files:
   - `index.html`
   - `style.css`
   - `script.js`
   - `README.md`
2. Open `index.html` directly in any modern web browser (Google Chrome, Firefox, Safari, Edge).

### Option B: Local Development Server
```bash
npm install
npm run dev
```
Open `http://localhost:3000` in your web browser.

---

## 15. Example Input and Output

### Input Source Code
```assembly
START:
    MOV AX, 05H
    JMP LOOP
    ADD AX, BX

LOOP:
    MOV BX, AX
    HLT
    END
```

### Trace Log
1. `Line 1:` `START` directive detected → Location Counter initialized to `1000H`.
2. `Line 2:` `MOV AX, 05H` → 3 bytes generated (`B8 05 00`), LC updated `1000H → 1003H`.
3. `Line 3:` `JMP LOOP` → Target `LOOP` is not in Symbol Table.
   - Placeholder generated: `E9 00 00` at `1003H`.
   - Forward reference logged: Patch address `1004H`, Next IP `1006H`.
   - LC updated `1003H → 1006H`.
4. `Line 4:` `ADD AX, BX` → 2 bytes generated (`03 C3`), LC updated `1006H → 1008H`.
5. `Line 5:` `LOOP:` label defined at `1008H`!
   - `LOOP` inserted into Symbol Table with Address `1008H`.
   - **Backpatching triggered:** Displacement = `1008H - 1006H = +0002H`.
   - Bytes at `1004H` and `1005H` updated from `00 00` to `02 00`.
6. `Line 6:` `MOV BX, AX` → 2 bytes generated (`8B D8`), LC updated `1008H → 100AH`.
7. `Line 7:` `HLT` → 1 byte generated (`F4`), LC updated `100AH → 100BH`.
8. `Line 8:` `END` → 0 pending unresolved references. Assembly completed with 0 errors.

### Disassembly Listing Output
```text
Line  Address  Machine Code      Source Statement
----  -------  ----------------  ------------------------------
   1  1000H                      START:
   2  1000H    B8 05 00          MOV AX, 05H
   3  1003H    E9 02 00          JMP LOOP
   4  1006H    03 C3             ADD AX, BX
   5  1008H                      LOOP:
   6  1008H    8B D8             MOV BX, AX
   7  100AH    F4                HLT
   8  100BH                      END
```

---

## 16. Limitations
1. **Instruction Set Scope:** Implements an educational subset of 8086 instructions rather than all 20,000+ combinations of modern x86.
2. **Addressing Modes:** Focuses primarily on register-to-register, register-to-immediate, and relative branch addressing modes. Complex segmented indexed modes (`[BX+SI+disp]`) are excluded to maintain conceptual clarity.
3. **Macro Processing:** Does not include a macro preprocessor pass (`MACRO` / `ENDM`).
4. **Relocation & Linking:** Generates flat binary real-mode image rather than Microsoft OBJ or ELF relocatable linkable object records.

---

## 17. Future Improvements
1. **Step-Back (Undo) Capability:** Allow stepping backwards through the assembly execution history to re-observe states.
2. **Visual Memory Grid View:** Provide an interactive canvas representation of the RAM segments.
3. **Integrated 8086 CPU Emulator:** Allow running the assembled machine code inside an interactive virtual CPU register display.
4. **Macro Processor Extension:** Add a front-end macro expansion pass demonstrating macro definition and invocation tables.

---

## 18. Viva Voce Questions and Answers

### Q1: What is a Location Counter (LC)?
**Answer:** The Location Counter is an internal variable or register maintained by the assembler to assign memory addresses to instructions, labels, and allocated data constants. It is initialized by `START` and increments by the byte size of each processed instruction.

### Q2: What is the main disadvantage of a single-pass assembler?
**Answer:** The principal disadvantage is that the generated machine code cannot be streamed directly to sequential output media (like tape or stdout) because forward-referenced instructions must be modified later via backpatching. Therefore, the object code must reside in a random-access memory buffer.

### Q3: Why is 8086 JMP relative rather than absolute?
**Answer:** In 8086 architecture, short and near conditional and unconditional jumps use relative displacement from the Instruction Pointer (IP). This produces position-independent code (PIC) that can execute correctly regardless of where the code segment is relocated in physical memory.

### Q4: How is displacement calculated during backpatching?
**Answer:**
$$\text{Displacement} = \text{Target Label Address} - \text{Next Instruction Address (Next IP)}$$
Where `Next IP` is the address immediately following the jump instruction (i.e., `Jump Instruction LC + Jump Instruction Length`).

### Q5: What error occurs if a label in the forward reference table remains unresolved at END?
**Answer:** The assembler reports an **"Undefined Symbol"** error, stating that a symbol was used as an operand but was never defined as a label or variable anywhere in the source program.

### Q6: What is the purpose of the EQU directive?
**Answer:** `EQU` (Equate) defines an assembly-time constant symbol. Unlike `DB` or `DW`, it does **not** allocate physical memory or advance the Location Counter; it merely binds a symbolic name to a numeric value in the Symbol Table.
