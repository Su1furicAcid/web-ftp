const net = require('net');
const fs = require('fs');
const util = require('util');

const client = new net.Socket();
let FTP_HOST = '';
let isCommandRunning = false;

// 使用promisify将回调函数转换为Promise
const sendCmd = util.promisify((command, callback) => {
    console.log(`Sending command: ${command}`);
    isCommandRunning = true;
    client.write(command + '\r\n');
    client.once('data', (data) => {
        isCommandRunning = false;
        if (callback) {
            callback(null, data);
        }
    });
});

// 连接到FTP服务器
const connToFtpSrv = (host, port) => {
    return new Promise((resolve, reject) => {
        FTP_HOST = host;
        client.connect(port, host, () => {
            console.log('Connected to FTP server');
            resolve();
        });
        // 持久连接
        let keepAlive = setInterval(() => {
            if (!isCommandRunning) {
                client.write('NOOP\r\n');
            }
        }, 60000);

        client.on('data', (data) => {
            console.log(`Received data: ${data}`);
        });
        client.on('close', () => {
            clearInterval(keepAlive);
            console.log('Connection closed');
        });
        client.on('error', (err) => {
            console.error(err);
            reject(err);
        });
    });
};

// 断开连接
const disconnFromFtpSrv = () => {
    client.end();
};

// 登录操作
const login = async (username, password) => {
    const userResponse = await sendCmd(`USER ${username}`);
    if (userResponse.toString().startsWith('331')) {
        const passResponse = await sendCmd(`PASS ${password}`);
        if (passResponse.toString().startsWith('230')) {
            console.log('Logged in');
        }
    }
};

// 登出操作
const logout = async () => {
    const response = await sendCmd('QUIT');
    if (response.toString().startsWith('221')) {
        console.log('Logged out');
    }
};

// 解析PASV响应
const parsePasvResp = (data) => {
    const match = data.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/);
    if (match) {
        const port = parseInt(match[5]) * 256 + parseInt(match[6]);
        return port;
    }
    return null;
};

// 获取文件列表
const fetchFileLst = async () => {
    console.log('start fetch file list');
    const pasvResponse = await sendCmd('PASV');
    const port = parsePasvResp(pasvResponse.toString());
    if (port) {
        const pasvClient = new net.Socket();
        return new Promise((resolve, reject) => {
            pasvClient.connect(port, FTP_HOST, async () => {
                await sendCmd('LIST');
                pasvClient.on('data', (data) => {
                    console.log(`File list: ${data}`);
                    const files = data.toString().split('\r\n');
                    console.log('allFiles', files);
                    resolve(files);
                    pasvClient.end();
                });
                pasvClient.on('error', (err) => {
                    reject(err);
                });
            });
        });
    } else {
        throw new Error('Failed to enter passive mode');
    }
};

// 上传文件
let lastReadPos = 0; // 上次结束位置

const uploadFile = async (localPath, remotePath, progressCallback, resume = false) => {
    await sendCmd('TYPE I');
    const pasvResponse = await sendCmd('PASV');
    const port = parsePasvResp(pasvResponse.toString());
    if (port) {
        const pasvClient = new net.Socket();
        pasvClient.connect(port, FTP_HOST, async () => {
            const fileStats = fs.statSync(localPath);
            const fileSize = fileStats.size;
            let fileStream;

            if (resume) { // 如果这个传输是续传的
                const restResponse = await sendCmd(`APPE ${remotePath}`);
                console.log('restResponse', restResponse.toString());
                fileStream = fs.createReadStream(localPath, { start: lastReadPos, flags: 'r' , autoClose: true, emitClose: true });
            } else {
                await sendCmd(`STOR ${remotePath}`);
                lastReadPos = 0;
                fileStream = fs.createReadStream(localPath);
            }

            const intervalId = setInterval(() => { // 定时器，每100ms检查一次上传进度
                const progress = (lastReadPos / fileSize) * 100;
                if (progressCallback) {
                    progressCallback(progress.toFixed(2));
                }
            }, 100);

            fileStream.pipe(pasvClient);

            fileStream.on('data', (chunk) => {
                lastReadPos += chunk.length; // 更新已读取的字节数
            });
            pasvClient.on('end', () => {
                if (progressCallback && lastReadPos >= fileSize) {
                    progressCallback(100.00);
                }
                clearInterval(intervalId);
                pasvClient.end();
                console.log('File uploaded');
            });
            pasvClient.on('close', () => {
                console.log('File transfer complete');
            });
        });
    }
};

// 下载文件
const downloadFile = async (localPath, remotePath, progressCallback, resume = false) => {
    await sendCmd('TYPE I');
    const pasvResponse = await sendCmd('PASV');
    const port = parsePasvResp(pasvResponse.toString());
    if (port) {
        const pasvClient = new net.Socket();
        pasvClient.connect(port, FTP_HOST, async () => {
            let downloadedSize = 0;
            let fileStream;

            if (resume) {
                const localFileStats = fs.statSync(localPath);
                const localFileSize = localFileStats.size;
                const restResponse = await sendCmd(`REST ${localFileSize}`);
                console.log('restResponse', restResponse.toString());
                downloadedSize = localFileSize;
                fileStream = fs.createWriteStream(localPath, { flags: 'a', autoClose: true });
            } else {
                downloadedSize = 0;
                fileStream = fs.createWriteStream(localPath);
            }

            await sendCmd(`RETR ${remotePath}`);
            
            const sizeResponse = await sendCmd(`SIZE ${remotePath}`);
            const totalSize = parseInt(sizeResponse.toString().split(' ')[1]);

            const intervalId = setInterval(() => {
                const progress = (downloadedSize / totalSize) * 100;
                
                if (progressCallback) {
                    progressCallback(progress.toFixed(2));
                }
            }, 100);

            pasvClient.pipe(fileStream);
            pasvClient.on('data', (chunk) => {
                downloadedSize += chunk.length;
            });
            pasvClient.on('end', () => {
                if (progressCallback && downloadedSize >= totalSize) {
                    progressCallback(100.00);
                }
                clearInterval(intervalId);
                pasvClient.end();
                console.log('File downloaded');
            });
            pasvClient.on('close', () => {
                console.log('File transfer complete');
            });
        });
    }
};

// 暂停下载
const pauseDownload = async () => {
    const pauseResponse = await sendCmd('ABOR');
    if (pauseResponse.toString().startsWith('226')) {
        console.log('Download paused');
    }
    return pauseResponse;
}

// 断点续传
const resumeDownload = async (localPath, remotePath, progressCallback) => {
    console.log('Resuming download');
    await downloadFile(localPath, remotePath, progressCallback, true);
};

// 暂停上传
const pauseUpload = async () => {
    const pauseResponse = await sendCmd('ABOR');
    if (pauseResponse.toString().startsWith('226')) {
        console.log('Upload paused');
    }
    return pauseResponse;
}

// 断点续传
const resumeUpload = async (localPath, remotePath, progressCallback) => {
    console.log('Resuming upload');
    await uploadFile(localPath, remotePath, progressCallback, true);
};

// 切换工作目录
const changeWorkDir = async (dir) => {
    const response = await sendCmd(`CWD ${dir}`);
    if (response.toString().startsWith('250')) {
        console.log(`Changed working directory to ${dir}`);
    }
};

// 返回上级目录
const changeToParentDir = async () => {
    const response = await sendCmd('CDUP');
    if (response.toString().startsWith('250')) {
        console.log('Changed to parent directory');
    }
};

// 删除文件（DELE）
const deleteFile = async (filename) => {
    try {
        const response = await sendCmd(`DELE ${filename}`);
        if (response.toString().startsWith('250')) {
            console.log(`File ${filename} deleted successfully`);
            return true;
        } else {
            console.error(`Failed to delete file ${filename}`);
            return false;
        }
    } catch (error) {
        console.error(`Error deleting file: ${error}`);
        throw error;
    }
};

// 添加删除目录的函数(RMD)
const removeDirectory = async (dirName) => {
    try {
        const response = await sendCmd(`RMD ${dirName}`);
        if (response.toString().startsWith('250')) {
            console.log(`Directory ${dirName} removed successfully`);
            return true;
        } else {
            console.error(`Failed to remove directory ${dirName}`);
            return false;
        }
    } catch (error) {
        console.error(`Error removing directory: ${error}`);
        throw error;
    }
};

// 添加获取当前工作目录的函数(PWD)
const printWorkingDirectory = async () => {
    try {
        const response = await sendCmd('PWD');
        // PWD响应格式通常是 "257 \"/current/path\" is current directory"
        if (response.toString().startsWith('257')) {
            const pathMatch = response.toString().match(/"([^"]+)"/);
            if (pathMatch) {
                console.log(`Current directory: ${pathMatch[1]}`);
                return pathMatch[1];
            }
        }
        console.error('Failed to get working directory');
        return null;
    } catch (error) {
        console.error(`Error getting working directory: ${error}`);
        throw error;
    }
};

// 添加获取系统信息的函数
const getSystemInfo = async () => {
    try {
        const response = await sendCmd('SYST');
        if (response.toString().startsWith('215')) {
            // 215 是SYST命令的标准成功响应代码
            console.log(`System info: ${response.toString()}`);
            return response.toString().substring(4); // 去掉"215 "前缀
        }
        console.error('Failed to get system information');
        return null;
    } catch (error) {
        console.error(`Error getting system information: ${error}`);
        throw error;
    }
};

const makeDir = async (folderName) => {
    const response = await sendCmd(`MKD ${folderName}`);
    if (response.toString().startsWith('257')) {
        console.log(`Created folder ${folderName}`);
    }
};

module.exports = {
    connToFtpSrv,
    disconnFromFtpSrv,
    login,
    logout,
    fetchFileLst,
    uploadFile,
    downloadFile,
    resumeDownload,
    pauseDownload,
    resumeUpload,
    pauseUpload,
    changeWorkDir,
    changeToParentDir,
    deleteFile,
    removeDirectory, 
    printWorkingDirectory,
    getSystemInfo,
    makeDir
};