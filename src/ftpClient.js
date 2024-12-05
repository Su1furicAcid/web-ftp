const net = require('net');
const fs = require('fs');

const client = new net.Socket();

let FTP_HOST = '';

// 发送指令
let sendCmd = (command, callback) => {
    console.log(`Sending command: ${command}`);
    client.write(command + '\r\n');
    client.once('data', (data) => {
        callback(data);
    });
}

// 连接到FTP服务器
let connToFtpSrv = (host, port) => {
    FTP_HOST = host;
    client.connect(port, host, () => {
        console.log('Connected to FTP server');
    });
    client.on('data', (data) => {
        console.log(`Received data: ${data}`);
    });
    client.on('close', () => {
        console.log('Connection closed');
    });
    client.on('error', (err) => {
        console.error(err);
    });
};

// 断开连接
let disconnFromFtpSrv = () => {
    client.end();
};

// 登录操作
let login = (username, password) => {
    sendCmd(`USER ${username}`, (data) => {
        if (data.toString().startsWith('331')) {
            sendCmd(`PASS ${password}`, (data) => {
                if (data.toString().startsWith('230')) {
                    console.log('Logged in');
                }
            });
        }
    });
}

// 登出操作
let logout = () => {
    sendCmd('QUIT', (data) => {
        if (data.toString().startsWith('221')) {
            console.log('Logged out');
        }
    });
}

// 解析PASV响应
let parsePasvResp = (data) => {
    const match = data.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/);
    if (match) {
        const port = parseInt(match[5]) * 256 + parseInt(match[6]);
        return port;
    }
    return null;
}

// 获取文件列表
async function fetchFileLst() {
    return new Promise((resolve, reject) => {
    console.log('start fetch file list');
    let allFiles = [];
    sendCmd('PASV', (data) => {
        const port = parsePasvResp(data.toString());
        if (port) {
            const pasvClient = new net.Socket();
            pasvClient.connect(port, FTP_HOST, () => {
                sendCmd('LIST', () => {
                    pasvClient.on('data', (data) => {
                        console.log(`File list: ${data}`);
                        allFiles = data.toString().split('\r\n');
                        console.log('allFiles', allFiles);
                        resolve(allFiles);
                        pasvClient.end();
                    });
                });
            });
        } else {
            reject('');
        }
    });
})
}

// 上传文件
let uploadFile = (localPath, remotePath) => {
    const fileStats = fs.statSync(localPath);
    const fileSize = fileStats.size;
    console.log(`File size: ${fileSize}`);
    const fileStream = fs.createReadStream(localPath);
    sendCmd('PASV', (data) => {
        const port = parsePasvResp(data.toString());
        if (port) {
            const pasvClient = new net.Socket();
            pasvClient.connect(port, FTP_HOST, () => {
                sendCmd(`STOR ${remotePath}`, () => {
                    fileStream.pipe(pasvClient);
                    fileStream.on('end', () => {
                        pasvClient.end();
                        console.log('File uploaded');
                    });
                    fileStream.on('close', () => {
                        console.log('File transfer complete');
                    });
                });
            });
        }
    });
};

// 下载文件
let downloadFile = (remotePath, localPath) => {
    sendCmd('PASV', (data) => {
        const port = parsePasvResp(data.toString());
        if (port) {
            const pasvClient = new net.Socket();
            pasvClient.connect(port, FTP_HOST, () => {
                sendCmd(`RETR ${remotePath}`, () => {
                    const fileStream = fs.createWriteStream(localPath);
                    pasvClient.pipe(fileStream);
                    pasvClient.on('end', () => {
                        pasvClient.end();
                        console.log('File downloaded');
                    });
                    pasvClient.on('close', () => {
                        console.log('File transfer complete');
                    });
                });
            });
        }
    });
};

// 断点续传
let resumeDownload = (remotePath, localPath) => {
    const localFileStats = fs.statSync(localPath);
    const localFileSize = localFileStats.size;
    sendCmd(`REST ${localFileSize}`, (data) => {
        if (data.toString().startsWith('350')) {
            downloadFile(remotePath, localPath);
        }
    });
};

export default {
    connToFtpSrv, disconnFromFtpSrv, login, logout, fetchFileLst, uploadFile, downloadFile, resumeDownload
}