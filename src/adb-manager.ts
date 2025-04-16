import { EventEmitter } from 'events';
import Adb, { DeviceClient, Forward } from '@devicefarmer/adbkit';
import Tracker from '@devicefarmer/adbkit/dist/src/adb/tracker';
import ADBDevice from '@devicefarmer/adbkit/dist/src/Device';
import internal from "stream";
import buffer from "buffer";

// 扩展DeviceClient类型定义
declare module '@devicefarmer/adbkit' {
    interface DeviceClient {
        removeForward(local: string): Promise<void>;
        forward(local: string, remote: string): Promise<void>;
        listForwards(): Promise<Forward[]>;
        waitForDevice(): Promise<void>;
        shell(command: string): Promise<internal.Duplex>;
    }
}

export class ADBManager extends EventEmitter {
    private adbClient = Adb.createClient();
    private tracker: Tracker;

    constructor() {
        super();
    }

    async shell(device: DeviceClient, command: string): Promise<string> {
        let duplex: internal.Duplex = await device.shell(command);
        // @ts-ignore
        let brandBuf: buffer.Buffer = await Adb.util.readAll(duplex);
        return brandBuf.toString();
    }

    async listDevices(): Promise<ADBDevice[]> {
        return this.adbClient.listDevices();
    }

    async getDevice(deviceId: string): Promise<DeviceClient> {
        return this.adbClient.getDevice(deviceId);
    }

    async trackDevices(): Promise<void> {
        let devices = await this.listDevices();
        for (let device of devices) {
            this.emit('device:connect', device.id);
        }

        if (this.tracker) {
            this.emit("tracking:started");
            return;
        }

        try {
            let tracker = await this.adbClient.trackDevices();
            this.tracker = tracker;

            tracker.on('add', async (device) => {
                console.log("ADB device " + device.id + " added");
                const deviceClient = this.adbClient.getDevice(device.id);
                await deviceClient.waitForDevice();
                this.emit('device:add', device.id, deviceClient);
            });

            tracker.on('remove', (device) => {
                console.log("ADB device " + device.id + " removed");
                this.emit('device:remove', device.id);
            });

            tracker.on('end', () => {
                this.tracker = undefined;
                console.log('ADB Tracking stopped');
                this.emit("tracking:stop");
            });

            this.emit("tracking:start");
        } catch (err) {
            this.tracker = undefined;
            this.emit("tracking:error", err);
            console.error('ADB error: ', err.stack);
        }
    }

    stopTracking(): void {
        if (this.tracker) {
            this.tracker.end();
            this.tracker = undefined;
        }
    }

    async listForwards(device: DeviceClient): Promise<Forward[]> {
        return device.listForwards();
    }

    async forward(device: DeviceClient, local: number, remote: number): Promise<void> {
        await device.forward(`tcp:${local}`, `tcp:${remote}`);
    }

    async removeForward(device: DeviceClient, local: number): Promise<void> {
        await device.removeForward(`tcp:${local}`);
    }
} 