# Commit連結
1. 母專案 -- https://github.com/se-test-10/git-examples/commits/main/ 
    * 分支 -- https://github.com/se-test-10/git-examples/commits/developGitBranch/  
2. 子專案 -- https://github.com/znn-07/git-examples/commits/main/

# Git 分支建立與合併

### 1. 檢查遠端儲存庫連線
開始操作前，確認本地專案綁定的遠端儲存庫（`origin`）位址：
```bash
git remote -v
```

### 2. 建立並切換至新功能分支
建立名為 `developGitBranch` 的新分支並自動切換過去：
```bash
git checkout -b developGitBranch
```

確認目前所在的分支：
```bash
git branch
```
> **提示**：畫面上帶有 `*` 號且呈現綠色的名稱即為當前工作分支。

### 3. 將變更加入暫存區與提交 Commit
將修改或新增的 `.md` 檔案加入暫存區並建立 commit：
```bash
git add *.md
git commit -m "add gitBranch.md"
```

### 4. 推送新分支至遠端 GitHub
將本地的 `developGitBranch` 分支推送到遠端 repository：
```bash
git push origin developGitBranch
```

### 5. 切換回主分支並進行合併 (Merge)
開發完成後，切換回 `main` 主分支，並將新分支的修改內容併入：

1. 切換回主分支：
   ```bash
   git checkout main
   ```

2. 合併 `developGitBranch` 分支：
   ```bash
   git merge developGitBranch
   ```

### 6. 同步最新主分支至遠端
將本地合併後最新狀態的 `main` 分支推送到 GitHub：
```bash
git push origin main
```

---

## ⚠️ 常見小失誤提醒 (根據操作歷程記錄)

1. **指令拼字錯誤**：
   - 拼錯指令（如：將 `origin` 誤打成 `orgin`）會導致 `fatal: 'orgin' does not appear to be a git repository` 錯誤，請仔細檢查指令拼字。
2. **檔案比對路徑錯誤**：
   - 執行 `git add .*md` 會無法匹配一般檔案，應使用 `git add *.md` 來指定副檔名。