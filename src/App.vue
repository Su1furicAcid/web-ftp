<template>
  <el-input v-model="username" placeholder="username"></el-input>
  <el-input v-model="password" placeholder="password"></el-input>
  <el-button type="primary" @click="login">Login</el-button>
  <el-button type="primary" @click="quit">Quit</el-button>
  <el-button type="primary" @click="flushFileLst">List files</el-button>
  <div class="all-files">
    <div v-for="(file, index) in allFiles" :key="index">文件{{ index }}: {{ file }}</div>
  </div>
  <el-button type="primary" @click="uploadFile">Upload file</el-button>
</template>

<script setup>
import { ipcRenderer } from 'electron';
import { ref, onMounted } from 'vue';

const username = ref('');
const password = ref('');
const allFiles = ref([]);

onMounted(async () => {
  await ipcRenderer.invoke('connect-ftp-server', 'localhost', 2121);
});

const login = async () => {
  await ipcRenderer.invoke('login-ftp-server', username.value, password.value);
}

const quit = () => {
  username.value = '';
  password.value = '';
  ipcRenderer.invoke('quit-ftp-server');
}

const flushFileLst = async () => {
  const response = await ipcRenderer.invoke('flush-file-list');
  console.log(response);
  allFiles.value = response;
}

const uploadFile = () => {
  ipcRenderer.invoke('upload-file', 'D:/test.txt', '/test2.txt');
}
</script>

<style scoped>
</style>
