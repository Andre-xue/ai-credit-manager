// app.js
App({
  globalData: {
    providerMap: {},
  },
  onLaunch() {
    this.globalData.providerMap = require('./utils/providers').PROVIDER_MAP
    this.checkUpdate()
  },

  // 应用更新：微信官方更新机制（检测 → 下载 → 弹窗确认重启）
  checkUpdate() {
    if (typeof wx === 'undefined' || !wx.getUpdateManager) return
    try {
      const um = wx.getUpdateManager()
      um.onCheckForUpdate((res) => {
        if (res.hasUpdate) wx.showToast({ title: '发现新版本，正在下载', icon: 'none' })
      })
      um.onUpdateReady(() => {
        wx.showModal({
          title: '更新提示',
          content: '新版本已下载完成，重启后即可使用。是否立即重启？',
          confirmText: '立即重启',
          cancelText: '稍后',
          success: (r) => { if (r.confirm) um.applyUpdate() },
        })
      })
      um.onUpdateFailed(() => {
        wx.showToast({ title: '更新下载失败，请检查网络', icon: 'none' })
      })
    } catch (e) { /* 非小程序环境忽略 */ }
  },
})
