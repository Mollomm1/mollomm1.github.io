"use strict";
const decoder = new TextDecoder();
const encoder = new TextEncoder();
V86Starter.prototype.serial1_send = function (a) {
    for (let b = 0; b < a.length; b++)
        this.bus.send("serial1-input", a.charCodeAt(b));
};
const SLICE_SIZE = 2 ** 17 * 32;
const BUF_SIZE = 256;
async function InitV86Hdd() {
    // all right! time to explain what goes on here
    const request = indexedDB.open("image", 2);
    request.onupgradeneeded = (event) => {
        const db = event.target.result;
        db.createObjectStore("parts");
    };
    const db = (await new Promise((r) => (request.onsuccess = r))).target.result;
    // loads a local file into indexedDB
    // can be optimized somewhat significantly with promise.all
    // the rootfs is an EXT4 binary blob, stored with indexedDB, in parts of SLICE_SIZE
    const size = (await new Promise((r) => (db
        .transaction("parts")
        .objectStore("parts")
        .get("size").onsuccess = r))).target.result;
    // next, we create a fake "file". this exists to fool v86 into dynamically loading from indexedDB instead
    // this part is very simple, just grab the parts from indexedDB when v86 wants them
    //
    // can be optimized *very* slightly with promise.all
    // Yes, this causes a memory leak... Too bad!
    const ro_slice_cache = {};
    // extremely large files will crash the tab. don't load extremely lare files i guess
    const fakefile = {
        size: size,
        slice: async (start, end) => {
            const starti = Math.floor(start / SLICE_SIZE);
            const endi = Math.floor(end / SLICE_SIZE);
            let i = starti;
            let buf = null;
            while (i <= endi) {
                let part = ro_slice_cache[i];
                if (!part) {
                    part = (await new Promise((r) => (db
                        .transaction("parts")
                        .objectStore("parts")
                        .get(i).onsuccess = r))).target.result;
                    ro_slice_cache[i] = part;
                }
                if (!part) {
                    i++;
                    continue;
                }
                const slice = part.slice(Math.max(0, start - i * SLICE_SIZE), end - i * SLICE_SIZE);
                if (buf == null) {
                    buf = slice;
                }
                else {
                    buf = catBufs(buf, slice);
                }
                i++;
            }
            return new Blob([buf]);
        },
        loadfile: async (f) => {
            const trn = db
                .transaction("parts", "readwrite")
                .objectStore("parts");
            trn.put(f.size, "size");
            fakefile.size = f.size;
            let i = 0;
            while (i * SLICE_SIZE < f.size) {
                const buf = await f
                    .slice(i * SLICE_SIZE, (i + 1) * SLICE_SIZE)
                    .arrayBuffer();
                await new Promise((r) => (db
                    .transaction("parts", "readwrite")
                    .objectStore("parts")
                    .put(buf, i).onsuccess = r));
                i++;
                console.log(i / (f.size / SLICE_SIZE));
            }
        },
        delete: async () => {
            db.close();
            indexedDB.deleteDatabase("image");
            window.location.reload();
        },
        // when a "file" is loaded with v86, it keeps around a "block_cache" so it can write on top of the drive in ram
        // normally changes don't persist, but this function will take the changes made in the cache and propagate them back to indexedDB
        resize: async (size) => {
            fakefile.size = size;
            let i = 0;
            db.transaction("parts", "readwrite")
                .objectStore("parts")
                .put(size, "size");
            while (i * SLICE_SIZE < size) {
                const block = await new Promise((r) => (db
                    .transaction("parts", "readwrite")
                    .objectStore("parts")
                    .get(i).onsuccess = r));
                if (!block.target.result) {
                    await new Promise((r) => (db
                        .transaction("parts", "readwrite")
                        .objectStore("parts")
                        .put(new ArrayBuffer(SLICE_SIZE), i).onsuccess =
                        r));
                    console.log("added block " + i);
                }
                i++;
            }
        },
        save: async (emulator = anura.x86?.emulator) => {
            const part_cache = {};
            for (const [offset, buffer] of emulator.disk_images.hda
                .block_cache) {
                const start = offset * BUF_SIZE;
                const starti = Math.floor(start / SLICE_SIZE);
                let i = starti;
                const offset_rel_to_slice = start % SLICE_SIZE;
                const end = SLICE_SIZE - offset_rel_to_slice;
                const slice = buffer.slice(0, Math.min(BUF_SIZE, end));
                let tmpb = part_cache[i];
                if (!tmpb) {
                    const part = (await new Promise((r) => (db
                        .transaction("parts")
                        .objectStore("parts")
                        .get(i).onsuccess = r))).target.result;
                    tmpb = new Uint8Array(part);
                    part_cache[i] = tmpb;
                }
                tmpb.set(slice, start % SLICE_SIZE);
                if (end < 256) {
                    i += 1;
                    const slice = buffer.slice(end, BUF_SIZE);
                    let tmpb = part_cache[i];
                    if (!tmpb) {
                        const part = (await new Promise((r) => (db
                            .transaction("parts")
                            .objectStore("parts")
                            .get(i).onsuccess = r))).target.result;
                        tmpb = new Uint8Array(part);
                        part_cache[i] = tmpb;
                    }
                    tmpb.set(slice, 0);
                }
            }
            const promises = [];
            for (const i in part_cache) {
                promises.push(new Promise((r) => (db
                    .transaction("parts", "readwrite")
                    .objectStore("parts")
                    .put(part_cache[i].buffer, parseInt(i)).onsuccess = r)));
            }
            await Promise.all(promises);
            anura.notifications.add({
                title: "x86 Subsystem",
                description: "Saved root filesystem sucessfully",
                timeout: 5000,
            });
        },
        set_state: () => { },
    };
    // @ts-ignore
    fakefile.__proto__ = File.prototype;
    return fakefile;
}
class V86Backend {
    sendQueue = [];
    nextWrite = null;
    openQueue = [];
    onDataCallbacks = {};
    read_intent_phys_addr;
    write_intent_phys_addr;
    new_intent_phys_addr;
    read_nbytes_phys_addr;
    write_nbytes_phys_addr;
    s_rows_phys_addr;
    s_cols_phys_addr;
    resize_intent_phys_addr;
    vgacanvas = null;
    screen_container = (h("div", { id: "screen_container", class: css `
                background-color: #000;

                canvas {
                    background-color: #000;
                }
            ` },
        h("div", { style: "white-space: pre; font: 14px monospace; line-height: 14px" }),
        (this.vgacanvas = (h("canvas", null)))));
    ready = true;
    act = false;
    cmd_q = null;
    virt_hda;
    netpty;
    xpty;
    runpty;
    emulator;
    saveinterval;
    //
    constructor(virt_hda) {
        console.log(virt_hda);
        this.virt_hda = virt_hda;
        const fs = anura.fs;
        const Path = Filer.Path;
        const Buffer = Filer.Buffer;
        const sh = new fs.Shell();
        this.emulator = new V86Starter({
            wasm_path: "/lib/v86.wasm",
            memory_size: 512 * 1024 * 1024,
            vga_memory_size: 8 * 1024 * 1024,
            screen_container: this.screen_container,
            initrd: {
                url: "/fs/initrd.img",
            },
            bzimage: {
                url: "/fs/bzimage",
                async: false,
            },
            hda: {
                buffer: virt_hda,
                async: true,
            },
            cmdline: "rw init=/sbin/init root=/dev/sda rootfstype=ext4 random.trust_cpu=on 8250.nr_uarts=10 spectre_v2=off pti=off mitigations=off",
            filesystem: { fs, sh, Path, Buffer },
            bios: { url: "/bios/seabios.bin" },
            vga_bios: { url: "/bios/vgabios.bin" },
            network_relay_url: anura.settings.get("relay-url"),
            // initial_state: { url: "/images/v86state.bin" },
            autostart: true,
            uart1: true,
            uart2: true,
            virtio_console: true,
        });
        let s0data = "";
        let s1data = "";
        // temporary, needs to be fixed later
        this.saveinterval = setInterval(() => {
            this.virt_hda.save();
        }, 1000 * 90);
        window.addEventListener("beforeunload", async (event) => {
            event.preventDefault();
            await this.virt_hda.save();
        });
        this.emulator.add_listener("serial0-output-byte", (byte) => {
            const char = String.fromCharCode(byte);
            if (char === "\r") {
                anura.logger.debug(s0data);
                this._proc_data(s0data);
                s0data = "";
                return;
            }
            s0data += char;
        });
        this.emulator.add_listener("serial1-output-byte", (byte) => {
            const char = String.fromCharCode(byte);
            if (char === "\r") {
                this._proc_data(s1data);
                s1data = "";
                return;
            }
            s1data += char;
        });
    }
    netids = [];
    registered = false;
    v86Wisp;
    termready = false;
    async netdata_send(data) {
        const sendData = new Uint8Array(data.length + 4);
        const dataView = new DataView(sendData.buffer);
        console.log("sending message of " + data.length);
        dataView.setUint32(0, data.length, true);
        sendData.set(data, 4);
        //dataView.setUint8(sendData.length - 1, 10);
        console.log(sendData);
        this.emulator.bus.send("virtio-console0-input-bytes", sendData);
    }
    async onboot() {
        if (this.registered)
            return;
        this.registered = true;
        // await sleep(500); // to be safe
        anura.notifications.add({
            title: "x86 Subsystem Ready",
            description: "x86 OS has booted and is ready for use",
            timeout: 5000,
        });
        this.termready = true;
        // await sleep(1000); // to be safe
        this.xpty = await this.openpty("startx /bin/xfrog", 1, 1, async (data) => {
            console.debug("XFROG " + data);
            if (data.includes("XFROG-INIT")) {
                anura.apps["anura.xfrog"].startup();
                // await sleep(1000); // to be safer?? (some PTY bug occurs without this, I'm not a racist but it feels like a race condition)
                this.startMouseDriver();
                anura.notifications.add({
                    title: "x86 Subsystem",
                    description: "Started XFrog Window Manager",
                    timeout: 5000,
                });
            }
        });
        const registerv86Wisp = () => {
            this.v86Wisp = new WebSocket(anura.wsproxyURL);
            this.v86Wisp.binaryType = "arraybuffer";
            this.v86Wisp.onmessage = (event) => {
                this.netdata_send(new Uint8Array(event.data));
            };
            this.v86Wisp.onclose = (event) => {
                registerv86Wisp();
            };
        };
        this.netpty = await this.openpty("modprobe tun && /bin/whisper --tun tun0 --pty /dev/hvc0", 1, 1, async (data) => {
            console.debug("WHISPER: " + data);
            if (data.includes("Whisper ready!")) {
                this.runcmd("sysctl -w net.ipv4.ip_forward=1");
                this.runcmd("ip route add default via 10.0.10.2 dev tun0");
                anura.notifications.add({
                    title: "x86 Subsystem",
                    description: "Started Networking Stack",
                    timeout: 5000,
                });
            }
            else if (data.includes("Connecting")) {
                registerv86Wisp();
            }
        });
        // await sleep(200);
        this.runpty = await this.openpty("DISPLAY=:0 bash", 1, 1, (data) => {
            console.debug("RUNPTY" + data);
        });
        // await sleep(200);
        // WISP networking
        let netBuffer = [];
        let inTransit = false;
        let currentRead = 0;
        let currentPacketSize = 0;
        let mfingBuffer = []; // I call it mfing buffer because I only have to do this because mf'ing whisper is screwing up
        this.emulator.add_listener("virtio-console0-output-bytes", function (bytes) {
            console.log(bytes);
            if (!inTransit) {
                if (bytes.length < 4 && mfingBuffer.length < 4) {
                    mfingBuffer.push(bytes); // bytes? more like just one byte
                    console.log("motherfucker mode activated");
                    console.log("mf steps: " + mfingBuffer.length);
                    if (mfingBuffer.length == 4) {
                        let totalSize = 0;
                        for (const array of mfingBuffer) {
                            totalSize += array.length;
                        }
                        const newBytes = new Uint8Array(totalSize);
                        let offset = 0;
                        for (const array of mfingBuffer) {
                            newBytes.set(array, offset);
                            offset += array.length;
                        }
                        bytes = newBytes;
                        console.log("mfing redemption time");
                        console.log(bytes);
                        mfingBuffer = [];
                    }
                    else {
                        return;
                    }
                }
                const dataView = new DataView(bytes.buffer);
                const length = dataView.getUint32(0, true);
                if (bytes.length - 4 != length) {
                    inTransit = true;
                    currentRead += bytes.length - 4;
                    currentPacketSize = length;
                    netBuffer.push(bytes.slice(4, bytes.length - 1));
                    inTransit = true;
                }
                else {
                    anura.x86?.v86Wisp.send(bytes.slice(4, bytes.byteLength));
                    inTransit = false;
                    currentRead = 0;
                    currentPacketSize = 0;
                    netBuffer = [];
                }
            }
            else {
                netBuffer.push(bytes);
                currentRead += bytes.length;
                if (currentRead >= currentPacketSize) {
                    console.log("Sending netbuffer: ");
                    console.log(new Blob(netBuffer));
                    anura.x86?.v86Wisp.send(new Blob(netBuffer));
                    inTransit = false;
                    currentRead = 0;
                    currentPacketSize = 0;
                    netBuffer = [];
                }
            }
            console.log("got data");
            console.log(bytes);
            console.log("stream transit: " + inTransit);
            console.log("read: " + currentRead);
            console.log("packetSize: " + currentPacketSize);
        });
    }
    runcmd(cmd) {
        this.writepty(this.runpty, `( ${cmd} ) & \n`);
    }
    closepty(TTYn) {
        this.emulator.serial0_send(`c\n${TTYn}`);
    }
    async #waitAndTry(command, cols, rows, onData) {
        while (!anura.x86.canopenpty) {
            console.log("waiting for pty");
            await sleep(1000);
        }
        return await this.openpty(command, cols, rows, onData);
    }
    canopenpty = true;
    opensafeQueue = [];
    openpty(command, cols, rows, onData) {
        if (!anura.x86.termready) {
            onData("\u001b[33mThe anura x86 subsystem has not yet booted. Please wait for the notification that it has booted and try again.\u001b[0m");
            return new Promise((resolve) => {
                resolve(-1);
            });
        }
        if (!anura.x86.canopenpty) {
            // return new Promise((resolve) => this.opensafeQueue.push(resolve));
            return this.#waitAndTry(command, cols, rows, onData);
        }
        anura.x86.canopenpty = false;
        this.write_uint(rows, this.s_rows_phys_addr);
        this.write_uint(cols, this.s_cols_phys_addr);
        this.write_uint(1, this.new_intent_phys_addr);
        if (this.ready) {
            this.ready = false;
            this.emulator.serial0_send("\x06\n");
            this.emulator.serial0_send(`${command}\n`);
        }
        else {
            this.cmd_q = command;
            this.act = true;
        }
        const waitAndLet = async () => {
            await sleep(10);
            anura.x86.canopenpty = true;
        };
        return new Promise((resolve) => {
            this.openQueue.push((number) => {
                this.onDataCallbacks[number] = onData;
                resolve(number);
                anura.logger.debug("Resolved PTY with ID: " + number);
                waitAndLet();
                //
            });
        });
    }
    resizepty(TTYn, cols, rows) {
        // Until somebody fixes proper resizing, this is what you get, dont like it? fix it.
        this.runcmd(`stty -F /dev/pts/${TTYn} cols ${cols} && stty -F /dev/pts/${TTYn} rows ${rows}`);
        /*
        if (TTYn == -1) {
            return;
        }
        this.write_uint(rows, this.s_rows_phys_addr);
        this.write_uint(cols, this.s_cols_phys_addr);
        this.write_uint(TTYn + 1, this.resize_intent_phys_addr);
        this.write_uint(1336, this.read_intent_phys_addr);
        if (this.ready) {
            this.ready = false;
            this.emulator.serial0_send("\x06\n");
        } else {
            this.act = true;
        }
        */
    }
    async startMouseDriver() {
        let ready = false;
        function pack(value1, value2) {
            const result = (value1 << 16) + value2;
            return result;
        }
        let pointer = "";
        const pty = await this.openpty("TERM=xterm DISPLAY=:0 /bin/anuramouse", 100, 100, (data) => {
            pointer = data.slice(0, -2);
            console.log(pointer);
            ready = true;
        });
        function write_uint(i, addr) {
            // I have to redefine this here because "this" breaks
            const bytes = [i, i >> 8, i >> 16, i >> 24].map((a) => a % 256);
            anura.x86.emulator.write_memory(bytes, addr);
        }
        function movemouse(x, y) {
            if (!ready)
                return;
            write_uint(pack(x, y), Number(pointer));
        }
        const vgacanvas = this.vgacanvas;
        function mouseHandler(event) {
            const rect = vgacanvas.getBoundingClientRect();
            const x = event.clientX - rect.x;
            const y = event.clientY - rect.y;
            movemouse(x, y);
        }
        this.vgacanvas.onmousemove = mouseHandler;
        // Move mouse to edge of X screen when mousing off
        // to prevent multiple cursors from displaying on screen
        this.vgacanvas.onmouseleave = function () {
            movemouse(0, 768);
        };
    }
    writepty(TTYn, data) {
        if (TTYn == -1) {
            return;
        }
        const bytes = encoder.encode(data);
        if (this.nextWrite) {
            this.sendQueue.push([data, TTYn]);
            return;
        }
        this.write_uint(TTYn + 1, this.write_intent_phys_addr);
        this.write_uint(bytes.length, this.write_nbytes_phys_addr);
        this.nextWrite = bytes;
        if (this.ready) {
            this.ready = false;
            this.emulator.serial0_send("\x06\n");
        }
        else {
            this.act = true;
        }
    }
    async _proc_data(data) {
        const start = data.indexOf("\x05");
        if (start === -1)
            return; // \005 is our special control code
        data = data.substring(start + 1);
        const parts = data.split(" ");
        switch (parts.shift()) {
            case "i": {
                const arr = parts.map((p) => parseInt(p));
                [
                    this.read_intent_phys_addr,
                    this.write_intent_phys_addr,
                    this.new_intent_phys_addr,
                    this.read_nbytes_phys_addr,
                    this.write_nbytes_phys_addr,
                    this.s_rows_phys_addr,
                    this.s_cols_phys_addr,
                    this.resize_intent_phys_addr,
                ] = arr;
                if (!this.registered)
                    this.onboot();
                this.emulator.serial0_send("\x06\n");
                break;
            }
            case "r": {
                const addr = parseInt(parts[0]);
                const n_bytes = this.read_uint(this.read_nbytes_phys_addr);
                // let n_tty = this.read_uint(this.read_intent_phys_addr) - 1;
                const n_tty = parseInt(parts[1]);
                const mem = this.emulator.read_memory(addr, n_bytes);
                const text = decoder.decode(mem);
                // console.log(n_tty)
                // console.log(text);
                const cb = this.onDataCallbacks[n_tty];
                if (cb) {
                    cb(text);
                }
                this.emulator.serial1_send("\x06\n");
                break;
            }
            case "w": {
                const addr = parseInt(parts[0]);
                this.emulator.write_memory(this.nextWrite, addr);
                this.nextWrite = null;
                this.write_uint(0, this.write_intent_phys_addr);
                const queued = this.sendQueue.shift();
                if (queued) {
                    this.writepty(queued[1], queued[0]);
                }
                this.emulator.serial0_send("\x06\n");
                break;
            }
            case "n": {
                const func = this.openQueue.shift();
                if (func) {
                    func(parseInt(parts[0]));
                }
                this.emulator.serial0_send("\x06\n");
                break;
            }
            case "v": {
                this.ready = true;
                if (this.act) {
                    this.ready = false;
                    this.act = false;
                    this.emulator.serial0_send("\x06\n");
                    if (this.cmd_q) {
                        this.cmd_q = null;
                        this.emulator.serial0_send(`${this.cmd_q}\n`);
                    }
                }
            }
        }
        // this.emulator.serial0_send("\x06\n"); // ack'd
    }
    read_uint(addr) {
        const b = this.emulator.read_memory(addr, 4);
        return b[0] + (b[1] << 8) + (b[2] << 16) + (b[3] << 24);
        // it's as shrimple as that
    }
    write_uint(i, addr) {
        const bytes = [i, i >> 8, i >> 16, i >> 24].map((a) => a % 256);
        this.emulator.write_memory(bytes, addr);
    }
}
async function savestate() {
    const new_state = await anura.x86.emulator.save_state();
    const a = document.createElement("a");
    a.download = "v86state.bin";
    a.href = window.URL.createObjectURL(new Blob([new_state]));
    a.dataset.downloadurl =
        "application/octet-stream:" + a.download + ":" + a.href;
    a.click();
    this.blur();
}
async function a() {
    const emulator = anura.x86.emulator;
    window.emulator = emulator;
    await new Promise((resolve) => setTimeout(resolve, 300));
    const text = await navigator.clipboard.readText();
    for (const l of text.split("\n")) {
        emulator.serial0_send(`${l}\n`);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    emulator.serial0_send("\n\x04\n");
}
//# sourceMappingURL=v86.js.map