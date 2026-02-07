#!/usr/bin/env python3
import tkinter as tk
from tkinter import filedialog, messagebox
import os
import subprocess
import re
from pathlib import Path
from datetime import datetime

def sanitize_filename(filename):
    """파일명에서 한글/특수문자 제거, 영문+숫자만 남기기"""
    # 확장자 분리
    stem = Path(filename).stem
    ext = Path(filename).suffix
    
    # 영문, 숫자, 하이픈, 언더스코어만 허용
    clean_stem = re.sub(r'[^a-zA-Z0-9\-_]', '', stem)
    
    # 언더스코어로 시작하면 제거
    clean_stem = clean_stem.lstrip('_')
    
    return f"{clean_stem}{ext}"

def find_best_cover(image_files):
    """가장 적합한 커버 이미지 찾기"""
    # 1. 한글/특수문자 없는 파일 우선
    simple_files = [f for f in image_files 
                   if re.match(r'^[a-zA-Z0-9\-_.]+$', f.name)]
    
    if simple_files:
        return simple_files[0]
    
    # 2. 없으면 첫 번째 파일
    return image_files[0] if image_files else None

def upload_photos():
    script_dir = Path(__file__).parent.absolute()
    
    # 사진 폴더 선택
    photo_folder = filedialog.askdirectory(title="📸 업로드할 사진 폴더를 선택하세요")
    if not photo_folder:
        return
    
    folder_name = Path(photo_folder).name
    slug = folder_name.replace(" ", "-").lower()
    title = folder_name
    
    # 날짜 추출
    date_match = re.match(r'(\d{6})', folder_name)
    if date_match:
        date_str = date_match.group(1)
        year = f"20{date_str[0:2]}"
        month = date_str[2:4]
        day = date_str[4:6]
        date = f"{year}-{month}-{day}"
    else:
        date = datetime.now().strftime("%Y-%m-%d")
    
    # 1. 사진 복사
    dest = script_dir / "public" / "albums" / slug
    dest.mkdir(parents=True, exist_ok=True)
    
    print(f"📁 폴더 생성: {dest}")
    
    # 파일 복사하면서 문제 있는 파일명 정리
    copied_files = []
    for item in Path(photo_folder).iterdir():
        if item.is_file() and item.suffix.lower() in ['.jpg', '.jpeg', '.png']:
            # 파일명 정리
            clean_name = sanitize_filename(item.name)
            dest_file = dest / clean_name
            
            # 복사
            import shutil
            shutil.copy2(item, dest_file)
            copied_files.append(dest_file)
            print(f"✅ 복사: {item.name} → {clean_name}")
    
    if not copied_files:
        messagebox.showerror("오류", "이미지 파일이 없습니다!")
        return
    
    # 2. 최적의 커버 이미지 선택
    cover_file = find_best_cover(copied_files)
    cover = f"{slug}/{cover_file.name}"
    
    print(f"🖼️  커버 이미지: {cover}")
    
    # 3. yml 생성
    yml_content = f'''title: "{title}"
slug: "{slug}"
date: {date}
cover: {cover}
'''
    
    yml_path = script_dir / "src" / "content" / "albums" / f"{slug}.yml"
    yml_path.write_text(yml_content)
    
    print(f"📝 yml 생성 완료!")
    print(yml_content)
    
    # 4. Git 푸시 확인
    if messagebox.askyesno("배포", f"✅ 파일 추가 완료!\n\n앨범: {title}\n날짜: {date}\n커버: {cover_file.name}\n\nGit에 푸시하시겠습니까?"):
        try:
            subprocess.run(["git", "add", "."], cwd=script_dir, check=True)
            subprocess.run(["git", "commit", "-m", f"📸 {title}"], cwd=script_dir, check=True)
            subprocess.run(["git", "push"], cwd=script_dir, check=True)
            messagebox.showinfo("완료", f"🚀 배포 완료!\n\n앨범: {title}\n날짜: {date}")
        except Exception as e:
            messagebox.showerror("오류", f"Git 오류:\n{e}")
    else:
        messagebox.showinfo("완료", f"파일은 추가되었습니다.\n나중에 수동으로 푸시하세요.\n\n앨범: {title}\n날짜: {date}")

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
