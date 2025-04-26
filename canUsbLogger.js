// canUsbLogger.js

import { generateCsv, generateTrc, generateAsc } from './traceExporter.js';

/**
 * @module canUsbLogger
 * Manages USB-CAN connection, in-memory logging, 20-row display, and multi-format export.
 */

// ————— Constants ——————————————————————————————————————————————————————

export const USB_VENDOR_ID        = 0x0483;
export const USB_INTERFACE_NUMBER = 0;
export const USB_ENDPOINT_IN      = 1;
export const USB_ENDPOINT_OUT     = 1;

const VISIBLE_LOG_ROWS = 20;
const SELECTORS = {
  logBody:        '#log-body',
  connectBtn:     '#connect-button',
  statusLabel:    '#connect-status',
  sendBtn:        '#send-button',
  intervalSelect: '#send-interval',
  spacebarBox:    '#send-on-space',
  exportBtn:      '#export-button',
};

// ————— State ——————————————————————————————————————————————————————

let usbDevice         = null;
let sendIntervalId    = null;
let fullLog           = [];    // unlimited retention
let startTimeMs       = null;  // for computing offsets in seconds

// UI elements (populated in init)
let logTableBody;
let connectButton;
let connectionStatus;
let sendButton;
let intervalSelect;
let spacebarCheckbox;
let exportButton;

// Track one entry per ID+type (ordered by most recent insertion)
const uniqueMap = new Map();

// ————— Initialization —————————————————————————————————————————————————

/**
 * Binds DOM elements and hooks up event listeners.
 * @param {Object} [ids]           CSS selectors override
 */
export function init(ids = {}) {
  const s = { ...SELECTORS, ...ids };

  logTableBody     = document.querySelector(s.logBody);
  connectButton    = document.querySelector(s.connectBtn);
  connectionStatus = document.querySelector(s.statusLabel);
  sendButton       = document.querySelector(s.sendBtn);
  intervalSelect   = document.querySelector(s.intervalSelect);
  spacebarCheckbox = document.querySelector(s.spacebarBox);
  exportButton     = document.querySelector(s.exportBtn);

  if (!logTableBody || !connectButton || !sendButton || !exportButton) {
    throw new Error('canUsbLogger.init: Missing required DOM elements');
  }

  renderLog(); // show empty padded table
  renderUnique();    // <-- ensure the 10-row skeleton shows immediately

  connectButton.addEventListener('click',      connectDevice);
  sendButton.addEventListener('click',         sendCanMessage);
  intervalSelect.addEventListener('change',    onIntervalChange);
  spacebarCheckbox.addEventListener('change',  onSpacebarToggle);
  exportButton.addEventListener('click',       exportLog);

  document.getElementById('clear-unique').addEventListener('click', () => {
    uniqueMap.clear();
    renderUnique();
  });  
}

// ————— Helpers ——————————————————————————————————————————————————————

/** @returns {string} "HH:mm:ss.SSS" */
export const getFormattedTimestamp = () => {
  const now  = new Date();
  const time = now.toLocaleTimeString('en-GB', { hour12: false });
  const ms   = String(now.getMilliseconds()).padStart(3, '0');
  return `${time}.${ms}`;
};

/**
 * Normalize and format a CAN ID for display.
 * @param {string} idHex – raw hex string
 * @param {'SYS'|'STD'|'EXT'} type
 * @returns {string} padded uppercase hex
 */
export function formatCanId(idHex, type) {
  if (type === 'SYS') return idHex.toUpperCase();

  let raw = parseInt(idHex, 16);
  if (Number.isNaN(raw)) {
    console.warn(`formatCanId: invalid "${idHex}", using 0`);
    raw = 0;
  }

  raw &= (type === 'STD' ? 0x7FF : 0x1FFFFFFF);
  const width = type === 'STD' ? 3 : 8;
  return raw.toString(16).padStart(width, '0').toUpperCase();
}

/**
 * Parse a space-separated hex string into byte values.
 * @param {string} input
 * @returns {number[]}
 * @throws {Error} on invalid byte
 */
export const parseHexString = (input) => {
  return input.trim().split(/\s+/).map((chunk) => {
    const val = parseInt(chunk, 16);
    if (Number.isNaN(val)) {
      throw new Error(`parseHexString: invalid byte "${chunk}"`);
    }
    return val;
  });
};

// ————— Rendering ————————————————————————————————————————————————————

/**
 * Render the newest VISIBLE_LOG_ROWS entries (newest at top).
 * Pads with blanks if fewer.
 */
function renderLog() {
  logTableBody.innerHTML = '';

  const recent = fullLog.slice(-VISIBLE_LOG_ROWS).reverse();
  const padCount = VISIBLE_LOG_ROWS - recent.length;

  recent.forEach(({ timestamp, id, type, dlc, data }) => {
    const tr = document.createElement('tr');
    [timestamp, id, type, dlc, data].forEach((text) => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });
    logTableBody.appendChild(tr);
  });

  for (let i = 0; i < padCount; i++) {
    const tr = document.createElement('tr');
    Array.from({ length: 5 }).forEach(() => tr.appendChild(document.createElement('td')));
    logTableBody.appendChild(tr);
  }
}

// ————— Logging —————————————————————————————————————————————————————

/**
 * Store a new CAN message and re-render the display.
 * @param {string} idHex
 * @param {'SYS'|'STD'|'EXT'|'TX'} type
 * @param {number} dlc
 * @param {string[]} dataBytes
 */
export function logCanMessage(idHex, type, dlc, dataBytes) {
  if (fullLog.length === 0) startTimeMs = performance.now();
  const offset = (performance.now() - startTimeMs) / 1000;
  const entry = {
    timestamp: getFormattedTimestamp(),
    offset,
    id:        formatCanId(idHex, type),
    type,
    dlc,
    data:      dataBytes.join(' ')
  };
  fullLog.push(entry);

  // UNIQUE logic: only first insertion fixes row position—but update its count & latest data
  const key = entry.id + '|' + entry.type;
  if (uniqueMap.has(key)) {
    const uni = uniqueMap.get(key);
    uni.count++;
    uni.timestamp = entry.timestamp;
    uni.dlc       = entry.dlc;
    uni.data      = entry.data;
  } else {
    entry.count = 1;
    uniqueMap.set(key, entry);
  }

  renderLog();
  renderUnique();
}

// ————— USB Connection & I/O ——————————————————————————————————————

/** Connect to USB-CAN device and start reading. */
export async function connectDevice() {
  try {
    usbDevice = await navigator.usb.requestDevice({
      filters: [{ vendorId: USB_VENDOR_ID }],
    });
    await usbDevice.open();
    if (!usbDevice.configuration) {
      await usbDevice.selectConfiguration(1);
    }
    await usbDevice.claimInterface(USB_INTERFACE_NUMBER);

    connectionStatus.textContent = 'Connected';
    listenToDevice();
  } catch (error) {
    console.error(error);
    logCanMessage('----', 'SYS', 0, [error.message || 'Connection Error']);
  }
}

/** Continuous read loop: parse frames and log them. */
export async function listenToDevice() {
  while (usbDevice && usbDevice.opened) {
    try {
      const result = await usbDevice.transferIn(USB_ENDPOINT_IN, 64);
      if (result.status === 'ok' && result.data.byteLength >= 5) {
        const view      = new DataView(result.data.buffer);
        const raw       = view.getUint32(0, true);
        const dlc       = view.getUint8(4);
        const byteCount = Math.min(dlc, result.data.byteLength - 5);
        const bytes     = Array.from({ length: byteCount }, (_, i) =>
          view.getUint8(5 + i).toString(16).padStart(2, '0').toUpperCase()
        );

        const msgType = (raw & 0x80000000) ? 'EXT' : 'STD';
        const rawHex  = raw.toString(16).padStart(8, '0');
        logCanMessage(rawHex, msgType, dlc, bytes);
      }
    } catch (error) {
      console.error(error);
      logCanMessage('----', 'SYS', 0, [error.message || 'Read Error']);
      break;
    }
  }
}

// ————— Sending —————————————————————————————————————————————————————

/** Build and send a CAN message from UI inputs. */
export async function sendCanMessage() {
  if (!usbDevice) return;

  const idInput   = document.getElementById('can-id').value;
  const dataInput = document.getElementById('can-data').value;
  const type      = document.getElementById('can-id-type').value;

  let id = parseInt(idInput, 16);
  if (Number.isNaN(id)) {
    console.warn(`sendCanMessage: invalid ID "${idInput}", using 0`);
    id = 0;
  }

  if (type === 'STD') {
    id &= 0x7FF;
  } else {
    id = (id & 0x1FFFFFFF) | 0x80000000;
  }

  let dataBytes;
  try {
    dataBytes = parseHexString(dataInput);
  } catch (error) {
    console.error(error);
    logCanMessage('----', 'SYS', 0, [error.message]);
    return;
  }

  const buffer = new ArrayBuffer(5 + dataBytes.length);
  const view   = new DataView(buffer);
  view.setUint32(0, id, true);
  view.setUint8(4, dataBytes.length);
  dataBytes.forEach((b, i) => view.setUint8(5 + i, b));

  try {
    await usbDevice.transferOut(USB_ENDPOINT_OUT, buffer);
    logCanMessage(
      id.toString(16).padStart(8, '0'),
      'TX',
      dataBytes.length,
      dataBytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    );
  } catch (error) {
    console.error(error);
    logCanMessage('----', 'SYS', 0, [error.message || 'Send Error']);
  }
}

// ————— UI Event Handlers ——————————————————————————————————————————————

/** Toggle automatic send interval. */
export function onIntervalChange(event) {
  if (sendIntervalId) clearInterval(sendIntervalId);
  const ms = Number(event.target.value);
  if (ms > 0) {
    sendIntervalId = setInterval(sendCanMessage, ms);
  }
}

/** Toggle spacebar-to-send functionality. */
export function onSpacebarToggle(event) {
  if (event.target.checked) {
    window.addEventListener('keydown', spacebarHandler);
  } else {
    window.removeEventListener('keydown', spacebarHandler);
  }
}

/** Send when Space is pressed. */
export function spacebarHandler(event) {
  if (event.code === 'Space') {
    event.preventDefault();
    sendCanMessage();
  }
}

// ————— Exporting ————————————————————————————————————————————————————

/**
 * Prompt user to save current log in CSV, TRC, or ASC format.
 */
export async function exportLog() {
  try {
    let fileHandle;
    if (window.showSaveFilePicker) {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: 'can-log',
        types: [
          {
            description: 'CSV',
            accept: { 'text/csv': ['.csv'] },
          },
          {
            description: 'Peak TRC',
            accept: { 'application/octet-stream': ['.trc'] },
          },
          {
            description: 'ASC Log',
            accept: { 'text/plain': ['.asc'] },
          },
        ],
      });
    }

    if (fileHandle) {
      const ext = fileHandle.name.split('.').pop().toLowerCase();
      let content;
      if (ext === 'trc') content = generateTrc(fullLog, startTimeMs);
      else if (ext === 'asc') content = generateAsc(fullLog, startTimeMs);
      else content = generateCsv(fullLog);

      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
    } else {
      // Fallback: CSV blob download
      const blob = new Blob([generateCsv(fullLog)], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = 'can-log.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    console.error('exportLog:', error);
    logCanMessage('----', 'SYS', 0, [error.message]);
  }
}

/**
 * Renders up to 10 unique messages (most recently updated) into #unique-body
 */
function renderUnique() {
  const tbody = document.getElementById('unique-body');
  tbody.innerHTML = '';

  // Always show in insertion order, up to 10 distinct entries
  const entries = Array.from(uniqueMap.values()).slice(0, 10);
  const pad     = 10 - entries.length;

  entries.forEach(e => {
    const tr = document.createElement('tr');
    [e.timestamp, e.id, e.type, e.dlc, e.data, e.count].forEach(txt => {
      const td = document.createElement('td');
      td.textContent = txt;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  // Pad out to exactly 10 rows
  for (let i = 0; i < pad; i++) {
    const tr = document.createElement('tr');
    for (let j = 0; j < 6; j++) tr.appendChild(document.createElement('td'));
    tbody.appendChild(tr);
  }
}