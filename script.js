// canUsbLogger.js

/**
 * @module canUsbLogger
 * Handles USB-CAN device connection, message logging, and message sending.
 */

const USB_VENDOR_ID = 0x0483;
const USB_INTERFACE_NUMBER = 0;
const USB_ENDPOINT_IN = 1;
const USB_ENDPOINT_OUT = 1;
const MAX_LOG_ROWS = 500;

let usbDevice = null;
let sendIntervalTimer = null;

const logTableBody = document.getElementById('log-body');
const connectButton = document.getElementById('connect-btn');
const connectionStatus = document.getElementById('connect-status');
const sendButton = document.getElementById('send-btn');
const sendIntervalSelect = document.getElementById('send-interval');
const spacebarCheckbox = document.getElementById('send-on-space');

/**
 * Returns current time as "HH:mm:ss.SSS".
 * @returns {string}
 */
const getFormattedTimestamp = () => {
  const now = new Date();
  const time = now.toLocaleTimeString('en-GB', { hour12: false });
  const ms = now.getMilliseconds().toString().padStart(3, '0');
  return `${time}.${ms}`;
};

/**
 * Formats a raw CAN ID into SYS, STD or EXT display string.
 * @param {string} idHex - Hex string input.
 * @param {'SYS'|'STD'|'EXT'} type - Message type.
 * @returns {string}
 */
const formatCanId = (idHex, type) => {
  if (type === 'SYS') {
    return idHex.toUpperCase();
  }

  let raw = parseInt(idHex, 16);
  if (Number.isNaN(raw)) {
    console.warn(`Invalid CAN ID "${idHex}", defaulting to 0`);
    raw = 0;
  }

  if (type === 'STD') {
    raw &= 0x7FF;
    return raw.toString(16).padStart(3, '0').toUpperCase();
  }

  // EXT
  raw &= 0x1FFFFFFF;
  return raw.toString(16).padStart(8, '0').toUpperCase();
};

/**
 * Appends a CAN message row to the log table, trimming old entries.
 * @param {string} idHex
 * @param {'SYS'|'STD'|'EXT'|'TX'} type
 * @param {number} dlc
 * @param {string[]} dataBytes
 */
const logCanMessage = (idHex, type, dlc, dataBytes) => {
  const row = document.createElement('tr');
  const cells = {
    timestamp: getFormattedTimestamp(),
    id:      formatCanId(idHex, type),
    type,
    dlc,
    data: dataBytes.join(' '),
  };

  Object.values(cells).forEach(text => {
    const td = document.createElement('td');
    td.textContent = text;
    row.appendChild(td);
  });

  logTableBody.appendChild(row);

  // Keep log to MAX_LOG_ROWS
  while (logTableBody.children.length > MAX_LOG_ROWS) {
    logTableBody.removeChild(logTableBody.firstChild);
  }

  row.scrollIntoView({ behavior: 'smooth' });
};

/**
 * Connects to the USB-CAN device and begins listening.
 */
async function connectDevice() {
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

/**
 * Continuously reads CAN frames from the device and logs them.
 */
async function listenToDevice() {
  while (usbDevice && usbDevice.opened) {
    try {
      const result = await usbDevice.transferIn(USB_ENDPOINT_IN, 64);
      if (result.status === 'ok' && result.data.byteLength >= 5) {
        const view = new DataView(result.data.buffer);
        const rawId = view.getUint32(0, true);
        const dlc   = view.getUint8(4);
        const availableBytes = result.data.byteLength - 5;
        const count = Math.min(dlc, availableBytes);

        const dataBytes = Array.from({ length: count }, (_, i) =>
          view.getUint8(5 + i).toString(16).padStart(2, '0').toUpperCase()
        );

        const isExtended = Boolean(rawId & 0x80000000);
        const idHex = (rawId >>> 0).toString(16).padStart(8, '0').toUpperCase();
        logCanMessage(idHex, isExtended ? 'EXT' : 'STD', dlc, dataBytes);
      }
    } catch (error) {
      console.error(error);
      logCanMessage('----', 'SYS', 0, [error.message || 'Read Error']);
      break; // stop on persistent read error
    }
  }
}

/**
 * Parses a space-separated hex string into an array of byte values.
 * @param {string} input
 * @returns {number[]}
 */
const parseHexString = input =>
  input
    .trim()
    .split(/\s+/)
    .map(byte => {
      const val = parseInt(byte, 16);
      if (Number.isNaN(val)) {
        throw new Error(`Invalid hex byte "${byte}"`);
      }
      return val;
    });

/**
 * Builds and sends a CAN message from UI inputs.
 */
async function sendCanMessage() {
  if (!usbDevice) {
    return;
  }

  const idHexInput    = document.getElementById('can-id').value;
  const dataHexInput  = document.getElementById('can-data').value;
  const idType        = document.getElementById('can-id-type').value;

  let id = parseInt(idHexInput, 16);
  if (Number.isNaN(id)) {
    console.warn(`Invalid ID "${idHexInput}", defaulting to 0`);
    id = 0;
  }

  if (idType === 'STD') {
    id &= 0x7FF;
  } else {
    // EXT: mask and set MSB
    id &= 0x1FFFFFFF;
    id |= 0x80000000;
  }

  let dataBytes;
  try {
    dataBytes = parseHexString(dataHexInput);
  } catch (parseError) {
    console.error(parseError);
    logCanMessage('----', 'SYS', 0, [parseError.message]);
    return;
  }

  const buffer = new ArrayBuffer(5 + dataBytes.length);
  const view   = new DataView(buffer);
  view.setUint32(0, id, true);
  view.setUint8(4, dataBytes.length);
  dataBytes.forEach((b, idx) => view.setUint8(5 + idx, b));

  try {
    await usbDevice.transferOut(USB_ENDPOINT_OUT, buffer);
    const idHex = id.toString(16).padStart(8, '0').toUpperCase();
    logCanMessage(idHex, 'TX', dataBytes.length, dataBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()));
  } catch (error) {
    console.error(error);
    logCanMessage('----', 'SYS', 0, [error.message || 'Send Error']);
  }
}

/**
 * Handles enabling/disabling periodic send.
 */
function handleIntervalChange(event) {
  if (sendIntervalTimer) {
    clearInterval(sendIntervalTimer);
    sendIntervalTimer = null;
  }
  const ms = Number(event.target.value);
  if (ms > 0) {
    sendIntervalTimer = setInterval(sendCanMessage, ms);
  }
}

/**
 * Toggles spacebar-to-send functionality.
 */
function handleSpacebarToggle(event) {
  if (event.target.checked) {
    window.addEventListener('keydown', spacebarHandler);
  } else {
    window.removeEventListener('keydown', spacebarHandler);
  }
}

/**
 * Sends on Space key.
 * @param {KeyboardEvent} e
 */
function spacebarHandler(e) {
  if (e.code === 'Space') {
    e.preventDefault();
    sendCanMessage();
  }
}

// Wire up UI events
connectButton.addEventListener('click',      connectDevice);
sendButton.addEventListener('click',         sendCanMessage);
sendIntervalSelect.addEventListener('change', handleIntervalChange);
spacebarCheckbox.addEventListener('change',   handleSpacebarToggle);