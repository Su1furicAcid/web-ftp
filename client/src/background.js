'use strict'

import { app, protocol, BrowserWindow, ipcMain } from 'electron'
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib'
import installExtension, { VUEJS3_DEVTOOLS } from 'electron-devtools-installer'
import ftpClient from './ftpClient'
const isDevelopment = process.env.NODE_ENV !== 'production'

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true } }
])

let win = null;

async function createWindow() {
  // Create the browser window.
  win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      
      // Use pluginOptions.nodeIntegration, leave this alone
      // See nklayman.github.io/vue-cli-plugin-electron-builder/guide/security.html#node-integration for more info
      nodeIntegration: process.env.ELECTRON_NODE_INTEGRATION,
      contextIsolation: !process.env.ELECTRON_NODE_INTEGRATION
    }
  })

  if (process.env.WEBPACK_DEV_SERVER_URL) {
    // Load the url of the dev server if in development mode
    await win.loadURL(process.env.WEBPACK_DEV_SERVER_URL)
    if (!process.env.IS_TEST) win.webContents.openDevTools()
  } else {
    createProtocol('app')
    // Load the index.html when not in development
    win.loadURL('app://./index.html')
  }
}

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
  if (isDevelopment && !process.env.IS_TEST) {
    // Install Vue Devtools
    try {
      await installExtension(VUEJS3_DEVTOOLS)
    } catch (e) {
      console.error('Vue Devtools failed to install:', e.toString())
    }
  }
  createWindow()
})

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
  if (process.platform === 'win32') {
    process.on('message', (data) => {
      if (data === 'graceful-exit') {
        app.quit()
      }
    })
  } else {
    process.on('SIGTERM', () => {
      app.quit()
    })
  }
}

ipcMain.handle('connect-ftp-server', async (event, FTP_HOST, FTP_PORT) => {
  let response = ftpClient.connToFtpSrv(FTP_HOST, FTP_PORT);
  return response;
});

ipcMain.handle('login-ftp-server', async (event, username, password) => {
  let response = await ftpClient.login(username, password);
  return response;
});

ipcMain.handle('quit-ftp-server', async () => {
  let response = await ftpClient.logout();
  return response;
});

ipcMain.handle('flush-file-list', async () => {
  let response = await ftpClient.fetchFileLst();
  return response;
});

ipcMain.handle('upload-file', async (event, localPath, remotePath) => {
  let response = ftpClient.uploadFile(localPath, remotePath, (progress) => {
    console.log('upload progress', progress);
    win.webContents.send('upload-progress', progress);
  });
  return response;
});

ipcMain.handle('download-file', async (event, localPath, remotePath) => {
  let response = ftpClient.downloadFile(localPath, remotePath, (progress) => {
    console.log('download progress', progress);
    win.webContents.send('download-progress', progress);
  });
  return response;
});

ipcMain.handle('pause-download', async () => {
  let response = ftpClient.pauseDownload();
  return response;
});

ipcMain.handle('resume-download', async (event, localPath, remotePath) => {
  let response = ftpClient.resumeDownload(localPath, remotePath, (progress) => {
    console.log('progress', progress);
    win.webContents.send('download-progress', progress);
  });
  return response;
});

ipcMain.handle('pause-upload', async () => {
  let response = ftpClient.pauseUpload();
  return response;
});

ipcMain.handle('resume-upload', async (event, localPath, remotePath) => {
  let response = ftpClient.resumeUpload(localPath, remotePath, (progress) => {
    console.log('progress', progress);
    win.webContents.send('upload-progress', progress);
  });
  return response;
});

ipcMain.handle('change-work-directory', async (event, dir) => {
  let response = ftpClient.changeWorkDir(dir);
  return response;
});

ipcMain.handle('move-father-directory', async () => {
  let response = ftpClient.changeToParentDir();
  return response;
});

ipcMain.handle('add-new-folder', async (event, folderName) => {
  let response = ftpClient.makeDir(folderName);
  return response;
});

// 在现有的 ipcMain.handle 部分添加dele
ipcMain.handle('delete-file', async (event, filename) => {
  try {
      const response = await ftpClient.deleteFile(filename);
      return response;
  } catch (error) {
      console.error('Error in delete-file handler:', error);
      throw error;
  }
});

// RMD
ipcMain.handle('remove-directory', async (event, dirName) => {
  try {
      const response = await ftpClient.removeDirectory(dirName);
      return response;
  } catch (error) {
      console.error('Error in remove-directory handler:', error);
      throw error;
  }
});

// PWD
ipcMain.handle('print-working-directory', async () => {
  try {
      const response = await ftpClient.printWorkingDirectory();
      return response;
  } catch (error) {
      console.error('Error in print-working-directory handler:', error);
      throw error;
  }
});

// 添加SYST命令处理
ipcMain.handle('get-system-info', async () => {
  try {
      const response = await ftpClient.getSystemInfo();
      return response;
  } catch (error) {
      console.error('Error in get-system-info handler:', error);
      throw error;
  }
});