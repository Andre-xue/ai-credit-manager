// app.js
App({
  globalData: {
    providerMap: {},
  },
  onLaunch() {
    this.globalData.providerMap = require('./utils/providers').PROVIDER_MAP
  },
})
