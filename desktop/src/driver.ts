import { SerialPort } from "serialport";
import { Buffer } from "buffer";
import { millis, withRetry, yieldThread } from "./util";

const PKG_START = 0x7B;
const PKG_END = 0x7D;
const CMD_READ = 0xAA;
const CMD_WRITE = 0xBB;
const CMD_PAGE_WRITE_START = 0xCC;
const CMD_PAGE_WRITE_DATA = 0xCD;
const PAGE_SIZE = 256;

type ProgressCallback = (completed: number, total: number) => void;

export default class Driver {
    private receivedData: number[] = [];

    constructor(private port: SerialPort) {
        port.on("data", (data: Buffer) => {
            this.receivedData.push(...data);
        });
    }

    //#region block read/write
    /**
     * 
     * @param data the data buffer to read into
     * @param offset offset of the first byte in the data buffer
     * @param start start address, byte in this address is written to the first byte of the buffer
     * @param length how many bytes to read
     * @param progress progress callback
     */
    async read(data: Buffer, offset: number = 0, start: number = 0, length: number = data.length, progress: ProgressCallback = () => { }) {
        for (let i = 0; i < length; i++) {
            data[i + offset] = await this.readByte(i + start);

            progress(i + 1, length);
        }
    }

    /**
     * block write function. does not support page writing
     * 
     * @param data the data to write
     * @param offset offset of the first byte in the data buffer
     * @param start start address, first byte is written to this address in ROM
     * @param length how many bytes to write
     * @param progress progress callback
     */
    async write(data: Buffer, offset: number = 0, start: number = 0, length: number = data.length, progress: ProgressCallback = () => { }) {
        for (let i = 0; i < length; i++) {
            await this.writeByte(i + start, data[i + offset]);

            progress(i + 1, length);
        }
    }
    //#endregion

    //#region page write mode
    /**
     * page write function.
     * 
     * @param data the data to write
     * @param offset offset of the first byte in the data buffer
     * @param start start address, first byte is written to this address in ROM. Must be at the start of a byte (%256)
     * @param length how many bytes to write. if less than page size (256 bytes), the missing data is filled with 0x00
     * @param progress progress callback
     */
    async writePage(data: Buffer, offset: number = 0, start: number = 0, length: number = data.length, progress: ProgressCallback = () => { }) {
        if (start !== (start & 0xffff)) {
            throw new Error("start address out of bounds");
        }
        if ((start % PAGE_SIZE) !== 0) {
            throw new Error(`start address ${start} is not on a page boundary for page size ${PAGE_SIZE}`);
        }
        if (length > PAGE_SIZE) {
            throw new Error("data length did not match page size");
        }

        // enter page write mode and the first byte
        await this.startPageWrite(start, data[offset]);
        progress(1, length);

        // write remaining page data
        for (let i = 1; i < PAGE_SIZE; i += 3) {
            await this.sendPageData(
                data[i + offset + 0] | 0x0,
                data[i + offset + 1] | 0x0,
                data[i + offset + 2] | 0x0,
                (i === PAGE_SIZE - 3)
            );

            progress(i + 1, length);
        }
    }

    private async startPageWrite(startAddress: number, byteOne: number) {
        if (startAddress !== (startAddress & 0xffff)) {
            throw new Error("start address out of bounds");
        }
        if ((byteOne !== (byteOne & 0xff))) {
            throw new Error("data out of bounds");
        }

        // send write request
        this.port.write(Buffer.from([
            /* START */ PKG_START,
            /* cmd */ CMD_PAGE_WRITE_START,
            /* lower address */ (startAddress & 0xff),
            /* upper address */ ((startAddress >> 8) & 0xff),
            /* data */ byteOne,
            /* END */ PKG_END
        ]));

        // wait for response
        const response = await this.readPackage(4, 1000);
        const start = response[0];
        const data = response[1];
        const dataInv = response[2];
        const end = response[3];

        // check start and end bytes are ok
        if (start !== PKG_START || end !== PKG_END) {
            throw new Error("invalid package start/end bytes");
        }

        // check data matches ~data
        if ((data & 0xff) !== (~dataInv & 0xff)) {
            throw new Error("data check failed");
        }

        // check response value
        if ((data & 0xff) !== (byteOne & 0xff)) {
            throw new Error("response data invalid");
        }
    }

    private async sendPageData(byteOne: number, byteTwo: number, byteTree: number, isLast: boolean) {
        if ((byteOne !== (byteOne & 0xff)) || (byteTwo !== (byteTwo & 0xff)) || (byteTree !== (byteTree & 0xff))) {
            throw new Error("data out of bounds");
        }

        // send write request
        this.port.write(Buffer.from([
            /* START */ PKG_START,
            /* cmd */ CMD_PAGE_WRITE_DATA,
            /* data */ (byteOne & 0xff),
            /* data */ (byteTwo & 0xff),
            /* data */ (byteTree & 0xff),
            /* END */ PKG_END
        ]));

        // wait for response
        const response = await this.readPackage(4, 1000);
        const start = response[0];
        const rData = response[1];
        const rDataInv = response[2];
        const end = response[3];

        // check start and end bytes are ok
        if (start !== PKG_START || end !== PKG_END) {
            throw new Error("invalid package start/end bytes");
        }

        // check data matches ~data
        if ((rData & 0xff) !== (~rDataInv & 0xff)) {
            throw new Error("data check failed");
        }

        // check response value
        if (isLast) {
            if ((rDataInv & 0xff) !== (byteOne & 0xff)) {
                throw new Error("response data invalid");
            }
        } else {
            if ((rData & 0xff) !== (byteOne & 0xff)) {
                throw new Error("response data invalid");
            }
        }
    }
    //#endregion

    //#region byte read/write
    /**
     * read a single byte
     * 
     * @param address the address to read from
     * @returns the byte read
     */
    async readByte(address: number): Promise<number> {
        if (address !== (address & 0xffff)) {
            throw new Error("address out of bounds");
        }

        return await withRetry(5, async () => {
            // send read request
            this.port.write(Buffer.from([
            /* START */ PKG_START,
            /* cmd */ CMD_READ,
            /* lower address */ (address & 0xff),
            /* upper address */ ((address >> 8) & 0xff),
            /* nop */ 0,
            /* END */ PKG_END
            ]));

            // wait for response
            const response = await this.readPackage(4, 1000);
            const start = response[0];
            const data = response[1];
            const dataInv = response[2];
            const end = response[3];

            // check start and end bytes are ok
            if (start !== PKG_START || end !== PKG_END) {
                throw new Error("invalid package start/end bytes");
            }

            // check data matches ~data
            if ((data & 0xff) !== (~dataInv & 0xff)) {
                throw new Error("data check failed");
            }

            return data;
        });
    }

    /**
     * write a single byte
     * 
     * @param address the address to write to
     * @param data the data byte to write
     */
    async writeByte(address: number, data: number) {
        if (address !== (address & 0xffff)) {
            throw new Error("address out of bounds");
        }
        if (data !== (data & 0xff)) {
            throw new Error("data out of bounds");
        }

        await withRetry(5, async () => {
            // send write request
            this.port.write(Buffer.from([
            /* START */ PKG_START,
            /* cmd */ CMD_WRITE,
            /* lower address */ (address & 0xff),
            /* upper address */ ((address >> 8) & 0xff),
            /* data */ (data & 0xff),
            /* END */ PKG_END
            ]));

            // wait for response
            const response = await this.readPackage(4, 1000);
            const start = response[0];
            const rData = response[1];
            const rDataInv = response[2];
            const end = response[3];

            // check start and end bytes are ok
            if (start !== PKG_START || end !== PKG_END) {
                throw new Error("invalid package start/end bytes");
            }

            // check data matches ~data
            if ((data & 0xff) !== (rData & 0xff) || (rData & 0xff) !== (~rDataInv & 0xff)) {
                throw new Error("data check failed");
            }
        });
    }

    /**
     * read a n-byte package
     * 
     * @param len number of bytes in the expected package
     * @param timeoutMs timeout for receive
     * @returns received package
     * @throws if not received in timeout or read from port fails
     */
    private async readPackage(len: number, timeoutMs: number): Promise<number[]> {
        let pkg: number[] = [];
        const start = millis();

        // fast-forward to first start-of-packet
        while (this.receivedData.length === 0 || this.receivedData[0] !== PKG_START) {
            let d = this.receivedData.shift();
            if (d !== undefined) {
                console.log(d);
            }

            if (this.receivedData.length === 0) {
                //await sleep(1);
                await yieldThread();
            }

            if ((millis() - start) >= timeoutMs) {
                throw new Error("timeout waiting for package");
            }
        }

        // wait until n bytes are available
        while (this.receivedData.length < len) {
            //await sleep(1);
            await yieldThread();
        }

        // read n bytes
        for (let i = 0; i < len; i++) {
            pkg.push(this.receivedData.shift()!! & 0xff);
        }
        return pkg;
    }
    //#endregion
}
