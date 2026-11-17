#!/usr/bin/env python3
"""给 CI 生成的 AndroidManifest.xml 注入相机/相册/存储权限（幂等）。
用法: python3 assets/inject-android-permissions.py <AndroidManifest.xml路径>
"""
import sys
import re

PERMISSIONS = [
    'android.permission.CAMERA',
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_MEDIA_VIDEO',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
]

def main():
    if len(sys.argv) < 2:
        print('usage: inject-android-permissions.py <manifest>')
        sys.exit(1)
    path = sys.argv[1]
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    # 找 <manifest ...> 标签结束位置
    m = re.search(r'<manifest[^>]*>', content)
    if not m:
        print('manifest tag not found')
        sys.exit(1)
    insert_at = m.end()
    lines = []
    for perm in PERMISSIONS:
        # 若已存在同名权限则跳过（幂等）
        name = perm.split('.')[-1]
        if re.search(rf'android:name="[^"]*{name}"', content):
            continue
        # READ/WRITE_EXTERNAL_STORAGE 在 Android 13+ 意义有限，加 maxSdkVersion 避免 Google Play 声明冲突
        if 'EXTERNAL_STORAGE' in perm:
            lines.append(f'    <uses-permission android:name="{perm}" android:maxSdkVersion="32" />')
        else:
            lines.append(f'    <uses-permission android:name="{perm}" />')
    if lines:
        block = '\n' + '\n'.join(lines)
        content = content[:insert_at] + block + content[insert_at:]
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print('injected', len(lines), 'permissions')
    else:
        print('permissions already present')

if __name__ == '__main__':
    main()
