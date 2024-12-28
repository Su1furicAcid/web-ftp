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
          <el-button type="danger" @click="quit" class="logout-button">退出登录</el-button>
        </div>
      </div>
    </el-dialog>
    <div class="content-container">
      <el-badge is-dot :hidden="loginStatus !== '未登录'">
        <div class="login-status" @click="loginDialogVisible = true">登录状态: {{ loginStatus }}</div>
      </el-badge>
      <div class="download-path">
        <div>当前下载路径</div>
        <el-input v-model="downloadPath" placeholder="请输入新的下载路径"></el-input>
      </div>
      <el-button type="primary" @click="flushFileLst">刷新文件列表</el-button>
      <el-table :data="parsedFiles" style="width: 100%">
        <el-table-column prop="permissions" label="权限" width="150"></el-table-column>
        <el-table-column prop="links" label="链接数" width="100"></el-table-column>
        <el-table-column prop="owner" label="所有者" width="150"></el-table-column>
        <el-table-column prop="group" label="组" width="150"></el-table-column>
        <el-table-column prop="size" label="大小" width="100"></el-table-column>
        <el-table-column prop="date" label="日期" width="200"></el-table-column>
        <el-table-column prop="name" label="文件名"></el-table-column>
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button type="text" size="small" @click="downloadThisFile(row)" v-show="row.status === 'cloud'">下载</el-button>
            <el-button type="text" size="small" @click="resumeThisFile(row)" v-show="row.status === 'paused'">继续</el-button>
            <el-button type="text" size="small" @click="pauseDownload" v-show="row.status === 'downloading'">暂停</el-button>
            <el-progress v-if="row.progress" :percentage="row.progress" status="active"></el-progress>
          </template>
        </el-table-column>
      </el-table>
      <el-upload v-model:file-list="fileList" ref="upload" :on-change="appendFileList" :auto-upload="false">
        <el-button size="small" type="primary">选择文件</el-button>
      </el-upload>
      <div class="el-button-container">
        <el-button type="primary" @click="uploadFile">上传文件</el-button>
        <el-button type="text" @click="pauseUpload" v-if="uploadInfo.status === 'uploading'">暂停</el-button>
        <el-button type="text" @click="resumeUpload" v-if="uploadInfo.status === 'paused'">继续</el-button>
        <el-progress :percentage="uploadInfo.progress" v-if="uploadInfo.status === 'uploading' || uploadInfo.status === 'paused'"></el-progress>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ipcRenderer } from 'electron';
import { ref, onMounted, watch } from 'vue';
import { ElMessage } from 'element-plus';
import debounce from './utils';

const username = ref('');
const password = ref('');
const allFiles = ref([]);
const loginStatus = ref('未登录');
const loginDialogVisible = ref(false);
const parsedFiles = ref([]);
const fileList = ref([]);
let currentDownloadFile = ref({});
let uploadInfo = ref({});
let downloadPath = ref('');

onMounted(async () => {
  if (localStorage.getItem('downloadPath')) {
    downloadPath.value = localStorage.getItem('downloadPath');
  } else {
    downloadPath.value = 'D:/';
    localStorage.setItem('downloadPath', 'D:/');
  }
  try {
    await ipcRenderer.invoke('connect-ftp-server', 'localhost', 2121);
  } catch (error) {
    ElMessage.error('连接FTP服务器失败');
  }
});

watch(downloadPath, (newVal) => {
  debounce(() => {
    localStorage.deleteItem('downloadPath');
    localStorage.setItem('downloadPath', newVal);
  }, 500);
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

const quit = () => {
  username.value = '';
  password.value = '';
  ipcRenderer.invoke('quit-ftp-server');
  ElMessage.success('退出FTP服务器成功');
  loginStatus.value = '未登录';
}

const flushFileLst = async () => {
  try {
    const response = await ipcRenderer.invoke('flush-file-list');
    console.log(response);
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
      ipcRenderer.invoke('upload-file', file.raw.path, `/${file.name}`);
      uploadInfo.value.status = 'uploading';
      ElMessage.success('上传文件成功');
    } catch (error) {
      ElMessage.error('上传文件失败');
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
      size: parts[4],
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
</script>

<style scoped>
.container {
  background-color: #FAF9F6;
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
  justify-content: center;
  align-items: center;
  margin-bottom: 20px;
  width: 300px;
}

.login-title {
  margin-left: 5px;
  width: 100px;
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
</style>