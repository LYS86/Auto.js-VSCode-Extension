import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import * as ws from 'websocket';
import * as http from 'http';
import * as querystring from 'querystring';
import * as url from 'url';
import * as fs from 'fs'
import { Project, ProjectObserser } from './project';
import { DeviceClient } from '@devicefarmer/adbkit';
import { ADBManager } from './adb-manager';
import { getExtensionContext } from './context';
const DEBUG = false;

function logDebug(message?: any, ...optionalParams: any[]) {
  if (DEBUG) {
    console.log.apply(console, arguments);
  }
}


const HANDSHAKE_TIMEOUT = 10 * 1000;

export class Device extends EventEmitter {
  public name: string;
  public type: string;
  public id: string;
  private connection: ws.connection;
  public attached: boolean = false;
  public projectObserser: ProjectObserser;

  constructor(connection: ws.connection, type: string, id: string) {
    super();
    this.type = type
    this.id = id
    this.connection = connection;
    this.read(this.connection);
    this.on('data:hello', data => {
      logDebug("on client hello: ", data);
      this.attached = true;
      this.name = data['device_name'];
      let message_id = `${Date.now()}_${Math.random()}`;
      let appVersionCode = data['app_version_code']
      let extensionVersion = getExtensionContext().extension.packageJSON.version
      let returnData
      if (appVersionCode >= 629) {
        returnData = JSON.stringify({ message_id, data: "ok", version: extensionVersion, debug: DEBUG, type: 'hello' })
      } else {
        returnData = JSON.stringify({ message_id, data: "连接成功", debug: DEBUG, type: 'hello' })
      }
      logDebug("return data: ", returnData)
      this.connection.sendUTF(returnData);
      this.emit("attach", this);
    });
    this.on('data:ping', data => {
      logDebug("on client ping: ", data);
      let message_id = `${Date.now()}_${Math.random()}`;
      var returnData = JSON.stringify({ type: 'pong', data: data })
      logDebug("pong: ", returnData)
      this.connection.sendUTF(returnData);
    })
    setTimeout(() => {
      if (!this.attached) {
        console.log("handshake timeout");
        this.connection.close();
        this.connection = null;
      }
    }, HANDSHAKE_TIMEOUT);
  }

  close() {
    let message_id = `${Date.now()}_${Math.random()}`;
    let closeMessage = JSON.stringify({ message_id, data: "close", debug: false, type: 'close' })
    this.connection.sendUTF(closeMessage);
    this.connection.close();
    this.connection = null;
  }

  send(type: string, data: any): void {
    let message_id = `${Date.now()}_${Math.random()}`;
    console.log(data);
    this.connection.sendUTF(JSON.stringify({
      type: type,
      message_id,
      data: data
    }));
  }

  sendBytes(bytes: Buffer): void {
    this.connection.sendBytes(bytes);
  }

  sendBytesCommand(command: string, md5: string, data: object = {}): void {
    data = Object(data);
    data['command'] = command;
    let message_id = `${Date.now()}_${Math.random()}`;
    this.connection.sendUTF(JSON.stringify({
      type: 'bytes_command',
      message_id,
      md5: md5,
      data: data
    }));
  }

  sendCommand(command: string, data: object): void {
    data = Object(data);
    data['command'] = command;
    this.send('command', data);
  }

  public toString = (): string => {
    if (!this.name) {
      return `Device (${this.type}: ${this.id})`;
    }
    return `Device ${this.name}(${this.type}: ${this.id})`;
  }

  private read(connection: ws.connection) {
    connection.on('message', message => {
      logDebug("message: ", message);
      if (message.type == 'utf8') {
        try {
          let json = JSON.parse(message.utf8Data);
          logDebug("json: ", json);
          this.emit('message', json);
          this.emit('data:' + json['type'], json['data']);
        } catch (e) {
          console.error(e);
        }
      }
    });
    connection.on('close', (reasonCode, description) => {
      console.log(`close: device = ${this}, reason = ${reasonCode}, desc = ${description}`);
      this.connection = null;
      this.emit('disconnect');
    });
  }

}

export class AutoJsDebugServer extends EventEmitter {
  public isHttpServerStarted = false
  private httpServer: http.Server;
  public adbManager: ADBManager;
  private port: number;
  public devices: Array<Device> = [];
  public project: Project = null;
  private logChannels: Map<string, vscode.OutputChannel>;
  private fileFilter = (relativePath: string, absPath: string, stats: fs.Stats) => {
    if (!this.project) {
      return true;
    }
    return this.project.fileFilter(relativePath, absPath, stats);
  };

  constructor(port: number) {
    super();
    this.logChannels = new Map<string, vscode.OutputChannel>();
    this.port = port;
    this.adbManager = new ADBManager();
    
    this.adbManager.on('device:add', async (deviceId: string, deviceClient: DeviceClient) => {
      await this.connectDevice(deviceId, deviceClient);
    });

    this.adbManager.on('device:remove', (deviceId: string) => {
      let wsDevice = this.getDeviceById(deviceId);
      if (wsDevice) {
        wsDevice.close();
      }
    });

    this.adbManager.on('tracking:start', () => {
      this.emit("adb:tracking_start");
    });

    this.adbManager.on('tracking:stop', () => {
      this.emit("adb:tracking_stop");
    });

    this.adbManager.on('tracking:error', () => {
      this.emit("adb:tracking_error");
    });

    this.httpServer = http.createServer((request, response) => {
      console.log(new Date() + ' Received request for ' + request.url);
      var urlObj = url.parse(request.url);
      var query = urlObj.query;
      var queryObj = querystring.parse(query);
      if (urlObj.pathname == "/exec") {
        response.writeHead(200);
        response.end("this commond is:" + queryObj.cmd + "-->" + queryObj.path);
        this.emit('cmd', queryObj.cmd, queryObj.path);
        console.log(queryObj.cmd, queryObj.path);
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    let wsServer = new ws.server({ httpServer: this.httpServer, keepalive: true, keepaliveInterval: 10000 });
    wsServer.on('request', request => {
      let connection = request.accept();
      if (!connection) {
        return;
      }
      this.newDevice(connection, "tcp", connection.socket.remoteAddress + ":" + connection.socket.remotePort)
    })
  }

  getDeviceById(id: string): Device {
    return this.devices.find((value) => {
      return value.id == id
    })
  }

  private newDevice(connection: ws.connection, type: string, id: string) {
    let device = new Device(connection, type, id);
    logDebug(connection.state, "--->status")
    device
      .on("attach", (device) => {
        this.attachDevice(device);
        this.emit('new_device', device);
        let logChannel = this.newLogChannel(device);
        logChannel.appendLine(`Device connected: ${device}`);
      })
  }

  async adbShell(device: DeviceClient, command: string): Promise<string> {
    return this.adbManager.shell(device, command);
  }

  async listADBDevices() {
    return this.adbManager.listDevices();
  }

  async trackADBDevices() {
    await this.adbManager.trackDevices();
  }

  stopTrackADBDevices() {
    this.adbManager.stopTracking();
  }

  async connectDevice(id: string, device: DeviceClient = undefined) {
    if (!device) {
      device = await this.adbManager.getDevice(id);
    }
    let forwards = await this.adbManager.listForwards(device);
    let forward = forwards.find(forward => forward.remote == 'tcp:9317');
    if (!forward) {
      await this.adbManager.forward(device, this.port, 9317);
    }
    this.connectAutoxjsByADB(this.port, id);
  }

  private connectAutoxjsByADB(port: Number, deviceId: string) {
    let autoJsDebugServer = this
    let url = `ws://localhost:${port}/`

    var client = new ws.client();

    client.on('connectFailed', function (error) {
      let err = 'Connect Error: ' + error.toString()
      console.log(err);
      vscode.window.showInformationMessage(err)
    });

    client.on('connect', function (connection) {
      console.log("connected to " + url)
      autoJsDebugServer.newDevice(connection, "adb", deviceId)
    });
    client.connect(url);
  }

  listen(): void {
    if (this.isHttpServerStarted) {
      this.emit("connected");
      return
    }
    this.httpServer.on('error', (e) => {
      this.isHttpServerStarted = false
      console.error('server error: ', e);
    });
    this.httpServer.listen(this.port, '0.0.0.0', () => {
      this.isHttpServerStarted = true
      const address: any = this.httpServer.address();
      var localAddress = this.getIPAddress();
      console.log(`server listening on ${localAddress}:${address.port} / ${address.address}:${address.port}`);
      this.emit("connect");
    });
  }

  send(type: string, data: any): void {
    this.devices.forEach(device => {
      device.send(type, data);
    });
  }

  sendBytes(data: Buffer): void {
    this.devices.forEach(device => {
      device.sendBytes(data);
    });
  }

  sendBytesCommand(command: string, md5: string, data: object = {}): void {
    this.devices.forEach(device => {
      device.sendBytesCommand(command, md5, data);
    });
  }

  sendProjectCommand(folder: string, command: string) {
    let startTime = new Date().getTime();
    this.devices.forEach(device => {
      if (device.projectObserser == null || device.projectObserser.folder != folder) {
        device.projectObserser = new ProjectObserser(folder, this.fileFilter);
      }
      device.projectObserser.diff()
        .then(result => {
          device.sendBytes(result.buffer);
          device.sendBytesCommand(command, result.md5, {
            'id': folder,
            'name': folder
          });
          this.getLogChannel(device).appendLine(`发送项目耗时: ${(new Date().getTime() - startTime) / 1000} 秒`);
        });
    });
  }

  sendCommand(command: string, data: object = {}): void {
    this.devices.forEach(device => {
      device.sendCommand(command, data);
    });
  }

  disconnect(): void {
    this.httpServer.close();
    this.isHttpServerStarted = false
    this.emit("disconnect");
    this.logChannels.forEach(channel => {
      channel.dispose();
    });
    this.logChannels.clear();
    this.devices.forEach((device) => {
      device.close()
    })
  }

  /** 获取本地IP */
  getIPAddress(): string {
    var interfaces = require('os').networkInterfaces();
    for (var devName in interfaces) {
      var iface = interfaces[devName];
      for (var i = 0; i < iface.length; i++) {
        var alias = iface[i];
        console.log("---", alias)
        if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
          return alias.address;
        }
      }
    }
  }
  /** 获取本地IP */
  getIPs(): string[] {
    var ips = [];
    var interfaces = require('os').networkInterfaces();
    for (var devName in interfaces) {
      var iface = interfaces[devName];
      for (var i = 0; i < iface.length; i++) {
        var alias = iface[i];
        console.log("---", alias)
        if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
          ips.push(alias.address);
        }
      }
    }
    return ips;
  }

  /** 获取服务运行端口 */
  getPort(): number {
    return this.port;
  }

  private attachDevice(device: Device): void {
    this.devices.push(device);
    device.on('data:log', data => {
      console.log(data['log']);
      this.getLogChannel(device).appendLine(data['log']);
      this.emit('log', data['log']);
    });
    device.on('disconnect', this.detachDevice.bind(this, device));
  }

  private detachDevice(device: Device): void {
    this.devices.splice(this.devices.indexOf(device), 1);
    console.log("detachDevice: " + device);
    vscode.window.showInformationMessage(`Device disconnected: ${device}`)
    var logChannel = this.getLogChannel(device)
    logChannel.dispose();
    this.logChannels.delete(device.toString())
  }

  /** 创建设备日志打印通道 */
  private newLogChannel(device: Device): vscode.OutputChannel {
    let channelName = device.toString();
    // let logChannel = this.logChannels.get(channelName);
    // if (!logChannel) {
    let logChannel = vscode.window.createOutputChannel(channelName);
    this.logChannels.set(channelName, logChannel);
    // }
    logChannel.show(true);
    // console.log("创建日志通道" + channelName)
    return logChannel;
  }

  /** 获取设备日志打印通道 */
  private getLogChannel(device: Device): vscode.OutputChannel {
    let channelName = device.toString();
    // console.log("获取日志通道：" + channelName);
    return this.logChannels.get(channelName);
  }

}
