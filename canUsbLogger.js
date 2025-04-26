// canUsbLogger.js

import { generateCsv, generateTrc, generateAsc } from './traceExporter.js';

/**
 * Manages USB‐CAN connection, logging, unique entry table, send‐template table, and exports.
 */
class CanUsbLogger {
  // USB constants
  static USB_VENDOR_ID        = 0x0483;
  static USB_INTERFACE_NUMBER = 0;
  static USB_ENDPOINT_IN      = 1;
  static USB_ENDPOINT_OUT     = 1;

  // Display constants
  static VISIBLE_LOG_ROWS     = 20;
  static UNIQUE_TABLE_ROWS    = 10;

  // Default selectors (can be overridden in init)
  static SELECTORS = {
    logBody:        '#log-body',
    connectBtn:     '#connect-button',
    statusLabel:    '#connect-status',
    spacebarBox:    '#send-on-space',
    exportBtn:      '#export-button',
    clearUnique:    '#clear-unique',
    sendBody:       '#send-body',
    uniqueBody:     '#unique-body',
  };

  constructor() {
    this.usbDevice        = null;
    this.fullLog          = [];
    this.startTimeMs      = null;
    this.uniqueMap        = new Map();
    this.sendTemplates    = Array.from(
      { length: CanUsbLogger.UNIQUE_TABLE_ROWS },
      () => ({ id: '00000000', type: 'STD', data: '', interval: 100 })
    );
    this.sendTemplateTimers = new Map();
  }

  /**
   * Initialize UI bindings and render empty tables.
   * @param {Object} [ids] CSS selector overrides
   */
  init(ids = {}) {
    const sel = { ...CanUsbLogger.SELECTORS, ...ids };

    this.logTableBody     = document.querySelector(sel.logBody);
    this.connectButton    = document.querySelector(sel.connectBtn);
    this.connectionStatus = document.querySelector(sel.statusLabel);
    this.exportButton     = document.querySelector(sel.exportBtn);
    this.clearUniqueBtn   = document.querySelector(sel.clearUnique);
    this.sendTableBody    = document.querySelector(sel.sendBody);
    this.uniqueTableBody  = document.querySelector(sel.uniqueBody);

    if (
      !this.logTableBody ||
      !this.connectButton ||
      !this.exportButton ||
      !this.clearUniqueBtn ||
      !this.sendTableBody ||
      !this.uniqueTableBody
    ) {
      throw new Error('CanUsbLogger.init: missing required DOM elements');
    }

    this.renderLog();
    this.renderUnique();
    this.renderSendTable();

    this.connectButton.addEventListener('click',      () => this.connectDevice());
    this.exportButton.addEventListener('click',       () => this.exportLog());
    this.clearUniqueBtn.addEventListener('click',     () => {
      this.uniqueMap.clear();
      this.renderUnique();
    });
  }

  /** @returns {string} "HH:mm:ss.SSS" */
  getFormattedTimestamp() {
    const now  = new Date();
    const time = now.toLocaleTimeString('en-GB', { hour12: false });
    const ms   = String(now.getMilliseconds()).padStart(3, '0');
    return `${time}.${ms}`;
  }

  /**
   * Normalize and pad a CAN ID for display.
   * @param {string} idHex Raw hexadecimal string
   * @param {'SYS'|'STD'|'EXT'} type
   * @returns {string}
   */
  formatCanId(idHex, type) {
    if (type === 'SYS') return idHex.toUpperCase();

    let raw = parseInt(idHex, 16);
    if (Number.isNaN(raw)) {
      console.warn(`formatCanId: invalid "${idHex}", defaulting to 0`);
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
  parseHexString(input) {
    return input.trim().split(/\s+/).map((chunk) => {
      const value = parseInt(chunk, 16);
      if (Number.isNaN(value)) {
        throw new Error(`parseHexString: invalid byte "${chunk}"`);
      }
      return value;
    });
  }

  /** Render the most recent rows in the main log table. */
  renderLog() {
    this.logTableBody.innerHTML = '';
    const recent = this.fullLog.slice(-CanUsbLogger.VISIBLE_LOG_ROWS).reverse();
    const padCount = CanUsbLogger.VISIBLE_LOG_ROWS - recent.length;

    recent.forEach(({ timestamp, id, type, dlc, data }) => {
      const tr = document.createElement('tr');
      [timestamp, id, type, dlc, data].forEach((text) => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      this.logTableBody.appendChild(tr);
    });

    for (let i = 0; i < padCount; i++) {
      const tr = document.createElement('tr');
      Array.from({ length: 5 }).forEach(() => tr.appendChild(document.createElement('td')));
      this.logTableBody.appendChild(tr);
    }
  }

  /** Render up to 10 unique ID/type entries with counts. */
  renderUnique() {
    this.uniqueTableBody.innerHTML = '';
    const entries = Array.from(this.uniqueMap.values()).slice(0, CanUsbLogger.UNIQUE_TABLE_ROWS);
    const padCount = CanUsbLogger.UNIQUE_TABLE_ROWS - entries.length;

    entries.forEach(({ timestamp, id, type, dlc, data, count }) => {
      const tr = document.createElement('tr');
      [timestamp, id, type, dlc, data, count].forEach((text) => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      this.uniqueTableBody.appendChild(tr);
    });

    for (let i = 0; i < padCount; i++) {
      const tr = document.createElement('tr');
      Array.from({ length: 6 }).forEach(() => tr.appendChild(document.createElement('td')));
      this.uniqueTableBody.appendChild(tr);
    }
  }

  /** Render the 10 send‐template rows with inputs and buttons. */
  renderSendTable() {
    this.sendTableBody.innerHTML = '';

    this.sendTemplates.forEach((tpl, idx) => {
      const tr = document.createElement('tr');

      // ID input
      const idTd = document.createElement('td');
      const idIn = document.createElement('input');
      idIn.type = 'text';
      idIn.value = tpl.id;
      idIn.maxLength = 8;
      idIn.pattern = '[0-9A-Fa-f]{8}';
      idIn.addEventListener('input', () => { tpl.id = idIn.value; });
      idTd.appendChild(idIn);
      tr.appendChild(idTd);

      // Type select
      const typeTd = document.createElement('td');
      const sel = document.createElement('select');
      ['STD', 'EXT'].forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v === 'STD' ? 'Standard' : 'Extended';
        if (v === tpl.type) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => { tpl.type = sel.value; });
      typeTd.appendChild(sel);
      tr.appendChild(typeTd);

      // Data input
      const dataTd = document.createElement('td');
      const dataIn = document.createElement('input');
      dataIn.type = 'text';
      dataIn.value = tpl.data;
      dataIn.placeholder = 'e.g. 11 22 33';
      dataIn.addEventListener('input', () => { tpl.data = dataIn.value; });
      dataTd.appendChild(dataIn);
      tr.appendChild(dataTd);

      // Interval input
      const intTd = document.createElement('td');
      const intIn = document.createElement('input');
      intIn.type = 'number';
      intIn.min = '0';
      intIn.max = '65535';
      intIn.value = String(tpl.interval);
      intIn.addEventListener('change', () => { tpl.interval = Number(intIn.value); });
      intTd.appendChild(intIn);
      tr.appendChild(intTd);

      // Action button
      const actTd = document.createElement('td');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Send Now';
      btn.addEventListener('click', () => this.sendCanMessageFromTemplate(tpl));
      actTd.appendChild(btn);
      tr.appendChild(actTd);

      this.sendTableBody.appendChild(tr);
    });
  }

  /**
   * Log a new CAN message, update full log, unique map, and re-render.
   * @param {string} idHex
   * @param {'SYS'|'STD'|'EXT'|'TX'} type
   * @param {number} dlc
   * @param {string[]} dataBytes
   */
  logCanMessage(idHex, type, dlc, dataBytes) {
    if (this.fullLog.length === 0) this.startTimeMs = performance.now();
    const offset = (performance.now() - this.startTimeMs) / 1000;
    const entry = {
      timestamp: this.getFormattedTimestamp(),
      offset,
      id:        this.formatCanId(idHex, type),
      type,
      dlc,
      data:      dataBytes.join(' '),
    };

    this.fullLog.push(entry);

    // Unique map: update count or insert new
    const key = `${entry.id}|${entry.type}`;
    if (this.uniqueMap.has(key)) {
      const existing = this.uniqueMap.get(key);
      existing.count++;
      existing.timestamp = entry.timestamp;
      existing.dlc       = entry.dlc;
      existing.data      = entry.data;
    } else {
      entry.count = 1;
      this.uniqueMap.set(key, entry);
    }

    this.renderLog();
    this.renderUnique();
  }

  /** Prompt user to connect to USB-CAN device, then start listening. */
  async connectDevice() {
    try {
      this.usbDevice = await navigator.usb.requestDevice({
        filters: [{ vendorId: CanUsbLogger.USB_VENDOR_ID }],
      });
      await this.usbDevice.open();
      if (!this.usbDevice.configuration) {
        await this.usbDevice.selectConfiguration(1);
      }
      await this.usbDevice.claimInterface(CanUsbLogger.USB_INTERFACE_NUMBER);

      this.connectionStatus.textContent = 'Connected';
      this.listenToDevice();
    } catch (err) {
      console.error(err);
      this.logCanMessage('----', 'SYS', 0, [err.message || 'Connection Error']);
    }
  }

  /** Continuous read loop: parse incoming frames and log them. */
  async listenToDevice() {
    while (this.usbDevice && this.usbDevice.opened) {
      try {
        const result = await this.usbDevice.transferIn(CanUsbLogger.USB_ENDPOINT_IN, 64);
        if (result.status === 'ok' && result.data.byteLength >= 5) {
          const view      = new DataView(result.data.buffer);
          const raw       = view.getUint32(0, true);
          const dlc       = view.getUint8(4);
          const count     = Math.min(dlc, result.data.byteLength - 5);
          const bytes     = Array.from({ length: count }, (_, i) =>
            view.getUint8(5 + i).toString(16).padStart(2, '0').toUpperCase()
          );

          const msgType = (raw & 0x80000000) ? 'EXT' : 'STD';
          const rawHex  = raw.toString(16).padStart(8, '0');
          this.logCanMessage(rawHex, msgType, dlc, bytes);
        }
      } catch (err) {
        console.error(err);
        this.logCanMessage('----', 'SYS', 0, [err.message || 'Read Error']);
        break;
      }
    }
  }

  /** Build and send a CAN message from UI inputs. */
  async sendCanMessage() {
    if (!this.usbDevice) return;

    const idInput   = document.getElementById('can-id').value;
    const dataInput = document.getElementById('can-data').value;
    const type      = document.getElementById('can-id-type').value;

    let rawId = parseInt(idInput, 16);
    if (Number.isNaN(rawId)) {
      console.warn(`sendCanMessage: invalid ID "${idInput}", defaulting to 0`);
      rawId = 0;
    }

    if (type === 'STD') {
      rawId &= 0x7FF;
    } else {
      rawId = (rawId & 0x1FFFFFFF) | 0x80000000;
    }

    let dataBytes;
    try {
      dataBytes = this.parseHexString(dataInput);
    } catch (err) {
      console.error(err);
      this.logCanMessage('----', 'SYS', 0, [err.message]);
      return;
    }

    const buffer = new ArrayBuffer(5 + dataBytes.length);
    const view   = new DataView(buffer);
    view.setUint32(0, rawId, true);
    view.setUint8(4, dataBytes.length);
    dataBytes.forEach((b, i) => view.setUint8(5 + i, b));

    try {
      await this.usbDevice.transferOut(CanUsbLogger.USB_ENDPOINT_OUT, buffer);
      this.logCanMessage(
        rawId.toString(16).padStart(8, '0'),
        'TX',
        dataBytes.length,
        dataBytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      );
    } catch (err) {
      console.error(err);
      this.logCanMessage('----', 'SYS', 0, [err.message || 'Send Error']);
    }
  }

  /** Handle changes to the send interval selector. */
  handleIntervalChange(event) {
    if (this.sendIntervalId) clearInterval(this.sendIntervalId);
    const ms = Number(event.target.value);
    if (ms > 0) {
      this.sendIntervalId = setInterval(() => this.sendCanMessage(), ms);
    }
  }

  /** Toggle spacebar‐to‐send functionality. */
  handleSpacebarToggle(event) {
    if (event.target.checked) {
      window.addEventListener('keydown', (e) => this.spacebarHandler(e));
    } else {
      window.removeEventListener('keydown', (e) => this.spacebarHandler(e));
    }
  }

  /** Send when Spacebar is pressed. */
  spacebarHandler(event) {
    if (event.code === 'Space') {
      event.preventDefault();
      this.sendCanMessage();
    }
  }

  /** Export the full log in CSV, TRC, or ASC via file picker or fallback. */
  async exportLog() {
    try {
      let handle;
      if (window.showSaveFilePicker) {
        handle = await window.showSaveFilePicker({
          suggestedName: 'can-log',
          types: [
            { description: 'CSV', accept: { 'text/csv': ['.csv'] } },
            { description: 'Peak TRC', accept: { 'application/octet-stream': ['.trc'] } },
            { description: 'ASC Log', accept: { 'text/plain': ['.asc'] } },
          ],
        });
      }

      if (handle) {
        const ext     = handle.name.split('.').pop().toLowerCase();
        const content = ext === 'trc'
          ? generateTrc(this.fullLog, this.startTimeMs)
          : ext === 'asc'
            ? generateAsc(this.fullLog, this.startTimeMs)
            : generateCsv(this.fullLog);

        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
      } else {
        // Fallback to CSV download
        const blob = new Blob([generateCsv(this.fullLog)], { type: 'text/csv' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = 'can-log.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('exportLog:', err);
      this.logCanMessage('----', 'SYS', 0, [err.message]);
    }
  }

  /**
   * Send a message based on a template, then reschedule it after `interval`.
   * @param {{id:string,type:string,data:string,interval:number}} tpl
   */
  async sendCanMessageFromTemplate(tpl) {
    if (!this.usbDevice) {
      console.warn('Template send: USB device not connected');
      return;
    }

    // Build and send exactly as sendCanMessage, but using tpl values...
    let rawId = parseInt(tpl.id, 16);
    if (Number.isNaN(rawId)) {
      console.warn(`Invalid template ID "${tpl.id}", defaulting to 0`);
      rawId = 0;
    }
    if (tpl.type === 'STD') {
      rawId &= 0x7FF;
    } else {
      rawId = (rawId & 0x1FFFFFFF) | 0x80000000;
    }

    let dataBytes;
    try {
      dataBytes = this.parseHexString(tpl.data);
    } catch (err) {
      console.error(err);
      this.logCanMessage('----', 'SYS', 0, [err.message]);
      return;
    }

    const buffer = new ArrayBuffer(5 + dataBytes.length);
    const view   = new DataView(buffer);
    view.setUint32(0, rawId, true);
    view.setUint8(4, dataBytes.length);
    dataBytes.forEach((b, i) => view.setUint8(5 + i, b));

    try {
      await this.usbDevice.transferOut(CanUsbLogger.USB_ENDPOINT_OUT, buffer);
      this.logCanMessage(
        rawId.toString(16).padStart(8, '0'),
        'TX',
        dataBytes.length,
        dataBytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      );
    } catch (err) {
      console.error(err);
      this.logCanMessage('----', 'SYS', 0, [err.message]);
    }

    // Reschedule
    setTimeout(() => this.sendCanMessageFromTemplate(tpl), tpl.interval);
  }
}

export default new CanUsbLogger();