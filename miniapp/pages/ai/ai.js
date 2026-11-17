Page({
  data: {
    quick: [
      { icon: '📊', title: '如何管理 AI 订阅费用？' },
      { icon: '🔑', title: 'API Key 怎么安全保管？' },
      { icon: '📅', title: '每天签到有哪些注意事项？' },
      { icon: '💡', title: '这个 App 能帮我做什么？' },
    ],
  },

  onTapQuick(e) {
    const title = e.currentTarget.dataset.title
    wx.setClipboardData({
      data: title,
      success: () => wx.showToast({ title: '问题已复制，可在桌面端 AI 助手提问', icon: 'none', duration: 2200 }),
    })
  },

  copyGuide() {
    wx.setClipboardData({
      data: '请在桌面客户端或网页版打开「AI 助手」使用完整聊天功能',
      success: () => wx.showToast({ title: '已复制', icon: 'none' }),
    })
  },
})
