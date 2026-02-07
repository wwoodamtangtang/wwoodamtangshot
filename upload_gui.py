#!/usr/bin/env python3
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, scrolledtext
import os
import subprocess
import re
import sys
from pathlib import Path
from datetime import datetime
import shutil
from PIL import Image, ImageTk
import threading
import queue

class ConsoleRedirector:
    """콘솔 출력을 텍스트 위젯으로 리다이렉트"""
    def __init__(self, text_widget, tag="stdout"):
        self.text_widget = text_widget
        self.tag = tag
        
    def write(self, message):
        if message.strip():
            self.text_widget.insert('end', message, (self.tag,))
            self.text_widget.see('end')
            self.text_widget.update_idletasks()
    
    def flush(self):
        pass

class AlbumManager:
    def __init__(self, root):
        self.root = root
        self.root.title("📸 앨범 관리자")
        self.root.geometry("1200x900")
        
        self.script_dir = Path.cwd()
        
        # 메인 프레임
        main_frame = ttk.Frame(root)
        main_frame.pack(fill='both', expand=True)
        
        # 상단: 탭
        self.notebook = ttk.Notebook(main_frame)
        self.notebook.pack(fill='both', expand=True, padx=10, pady=(10, 0))
        
        # 탭 1: 새 앨범 업로드
        self.upload_tab = ttk.Frame(self.notebook)
        self.notebook.add(self.upload_tab, text="📤 새 앨범 업로드")
        self.create_upload_tab()
        
        # 탭 2: 기존 앨범 관리
        self.manage_tab = ttk.Frame(self.notebook)
        self.notebook.add(self.manage_tab, text="📁 앨범 관리")
        self.create_manage_tab()
        
        # 탭 3: 사진 편집
        self.edit_tab = ttk.Frame(self.notebook)
        self.notebook.add(self.edit_tab, text="✂️ 사진 편집")
        self.create_edit_tab()
        
        # 하단: 통합 콘솔
        console_frame = ttk.LabelFrame(main_frame, text="🖥️ 콘솔", padding=5)
        console_frame.pack(fill='both', expand=False, padx=10, pady=10, ipady=5)
        
        self.console = scrolledtext.ScrolledText(console_frame, height=10, 
                                                  bg='black', fg='#00ff00',
                                                  font=('Monaco', 10))
        self.console.pack(fill='both', expand=True)
        
        # 콘솔 태그 설정
        self.console.tag_config("stdout", foreground="#00ff00")
        self.console.tag_config("stderr", foreground="#ff0000")
        self.console.tag_config("info", foreground="#00ffff")
        
        # stdout/stderr 리다이렉트
        sys.stdout = ConsoleRedirector(self.console, "stdout")
        sys.stderr = ConsoleRedirector(self.console, "stderr")
        
        self.log("✅ 앨범 관리자 시작됨")
        self.log(f"📁 작업 디렉토리: {self.script_dir}\n")
    
    def log(self, message, tag="info"):
        """콘솔에 로그 출력"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.console.insert('end', f"[{timestamp}] {message}\n", (tag,))
        self.console.see('end')
        self.root.update_idletasks()
    
    def run_command(self, cmd, cwd=None):
        """명령어 실행 및 실시간 출력"""
        if cwd is None:
            cwd = self.script_dir
        
        self.log(f"$ {' '.join(cmd)}", "info")
        
        process = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        
        for line in process.stdout:
            print(line.rstrip())
        
        process.wait()
        
        if process.returncode == 0:
            self.log("✅ 명령어 실행 완료\n", "info")
        else:
            self.log(f"❌ 오류 발생 (exit code: {process.returncode})\n", "stderr")
        
        return process.returncode == 0
    
    def sanitize_filename(self, filename):
        """파일명 정리"""
        stem = Path(filename).stem
        ext = Path(filename).suffix
        
        clean_stem = re.sub(r'[^a-zA-Z0-9\-]', '', stem)
        clean_stem = clean_stem.lstrip('_-')
        clean_stem = re.sub(r'-+', '-', clean_stem)
        clean_stem = clean_stem.rstrip('-')
        
        if not clean_stem:
            clean_stem = "photo"
        
        return f"{clean_stem}{ext}"
    
    def create_upload_tab(self):
        """새 앨범 업로드 탭"""
        frame = ttk.Frame(self.upload_tab, padding=20)
        frame.pack(fill='both', expand=True)
        
        ttk.Label(frame, text="사진 폴더를 선택하세요", font=("Arial", 14)).pack(pady=20)
        
        ttk.Button(frame, text="📂 폴더 선택", command=self.upload_photos).pack(pady=10)
        
        # 업로드 진행상황
        self.upload_progress = ttk.Progressbar(frame, mode='indeterminate')
        self.upload_progress.pack(pady=10, fill='x', padx=50)
    
    def create_manage_tab(self):
        """기존 앨범 관리 탭"""
        frame = ttk.Frame(self.manage_tab)
        frame.pack(fill='both', expand=True, padx=10, pady=10)
        
        # 앨범 목록
        list_frame = ttk.LabelFrame(frame, text="앨범 목록", padding=10)
        list_frame.pack(side='left', fill='both', expand=True, padx=(0, 5))
        
        self.album_listbox = tk.Listbox(list_frame, font=("Arial", 12))
        self.album_listbox.pack(fill='both', expand=True)
        self.album_listbox.bind('<<ListboxSelect>>', self.on_album_select)
        
        scrollbar = ttk.Scrollbar(self.album_listbox)
        scrollbar.pack(side='right', fill='y')
        self.album_listbox.config(yscrollcommand=scrollbar.set)
        scrollbar.config(command=self.album_listbox.yview)
        
        # 앨범 상세
        detail_frame = ttk.LabelFrame(frame, text="앨범 상세", padding=10)
        detail_frame.pack(side='right', fill='both', expand=True, padx=(5, 0))
        
        self.album_info = tk.Text(detail_frame, height=10, width=40)
        self.album_info.pack(pady=5, fill='x')
        
        ttk.Button(detail_frame, text="🖼️ 커버 이미지 변경", 
                  command=self.change_cover).pack(pady=5, fill='x')
        
        ttk.Button(detail_frame, text="🗑️ 앨범 삭제", 
                  command=self.delete_album).pack(pady=5, fill='x')
        
        ttk.Button(detail_frame, text="🚀 변경사항 배포", 
                  command=self.deploy_changes).pack(pady=20, fill='x')
        
        self.refresh_album_list()
    
    def create_edit_tab(self):
        """사진 편집 탭"""
        frame = ttk.Frame(self.edit_tab)
        frame.pack(fill='both', expand=True, padx=10, pady=10)
        
        # 왼쪽: 앨범 선택
        left_frame = ttk.LabelFrame(frame, text="앨범 선택", padding=10)
        left_frame.pack(side='left', fill='both', expand=False, padx=(0, 5), ipadx=100)
        
        self.edit_album_listbox = tk.Listbox(left_frame, font=("Arial", 11))
        self.edit_album_listbox.pack(fill='both', expand=True)
        self.edit_album_listbox.bind('<<ListboxSelect>>', self.on_edit_album_select)
        
        # 오른쪽: 사진 목록
        right_frame = ttk.LabelFrame(frame, text="사진 목록", padding=10)
        right_frame.pack(side='right', fill='both', expand=True, padx=(5, 0))
        
        self.photos_canvas = tk.Canvas(right_frame)
        photos_scrollbar = ttk.Scrollbar(right_frame, orient="vertical", command=self.photos_canvas.yview)
        self.photos_scrollable_frame = ttk.Frame(self.photos_canvas)
        
        self.photos_scrollable_frame.bind(
            "<Configure>",
            lambda e: self.photos_canvas.configure(scrollregion=self.photos_canvas.bbox("all"))
        )
        
        self.photos_canvas.create_window((0, 0), window=self.photos_scrollable_frame, anchor="nw")
        self.photos_canvas.configure(yscrollcommand=photos_scrollbar.set)
        
        self.photos_canvas.pack(side="left", fill="both", expand=True)
        photos_scrollbar.pack(side="right", fill="y")
        
        ttk.Button(right_frame, text="🚀 변경사항 배포", 
                  command=self.deploy_changes).pack(pady=10, fill='x')
        
        self.refresh_edit_album_list()
    
    def upload_photos(self):
        """새 앨범 업로드"""
        photo_folder = filedialog.askdirectory(title="📸 업로드할 사진 폴더를 선택하세요")
        if not photo_folder:
            return
        
        self.upload_progress.start()
        
        def upload_thread():
            try:
                folder_name = Path(photo_folder).name
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
                
                self.log(f"\n📤 새 앨범 업로드 시작")
                self.log(f"📁 앨범: {title}")
                self.log(f"📅 날짜: {date}")
                
                # src/content/albums에 폴더 생성
                dest = self.script_dir / "src" / "content" / "albums" / title
                dest.mkdir(parents=True, exist_ok=True)
                
                self.log(f"✅ 폴더 생성: {dest}")
                
                # 파일 복사
                copied_files = []
                for item in Path(photo_folder).iterdir():
                    if item.is_file() and item.suffix.lower() in ['.jpg', '.jpeg', '.png']:
                        clean_name = self.sanitize_filename(item.name)
                        
                        if not clean_name or clean_name == item.suffix:
                            self.log(f"⚠️  건너뛰기: {item.name}")
                            continue
                        
                        dest_file = dest / clean_name
                        
                        self.log(f"📋 {item.name} → {clean_name}")
                        
                        try:
                            shutil.copy2(item, dest_file)
                            copied_files.append(dest_file)
                        except Exception as e:
                            self.log(f"❌ 복사 실패: {e}", "stderr")
                
                if not copied_files:
                    self.log("❌ 이미지 파일이 없습니다!", "stderr")
                    messagebox.showerror("오류", "이미지 파일이 없습니다!")
                    return
                
                self.log(f"✅ 총 {len(copied_files)}개 파일 복사 완료")
                
                # 커버 이미지
                cover_file = self.find_best_cover(copied_files)
                cover = f"{title}/{cover_file.name}"
                
                self.log(f"🖼️  커버: {cover}")
                
                # yml 생성
                yml_content = f'''title: "{title}"
slug: "{title}"
date: {date}
cover: {cover}
'''
                
                yml_path = self.script_dir / "src" / "content" / "albums" / f"{title}.yml"
                yml_path.write_text(yml_content)
                
                self.log(f"✅ yml 파일 생성 완료")
                
                self.root.after(0, lambda: self.refresh_album_list())
                self.root.after(0, lambda: self.refresh_edit_album_list())
                
                # Git 푸시 확인
                if messagebox.askyesno("배포", f"✅ 앨범 추가 완료!\n\n{title}\n\nGit에 푸시하시겠습니까?"):
                    self.deploy_changes()
                
            finally:
                self.upload_progress.stop()
        
        thread = threading.Thread(target=upload_thread)
        thread.start()
    
    def find_best_cover(self, image_files):
        """최적의 커버 이미지 찾기"""
        simple_files = [f for f in image_files 
                       if re.match(r'^[a-zA-Z0-9\-]+\.(jpg|jpeg|png)$', f.name, re.IGNORECASE)]
        
        return simple_files[0] if simple_files else image_files[0]
    
    def refresh_album_list(self):
        """앨범 목록 새로고침"""
        self.album_listbox.delete(0, 'end')
        
        albums_dir = self.script_dir / "src" / "content" / "albums"
        yml_files = sorted(albums_dir.glob("*.yml"), reverse=True)
        
        for yml_file in yml_files:
            self.album_listbox.insert('end', yml_file.stem)
    
    def refresh_edit_album_list(self):
        """편집 탭 앨범 목록 새로고침"""
        self.edit_album_listbox.delete(0, 'end')
        
        albums_dir = self.script_dir / "src" / "content" / "albums"
        yml_files = sorted(albums_dir.glob("*.yml"), reverse=True)
        
        for yml_file in yml_files:
            self.edit_album_listbox.insert('end', yml_file.stem)
    
    def on_album_select(self, event):
        """앨범 선택 시"""
        selection = self.album_listbox.curselection()
        if not selection:
            return
        
        album_name = self.album_listbox.get(selection[0])
        self.selected_album = album_name
        
        yml_path = self.script_dir / "src" / "content" / "albums" / f"{album_name}.yml"
        
        if yml_path.exists():
            yml_content = yml_path.read_text()
            self.album_info.delete('1.0', 'end')
            self.album_info.insert('1.0', yml_content)
    
    def on_edit_album_select(self, event):
        """편집 탭에서 앨범 선택 시"""
        selection = self.edit_album_listbox.curselection()
        if not selection:
            return
        
        album_name = self.edit_album_listbox.get(selection[0])
        self.show_photos_grid(album_name)
    
    def show_photos_grid(self, album_name):
        """사진 그리드 표시"""
        for widget in self.photos_scrollable_frame.winfo_children():
            widget.destroy()
        
        album_dir = self.script_dir / "src" / "content" / "albums" / album_name
        
        if not album_dir.exists():
            ttk.Label(self.photos_scrollable_frame, text="앨범 폴더가 없습니다!").pack()
            return
        
        images = list(album_dir.glob("*.jpg")) + list(album_dir.glob("*.jpeg")) + list(album_dir.glob("*.png"))
        
        if not images:
            ttk.Label(self.photos_scrollable_frame, text="이미지 파일이 없습니다!").pack()
            return
        
        ttk.Label(self.photos_scrollable_frame, 
                 text=f"총 {len(images)}장", 
                 font=("Arial", 12, "bold")).pack(pady=10)
        
        row_frame = None
        for i, img_path in enumerate(images):
            if i % 3 == 0:
                row_frame = ttk.Frame(self.photos_scrollable_frame)
                row_frame.pack(pady=5, fill='x')
            
            photo_frame = ttk.Frame(row_frame, relief='solid', borderwidth=1)
            photo_frame.pack(side='left', padx=5, pady=5)
            
            try:
                img = Image.open(img_path)
                img.thumbnail((200, 200))
                photo = ImageTk.PhotoImage(img)
                
                label = tk.Label(photo_frame, image=photo)
                label.image = photo
                label.pack()
                
                ttk.Label(photo_frame, text=img_path.name, font=("Arial", 9)).pack()
                
                ttk.Button(photo_frame, text="🗑️ 삭제",
                          command=lambda p=img_path, a=album_name: self.delete_photo(p, a)).pack(pady=5)
                
            except Exception as e:
                ttk.Label(photo_frame, text=f"{img_path.name}\n로드 실패").pack()
    
    def delete_photo(self, photo_path, album_name):
        """사진 삭제"""
        if not messagebox.askyesno("확인", f"'{photo_path.name}'을(를) 삭제하시겠습니까?"):
            return
        
        try:
            self.log(f"\n🗑️ 사진 삭제: {photo_path.name}")
            photo_path.unlink()
            
            # 커버 이미지였다면 yml 업데이트
            yml_path = self.script_dir / "src" / "content" / "albums" / f"{album_name}.yml"
            if yml_path.exists():
                yml_content = yml_path.read_text()
                if photo_path.name in yml_content:
                    album_dir = self.script_dir / "src" / "content" / "albums" / album_name
                    remaining_images = list(album_dir.glob("*.jpg")) + list(album_dir.glob("*.jpeg"))
                    
                    if remaining_images:
                        new_cover = f"{album_name}/{remaining_images[0].name}"
                        yml_content = re.sub(r'cover: .*', f'cover: {new_cover}', yml_content)
                        yml_path.write_text(yml_content)
                        self.log(f"🖼️ 커버 이미지 자동 변경: {remaining_images[0].name}")
            
            self.log(f"✅ 삭제 완료")
            messagebox.showinfo("완료", f"'{photo_path.name}'이(가) 삭제되었습니다!")
            
            self.show_photos_grid(album_name)
            
        except Exception as e:
            self.log(f"❌ 삭제 실패: {e}", "stderr")
            messagebox.showerror("오류", f"삭제 실패:\n{e}")
    
    def change_cover(self):
        """커버 이미지 변경"""
        if not hasattr(self, 'selected_album'):
            messagebox.showwarning("경고", "앨범을 먼저 선택하세요!")
            return
        
        album_name = self.selected_album
        album_dir = self.script_dir / "src" / "content" / "albums" / album_name
        
        if not album_dir.exists():
            messagebox.showerror("오류", "앨범 폴더가 없습니다!")
            return
        
        images = list(album_dir.glob("*.jpg")) + list(album_dir.glob("*.jpeg")) + list(album_dir.glob("*.png"))
        
        if not images:
            messagebox.showerror("오류", "이미지 파일이 없습니다!")
            return
        
        dialog = tk.Toplevel(self.root)
        dialog.title(f"커버 이미지 선택 - {album_name}")
        dialog.geometry("800x600")
        
        canvas = tk.Canvas(dialog)
        scrollbar = ttk.Scrollbar(dialog, orient="vertical", command=canvas.yview)
        scrollable_frame = ttk.Frame(canvas)
        
        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )
        
        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        
        for img_path in images:
            frame = ttk.Frame(scrollable_frame)
            frame.pack(pady=5, padx=10, fill='x')
            
            try:
                img = Image.open(img_path)
                img.thumbnail((200, 200))
                photo = ImageTk.PhotoImage(img)
                
                label = tk.Label(frame, image=photo)
                label.image = photo
                label.pack(side='left')
                
                btn = ttk.Button(frame, text=f"선택: {img_path.name}",
                                command=lambda p=img_path: self.set_cover(album_name, p, dialog))
                btn.pack(side='left', padx=10)
            except Exception as e:
                ttk.Label(frame, text=f"{img_path.name} - 로드 실패").pack()
        
        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
    
    def set_cover(self, album_name, image_path, dialog):
        """커버 이미지 설정"""
        yml_path = self.script_dir / "src" / "content" / "albums" / f"{album_name}.yml"
        
        if not yml_path.exists():
            messagebox.showerror("오류", "yml 파일이 없습니다!")
            return
        
        yml_content = yml_path.read_text()
        new_cover = f"{album_name}/{image_path.name}"
        yml_content = re.sub(r'cover: .*', f'cover: {new_cover}', yml_content)
        yml_path.write_text(yml_content)
        
        self.log(f"\n🖼️ 커버 변경: {image_path.name}")
        
        messagebox.showinfo("완료", f"커버 이미지가 변경되었습니다!\n\n{image_path.name}")
        dialog.destroy()
        
        self.album_info.delete('1.0', 'end')
        self.album_info.insert('1.0', yml_content)
    
    def delete_album(self):
        """앨범 삭제"""
        if not hasattr(self, 'selected_album'):
            messagebox.showwarning("경고", "앨범을 먼저 선택하세요!")
            return
        
        album_name = self.selected_album
        
        if not messagebox.askyesno("확인", f"'{album_name}' 앨범을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다!"):
            return
        
        self.log(f"\n🗑️ 앨범 삭제: {album_name}")
        
        yml_path = self.script_dir / "src" / "content" / "albums" / f"{album_name}.yml"
        if yml_path.exists():
            yml_path.unlink()
        
        album_dir = self.script_dir / "src" / "content" / "albums" / album_name
        if album_dir.exists():
            shutil.rmtree(album_dir)
        
        self.log(f"✅ 앨범 삭제 완료")
        
        messagebox.showinfo("완료", f"'{album_name}' 앨범이 삭제되었습니다!")
        
        self.refresh_album_list()
        self.refresh_edit_album_list()
        self.album_info.delete('1.0', 'end')
    
    def deploy_changes(self):
        """Git 배포"""
        self.log("\n🚀 Git 배포 시작...")
        
        try:
            if not self.run_command(["git", "add", "."]):
                raise Exception("git add 실패")
            
            if not self.run_command(["git", "commit", "-m", "update: 앨범 변경"]):
                self.log("⚠️ 커밋할 변경사항이 없음")
            
            if not self.run_command(["git", "push"]):
                raise Exception("git push 실패")
            
            self.log("✅ 배포 완료!\n", "info")
            messagebox.showinfo("완료", "🚀 배포 완료!")
            
        except Exception as e:
            self.log(f"❌ 배포 실패: {e}\n", "stderr")
            messagebox.showerror("오류", f"Git 오류:\n{e}")

if __name__ == "__main__":
    root = tk.Tk()
    app = AlbumManager(root)
    root.mainloop()
