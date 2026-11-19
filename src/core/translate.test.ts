import { describe, it, expect } from 'vitest'
import {
  categorizeFile, chunkForTranslate, alignPairs, renderPairHtml,
  buildHtml, buildPlain, layoutName, layoutSuffix, type TranslatePair,
} from './translate'

const pairs: TranslatePair[] = [
  { source: '你好世界', target: 'Hello world' },
  { source: '第二段落', target: 'Second paragraph' },
]

describe('AI翻译文件分类', () => {
  it('文档类', () => {
    for (const n of ['a.txt', 'b.md', 'c.docx', 'd.pdf', 'e.csv', 'f.xlsx']) {
      expect(categorizeFile(n), n).toBe('document')
    }
  })
  it('图片类', () => {
    for (const n of ['a.png', 'b.jpg', 'c.webp', 'd.HEIC']) {
      expect(categorizeFile(n), n).toBe('image')
    }
  })
  it('压缩类', () => {
    for (const n of ['a.zip', 'b.rar', 'c.7z', 'd.tar.gz']) {
      expect(categorizeFile(n), n).toBe('archive')
    }
  })
  it('未知类', () => {
    expect(categorizeFile('a.exe')).toBe('other')
  })
})

describe('文本切块', () => {
  it('短段落在限额内合并为一块', () => {
    const chunks = chunkForTranslate('段落一内容\n\n段落二内容', 450)
    expect(chunks).toEqual(['段落一内容\n\n段落二内容'])
  })
  it('段落累计超限时分成多块', () => {
    const a = '甲'.repeat(60), b = '乙'.repeat(60)
    const chunks = chunkForTranslate(`${a}\n\n${b}`, 80)
    expect(chunks).toEqual([a, b])
  })
  it('长段落按句号再切', () => {
    const long = Array.from({ length: 30 }, (_, i) => `第${i}句话。`).join('')
    const chunks = chunkForTranslate(long, 100)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(c => c.length <= 110)).toBe(true)
  })
  it('空文本返回空', () => {
    expect(chunkForTranslate('   ')).toEqual([])
  })
})

describe('双语对齐与布局渲染', () => {
  it('按段落对齐，数量不等补空', () => {
    const r = alignPairs('A\n\nB\n\nC', '甲')
    expect(r.length).toBe(3)
    expect(r[1].target).toBe('')
  })
  it('三种布局生成对应 class', () => {
    expect(renderPairHtml(pairs[0], 'side-by-side')).toContain('tr-side')
    expect(renderPairHtml(pairs[0], 'interleaved')).toContain('tr-underline')
    expect(renderPairHtml(pairs[0], 'stacked')).toContain('tr-stack')
  })
  it('渲染内容转义 HTML', () => {
    expect(renderPairHtml({ source: '<script>x</script>', target: 'ok' }, 'stacked')).toContain('&lt;script&gt;')
  })
  it('布局名称', () => {
    expect(layoutName('side-by-side')).toContain('左右')
    expect(layoutName('interleaved')).toContain('下划线')
    expect(layoutName('stacked')).toContain('上下')
  })
})

describe('导出内容生成', () => {
  it('HTML 含全部选中布局', () => {
    const html = buildHtml('测试文档', pairs, ['side-by-side', 'stacked'])
    expect(html).toContain('data-layout="side-by-side"')
    expect(html).toContain('data-layout="stacked"')
    expect(html).not.toContain('data-layout="interleaved"')
    expect(html).toContain('你好世界')
  })
  it('TXT 含原文译文', () => {
    const txt = buildPlain('测试', pairs, ['stacked'], 'txt')
    expect(txt).toContain('【原文】')
    expect(txt).toContain('Hello world')
  })
  it('MD 左右布局生成表格', () => {
    const md = buildPlain('测试', pairs, ['side-by-side'], 'md')
    expect(md).toContain('| 原文 | 译文 |')
    expect(md).toContain('| --- | --- |')
  })
  it('多选布局都出现在导出里', () => {
    const md = buildPlain('测试', pairs, ['side-by-side', 'interleaved', 'stacked'], 'md')
    expect(md).toContain('左右对照')
    expect(md).toContain('逐句对照')
    expect(md).toContain('上下结构')
  })
})

describe('多布局导出为多个文件', () => {
  it('每种布局文件名后缀不同', () => {
    expect(layoutSuffix('side-by-side')).toBe('左右对照')
    expect(layoutSuffix('interleaved')).toBe('逐句对照')
    expect(layoutSuffix('stacked')).toBe('上下结构')
  })
  it('单布局HTML只含该布局，不含其他布局', () => {
    const html = buildHtml('测试', pairs, ['stacked'])
    expect(html).toContain('data-layout="stacked"')
    expect(html).not.toContain('data-layout="side-by-side"')
    expect(html).not.toContain('data-layout="interleaved"')
  })
  it('分别生成的两个HTML各自只含一种布局', () => {
    const a = buildHtml('测试', pairs, ['side-by-side'])
    const b = buildHtml('测试', pairs, ['interleaved'])
    expect(a).toContain('data-layout="side-by-side"')
    expect(a).not.toContain('data-layout="interleaved"')
    expect(b).toContain('data-layout="interleaved"')
    expect(b).not.toContain('data-layout="side-by-side"')
  })
})
