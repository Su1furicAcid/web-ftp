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

// 用户登出
const userlogout = async () => {
    try {
        const response = await sendCmd('REIN');
        if (response.toString().startsWith('220')) {
            console.log('User session reinitialized');
        } else {
            console.error('Failed to reinitialize user session');
        }
    } catch (error) {
        console.error('Error during user logout:', error);
        throw error;
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
const uploadFile = async (localPath, remotePath, progressCallback, resume = false) => {
    let lastReadPos = 0;
    if (resume) {
        // 获取远程文件大小
        const sizeResponse = await sendCmd(`SIZE ${remotePath}`);
        const sizeStr = sizeResponse.toString();
        if (sizeStr.startsWith('213')) {
            const remoteSize = parseInt(sizeStr.split(' ')[1]);
            lastReadPos = remoteSize;
            console.log(`Remote file size: ${remoteSize}`);
        }
    }
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
                const restResponse = await sendCmd(`REST ${lastReadPos}`);
                console.log('restResponse', restResponse.toString());
                fileStream = fs.createReadStream(localPath, { start: lastReadPos, flags: 'r' , autoClose: true, emitClose: true });
                await sendCmd(`STOR ${remotePath}`); // 发送STOR命令
            } else {
                await sendCmd(`STOR ${remotePath}`);
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

// 上传文件（唯一）
const uploadFileU = async (localPath, progressCallback) => {
    try {
        await sendCmd('TYPE I');
        const pasvResponse = await sendCmd('PASV');
        const port = parsePasvResp(pasvResponse.toString());
        if (port) {
            const pasvClient = new net.Socket();
            pasvClient.connect(port, FTP_HOST, async () => {
                const response = await sendCmd('STOU');
                if (response.toString().startsWith('150')) {
                    const remoteFileName = response.toString().match(/"([^"]+)"/)[1];
                    console.log(`Uploading to unique file: ${remoteFileName}`);

                    const fileStream = fs.createReadStream(localPath);
                    fileStream.on('data', (chunk) => {
                        pasvClient.write(chunk);
                        if (progressCallback) {
                            progressCallback(chunk.length);
                        }
                    });

                    fileStream.on('end', () => {
                        pasvClient.end();
                    });

                    pasvClient.on('close', () => {
                        console.log('File transfer complete');
                    });

                    pasvClient.on('error', (err) => {
                        console.error('Error during file transfer:', err);
                    });
                } else {
                    console.error('Failed to initiate STOU command:', response.toString());
                }
            });

            pasvClient.on('error', (err) => {
                console.error('Error connecting to PASV port:', err);
            });
        } else {
            console.error('Failed to parse PASV response');
        }
    } catch (error) {
        console.error('Error during file upload:', error);
        throw error;
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

// 添加获取系统信息的函数(SYST)
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

// 添加重命名文件的函数(RNFR、RNTO)
const renameFile = async (oldName, newName) => {
    try {
        // 发送 RNFR 命令
        const rnfrResponse = await sendCmd(`RNFR ${oldName}`);
        if (!rnfrResponse.toString().startsWith('350')) {
            throw new Error('RNFR command failed');
        }

        // 发送 RNTO 命令
        const rntoResponse = await sendCmd(`RNTO ${newName}`);
        if (!rntoResponse.toString().startsWith('250')) {
            throw new Error('RNTO command failed');
        }

        console.log(`File renamed from ${oldName} to ${newName}`);
        return true;
    } catch (error) {
        console.error(`Error renaming file: ${error}`);
        throw error;
    }
};

// STRU
const setFileStructure = async (structure) => {
    try {
        const response = await sendCmd(`STRU ${structure}`);
        const responseStr = response.toString();
        console.log('STRU command response:', responseStr); // 添加日志

        if (responseStr.startsWith('200')) {
            console.log(`File structure set to ${structure}`);
            return true;
        } else {
            console.error(`Failed to set file structure: ${responseStr}`);
            throw new Error(responseStr);
        }
    } catch (error) {
        console.error(`Error setting file structure: ${error}`);
        throw error;
    }
};

// MODE
const setTransferMode = async (mode) => {
    try {
        const response = await sendCmd(`MODE ${mode}`);
        const responseStr = response.toString();
        console.log('MODE command response:', responseStr); // 添加日志
        if (responseStr.startsWith('200')) {
            console.log(`Transfer mode set to ${mode}`);
            return true;
        } else {
            console.error(`Failed to set transfer mode: ${responseStr}`);
            throw new Error(responseStr);
        }
    } catch (error) {
        console.error(`Error setting transfer mode: ${error}`);
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
    userlogout,
    logout,
    fetchFileLst,
    uploadFile,
    uploadFileU,
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
    renameFile,
    setFileStructure,
    setTransferMode,
    makeDir
};