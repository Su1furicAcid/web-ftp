const net = require('net');
const fs = require('fs');
const util = require('util');

const client = new net.Socket();
let FTP_HOST = '';

// 使用promisify将回调函数转换为Promise
const sendCmd = util.promisify((command, callback) => {
    console.log(`Sending command: ${command}`);
    client.write(command + '\r\n');
    client.once('data', (data) => {
        callback(null, data);
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
        client.on('data', (data) => {
            console.log(`Received data: ${data}`);
        });
        client.on('close', () => {
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
let lastReadPos = 0;

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

            if (resume) {
                const restResponse = await sendCmd(`APPE ${remotePath}`);
                console.log('restResponse', restResponse.toString());
                fileStream = fs.createReadStream(localPath, { start: lastReadPos, flags: 'r' , autoClose: true, emitClose: true });
            } else {
                await sendCmd(`STOR ${remotePath}`);
                lastReadPos = 0;
                fileStream = fs.createReadStream(localPath);
            }

            const intervalId = setInterval(() => {
                const progress = (lastReadPos / fileSize) * 100;
                if (progressCallback) {
                    progressCallback(progress.toFixed(2));
                }
            }, 100);

            fileStream.pipe(pasvClient);

            fileStream.on('data', (chunk) => {
                lastReadPos += chunk.length;
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
    changeToParentDir
};