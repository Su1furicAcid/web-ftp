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
const uploadFile = async (localPath, remotePath) => {
    const fileStats = fs.statSync(localPath);
    const fileSize = fileStats.size;
    console.log(`File size: ${fileSize}`);
    const fileStream = fs.createReadStream(localPath);
    const pasvResponse = await sendCmd('PASV');
    const port = parsePasvResp(pasvResponse.toString());
    if (port) {
        const pasvClient = new net.Socket();
        pasvClient.connect(port, FTP_HOST, async () => {
            await sendCmd(`STOR ${remotePath}`);
            fileStream.pipe(pasvClient);
            fileStream.on('end', () => {
                pasvClient.end();
                console.log('File uploaded');
            });
            fileStream.on('close', () => {
                console.log('File transfer complete');
            });
        });
    }
};

// 下载文件
const downloadFile = async (remotePath, localPath, progressCallback) => {
    const pasvResponse = await sendCmd('PASV');
    const port = parsePasvResp(pasvResponse.toString());
    if (port) {
        const pasvClient = new net.Socket();
        pasvClient.connect(port, FTP_HOST, async () => {
            await sendCmd(`RETR ${remotePath}`);
            const fileStream = fs.createWriteStream(localPath);
            let downloadedSize = 0;

            const sizeResponse = await sendCmd(`SIZE ${remotePath}`);
            const totalSize = parseInt(sizeResponse.toString().split(' ')[1]);

            const intervalId = setInterval(() => {
                const progress = (downloadedSize / totalSize) * 100;
                if (progressCallback) {
                    progressCallback(progress.toFixed(2));
                }
            }, 200);

            pasvClient.pipe(fileStream);
            pasvClient.on('data', (chunk) => {
                downloadedSize += chunk.length;
            });
            pasvClient.on('end', () => {
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

// 断点续传
const resumeDownload = async (remotePath, localPath) => {
    const localFileStats = fs.statSync(localPath);
    const localFileSize = localFileStats.size;
    const restResponse = await sendCmd(`REST ${localFileSize}`);
    if (restResponse.toString().startsWith('350')) {
        await downloadFile(remotePath, localPath);
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
    resumeDownload
};