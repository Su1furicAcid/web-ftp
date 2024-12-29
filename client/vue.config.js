const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  transpileDependencies: true,
  configureWebpack: {
    resolve: {
      fallback: {
        path: require.resolve('path-browserify'),
        fs: false,
        net: false,
        tls: false,
      },
    }
  },
  pluginOptions: {
    electronBuilder: {
      nodeIntegration: true,
    }
  }
})
