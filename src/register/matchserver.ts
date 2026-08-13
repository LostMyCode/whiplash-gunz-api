/**
 * matchserver.ts
 *
 * Encodes and decodes GunZ MCommand binary packets, performs the
 * REPLYCONNECT handshake (which establishes encryption keys), and
 * sends MC_MATCH_REQUEST_CREATE_ACCOUNT over a WebSocket connection.
 *
 * Protocol overview (all multi-byte integers are little-endian):
 *
 *   Every TCP frame is prefixed by MPacketHeader (6 bytes, packed):
 *     u16 nMsg       -- message type:
 *                         10  = MSGID_REPLYCONNECT  (server → client, handshake)
 *                        100  = MSGID_RAWCOMMAND     (no encryption)
 *                        101  = MSGID_COMMAND        (encrypted payload)
 *     u16 nSize      -- total frame size including the 6-byte header
 *                       (may itself be encrypted when nMsg == MSGID_COMMAND)
 *     u16 nCheckSum  -- sum of bytes from offset 6 to end, folded to 16 bits
 *
 *   After the header the MCommand payload follows:
 *     u16 totalSize  -- total size of the command payload (same as nSize-6)
 *     u16 commandID  -- MC_* constant
 *     u8  serialNum  -- rolling serial number (0 for first packet)
 *     [parameters…]
 *
 *   Parameter encoding:
 *     MPT_STR  : u16 byteLen, then byteLen bytes (no null terminator)
 *     MPT_BLOB : u32 byteLen, then byteLen bytes
 *
 *   Encryption (MPacketCrypter):
 *     MCOMMAND_VERSION = 55  →  m_nSHL = (55 % 6) + 1 = 2
 *     Key: 32-byte array derived by MMakeSeedKey(serverUID, clientUID, timestamp)
 *     Per-byte cipher (XOR-based bit-rotation):
 *       Enc(s, key): b = s ^ key; w = b << 2; return (w&0xFF | w>>8) ^ 0xF0
 *       Dec(s, key): b = s ^ 0xF0; d = (b&3)<<6 | b>>2; return d ^ key
 *     Both the command payload AND nSize in the header are encrypted
 *     with their own independent key streams (key index resets to 0 for
 *     each field).
 *
 *   Handshake:
 *     Server sends MSGID_REPLYCONNECT (26 bytes total) immediately after
 *     connecting, containing serverUID (High+Low u32s), clientUID (High+Low
 *     u32s), and a u32 timestamp.  The client uses these to derive the
 *     encryption key before sending any MSGID_COMMAND packet.
 */

import WebSocket from 'ws';
import sodium = require('libsodium-wrappers');

// ---------------------------------------------------------------------------
// WebSocket transport helpers
//
// The GunZ MatchServer-ws binary (ogz-server/MatchServer-ws) speaks WebSocket
// on port 6032.  Raw TCP on port 6000 is also open but its send path is
// broken in the current binary (IsWebSocketHandle heuristic treats all Linux
// heap-based handles as WebSocket handles and drops TCP sends silently).
//
// The WebSocket frame format mirrors the ogz-ws-proxy-server wire format:
//   Send:    [0x01][payload]   — TCP data to server
//   Receive: [0x01][payload]   — TCP data from server
// ---------------------------------------------------------------------------

const PKT_TYPE_TCP = 0x01;

/**
 * Open a WebSocket connection to the MatchServer and return a simple
 * send/receive interface.  All GunZ protocol bytes are wrapped/unwrapped
 * in the 0x01-prefix binary frame format automatically.
 */
function connectWS(host: string, port: number): {
    send: (data: Buffer) => void;
    onData: (cb: (chunk: Buffer) => void) => void;
    onError: (cb: (err: Error) => void) => void;
    onClose: (cb: () => void) => void;
    destroy: () => void;
} {
    const url = `ws://${host}:${port}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'nodebuffer';

    let dataCallback: ((chunk: Buffer) => void) | null = null;
    let errorCallback: ((err: Error) => void) | null = null;
    let closeCallback: (() => void) | null = null;

    // Buffer any messages that arrive before onData() is called.
    const pendingData: Buffer[] = [];

    ws.on('message', (raw: Buffer) => {
        // Unwrap the [0x01][payload] frame — strip the first byte
        if (raw.length < 1 || raw[0] !== PKT_TYPE_TCP) return;
        const payload = raw.subarray(1) as Buffer;
        if (dataCallback) {
            dataCallback(payload);
        } else {
            pendingData.push(payload);
        }
    });

    ws.on('error', (err: Error) => {
        if (errorCallback) errorCallback(err);
    });

    ws.on('close', () => {
        if (closeCallback) closeCallback();
    });

    return {
        send(data: Buffer) {
            const frame = Buffer.allocUnsafe(1 + data.length);
            frame[0] = PKT_TYPE_TCP;
            data.copy(frame, 1);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(frame);
            }
        },
        onData(cb) {
            dataCallback = cb;
            // Flush any messages that arrived before this callback was registered
            while (pendingData.length > 0) {
                cb(pendingData.shift()!);
            }
        },
        onError(cb) { errorCallback = cb; },
        onClose(cb) { closeCallback = cb; },
        destroy() {
            ws.removeAllListeners();
            ws.terminate();
        },
    };
}

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

const MSGID_REPLYCONNECT = 10;
const MSGID_RAWCOMMAND   = 100;
const MSGID_COMMAND      = 101;

const MC_MATCH_REQUEST_CREATE_ACCOUNT  = 8006;
const MC_MATCH_RESPONSE_CREATE_ACCOUNT = 8007;

// Google OAuth commands (added in feat/google-oauth-server)
const MC_MATCH_LOGIN_GOOGLE           = 8022; // Client → Server: Google ID token
const MC_MATCH_RESPONSE_LOGIN_GOOGLE  = 8024; // Server → Client: session token response
const MC_MATCH_RESPONSE_LOGIN_FAILED  = 1011; // Server → Client: login failure with reason string

const MCOMMAND_VERSION = 55;

// m_nSHL for the cipher (matches C++ MPacketCrypter::InitConst)
const M_SHL = (MCOMMAND_VERSION % 6) + 1; // = 2

// PACKET_CRYPTER_KEY_LEN
const KEY_LEN = 32;

// MReplyConnectMsg total size: 6-byte MPacketHeader + 5 × u32 fields
// (nHostHigh, nHostLow, nAllocHigh, nAllocLow, nTimeStamp) = 26 bytes
const REPLY_CONNECT_SIZE = 6 + 5 * 4; // = 26 bytes

// ---------------------------------------------------------------------------
// MPacketCrypter — per-byte cipher
// ---------------------------------------------------------------------------

/**
 * Encrypt a single byte with a key byte.
 * Matches C++: b = s^key; w = b<<SHL; return (w&0xFF | w>>8) ^ 0xF0
 */
function encByte(s: number, key: number): number {
    const b = (s ^ key) & 0xFF;
    const w = b << M_SHL;
    return ((w & 0xFF) | ((w & 0xFF00) >> 8)) ^ 0xF0;
}

/**
 * Encrypt a Buffer in-place using the key, starting at keyIndex.
 * Returns the updated keyIndex after processing all bytes.
 */
function encrypt(buf: Buffer, key: Buffer, keyIndex = 0): number {
    for (let i = 0; i < buf.length; i++) {
        buf[i] = encByte(buf[i], key[keyIndex]);
        keyIndex = (keyIndex + 1) % KEY_LEN;
    }
    return keyIndex;
}

/**
 * Decrypt a single byte with a key byte.
 * Matches C++: b = s^0xF0; bh = b & m_ShlMask (= b & 3); d = (bh<<(8-SHL)) | (b>>SHL); return d^key
 * m_ShlMask = sum of (1<<i) for i in 0..SHL-1 = 3 when SHL=2.
 */
function decByte(s: number, key: number): number {
    const b = (s ^ 0xF0) & 0xFF;
    const bh = b & 3; // m_ShlMask = 3 when M_SHL = 2
    const d = ((bh << (8 - M_SHL)) | (b >> M_SHL)) & 0xFF;
    return (d ^ key) & 0xFF;
}

/**
 * Decrypt a Buffer in-place using the key, starting at keyIndex.
 * Returns the updated keyIndex after processing all bytes.
 */
function decrypt(buf: Buffer, key: Buffer, keyIndex = 0): number {
    for (let i = 0; i < buf.length; i++) {
        buf[i] = decByte(buf[i], key[keyIndex]);
        keyIndex = (keyIndex + 1) % KEY_LEN;
    }
    return keyIndex;
}

// ---------------------------------------------------------------------------
// MMakeSeedKey — matches C++ MMatchUtil.cpp
// ---------------------------------------------------------------------------

/**
 * Derives the 32-byte MPacketCrypterKey from server UID, client UID,
 * and the timestamp sent in MSGID_REPLYCONNECT.
 *
 * Layout (matches C++ MMakeSeedKey in MMatchUtil.cpp exactly — see the
 * "// Fix: Include High part" comment there):
 *
 *   memcpy(p,     &nTimeStamp,    4)  → bytes  0..3
 *   memcpy(p + 4, &uidServer.Low, 4)  → bytes  4..7
 *   memcpy(p + 8, &uidServer.High,4)  → bytes  8..11
 *   memcpy(p + 12,&uidClient.Low, 4)  → bytes 12..15
 *   XOR bytes 0..15 with constant XOR[16]
 *   Fixed IV bytes 16..31 (uidClient.High is overwritten by the IV, unused)
 *
 * SHARED WIRE CONTRACT: this must byte-for-byte match MMakeSeedKey in
 * whiplash-gunz (src/CSCommon/Source/MMatchUtil.cpp). Don't change one side
 * without the other and a coordinated redeploy.
 */
function makeSeedKey(
    serverHigh: number,   // serverUID.High — written at offset 8
    serverLow: number,    // serverUID.Low  — written at offset 4
    clientHigh: number,   // clientUID.High — NOT used (overwritten by fixed IV)
    clientLow: number,    // clientUID.Low  — written at offset 12
    timestamp: number,
): Buffer {
    const XOR = [87, 2, 91, 4, 52, 6, 1, 8, 55, 10, 18, 105, 65, 56, 15, 120];

    const key = Buffer.alloc(KEY_LEN, 0);

    // Bytes 0..3:   timestamp (u32 LE)
    // Bytes 4..7:   serverUID.Low  (C++: memcpy(p+4, &uidServer.Low, 4))
    // Bytes 8..11:  serverUID.High (C++: memcpy(p+8, &uidServer.High, 4))
    // Bytes 12..15: clientUID.Low  (C++: memcpy(p+12, &uidClient.Low, 4))
    key.writeUInt32LE(timestamp,  0);
    key.writeUInt32LE(serverLow,  4);
    key.writeUInt32LE(serverHigh, 8);
    key.writeUInt32LE(clientLow,  12);

    // XOR the first 16 bytes with the constant XOR table
    for (let i = 0; i < 16; i++) {
        key[i] ^= XOR[i];
    }

    // Fixed IV for bytes 16..31 (C++: p = p+16; p[0..15] = ...)
    key[16] = 55;
    key[17] = 4;
    key[18] = 93;
    key[19] = 46;
    key[20] = 67;
    key[21] = MCOMMAND_VERSION; // 55
    key[22] = 73;
    key[23] = 83;
    key[24] = 80;
    key[25] = 5;
    key[26] = 19;
    key[27] = 201;
    key[28] = 40;
    key[29] = 164;
    key[30] = 77;
    key[31] = 5;

    return key;
}

// ---------------------------------------------------------------------------
// Checksum — matches C++ MBuildCheckSum
// ---------------------------------------------------------------------------

/**
 * Compute the 16-bit checksum over the packet buffer.
 *
 * Matches C++ MBuildCheckSum:
 *   1. Sum bytes from offset sizeof(MPacketHeader)=6 to end of packet.
 *   2. Subtract bytes 0..3 (nMsg u16 LE + nSize u16 LE, the first 4 header bytes).
 *   3. Fold 32-bit result into 16 bits.
 *
 * For MSGID_COMMAND packets the nSize bytes at offset 2..3 are already
 * encrypted before this function is called, so the checksum covers the
 * encrypted form.
 */
function buildCheckSum(buf: Buffer): number {
    let sum = 0;
    for (let i = 6; i < buf.length; i++) {
        sum += buf[i];
    }
    sum -= buf[0] + buf[1] + buf[2] + buf[3];
    // Fold 32-bit sum into 16 bits
    sum = (sum & 0xFFFF) + ((sum >>> 16) & 0xFFFF);
    return sum & 0xFFFF;
}

// ---------------------------------------------------------------------------
// MCommand encoding
// ---------------------------------------------------------------------------

/**
 * Encode a signed 32-bit integer parameter (MPT_INT): u32 LE.
 */
function encodeInt(value: number): Buffer {
    const out = Buffer.allocUnsafe(4);
    out.writeInt32LE(value, 0);
    return out;
}

/**
 * Encode an unsigned 32-bit integer parameter (MPT_UINT): u32 LE.
 */
function encodeUInt(value: number): Buffer {
    const out = Buffer.allocUnsafe(4);
    out.writeUInt32LE(value >>> 0, 0);
    return out;
}

/**
 * Encode a string parameter matching MCommandParameterString::GetData wire format:
 *   u16 nValueSize = strlen(str) + 2   (includes null terminator + 1 spare byte)
 *   nValueSize bytes: the UTF-8 string followed by two zero bytes
 *
 * The C++ SetData copies exactly nValueSize bytes into m_Value without adding its
 * own null terminator, so the null terminator must be included in the payload.
 * Omitting it causes strlen(m_Value) to read past the buffer, potentially appending
 * garbage bytes to the curl URL and triggering CURLE_URL_MALFORMAT.
 */
function encodeStr(str: string): Buffer {
    const strBuf = Buffer.from(str, 'utf8');
    // nValueSize = strBuf.length + 2 (null terminator + 1 spare), matching C++ GetData
    const nValueSize = strBuf.length + 2;
    const out = Buffer.alloc(2 + nValueSize); // Buffer.alloc zero-fills (provides the null bytes)
    out.writeUInt16LE(nValueSize, 0);
    strBuf.copy(out, 2);
    return out;
}

/**
 * Encode a blob parameter: u32 len + bytes.
 */
function encodeBlob(data: Buffer): Buffer {
    const out = Buffer.allocUnsafe(4 + data.length);
    out.writeUInt32LE(data.length, 0);
    data.copy(out, 4);
    return out;
}

/**
 * Build the raw MCommand payload (no packet header) for
 * MC_MATCH_REQUEST_CREATE_ACCOUNT.
 *
 * Layout:
 *   u16 totalSize
 *   u16 commandID  = 8006
 *   u8  serialNum  = 0
 *   u16 usernameLen + username bytes      (MPT_STR)
 *   u32 hashLen     + hashBytes           (MPT_BLOB)
 *   u16 emailLen    + email bytes         (MPT_STR)
 *   u16 secretLen   + sharedSecret bytes  (MPT_STR)
 */
function buildCreateAccountCommand(username: string, hashedPassword: Buffer, email: string, sharedSecret: string): Buffer {
    const pUsername = encodeStr(username);
    const pPassword = encodeBlob(hashedPassword);
    const pEmail    = encodeStr(email);
    const pSecret   = encodeStr(sharedSecret);

    // totalSize includes itself (2 bytes) + commandID (2) + serial (1) + params
    const totalSize = 2 + 2 + 1 + pUsername.length + pPassword.length + pEmail.length + pSecret.length;

    const cmd = Buffer.allocUnsafe(totalSize);
    let offset = 0;

    cmd.writeUInt16LE(totalSize, offset); offset += 2;
    cmd.writeUInt16LE(MC_MATCH_REQUEST_CREATE_ACCOUNT, offset); offset += 2;
    cmd.writeUInt8(0, offset); offset += 1; // serial number

    pUsername.copy(cmd, offset); offset += pUsername.length;
    pPassword.copy(cmd, offset); offset += pPassword.length;
    pEmail.copy(cmd, offset);    offset += pEmail.length;
    pSecret.copy(cmd, offset);

    return cmd;
}

/**
 * Build the raw MCommand payload for MC_MATCH_LOGIN_GOOGLE (8022).
 *
 * Layout (matches MSharedCommandTable.cpp definition):
 *   u16 totalSize
 *   u16 commandID  = 8022
 *   u8  serialNum  = 0
 *   u16 idTokenLen + idToken bytes      (MPT_STR)
 *   i32 commandVersion                  (MPT_INT)  = MCOMMAND_VERSION (55)
 *   u32 checksumPack                    (MPT_UINT) = 0
 *   u32 major                           (MPT_UINT) = 0
 *   u32 minor                           (MPT_UINT) = 0
 *   u32 patch                           (MPT_UINT) = 0
 *   u32 revision                        (MPT_UINT) = 0
 */
function buildLoginGoogleCommand(idToken: string): Buffer {
    const pIdToken        = encodeStr(idToken);
    const pCmdVersion     = encodeInt(MCOMMAND_VERSION);
    const pChecksumPack   = encodeUInt(0);
    const pMajor          = encodeUInt(0);
    const pMinor          = encodeUInt(0);
    const pPatch          = encodeUInt(0);
    const pRevision       = encodeUInt(0);

    const totalSize = 2 + 2 + 1
        + pIdToken.length
        + pCmdVersion.length
        + pChecksumPack.length
        + pMajor.length
        + pMinor.length
        + pPatch.length
        + pRevision.length;

    const cmd = Buffer.allocUnsafe(totalSize);
    let offset = 0;

    cmd.writeUInt16LE(totalSize, offset);         offset += 2;
    cmd.writeUInt16LE(MC_MATCH_LOGIN_GOOGLE, offset); offset += 2;
    cmd.writeUInt8(0, offset);                    offset += 1; // serial number

    pIdToken.copy(cmd, offset);      offset += pIdToken.length;
    pCmdVersion.copy(cmd, offset);   offset += pCmdVersion.length;
    pChecksumPack.copy(cmd, offset); offset += pChecksumPack.length;
    pMajor.copy(cmd, offset);        offset += pMajor.length;
    pMinor.copy(cmd, offset);        offset += pMinor.length;
    pPatch.copy(cmd, offset);        offset += pPatch.length;
    pRevision.copy(cmd, offset);

    return cmd;
}

/**
 * Wrap a command payload in a MPacketHeader and apply encryption.
 *
 * For MSGID_COMMAND the nSize field in the header is also encrypted
 * (with a fresh key stream starting at index 0), then the command
 * payload is encrypted (also starting at key index 0).
 *
 * Checksum is computed over the final (partially encrypted) buffer.
 */
function wrapInPacket(cmdBuf: Buffer, msgId: number, key: Buffer | null): Buffer {
    const packetSize = 6 + cmdBuf.length;
    const pkt = Buffer.allocUnsafe(packetSize);

    pkt.writeUInt16LE(msgId, 0);
    pkt.writeUInt16LE(packetSize, 2); // nSize (plaintext before possible encryption)
    pkt.writeUInt16LE(0, 4);          // nCheckSum placeholder

    cmdBuf.copy(pkt, 6);

    if (msgId === MSGID_COMMAND && key) {
        // Encrypt nSize (2 bytes) with key stream starting at index 0
        const nSizeBuf = Buffer.allocUnsafe(2);
        nSizeBuf.writeUInt16LE(packetSize, 0);
        encrypt(nSizeBuf, key, 0);
        nSizeBuf.copy(pkt, 2);

        // Encrypt the command payload with key stream starting at index 0
        const payloadBuf = pkt.subarray(6);
        encrypt(payloadBuf, key, 0);
    }

    pkt.writeUInt16LE(buildCheckSum(pkt), 4);
    return pkt;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface ParsedCommand {
    commandID: number;
    payload: Buffer;  // raw decrypted payload (after the 5-byte header)
}

/**
 * Decrypt and extract the MCommand payload from a raw received frame.
 *
 * Handles both MSGID_COMMAND (encrypted) and MSGID_RAWCOMMAND (plaintext).
 * Returns null if the frame is incomplete, malformed, or uses an unexpected
 * message type.
 */
function parseResponsePacket(buf: Buffer, key: Buffer | null): ParsedCommand | null {
    if (buf.length < 6) return null;

    const nMsg  = buf.readUInt16LE(0);
    let nSize: number;
    let payload: Buffer;

    if (nMsg === MSGID_COMMAND) {
        if (!key) return null;

        // Decrypt nSize (2 bytes)
        const nSizeBuf = buf.subarray(2, 4);
        const nSizeCopy = Buffer.from(nSizeBuf);
        decrypt(nSizeCopy, key, 0);
        nSize = nSizeCopy.readUInt16LE(0);

        if (buf.length < nSize) return null;

        // Decrypt command payload
        payload = Buffer.from(buf.subarray(6, nSize));
        decrypt(payload, key, 0);
    } else if (nMsg === MSGID_RAWCOMMAND) {
        nSize = buf.readUInt16LE(2);
        if (buf.length < nSize) return null;
        payload = buf.subarray(6, nSize);
    } else {
        return null;
    }

    if (payload.length < 5) return null; // u16 totalSize + u16 cmdID + u8 serial

    const commandID = payload.readUInt16LE(2);
    const params    = payload.subarray(5); // raw parameter bytes after serial
    return { commandID, payload: params };
}

/**
 * Parse an MPT_STR parameter from a command parameter buffer.
 *
 * The GunZ wire format for MPT_STR (MCommandParameterString::GetData) is:
 *   u16 nValueSize  = strlen(str) + 2
 *   nValueSize bytes of string data (includes the C-string null terminator + 1 spare byte)
 *
 * We read nValueSize bytes but trim everything from the first null byte onward,
 * so the returned string matches the original C-string value without trailing garbage.
 *
 * Returns null if the buffer is too short.
 */
function readStr(buf: Buffer, offset: number): { value: string; next: number } | null {
    if (offset + 2 > buf.length) return null;
    const nValueSize = buf.readUInt16LE(offset);
    offset += 2;
    if (offset + nValueSize > buf.length) return null;
    const raw = buf.slice(offset, offset + nValueSize);
    const nullIdx = raw.indexOf(0);
    const value = (nullIdx >= 0 ? raw.slice(0, nullIdx) : raw).toString('utf8');
    return { value, next: offset + nValueSize };
}

/**
 * Parse MC_MATCH_RESPONSE_CREATE_ACCOUNT (8007) from a raw parameter buffer.
 * Layout: MPT_STR message
 */
function parseCreateAccountResponse(params: Buffer): { message: string } | null {
    const r = readStr(params, 0);
    if (!r) return null;
    return { message: r.value };
}

/**
 * Parse MC_MATCH_RESPONSE_LOGIN_GOOGLE (8024) from a raw parameter buffer.
 * Layout: MPT_INT result, MPT_STR sessionToken, MPT_INT expiresAt
 */
function parseLoginGoogleResponse(params: Buffer): {
    result: number;
    sessionToken: string;
    expiresAt: number;
} | null {
    if (params.length < 4) return null;
    const result = params.readInt32LE(0);
    let offset = 4;

    const tokenResult = readStr(params, offset);
    if (!tokenResult) return null;
    offset = tokenResult.next;

    if (offset + 4 > params.length) return null;
    const expiresAt = params.readInt32LE(offset);

    return { result, sessionToken: tokenResult.value, expiresAt };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CreateAccountResult {
    success: boolean;
    message: string;
}

/**
 * Connect to the GunZ MatchServer via TCP, perform the REPLYCONNECT
 * handshake, send MC_MATCH_REQUEST_CREATE_ACCOUNT, and return the server
 * response.
 *
 * @param host         - MatchServer hostname or IP address
 * @param port         - MatchServer TCP port (default 6000)
 * @param username     - Desired account username
 * @param passwordRaw  - Plaintext password (will be blake2b-hashed)
 * @param email        - Account e-mail address
 * @param sharedSecret - Shared registration secret (must match REGISTRATION_SECRET on the server)
 */
export async function createAccount(
    host: string,
    port: number,
    username: string,
    passwordRaw: string,
    email: string,
    sharedSecret: string,
): Promise<CreateAccountResult> {
    await sodium.ready;

    // Hash the password with BLAKE2b (32-byte output = crypto_generichash_BYTES)
    const passwordHash = Buffer.from(
        sodium.crypto_generichash(
            sodium.crypto_generichash_BYTES, // 32 bytes
            Buffer.from(passwordRaw, 'utf8')
        )
    );

    return new Promise((resolve, reject) => {
        const TIMEOUT_MS = 10_000;

        // Use WebSocket transport: the MatchServer-ws binary speaks WebSocket on
        // the configured port (default 6032). Raw TCP on port 6000 is present
        // but broken in the current binary (sends are silently dropped).
        const conn = connectWS(host, port);

        let settled = false;
        function settle(fn: () => void) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            conn.destroy();
            fn();
        }

        let timer = setTimeout(() => {
            settle(() => reject(new Error('Timeout waiting for MatchServer response')));
        }, TIMEOUT_MS);

        conn.onError((err: Error) => {
            settle(() => reject(err));
        });

        // Receive-state machine
        //   Phase 0: waiting for MSGID_REPLYCONNECT (28 bytes)
        //   Phase 1: waiting for MC_MATCH_RESPONSE_CREATE_ACCOUNT
        let phase = 0;
        let recvBuf = Buffer.alloc(0);
        let cryptoKey: Buffer | null = null; // derived after REPLYCONNECT

        const onChunk = (chunk: Buffer) => {
            recvBuf = Buffer.concat([recvBuf, chunk]);

            if (phase === 0) {
                // We expect exactly REPLY_CONNECT_SIZE bytes for the handshake
                if (recvBuf.length < REPLY_CONNECT_SIZE) return;

                const nMsg = recvBuf.readUInt16LE(0);
                if (nMsg !== MSGID_REPLYCONNECT) {
                    settle(() => reject(new Error(`Expected MSGID_REPLYCONNECT (10), got ${nMsg}`)));
                    return;
                }

                // MReplyConnectMsg layout (after 6-byte header):
                //   u32 nHostHigh   (server UID high)
                //   u32 nHostLow    (server UID low)
                //   u32 nAllocHigh  (client UID high assigned by server)
                //   u32 nAllocLow   (client UID low assigned by server)
                //   u32 nTimeStamp
                const serverHigh = recvBuf.readUInt32LE(6);
                const serverLow  = recvBuf.readUInt32LE(10);
                const clientHigh = recvBuf.readUInt32LE(14);
                const clientLow  = recvBuf.readUInt32LE(18);
                const timestamp  = recvBuf.readUInt32LE(22);

                cryptoKey = makeSeedKey(serverHigh, serverLow, clientHigh, clientLow, timestamp);

                // Consume the handshake bytes from the buffer
                recvBuf = recvBuf.subarray(REPLY_CONNECT_SIZE);

                // Build and send MC_MATCH_REQUEST_CREATE_ACCOUNT
                const cmdBuf = buildCreateAccountCommand(username, passwordHash, email, sharedSecret);

                // NOTE: MC_MATCH_REQUEST_CREATE_ACCOUNT is not flagged MCCT_NON_ENCRYPTED
                // and we are not in MCM_WORKER mode, so it must be sent as MSGID_COMMAND
                // (encrypted) matching what the C++ MClient::MakeCmdPacket does.
                const packet = wrapInPacket(cmdBuf, MSGID_COMMAND, cryptoKey);

                conn.send(packet);
                phase = 1;

                // If there is already buffered data from phase 1, process it now
                // instead of waiting for the next WS message to arrive.
                if (recvBuf.length > 0) {
                    onChunk(Buffer.alloc(0));
                    return;
                }

            } else if (phase === 1) {
                // We need at least a full packet header
                if (recvBuf.length < 6) return;

                const nMsg = recvBuf.readUInt16LE(0);

                // Determine total frame length
                // For MSGID_COMMAND nSize is encrypted; decrypt it first
                let frameSize: number;
                if (nMsg === MSGID_COMMAND) {
                    const nSizeBuf = Buffer.from(recvBuf.subarray(2, 4));
                    decrypt(nSizeBuf, cryptoKey!, 0);
                    frameSize = nSizeBuf.readUInt16LE(0);
                } else {
                    frameSize = recvBuf.readUInt16LE(2);
                }

                if (recvBuf.length < frameSize) return;

                const result = parseResponsePacket(recvBuf.subarray(0, frameSize), cryptoKey);

                if (!result) {
                    settle(() => reject(new Error('Failed to parse MatchServer response')));
                    return;
                }

                // Skip unrelated commands (e.g. MC_CLOCK_SYNCHRONIZE sent on connect)
                if (result.commandID !== MC_MATCH_RESPONSE_CREATE_ACCOUNT) {
                    recvBuf = recvBuf.subarray(frameSize);
                    return;
                }

                const parsed = parseCreateAccountResponse(result.payload);
                if (!parsed) {
                    settle(() => reject(new Error('Malformed MC_MATCH_RESPONSE_CREATE_ACCOUNT payload')));
                    return;
                }

                const success = parsed.message === 'Account created!';
                settle(() => resolve({ success, message: parsed.message }));
            }
        };

        conn.onData(onChunk);

        conn.onClose(() => {
            // If we close before getting a response, reject
            if (phase === 1) {
                settle(() => reject(new Error('Connection closed before receiving response')));
            }
        });
    });
}

// ---------------------------------------------------------------------------
// Google OAuth login / auto-register
// ---------------------------------------------------------------------------

export interface LoginGoogleResult {
    success: boolean;
    message: string;
    sessionToken?: string;
    expiresAt?: number;
}

/**
 * Connect to the GunZ MatchServer via TCP, perform the REPLYCONNECT
 * handshake, send MC_MATCH_LOGIN_GOOGLE (8022), and return the session
 * token from MC_MATCH_RESPONSE_LOGIN_GOOGLE (8024).
 *
 * The server will automatically create an account for first-time Google
 * users, so this doubles as a "register with Google" endpoint.
 *
 * @param host         - MatchServer hostname or IP address
 * @param port         - MatchServer TCP port (default 6000)
 * @param idToken      - Google ID token obtained from the Google Identity SDK
 */
export async function loginWithGoogle(
    host: string,
    port: number,
    idToken: string,
): Promise<LoginGoogleResult> {
    return new Promise((resolve, reject) => {
        const TIMEOUT_MS = 15_000;

        const conn = connectWS(host, port);

        let settled = false;
        function settle(fn: () => void) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            conn.destroy();
            fn();
        }

        let timer = setTimeout(() => {
            settle(() => reject(new Error('Timeout waiting for MatchServer response')));
        }, TIMEOUT_MS);

        conn.onError((err: Error) => {
            settle(() => reject(err));
        });

        // Receive-state machine
        //   Phase 0: waiting for MSGID_REPLYCONNECT (26 bytes)
        //   Phase 1: waiting for MC_MATCH_RESPONSE_LOGIN_GOOGLE
        let phase = 0;
        let recvBuf = Buffer.alloc(0);
        let cryptoKey: Buffer | null = null;

        const onChunk = (chunk: Buffer) => {
            recvBuf = Buffer.concat([recvBuf, chunk]);

            if (phase === 0) {
                if (recvBuf.length < REPLY_CONNECT_SIZE) return;

                const nMsg = recvBuf.readUInt16LE(0);
                if (nMsg !== MSGID_REPLYCONNECT) {
                    settle(() => reject(new Error(`Expected MSGID_REPLYCONNECT (10), got ${nMsg}`)));
                    return;
                }

                const serverHigh = recvBuf.readUInt32LE(6);
                const serverLow  = recvBuf.readUInt32LE(10);
                const clientHigh = recvBuf.readUInt32LE(14);
                const clientLow  = recvBuf.readUInt32LE(18);
                const timestamp  = recvBuf.readUInt32LE(22);

                cryptoKey = makeSeedKey(serverHigh, serverLow, clientHigh, clientLow, timestamp);
                recvBuf = recvBuf.subarray(REPLY_CONNECT_SIZE);

                // Build and send MC_MATCH_LOGIN_GOOGLE
                const cmdBuf = buildLoginGoogleCommand(idToken);
                const packet = wrapInPacket(cmdBuf, MSGID_COMMAND, cryptoKey);

                conn.send(packet);
                phase = 1;

                // If there is already buffered data from phase 1, process it now
                // instead of waiting for the next WS message to arrive.
                if (recvBuf.length > 0) {
                    onChunk(Buffer.alloc(0));
                    return;
                }

            } else if (phase === 1) {
                if (recvBuf.length < 6) return;

                const nMsg = recvBuf.readUInt16LE(0);
                let frameSize: number;
                if (nMsg === MSGID_COMMAND) {
                    const nSizeBuf = Buffer.from(recvBuf.subarray(2, 4));
                    decrypt(nSizeBuf, cryptoKey!, 0);
                    frameSize = nSizeBuf.readUInt16LE(0);
                } else {
                    frameSize = recvBuf.readUInt16LE(2);
                }

                if (recvBuf.length < frameSize) return;

                const result = parseResponsePacket(recvBuf.subarray(0, frameSize), cryptoKey);

                if (!result) {
                    settle(() => reject(new Error('Failed to parse MatchServer response')));
                    return;
                }

                // Handle login failure response
                if (result.commandID === MC_MATCH_RESPONSE_LOGIN_FAILED) {
                    const r = readStr(result.payload, 0);
                    const msg = r ? r.value : 'Google login failed';
                    settle(() => resolve({ success: false, message: msg }));
                    return;
                }

                // Skip unrelated commands (e.g. MC_CLOCK_SYNCHRONIZE sent on connect)
                if (result.commandID !== MC_MATCH_RESPONSE_LOGIN_GOOGLE) {
                    recvBuf = recvBuf.subarray(frameSize);
                    return;
                }

                const parsed = parseLoginGoogleResponse(result.payload);
                if (!parsed) {
                    settle(() => reject(new Error('Malformed MC_MATCH_RESPONSE_LOGIN_GOOGLE payload')));
                    return;
                }

                if (parsed.result !== 0) {
                    settle(() => resolve({
                        success: false,
                        message: `Google login rejected by server (code ${parsed.result})`,
                    }));
                    return;
                }

                settle(() => resolve({
                    success: true,
                    message: 'Google account registered and session created',
                    sessionToken: parsed.sessionToken,
                    expiresAt: parsed.expiresAt,
                }));
            }
        };

        conn.onData(onChunk);

        conn.onClose(() => {
            if (phase === 1) {
                settle(() => reject(new Error('Connection closed before receiving Google login response')));
            }
        });
    });
}
