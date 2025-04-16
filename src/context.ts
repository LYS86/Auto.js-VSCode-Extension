import * as vscode from 'vscode';

let _context: vscode.ExtensionContext;

export function setExtensionContext(context: vscode.ExtensionContext) {
    _context = context;
}

export function getExtensionContext(): vscode.ExtensionContext {
    return _context;
} 