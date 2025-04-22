let device;
let sendIntervalId = null;
const logBody = document.getElementById("log-body");

function logCANMessage(idHex, type, dlc, dataArray) {
  const tr = document.createElement("tr");

  const tdTimestamp = document.createElement("td");
  const now = new Date();
  const timeString = now.toLocaleTimeString('en-US', { hour12: false }) + '.' + now.getMilliseconds().toString().padStart(3, '0');
  tdTimestamp.textContent = timeString;

  const tdId = document.createElement("td");
  let formattedId;
  if (type === "SYS") {
    formattedId = idHex;
  } else {
    let rawId = parseInt(idHex, 16);
    if (isNaN(rawId)) rawId = 0;
    if (type === "STD") {
      rawId &= 0x7FF;
      formattedId = rawId.toString(16).padStart(3, '0').toUpperCase();
    } else {
      rawId &= 0x1FFFFFFF;
      formattedId = rawId.toString(16).padStart(8, '0').toUpperCase();
    }
  }
  tdId.textContent = formattedId;

  const tdType = document.createElement("td");
  tdType.textContent = type;

  const tdDlc = document.createElement("td");
  tdDlc.textContent = dlc;

  const tdData = document.createElement("td");
  tdData.textContent = dataArray.join(" ");

  tr.appendChild(tdTimestamp);
  tr.appendChild(tdId);
  tr.appendChild(tdType);
  tr.appendChild(tdDlc);
  tr.appendChild(tdData);

  logBody.appendChild(tr);

  const MAX_LOG_ROWS = 500;
  if (logBody.children.length > MAX_LOG_ROWS) {
    logBody.removeChild(logBody.firstChild);
  }

  tr.scrollIntoView({ behavior: "smooth" });
}

const connectBtn = document.getElementById("connect-btn");
const connectStatus = document.getElementById("connect-status");

connectBtn.addEventListener("click", async () => {
  try {
    device = await navigator.usb.requestDevice({ filters: [{ vendorId: 0x0483 }] });
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    await device.claimInterface(0);
    connectStatus.textContent = "Connected";
    listenToDevice();
  } catch (err) {
    console.error(err);
    logCANMessage("----", "SYS", "-", [err.message || "Error"]);
  }
});

async function listenToDevice() {
  while (device && device.opened) {
    try {
      const result = await device.transferIn(1, 64);
      if (result.status === "ok" && result.data && result.data.byteLength >= 5) {
        const view = new DataView(result.data.buffer);
        const canId = view.getUint32(0, true);
        const dlc = view.getUint8(4);
        const available = result.data.byteLength;
        const dataBytes = Math.min(dlc, available - 5);
        const data = [];

        for (let i = 0; i < dataBytes; i++) {
          data.push(view.getUint8(5 + i).toString(16).padStart(2, '0').toUpperCase());
        }

        const extended = (canId & 0x80000000) !== 0;
        const idDisplay = (canId >>> 0).toString(16).padStart(8, '0').toUpperCase();
        logCANMessage(idDisplay, extended ? "EXT" : "STD", dlc, data);
      }
    } catch (err) {
      console.error(err);
      logCANMessage("----", "SYS", "-", [err.message || "Error"]);
    }
  }
}

function parseHexInput(input) {
  return input.trim().split(/\s+/).map(byte => parseInt(byte, 16));
}

async function sendCANMessage() {
  if (!device) return;

  const idInput = document.getElementById("can-id").value;
  const dataInput = document.getElementById("can-data").value;
  const idType = document.getElementById("can-id-type").value;

  let id = parseInt(idInput, 16);
  if (isNaN(id)) id = 0;

  // Sanitize ID based on type
  if (idType === "STD") {
    id &= 0x7FF;
  } else {
    id &= 0x1FFFFFFF;
    id |= 0x80000000; // Set MSB for extended
  }

  const data = parseHexInput(dataInput);
  const buffer = new ArrayBuffer(5 + data.length);
  const view = new DataView(buffer);

  view.setUint32(0, id, true);
  view.setUint8(4, data.length);
  data.forEach((val, idx) => view.setUint8(5 + idx, val));

  try {
    await device.transferOut(1, buffer);
    logCANMessage(id.toString(16).toUpperCase().padStart(8, '0'), "TX", data.length, data);
  } catch (err) {
    console.error(err);
    logCANMessage("----", "SYS", "-", [err.message || "Error"]);
  }
}

document.getElementById("send-btn").addEventListener("click", sendCANMessage);

document.getElementById("send-interval").addEventListener("change", (e) => {
  if (sendIntervalId) clearInterval(sendIntervalId);
  const interval = parseInt(e.target.value);
  if (interval > 0) {
    sendIntervalId = setInterval(sendCANMessage, interval);
  }
});

document.getElementById("send-on-space").addEventListener("change", (e) => {
  if (e.target.checked) {
    window.addEventListener("keydown", spacebarHandler);
  } else {
    window.removeEventListener("keydown", spacebarHandler);
  }
});

function spacebarHandler(e) {
  if (e.code === "Space") {
    e.preventDefault();
    sendCANMessage();
  }
}
