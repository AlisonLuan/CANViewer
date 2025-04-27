# 🛠 WebUSB CAN Interface Viewer

![Screenshot](./Images/example.png)

A modern, browser-based CAN bus tool that lets you **log**, **inspect**, **filter unique**, **configure**, and **send** CAN messages over USB (Custom HID) — all from your browser.

---

## 📦 Features

- 🔄 **Real-time CAN logging**: Live view of incoming CAN frames with timestamp, ID, type (STD/EXT), DLC, and data.
- 🔢 **Unique message summary**: See up to 10 distinct ID+type messages with counts, updated in place.
- 📤 **Table-driven sender**: Configure up to 10 send templates (ID, type, data, interval) with per-row **Send Now** and auto-repeat.
- 💾 **Export in multiple formats**:
  - **CSV** (comma-separated, quoted)
  - **Peak TRC** (Peak Systems trace format)
  - **ASC** (CANalyzer/BusMaster ASCII log)
- ⚙️ **Modular codebase**:
  - **`canUsbLogger.js`** – core logic, UI binding, logging, unique & send tables
  - **`traceExporter.js`** – standalone CSV/TRC/ASC generators
- 📱 **WebUSB support**: Works in Chrome/Edge; communicates with STM32 via Custom HID.

---

## 🎯 Project Structure

```
├── index.html          # Frontend UI
├── style.css           # Styles
├── canUsbLogger.js     # Main module (ES6 class)
├── traceExporter.js    # Trace export utilities
├── Images/             # Assets (screenshots)
│   └── example.png     # README image
└── README.md           # Project documentation
```

---

## 🚀 Quick Start

1. **Serve** this folder over HTTP (e.g., `npx http-server .`).
2. Open `index.html` in Chrome/Edge.
3. Click **Connect** and authorize the STM32 USB-CAN device.
4. **Monitor** live CAN frames in the **CAN Bus Log**.
5. **View** up to 10 unique ID+type messages with counts.
6. **Configure** send templates and click **Send Now** or let it auto-repeat.
7. Click **Export Log** to download CSV, TRC, or ASC of the full log.

---

## 📃 Trace Export Formats

### CSV
Standard comma-separated values, double-quoted; importable in spreadsheets.

### Peak TRC
Peak Systems `.trc` with `$FILEVERSION`, `$STARTTIME`, column headers, and aligned fields.

### ASC
CANalyzer/BusMaster ASCII `.asc` with timestamps and direction markers.

---

## 🛠 Firmware Requirements

- **STM32** with USB Full-Speed (Custom HID) peripheral
- Custom HID report format:
  - Bytes 0–3: CAN ID (MSB = EXT flag)
  - Byte 4: DLC (0–8)
  - Bytes 5–(5+DLC−1): Data
  - Remaining bytes zeroed
- Firmware parses OUT reports (ID+DLC+Data) → sends on CAN2; sends IN reports for browser.

---

## 🤝 Contributing

Issues and PRs welcome!

---

## 📜 License

Licensed under terms from STMicroelectronics and contributors.

*Built with ❤️ using STM32 HAL & WebUSB.*