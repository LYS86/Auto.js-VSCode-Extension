'use strict';
import * as vscode from 'vscode';
import { AutoJsDebugServer, Device } from './autojs-debug';
import { ProjectTemplate, Project } from './project';

import * as fs from 'fs';
import * as path from "path";
import { ProjectSender } from './project-sender';
import { setExtensionContext, getExtensionContext } from './context';

let server = new AutoJsDebugServer(9317);
let recentDevice: Device = null;
server
  .on('connect', () => {
    let servers = server.getIPs().join(":" + server.getPort() + " or ") + ":" + server.getPort();
    let showQrcode = "Show QR code"
    vscode.window.showInformationMessage(`Auto.js Autox.js \r\n server running on ${servers}`, showQrcode).then((result) => {
      if (result === showQrcode) {
        vscode.commands.executeCommand("extension.showQrCode")
      }
    });
  })
  .on('connected', () => {
    vscode.window.showInformationMessage('Auto.js Server already running');
  })
  .on('disconnect', () => {
    vscode.window.showInformationMessage('Auto.js Server stopped');
  })
  .on('adb:tracking_start', () => {
    vscode.window.showInformationMessage(`ADB: Tracking start`);
  })
  .on('adb:tracking_started', () => {
    vscode.window.showInformationMessage(`ADB: Tracking already running`);
  })
  .on('adb:tracking_stop', () => {
    vscode.window.showInformationMessage(`ADB: Tracking stop`);
  })
  .on('adb:tracking_error', () => {
    vscode.window.showInformationMessage(`ADB: Tracking error`);
  })
  .on('new_device', (device: Device) => {
    let messageShown = false;
    let showMessage = () => {
      if (messageShown)
        return;
      vscode.window.showInformationMessage('New device attached: ' + device);
      messageShown = true;
    };
    setTimeout(showMessage, 1000);
    device.on('data:device_name', showMessage);
  })
  .on('cmd', (cmd: String, url: String) => {
    switch (cmd) {
      case "save":
        extension.saveProject(url);
        break;
      case "rerun":
        extension.stopAll();
        setTimeout(function () {
          extension.run(url);
        }, 1000);
        break;
      default:
        break;
    }
  })

export class Extension {
  private documentViewPanel: any = undefined;
  private qrCodeViewPanel: any = undefined;
  private documentCache: Map<string, string> = new Map<string, string>();

  showServerAddress() {
    let servers = server.getIPs().join(":" + server.getPort() + " or ") + ":" + server.getPort();
    vscode.window.showInformationMessage(`Auto.js Autox.js \r\n server running on ${servers}`)
  }

  showQrCode() {
    let ips = server.getIPs()
    if (ips.length == 1) {
      this.showQrcodeWebview(ips[0])
    } else {
      vscode.window.showQuickPick(ips)
        .then(ip => {
          this.showQrcodeWebview(ip)
        });
    }
  }

  private showQrcodeWebview(ip: string) {
    let url = `ws://${ip}:${server.getPort()}`
    if (!this.qrCodeViewPanel) {
      this.qrCodeViewPanel = vscode.window.createWebviewPanel(
        'Qr code',
        "Qr code",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
        }
      );
      this.qrCodeViewPanel.onDidDispose(() => {
        this.qrCodeViewPanel = undefined;
      },
        undefined,
        getExtensionContext().subscriptions
      );
    }
    this.qrCodeViewPanel.webview.html = this.getQrCodeHtml(url)
  }

  private getQrCodeHtml(text: string): string {
    const icon = Extension.getVscodeResourceUrl(this.qrCodeViewPanel, "logo.png")
    const qrcodejs = Extension.getVscodeResourceUrl(this.qrCodeViewPanel, "assets/qrcode.js")
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QR CODE</title>
</head>
<body>
    <div id="qrcode"></div>
    <script src="${qrcodejs}"></script>
    <script type="text/javascript">
        new QRCode(document.getElementById("qrcode"), {
            width: 200,
            height: 200,
            curtainWidth: 220,
            curtainHeight: 220,
            qrcodeOffsetX: 10,
            qrcodeOffsetY: 10,
            curtainBgColor: "white",
            text: "${text}",
            iconSrc: "${icon}",
            iconRadius: 10
        }
        )
    </script>
</body>
</html>`
  }

  static getVscodeResourceUrl(webviewPanel: any, relativePath: string): string {
    return webviewPanel.webview.asWebviewUri(
      vscode.Uri.file(path.join(getExtensionContext().extensionPath, relativePath))
    );
  }

  openDocument() {
    if (this.documentViewPanel) {
      this.documentViewPanel.reveal((vscode.ViewColumn as any).Beside);
    } else {
      this.documentViewPanel = (vscode.window as any).createWebviewPanel(
        'Autox.js Document',
        'Autox.js开发文档',
        (vscode.ViewColumn as any).Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );
      this.documentViewPanel.webview.onDidReceiveMessage(message => {
        let href = message.href.substring(message.href.indexOf("\/electron-browser\/") + 18);
        this.loadDocument(href)
      }, undefined, getExtensionContext().subscriptions);
      this.documentViewPanel.onDidDispose(() => {
        this.documentViewPanel = undefined;
      },
        undefined,
        getExtensionContext().subscriptions
      );
    }
    try {
      this.loadDocument("http://doc.autoxjs.com/#/");
    } catch (e) {
      console.trace(e)
    }
  }

  private loadDocument(url) {
    try {
      let cache = this.documentCache.get(url);
      if (!cache) {
        cache = `<!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0" name="viewport">
                    <meta content="portrait" name="x5-orientation">
                    <meta content="true" name="x5-fullscreen">
                    <meta content="portrait" name="screen-orientation">
                    <meta content="yes" name="full-screen">
                    <meta content="webkit" name="renderer">
                    <meta content="IE=Edge" http-equiv="X-UA-Compatible">
                    <title>微信读书</title>
                    <style>
                    html,body,iframe{
                        width:100%;
                        height:100%;
                        border:0;
                        overflow: hidden;
                    }
                    </style>
                </head>
                <body>
                    <iframe src="`+ url + `"/>
                </body>
                </html>`;
        this.documentCache.set(url, cache);
      }
      this.documentViewPanel.webview.html = cache;
    } catch (e) {
      console.trace(e);
    }
  }

  startServer() {
    server.listen();
  }

  stopServer() {
    server.disconnect();
  }

  startTrackADBDevices() {
    server.trackADBDevices()
  }

  stopTrackADBDevices() {
    server.stopTrackADBDevices()
  }

  startAllServer() {
    server.listen()
    server.trackADBDevices()
  }

  stopAllServer() {
    server.disconnect()
    server.stopTrackADBDevices()
  }

  async manuallyConnectADB() {
    let devices = await server.listADBDevices()
    let names = await Promise.all(devices.map(async (device) => {
      let adbDevice = await server.adbManager.getDevice(device.id)
      let brand = await server.adbShell(adbDevice, "getprop ro.product.brand")
      let model = await server.adbShell(adbDevice, "getprop ro.product.model")
      return `${brand} ${model}: ${device.id}`
    }));
    vscode.window.showQuickPick(names)
      .then(name => {
        let device = devices[names.indexOf(name)]
        server.connectDevice(device.id)
      });
  }

  manuallyDisconnect() {
    let devices = server.devices
    let names = devices.map((device) => { return device.name + ": " + device.id })
    vscode.window.showQuickPick(names)
      .then(name => {
        let device = devices[names.indexOf(name)]
        server.getDeviceById(device.id).close()
      });
  }

  run(url?) {
    this.runOrRerun('run', url);
  }

  stop() {
    server.sendCommand('stop', {
      'id': vscode.window.activeTextEditor.document.fileName,
    });
  }

  stopAll() {
    server.sendCommand('stopAll');
  }

  rerun(url?) {
    this.runOrRerun('rerun', url);
  }

  runOrRerun(cmd, url?) {
    let text = "";
    let filename = null;
    if (url != null) {
      let uri = vscode.Uri.parse(url);
      filename = uri.fsPath;
      try {
        text = fs.readFileSync(filename, 'utf8');
      } catch (error) {
        console.error(error);
      }
    } else {
      let editor = vscode.window.activeTextEditor;
      filename = editor.document.fileName;
      text = editor.document.getText();
    }
    server.sendCommand(cmd, {
      'id': filename,
      'name': filename,
      'script': text
    });
  }

  runOnDevice() {
    this.selectDevice(device => this.runOn(device));
  }

  selectDevice(callback) {
    let devices: Array<Device> = server.devices;
    if (recentDevice) {
      let i = devices.indexOf(recentDevice);
      if (i > 0) {
        devices = devices.slice(0);
        devices[i] = devices[0];
        devices[0] = recentDevice;
      }
    }
    let names = devices.map(device => device.toString());
    vscode.window.showQuickPick(names)
      .then(select => {
        let device = devices[names.indexOf(select)];
        recentDevice = device;
        callback(device);
      });
  }

  runOn(target: AutoJsDebugServer | Device) {
    let editor = vscode.window.activeTextEditor;
    target.sendCommand('run', {
      'id': editor.document.fileName,
      'name': editor.document.fileName,
      'script': editor.document.getText()
    })
  }

  sendProjectCommand(command: string, url?) {
    let folder = null;
    if (url == null) {
      let folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length == 0) {
        vscode.window.showInformationMessage("请打开一个项目的文件夹");
        return null;
      }
      folder = folders[0].uri;
    } else {
      folder = vscode.Uri.parse(url);
    }
    if (!server.project || server.project.folder != folder) {
      server.project && server.project.dispose();
      server.project = new Project(folder);
    }
    server.sendProjectCommand(folder.fsPath, command);
  }

  async runProject(url?) {
    try {
      let folder = null;
      if (url == null) {
        let folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length == 0) {
          vscode.window.showErrorMessage("请打开一个项目的文件夹");
          return null;
        }
        folder = folders[0].uri;
      } else {
        folder = vscode.Uri.parse(url);
      }

      const mainFile = path.join(folder.fsPath, 'main.js');

      if (!fs.existsSync(mainFile)) {
        vscode.window.showErrorMessage("找不到 main.js 文件，请确保项目中包含 main.js");
        return;
      }

      const devices = server.devices;
      if (devices.length === 0) {
        vscode.window.showErrorMessage("没有已连接的设备");
        return;
      }

      let text;
      try {
        text = fs.readFileSync(mainFile, 'utf8');
      } catch (error) {
        vscode.window.showErrorMessage(`读取 main.js 失败: ${error.message}`);
        return;
      }

      if (devices.length === 1) {
        const device = devices[0];
        device.sendCommand('run', {
          'id': mainFile,
          'name': mainFile,
          'script': text
        });
        vscode.window.showInformationMessage(`正在运行项目: ${path.basename(folder.fsPath)}`);
        return;
      }

      const deviceItems = devices.map(device => ({
        label: device.name || device.id,
        description: device.type === 'adb' ? '(ADB)' : '(WebSocket)',
        device: device
      }));

      const selected = await vscode.window.showQuickPick(deviceItems, {
        placeHolder: '选择要运行项目的设备'
      });

      if (selected) {
        const device = selected.device;
        device.sendCommand('run', {
          'id': mainFile,
          'name': mainFile,
          'script': text
        });
        vscode.window.showInformationMessage(`正在运行项目: ${path.basename(folder.fsPath)}`);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`运行项目失败: ${error.message}`);
      console.error('运行项目时出错:', error);
    }
  }

  async saveProject(url?) {
    let folder = null;
    if (url == null) {
      let folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length == 0) {
        vscode.window.showInformationMessage("请打开一个项目的文件夹");
        return null;
      }
      folder = folders[0].uri;
    } else {
      folder = vscode.Uri.parse(url);
    }

    const devices = server.devices;
    if (devices.length === 0) {
      vscode.window.showInformationMessage("没有已连接的设备");
      return;
    }

    if (devices.length === 1) {
      const device = devices[0];
      const adbDevice = device.type === 'adb' ? await server.adbManager.getDevice(device.id) : undefined;
      const sender = new ProjectSender(device, folder.fsPath, adbDevice);
      await sender.send();
      return;
    }

    const deviceItems = devices.map(device => ({
      label: device.name || device.id,
      description: device.type === 'adb' ? '(ADB)' : '(WebSocket)',
      device: device
    }));

    const selected = await vscode.window.showQuickPick(deviceItems, {
      placeHolder: '选择要发送到的设备'
    });

    if (selected) {
      const device = selected.device;
      const adbDevice = device.type === 'adb' ? await server.adbManager.getDevice(device.id) : undefined;
      const sender = new ProjectSender(device, folder.fsPath, adbDevice);
      await sender.send();
    }
  }

  async saveToDevice() {
    const devices = server.devices;
    if (devices.length === 0) {
      vscode.window.showInformationMessage("没有已连接的设备");
      return;
    }

    if (devices.length === 1) {
      const device = devices[0];
      await this.saveProject();
      return;
    }

    const deviceItems = devices.map(device => ({
      label: device.name || device.id,
      description: device.type === 'adb' ? '(ADB)' : '(WebSocket)',
      device: device
    }));

    const selected = await vscode.window.showQuickPick(deviceItems, {
      placeHolder: '选择要保存到的设备'
    });

    if (selected) {
      await this.saveProject();
    }
  }

  newProject() {
    vscode.window.showOpenDialog({
      'canSelectFiles': false,
      'canSelectFolders': true,
      'openLabel': '新建到这里'
    }).then(uris => {
      if (!uris || uris.length == 0) {
        return;
      }
      return new ProjectTemplate(uris[0])
        .build();
    }).then(uri => {
      vscode.commands.executeCommand("vscode.openFolder", uri);
    });
  }
}

let extension = new Extension();

export function activate(context: vscode.ExtensionContext) {
  setExtensionContext(context);

  context.subscriptions.push(vscode.commands.registerCommand('extension.openDocument', () => {
    extension.openDocument();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.showQrCode', () => {
    extension.showQrCode();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.showServerAddress', () => {
    extension.showServerAddress();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.startAllServer', () => {
    extension.startAllServer();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.stopAllServer', () => {
    extension.stopAllServer();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.startServer', () => {
    extension.startServer();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.stopServer', () => {
    extension.stopServer();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.startTrackADBDevices', () => {
    extension.startTrackADBDevices();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.stopTrackADBDevices', () => {
    extension.stopTrackADBDevices();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.manuallyConnectADB', () => {
    extension.manuallyConnectADB();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.manuallyDisconnect', () => {
    extension.manuallyDisconnect();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.run', (url) => {
    extension.run(url);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.runOnDevice', () => {
    extension.runOnDevice();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.stop', () => {
    extension.stop();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.stopAll', () => {
    extension.stopAll();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.rerun', (url) => {
    extension.rerun(url);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.save', (url) => {
    extension.saveProject(url);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.saveToDevice', () => {
    extension.saveToDevice();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.newProject', () => {
    extension.newProject();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.runProject', (url) => {
    extension.runProject(url);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('extension.saveProject', (url) => {
    extension.saveProject(url);
  }));
}

export function deactivate() {
  server.disconnect();
}
