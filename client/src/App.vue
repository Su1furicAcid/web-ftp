<template>
  <div class="container">
    <el-dialog v-model="loginDialogVisible" title="登录">
      <div class="login-container">
        <div class="login-username">
          <el-icon>
            <User />
          </el-icon>
          <span class="login-title">用户名</span>
          <el-input v-model="username" placeholder="请输入用户名" class="login-input"></el-input>
        </div>
        <div class="login-password">
          <el-icon>
            <Lock />
          </el-icon>
          <span class="login-title">密码</span>
          <el-input v-model="password" placeholder="请输入密码" class="login-input" show-password></el-input>
        </div>
        <div class="login-button-container">
          <el-button type="success" @click="login" class="login-button">登录</el-button>
          <el-button type="danger" @click="logout" class="login-button">登出</el-button>
        </div>
      </div>
    </el-dialog>
    <el-dialog
      v-model="systemInfoDialogVisible"
      title="FTP服务器系统信息"
      width="30%">
      <span>{{ systemInfo }}</span>
    </el-dialog>
    <el-dialog v-model="renameDialogVisible" title="重命名文件" width="30%">
      <div class="rename-container">
        <div class="rename-item">
          <span>原文件名：</span>
          <el-input v-model="oldFileName" disabled></el-input>
        </div>
        <div class="rename-item">
          <span>新文件名：</span>
          <el-input v-model="newFileName" placeholder="请输入新的文件名"></el-input>
        </div>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="renameDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="renameFile">确定</el-button>
        </span>
      </template>
    </el-dialog>
    <el-dialog v-model="folderAddVisible" title="新建文件夹">
      <div class="login-container">
        <div class="login-username">
          <el-icon>
            <Folder />
          </el-icon>
          <span class="login-title">文件夹名</span>
          <el-input v-model="folderName" placeholder="请输入文件夹名" class="login-input"></el-input>
        </div>
        <div class="login-button-container">
          <el-button type="success" @click="addNewFolder(folderName)" class="login-button">新建</el-button>
        </div>
      </div>
    </el-dialog>
    <div class="content-container">
      <div class="connect-container">
        <div class="conn-title">FTP服务器地址</div>
        <el-input v-model="host" placeholder="请输入主机地址" class="connect-input"></el-input>
        <div class="conn-title">FTP服务器端口</div>
        <el-input v-model="port" placeholder="请输入端口号" class="connect-input"></el-input>
        <el-button type="success" @click="connectToFtpServer" v-if="loginStatus === '未登录'">现在连接 !</el-button>
        <el-button type="danger" @click="quit" v-if="loginStatus === '已登录'">退出</el-button>
        <el-button type="info"   @click="getSystemInfo" v-if="loginStatus === '已登录'"><el-icon><InfoFilled /></el-icon>系统信息</el-button>
        <div class="structure-container" v-if="loginStatus === '已登录'">
        <div class="conn-title">文件结构</div>
        <el-select 
          v-model="fileStructure" 
          placeholder="选择文件结构"
          @change="changeFileStructure"
          class="structure-select"
        >
          <el-option 
            v-for="item in structureOptions" 
            :key="item.value" 
            :label="item.label" 
            :value="item.value"
          ></el-option>
        </el-select>
      </div>
      <div class="structure-container" v-if="loginStatus === '已登录'">
      <div class="conn-title">传输模式</div>
      <el-select 
        v-model="transferMode" 
        placeholder="选择传输模式"
        @change="changeTransferMode"
        class="structure-select"
        >
          <el-option 
            v-for="item in modeOptions" 
            :key="item.value" 
            :label="item.label" 
            :value="item.value"
          ></el-option>
        </el-select>
      </div>
      </div>
      <el-badge is-dot :hidden="loginStatus !== '未登录'">
        <div class="login-status" @click="loginDialogVisible = true">登录状态: {{ loginStatus }}</div>
      </el-badge>
      <div class="download-path">
        <div style="width: 200px">下载到本地路径: </div>
        <el-input v-model="downloadPath" placeholder="请输入新的下载路径"></el-input>
      </div>
      <div class="work-directory">
        <div style="width: 320px">当前工作目录: </div>
        <el-input v-model="workDirectory" placeholder="请输入新的工作目录"></el-input>
        <el-button type="primary" @click="moveNewDirectory">
          <el-icon>
            <Switch />
          </el-icon>
          切换工作目录
        </el-button>
        <el-button type="primary" @click="moveFatherDirectory">
          <el-icon>
            <Back />
          </el-icon>
          返回上级目录
        </el-button>
        <el-button type="primary" @click="flushFileLst">
          <el-icon>
            <RefreshRight />
          </el-icon>
          刷新文件列表
        </el-button>
        <el-button type="success" @click="folderAddVisible = true">
          <el-icon>
            <Folder />
          </el-icon>
          新建文件夹
        </el-button>
        <el-button type="primary" @click="getCurrentDirectory">
          <el-icon>
            <Location />
          </el-icon>
          获取当前目录
        </el-button>
      </div>
      <el-table :data="parsedFiles" style="width: 95%; height: 50vh; overflow-y: auto;">
        <el-table-column prop="size" label="大小" width="100"></el-table-column>
        <el-table-column prop="date" label="修改日期" width="180"></el-table-column>
        <el-table-column prop="name" label="文件名"></el-table-column>
        <el-table-column label="" width="300">
          <template #default="{ row }">
            <el-button type="success" size="small" v-if="row.permissions[0] === 'd'"
              @click="enterNewFolder(row.name)">打开文件夹</el-button>
            <el-button type="danger" size="small" @click="removeDirectory(row)"
              v-if="row.permissions[0] === 'd'">删除目录</el-button>
            <el-button type="primary" size="small" @click="downloadThisFile(row)"
              v-show="row.status === 'cloud' && row.permissions[0] !== 'd'">下载</el-button>
            <el-button type="warning" size="small" @click="showRenameDialog(row)"
              v-if="row.permissions[0] !== 'd' && row.status != 'downloading' && row.status != 'paused'">重命名</el-button>
            <el-button type="text" size="small" @click="resumeThisFile(row)"
              v-show="row.status === 'paused'">继续</el-button>
            <el-button type="text" size="small" @click="pauseDownload"
              v-show="row.status === 'downloading'">暂停</el-button>
            <el-button type="danger" size="small" @click="deleteFile(row)" 
              v-if="row.permissions[0] !== 'd' && row.status != 'downloading' && row.status != 'paused'">删除</el-button>
            <el-progress v-if="row.progress" :percentage="row.progress" status="active"></el-progress>
          </template>
        </el-table-column>
      </el-table>
      <div class="upload-container">
        <el-upload v-model:file-list="fileList" ref="upload" :on-change="appendFileList" :auto-upload="false"
          :limit="1">
          <el-button size="small" type="text">选择文件</el-button>
        </el-upload>
        <div class="el-button-container">
          <el-button type="success" @click="uploadFile">上传到当前目录</el-button>
          <el-button type="text" @click="pauseUpload" v-if="uploadInfo.status === 'uploading'">暂停</el-button>
          <el-button type="text" @click="resumeUpload" v-if="uploadInfo.status === 'paused'">继续</el-button>
          <el-progress :percentage="uploadInfo.progress"
            v-if="uploadInfo.status === 'uploading' || uploadInfo.status === 'paused'">
          </el-progress>
          <el-button type="success" @click="uploadFileUniquely">唯一上传到当前目录</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ipcRenderer } from 'electron';
import { ref, onMounted, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import debounce from './utils';

const connectStatus = ref('未连接');
const username = ref('');
const password = ref('');
const allFiles = ref([]);
const loginStatus = ref('未登录');
const loginDialogVisible = ref(false);
const parsedFiles = ref([]);
const fileList = ref([]);
let currentDownloadFile = ref({});
let uploadInfo = ref({});
let downloadPath = ref('D:/');
let workDirectory = ref('/');
const host = ref('localhost');
const port = ref('2121');
const folderAddVisible = ref(false);
const folderName = ref('');
const systemInfo = ref('');
const systemInfoDialogVisible = ref(false);
const renameDialogVisible = ref(false);
const oldFileName = ref('');
const newFileName = ref('');
const structureOptions = [
    { label: 'File', value: 'F' },
    { label: 'Record', value: 'R' },
    { label: 'Page', value: 'P' }
];
const fileStructure = ref('F');
const modeOptions = [
    { label: 'Stream', value: 'S' },
    { label: 'Block', value: 'B' },
    { label: 'Compressed', value: 'C' }
];
const transferMode = ref('S');

onMounted(async () => {
  if (localStorage.getItem('downloadPath')) {
    downloadPath.value = localStorage.getItem('downloadPath');
  } else {
    downloadPath.value = 'D:/';
    localStorage.setItem('downloadPath', 'D:/');
  }

  if (localStorage.getItem('workDirectory')) {
    workDirectory.value = localStorage.getItem('workDirectory');
  } else {
    workDirectory.value = '/';
    localStorage.setItem('workDirectory', '/');
  }
});

watch([downloadPath], ([newVal]) => {
  console.log('change')
  debounce(() => {
    console.log(newVal);
    localStorage.setItem('downloadPath', newVal);
  }, 500)();
});

ipcRenderer.on('download-progress', (event, progress) => {
  parsedFiles.value = parsedFiles.value.map(file => {
    if (file.name === currentDownloadFile.value.name) {
      file.progress = progress;
      if (progress >= 100) {
        file.status = 'downloaded';
      }
    }
    return file;
  });
});

ipcRenderer.on('upload-progress', (event, progress) => {
  uploadInfo.value.progress = progress;
  if (progress >= 100) {
    setTimeout(() => {
      uploadInfo.value.progress = 0;
      uploadInfo.value.status = 'cloud';
    }, 500);
  }
});

const connectToFtpServer = async () => {
  try {
    await ipcRenderer.invoke('connect-ftp-server', host.value, port.value);
    ElMessage.success('连接FTP服务器成功');
    loginDialogVisible.value = true;
    connectStatus.value = '已连接';
    fileStructure.value = 'F';
    transferMode.value = 'S';
  } catch (error) {
    ElMessage.error('连接FTP服务器失败');
  }
}

const login = async () => {
  try {
    await ipcRenderer.invoke('login-ftp-server', username.value, password.value);
    ElMessage.success('登录FTP服务器成功');
    loginStatus.value = '已登录';
    loginDialogVisible.value = false;
  } catch (error) {
    ElMessage.error('登录FTP服务器失败');
  }
}

const logout = async () => {
  try {
    await ipcRenderer.invoke('logout-ftp-server');
    ElMessage.success('用户登出成功');
    loginStatus.value = '未登录';
  } catch (error) {
    ElMessage.error('登出FTP服务器失败');
  }
}

//SYST
const getSystemInfo = async () => {
    try {
        const response = await ipcRenderer.invoke('get-system-info');
        if (response) {
            systemInfo.value = response;
            systemInfoDialogVisible.value = true;
            ElMessage.success('获取系统信息成功');
        } else {
            ElMessage.error('获取系统信息失败');
        }
    } catch (error) {
        ElMessage.error('获取系统信息失败：' + error.message);
        console.error('Error getting system info:', error);
    }
}

const quit = () => {
  username.value = '';
  password.value = '';
  ipcRenderer.invoke('quit-ftp-server');
  fileStructure.value = 'F';
  transferMode.value = 'S';
  ElMessage.success('退出FTP服务器成功');
  loginStatus.value = '未登录';
}

const flushFileLst = async () => {
  try {
    const response = await ipcRenderer.invoke('flush-file-list');
    allFiles.value = response.slice(0, response.length - 1);
    parsedFiles.value = parseFiles(allFiles.value);
    ElMessage.success('获取文件列表成功');
  } catch (error) {
    ElMessage.error('获取文件列表失败');
  }
}

const uploadFile = () => {
  for (const file of fileList.value) {
    console.log(file.raw.path);
    uploadInfo.value = {
      progress: 0,
      status: 'local',
      localPath: file.raw.path,
    };
    try {
      ipcRenderer.invoke('upload-file', file.raw.path, `${workDirectory.value}/${file.raw.name}`);
      uploadInfo.value.status = 'uploading';
      ElMessage.success('上传文件成功');
    } catch (error) {
      ElMessage.error('上传文件失败');
      continue;
    }
  }
}

const uploadFileUniquely = async () => {
  for (const file of fileList.value) {
    console.log(file.raw.path);
    try {
      await ipcRenderer.invoke('upload-file-uniquely', file.raw.path);
      ElMessage.success('上传文件成功');
    } catch (error) {
      ElMessage.error('上传文件失败');
      console.error('Error uploading file uniquely:', error);
      continue;
    }
  }
}

const parseFiles = (files) => {
  return files.map(file => {
    const parts = file.split(/\s+/);
    return {
      permissions: parts[0],
      links: parts[1],
      owner: parts[2],
      group: parts[3],
      size: (x => {
        if (x === '0') return '-';
        if (x < 1024) return `${x}B`;
        if (x < 1024 * 1024) return `${(x / 1024).toFixed(2)}KB`;
        if (x < 1024 * 1024 * 1024) return `${(x / 1024 / 1024).toFixed(2)}MB`;
        return `${(x / 1024 / 1024 / 1024).toFixed(2)}GB`;
      })(parseInt(parts[4])),
      date: `${parts[5]} ${parts[6]} ${parts[7]}`,
      name: parts[8],
      progress: 0,
      status: 'cloud'
    };
  });
}

const appendFileList = (file) => {
  fileList.value.push(file);
}

const downloadThisFile = async (fileDescrip) => {
  try {
    await ipcRenderer.invoke('download-file', `${downloadPath.value}/${fileDescrip.name}`, fileDescrip.name);
    currentDownloadFile.value = fileDescrip;
    parseFiles.value = parsedFiles.value.map(file => {
      if (file.name === fileDescrip.name) {
        file.status = 'downloading';
      }
      return file;
    });
    ElMessage.success('开始下载文件');
  } catch (error) {
    ElMessage.error('下载文件失败');
  }
}

const pauseDownload = async () => {
  try {
    await ipcRenderer.invoke('pause-download', `${downloadPath.value}/${currentDownloadFile.value.name}`, currentDownloadFile.value.name);
    parseFiles.value = parsedFiles.value.map(file => {
      if (file.name === currentDownloadFile.value.name) {
        file.status = 'paused';
      }
      return file;
    });
    ElMessage.success('暂停下载成功');
  } catch (error) {
    ElMessage.error('暂停下载失败');
  }
}

const resumeThisFile = async (fileDescrip) => {
  try {
    await ipcRenderer.invoke('resume-download', `${downloadPath.value}/${fileDescrip.name}`, fileDescrip.name);
    currentDownloadFile.value = fileDescrip;
    parseFiles.value = parsedFiles.value.map(file => {
      if (file.name === fileDescrip.name) {
        file.status = 'downloading';
      }
      return file;
    });
    ElMessage.success('继续下载文件');
  } catch (error) {
    ElMessage.error('继续下载失败');
  }
}

const pauseUpload = async () => {
  try {
    await ipcRenderer.invoke('pause-upload', uploadInfo.value.localPath);
    uploadInfo.value.status = 'paused';
    ElMessage.success('暂停上传成功');
  } catch (error) {
    ElMessage.error('暂停上传失败');
  }
}

const resumeUpload = async () => {
  try {
    await ipcRenderer.invoke('resume-upload', uploadInfo.value.localPath, `/${uploadInfo.value.localPath.split('\\').pop()}`);
    uploadInfo.value.status = 'uploading';
    ElMessage.success('继续上传成功');
  } catch (error) {
    ElMessage.error('继续上传失败');
  }
}

const moveNewDirectory = async () => {
  try {
    await ipcRenderer.invoke('change-work-directory', workDirectory.value);
    ElMessage.success('切换工作目录成功');
    await flushFileLst();
  } catch (error) {
    ElMessage.error('切换工作目录失败');
  }
}

const moveFatherDirectory = async () => {
  try {
    await ipcRenderer.invoke('move-father-directory');
    workDirectory.value = workDirectory.value.split('/').slice(0, -2).join('/') + '/';
    ElMessage.success('返回上级目录成功');
    await flushFileLst();
  } catch (error) {
    ElMessage.error('返回上级目录失败');
  }
}

const enterNewFolder = async (folderName) => {
  workDirectory.value += `${folderName}/`;
  await moveNewDirectory();
}

const addNewFolder = async (folder) => {
  try {
    await ipcRenderer.invoke('add-new-folder', folder);
    ElMessage.success('新建文件夹成功');
    folderAddVisible.value = false;
    folderName.value = '';
    await flushFileLst();
  } catch (error) {
    ElMessage.error('新建文件夹失败');
  }
}

// 添加新的删除文件方法
const deleteFile = async (fileInfo) => {
  try {
    // 添加确认对话框
    await ElMessageBox.confirm(
      `确定要删除文件 ${fileInfo.name} 吗？`,
      '警告',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    );
    // 调用删除功能
    await ipcRenderer.invoke('delete-file', fileInfo.name);
    ElMessage.success('文件删除成功');
    // 刷新文件列表
    await flushFileLst();
  } catch (error) {
    if (error !== 'cancel') {  // 忽略用户取消的情况
      ElMessage.error('删除文件失败');
      console.error('Error deleting file:', error);
    }
  }
}

// 添加删除目录的方法
const removeDirectory = async (dirInfo) => {
    try {
        await ElMessageBox.confirm(
            `确定要删除目录 ${dirInfo.name} 吗？\n注意：只能删除空目录`,
            '警告',
            {
                confirmButtonText: '确定',
                cancelButtonText: '取消',
                type: 'warning',
            }
        );

        const result = await ipcRenderer.invoke('remove-directory', dirInfo.name);
        
        if (result) {
            ElMessage.success('目录删除成功');
            await flushFileLst();  // 刷新文件列表
        } else {
            ElMessage.error('目录删除失败');
        }
    } catch (error) {
        if (error !== 'cancel') {
            ElMessage.error('删除目录失败：' + (error.message || '未知错误'));
            console.error('Error removing directory:', error);
        }
    }
}

// 添加获取当前目录的方法
const getCurrentDirectory = async () => {
  try {
    const response = await ipcRenderer.invoke('print-working-directory');
    if (response) {
      workDirectory.value = response;
      ElMessage.success('获取当前目录成功');
    } else {
      ElMessage.error('获取当前目录失败');
    }
  } catch (error) {
    ElMessage.error('获取当前目录失败：' + error.message);
    console.error('Error getting current directory:', error);
  }
}

const showRenameDialog = (row) => {
    oldFileName.value = row.name;
    newFileName.value = '';
    renameDialogVisible.value = true;
}

const renameFile = async () => {
    try {
        if (!newFileName.value) {
            ElMessage.warning('请输入新的文件名');
            return;
        }
        await ipcRenderer.invoke('rename-file', oldFileName.value, newFileName.value);
        ElMessage.success('文件重命名成功');
        renameDialogVisible.value = false;      
        // 刷新文件列表
        await flushFileLst();
    } catch (error) {
        ElMessage.error('重命名失败：' + error.message);
    }
}

//STRU
const changeFileStructure = async (structure) => {
    try {
        const response = await ipcRenderer.invoke('set-file-structure', structure);
        if (response) {
            ElMessage.success(`文件结构已设置为 ${
                structureOptions.find(opt => opt.value === structure).label
            }`);
        } else {
            ElMessage.error('设置文件结构失败');
            fileStructure.value = 'F'; // 重置为默认值
        }
    } catch (error) {
        ElMessage.error('设置文件结构失败：' + error.message);
        fileStructure.value = 'F'; // 重置为默认值
        console.error('Error changing file structure:', error);
    }
}

//MODE
const changeTransferMode = async (mode) => {
    try {
        const response = await ipcRenderer.invoke('set-transfer-mode', mode);
        if (response) {
            ElMessage.success(`传输模式已设置为 ${
                modeOptions.find(opt => opt.value === mode).label
            }`);
        } else {
            ElMessage.error('设置传输模式失败');
            transferMode.value = 'S'; // 重置为默认值
        }
    } catch (error) {
        ElMessage.error('设置传输模式失败：' + error.message);
        transferMode.value = 'S'; // 重置为默认值
        console.error('Error changing transfer mode:', error);
    }
}
</script>

<style scoped>
.container {
  background-color: #FAF9F6;
}

.connect-container {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  margin-bottom: 20px;
}

.login-container {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  width: 100%;
}

.login-username,
.login-password {
  display: flex;
  flex-direction: row;
  justify-content: flex-start;
  align-items: center;
  margin-bottom: 20px;
  width: 300px;
}

.login-input {
  width: 25vw;
}

.login-title {
  margin-left: 5px;
  width: 10vw;
}

.login-button-container {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
}

.login-status {
  cursor: pointer;
}

.content-container {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  width: 100%;
  position: absolute;
  top: 50px;
}

.content-container>* {
  margin-bottom: 20px;
  margin-left: 10px;
}

.conn-title {
  width: 21vw;
}

.connect-container>div {
  margin-right: 10px;
}

.work-directory {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.work-directory>div {
  margin-right: 10px;
}

.download-path {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.download-path>div {
  margin-right: 10px;
}

.upload-container {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: center;
}

.el-button--danger {
  margin-left: 10px;
}

.el-button--info {
    margin-left: 10px;
}

.rename-container {
    padding: 20px;
}

.rename-item {
    display: flex;
    align-items: center;
    margin-bottom: 15px;
}

.rename-item span {
    width: 80px;
    margin-right: 10px;
}

.dialog-footer {
    display: flex;
    justify-content: flex-end;
}

.connect-container .el-select {
    margin-left: 10px;
    width: 120px;
}

.structure-container {
    display: flex;
    align-items: center;
    margin-left: 20px;  /* 整个组件与左侧的间距 */
}

.structure-select {
    width: 120px;
    margin-left: 0px;  /* 下拉框紧贴标签，不需要额外间距 */
}
</style>