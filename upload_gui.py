#!/usr/bin/env python3
import tkinter as tk
from tkinter import filedialog, messagebox
import os
import subprocess
from pathlib import Path
from datetime import datetime

def upload_photos():
    # 프로젝트 폴더 자동 찾기 (이 스크립트가 있는 위치)
    script_dir = Path(__file__).parent.absolute()
    
    # 사진 폴더 선택
    photo_folder = filedialog.askdirectory(title="📸 업로드할 사진 폴더를 선택하세요")
    if not photo_folder:
        return
    
    folder_name = Path(photo_folder).name
    slug = folder_name.replace(" ", "-").lower()
    title = folder_name
    date = datetime.now().strftime("%Y-%m-%d")
    
    # 1. 사진 복사
    dest = script_dir / "public" / "albums" / slug
    dest.mkdir(parents=True, exist_ok=True)
    os.system(f"cp -r '{photo_folder}'/* '{dest}/'")
    
    # 2. 첫 이미지 찾기
    images = list(dest.glob("*.jpg")) + list(dest.glob("*.jpeg")) + \
             list(dest.glob("*.JPG")) + list(dest.glob("*.JPEG"))
    
    if not images:
        messagebox.showerror("오류", "이미지 파일이 없습니다!")
        return
    
    cover = f"{slug}/{images[0].name}"
    
    # 3. yml 생성
    yml_content = f'''title: "{title}"
slug: "{slug}"
date: {date}
cover: {cover}
'''
    
    yml_path = script_dir / "src" / "content" / "albums" / f"{slug}.yml"
    yml_path.write_text(yml_content)
    
    # 4. Git 푸시 확인
    if messagebox.askyesno("배포", f"✅ 파일 추가 완료!\n\n앨범: {title}\n\nGit에 푸시하시겠습니까?"):
        try:
            subprocess.run(["git", "add", "."], cwd=script_dir, check=True)
            subprocess.run(["git", "commit", "-m", f"📸 {title}"], cwd=script_dir, check=True)
            subprocess.run(["git", "push"], cwd=script_dir, check=True)
            messagebox.showinfo("완료", f"🚀 배포 완료!\n\n앨범: {title}")
        except Exception as e:
            messagebox.showerror("오류", f"Git 오류:\n{e}")
    else:
        messagebox.showinfo("완료", "파일은 추가되었습니다.\n나중에 수동으로 푸시하세요.")

# GUI 창
root = tk.Tk()
root.title("📸 사진 업로드")
root.geometry("300x150")

label = tk.Label(root, text="사진 앨범을 업로드하세요", font=("Arial", 14))
label.pack(pady=20)

btn = tk.Button(root, text="📂 폴더 선택", command=upload_photos, 
                font=("Arial", 12), bg="#007AFF", fg="white", 
                padx=20, pady=10)
btn.pack(pady=10)

root.mainloop()
