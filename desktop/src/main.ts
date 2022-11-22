import { SerialPort } from "serialport";
import Driver from "./driver";
import cliProgress from "cli-progress";
import chalk from "chalk";
import fs from "fs/promises";

//@ts-ignore https://github.com/enquirer/enquirer/issues/135
import { AutoComplete, Confirm } from "enquirer";

//#region  UI
async function withProgressBar(title: string, callback: ((bar: cliProgress.SingleBar) => void)) {
    let pb = new cliProgress.SingleBar({
        format: `${title} | ${chalk.cyan("{bar}")} | {percentage}% | {value}/{total}`,
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
    });
    pb.start(100, 0);
    await callback(pb);
    pb.stop();
}

async function withProgress(title: string, callback: (progressCallback: (completed: number, total: number) => void) => void) {
    const start = new Date();

    await withProgressBar(title, async pb => {
        await callback((completed, total) => {
            pb.setTotal(total);
            pb.update(completed);
        });
    });

    // output timing data
    const end = new Date();
    let time = end.getTime() - start.getTime();
    let timeStr = `${time} ms`;
    if (time > 1000) {
        time /= 1000;
        timeStr = `${time.toFixed()} s`;

        if (time > 60) {
            time /= 60;
            timeStr = `${time.toFixed()} min`;
        }
    }
    console.log(`${title} completed in ${timeStr}`);
}

async function promptSerialPort(): Promise<string | undefined> {
    const ports = await SerialPort.list();
    if (ports.length === 0) {
        console.error("no serial ports found!");
        return undefined;
    }

    if (ports.length === 1) {
        const p = ports[0].path;
        console.log(`auto-select only serial port: ${p}`);
        return p;
    }

    return await new AutoComplete({
        name: "port",
        message: "select the serial port you wish to use",
        initial: 0,
        choices: ports.map(p => p.path)
    }).run();
}

async function instructAndWait(message: string) {
    for (; ;) {
        if ((await new Confirm({
            name: "confirmation",
            message
        }).run())) {
            return;
        }
    }
}

async function instructAddressLines(a16: boolean, a17: boolean) {
    const h = chalk.red("HIGH");
    const l = chalk.blue("LOW");
    await instructAndWait(`Set ${chalk.yellow("A16")} ${a16 ? h : l} and ${chalk.white("A17")} ${a17 ? h : l}`);
}
//#endregion

//#region direct byte write
/**
 * write to the eeprom, with a verify pass of the data
 *  
 * @param drv programmer driver
 * @param data the data to write
 * @param offset offset of the first byte in the data buffer
 * @param start start address, first byte is written to this address in ROM
 * @param length how many bytes to write
 * @param writeRetries how often to retry writing data that failed to verify
 */
async function writeWithVerify(drv: Driver, data: Buffer, offset: number = 0, start: number = 0, length: number = data.length, writeRetries: number = 5) {
    // read original data
    const originalData = Buffer.alloc(length);
    await withProgress("Reading Current Data".padEnd(20), async progress => {
        await drv.read(originalData, 0, start, length, progress);
    });

    // program only the bytes that are changed
    {
        let overwritten = 0;
        await withProgress("Writing New Data".padEnd(20), async progress => {
            for (let i = 0; i < length; i++) {
                if (data[i + offset] !== originalData[i]) {
                    await drv.writeByte(i + start, data[i + offset]);
                    overwritten++;
                }
                progress(i + 1, length);
            }
        });

        console.log(`finished writing ${length} bytes, with ${overwritten} new bytes written`);
    }

    // verify written data
    {
        let verified = 0;
        let errored = 0;
        await withProgressBar("Verifying Data".padEnd(20), async pb => {
            for (let i = 0; i < length; i++) {
                // verify data, retry write n times
                let didVerify = false;
                const expected = data[i + offset];
                let is: number;
                for (let tries = 0; tries < writeRetries; tries++) {
                    is = await drv.readByte(i + start);

                    // retry write
                    if (is !== expected) {
                        await drv.writeByte(i + start, data[i + offset]);
                        continue;
                    }

                    didVerify = true;
                    break;
                }

                // show warning if byte did not verify
                if (!didVerify) {
                    console.log(chalk.red(` 0x${(i + start.toString(16))} did not verify! Expected 0x${expected.toString(16)}, got 0x${is!!.toString(16)}`));
                    errored++;
                } else {
                    verified++;
                }

                // update progress
                pb.setTotal(length);
                pb.update(i + 1);
            }

        });

        console.log(`verified ${verified} bytes, with ${(errored === 0) ? "no" : chalk.red(errored)} failures`);
    }
}
//#endregion

//#region pagewise write
/**
 * write to the eeprom, with a verify pass of the data. 
 * Uses page-wise writing with 256 byte pages
 *  
 * @param drv programmer driver
 * @param data the data to write
 * @param offset offset of the first byte in the data buffer
 * @param start start address, first byte is written to this address in ROM. must be on a page boundary (%256)
 * @param length how many bytes to write. Bytes needed to fill the last page may be added
 */
async function pagedWriteWithVerify(drv: Driver, data: Buffer, offset: number = 0, start: number = 0, length: number = data.length) {
    const pageSize = 256;

    // program page-wise
    {
        let pages = 0;
        await withProgress("Writing Data".padEnd(15), async progress => {
            for (let i = 0; i < length; i += pageSize) {
                await drv.writePage(
                    data,
                    i + offset,
                    i + start,
                    pageSize,
                    (completed, _) => {
                        progress((pages * pageSize) + completed, length);
                    }
                );

                pages++;
            }
        });

        console.log(`finished writing ${length} bytes (${pages} pages)`);
    }

    // verify written data
    {
        let verified = 0;
        let errored = 0;
        await withProgress("Verifying Data".padEnd(15), async progress => {
            // read data
            const verifyBuffer = Buffer.alloc(length);
            await drv.read(verifyBuffer, 0, start, length, progress);

            // verify data
            for (let i = 0; i < length; i++) {
                // show warning if byte did not verify
                const expected = data[i + offset];
                const is = verifyBuffer[i];
                if (expected != is) {
                    console.log(chalk.red(` 0x${(i + start.toString(16))} did not verify! Expected 0x${expected.toString(16)}, got 0x${is!!.toString(16)}`));
                    errored++;
                } else {
                    verified++;
                }
            }

        });

        console.log(`verified ${verified} bytes, with ${(errored === 0) ? "no" : chalk.red(errored)} failures`);
    }
}
//#endregion

async function main() {
    // prompt for programmer port
    const portPath = await promptSerialPort();
    if (!portPath) {
        console.error("no ports available");
        return;
    }

    // connect to programmer
    const port = new SerialPort({
        path: portPath,
        baudRate: 115200
    });
    const drv = new Driver(port);

    async function read() {
        const path = `./read_${(new Date()).getTime()}.bin`;

        // get confirmation
        if (!(await new Confirm({
            name: "confirmation",
            message: "Start READ?"
        }).run())) {
            console.log("user abort");
            return;
        }

        // read the flash
        // NOTE: four reads, since the flash has 18 address lines but the programmer can only control 16 of them
        // so manual switching is needed
        const len = Math.pow(2, 16);
        const data = Buffer.alloc(Math.pow(2, 18));
        const a16 = 1 << 16;
        const a17 = 1 << 17;

        // A16=0; A17=0
        await instructAddressLines(false, false);
        await withProgress("Read Data 1", async progress => {
            await drv.read(data, 0, 0, len, progress);
        });

        // A16=1; A17=0
        await instructAddressLines(true, false);
        await withProgress("Read Data 2", async progress => {
            await drv.read(data, a16, 0, len, progress);
        });

        // A16=0; A17=1
        await instructAddressLines(false, true);
        await withProgress("Read Data 3", async progress => {
            await drv.read(data, a17, 0, len, progress);
        });

        // A16=1; A17=1
        await instructAddressLines(true, true);
        await withProgress("Read Data 4", async progress => {
            await drv.read(data, a16 + a17, 0, len, progress);
        });

        // write data to file, replacing existing file if needed
        await fs.writeFile(path, data);
        console.log(`saved file to ${path} (${data.length} bytes)`);
    }

    async function write() {
        const path = "./bios.bin";
        const image = await fs.readFile(path);
        console.log(`image loaded with ${image.length} bytes`);

        // get confirmation
        if (!(await new Confirm({
            name: "confirmation",
            message: "Start FLASH?"
        }).run())) {
            console.log("user abort");
            return;
        }

        // write the image
        // NOTE: four writes, since the flash has 18 address lines but the programmer can only control 16 of them
        // so manual switching is needed
        const len = Math.pow(2, 16);
        const a16 = 1 << 16;
        const a17 = 1 << 17;

        // A16=0; A17=0
        await instructAddressLines(false, false);
        await pagedWriteWithVerify(drv, image, 0, 0, len);

        // A16=1; A17=0
        await instructAddressLines(true, false);
        await pagedWriteWithVerify(drv, image, a16, 0, len);

        // A16=0; A17=1
        await instructAddressLines(false, true);
        await pagedWriteWithVerify(drv, image, a17, 0, len);

        // A16=1; A17=1
        await instructAddressLines(true, true);
        await pagedWriteWithVerify(drv, image, a16 + a17, 0, len);

        // finished
        console.log(`wrote ${image.length} bytes from ${path}`);
    }


    // exec
    await read();
    //await write();

    // close connection
    port.close();
}
main();
