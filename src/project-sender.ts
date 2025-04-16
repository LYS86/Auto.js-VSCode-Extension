import * as vscode from 'vscode';
import { Device } from './autojs-debug';
import { ProjectObserser } from './project';
import * as path from 'path';
import * as fs from 'fs';
import { DeviceClient } from '@devicefarmer/adbkit';

export class ProjectSender {
    private progressResolver: ((value: void) => void) | null = null;
    private currentProgress: vscode.Progress<{ message?: string; increment?: number }> | null = null;

    constructor(
        private device: Device,
        private projectPath: string,
        private adbDevice?: DeviceClient
    ) {}

    async send(): Promise<void> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `正在发送项目到设备:\n${this.device.name}`,
            cancellable: true
        }, async (progress, token) => {
            this.currentProgress = progress;
            
            return new Promise<void>((resolve, reject) => {
                this.progressResolver = resolve;
                token.onCancellationRequested(() => {
                    reject(new Error('用户取消了操作'));
                });

                this.startSending();
            });
        });
    }

    private async startSending() {
        try {
            // 更新进度显示
            this.updateProgress('正在准备项目文件...', 0);

            const observer = new ProjectObserser(this.projectPath, () => true);
            const { buffer, md5 } = await observer.diff();

            // 更新进度显示
            this.updateProgress('正在压缩项目文件...', 20);

            if (this.adbDevice) {
                await this.sendViaAdb(buffer);
            } else {
                await this.sendViaWebsocket(buffer, md5);
            }

            // 完成
            this.updateProgress('项目发送完成！', 100);
            vscode.window.showInformationMessage(`项目已成功发送到设备: ${this.device.name}`);
            this.progressResolver?.();
        } catch (error) {
            vscode.window.showErrorMessage(`发送项目失败: ${error.message}`);
            this.progressResolver?.();
        }
    }

    private async sendViaAdb(buffer: Buffer) {
        if (!this.adbDevice) return;

        this.updateProgress('正在通过ADB发送项目...', 40);

        // 创建临时zip文件
        const tempZipPath = path.join(this.projectPath, '.temp_project.zip');
        fs.writeFileSync(tempZipPath, buffer);

        try {
            // 创建设备上的目标目录
            const deviceProjectPath = '/sdcard/脚本/project';
            await this.adbDevice.shell(`mkdir -p ${deviceProjectPath}`);

            // 推送文件到设备
            this.updateProgress('正在通过ADB传输文件...', 60);
            await this.adbDevice.push(tempZipPath, `${deviceProjectPath}/temp.zip`);

            // 解压文件
            this.updateProgress('正在解压项目文件...', 80);
            await this.adbDevice.shell(`cd ${deviceProjectPath} && unzip -o temp.zip && rm temp.zip`);
        } finally {
            // 清理临时文件
            fs.unlinkSync(tempZipPath);
        }
    }

    private async sendViaWebsocket(buffer: Buffer, md5: string) {
        this.updateProgress('正在通过WebSocket发送项目...', 40);

        // 发送二进制数据
        this.device.sendBytes(buffer);

        // 发送保存项目命令
        this.updateProgress('正在保存项目...', 80);
        this.device.sendBytesCommand('save_project', md5, {
            'id': this.projectPath,
            'name': path.basename(this.projectPath)
        });
    }

    private updateProgress(message: string, increment: number) {
        if (this.currentProgress) {
            this.currentProgress.report({
                message: `\n${message}`,
                increment: increment
            });
        }
    }
} 