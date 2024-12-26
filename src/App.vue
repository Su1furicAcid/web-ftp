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
            <el-button type="text" size="small" @click="downloadThisFile(row)">下载</el-button>
            <el-button type="text" size="small" @click="pauseDownload">暂停</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-upload v-model:file-list="fileList" ref="upload" :on-change="appendFileList" :auto-upload="false">
        <el-button size="small" type="primary">选择文件</el-button>
      </el-upload>
      <el-button type="primary" @click="uploadFile">上传文件</el-button>
    </div>
    <div v-show="currentDownloadProgress > 0">
      <el-progress :percentage="currentDownloadProgress" status="success"></el-progress>
    </div>
  </div>
</template>

<script setup>
import { ipcRenderer } from 'electron';
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';

const username = ref('');
const password = ref('');
const allFiles = ref([]);
const loginStatus = ref('未登录');
const loginDialogVisible = ref(false);
const parsedFiles = ref([]);
const fileList = ref([]);

let currentDownloadProgress = ref(0);

onMounted(async () => {
  try {
    await ipcRenderer.invoke('connect-ftp-server', 'localhost', 2121);
  } catch (error) {
    ElMessage.error('连接FTP服务器失败');
  }
});

ipcRenderer.on('download-progress', (event, progress) => {
  console.log('app.vue', progress);
  currentDownloadProgress.value = progress;
  let timer = setInterval(() => {
    if (currentDownloadProgress.value >= 100) {
      clearInterval(timer);
      currentDownloadProgress.value = 0;
    }
  }, 1000);
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
    try {
      ipcRenderer.invoke('upload-file', file.raw.path, `/${file.name}`);
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
      name: parts[8]
    };
  });
}

const appendFileList = (file) => {
  fileList.value.push(file);
}

const downloadThisFile = async (fileDescrip) => {
  try {
    await ipcRenderer.invoke('download-file', fileDescrip.name, `D:/${fileDescrip.name}`);
    ElMessage.success('开始下载文件');
  } catch (error) {
    ElMessage.error('下载文件失败');
  }
}

const pauseDownload = async () => {
  try {
    await ipcRenderer.invoke('pause-download');
    ElMessage.success('暂停下载成功');
  } catch (error) {
    ElMessage.error('暂停下载失败');
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