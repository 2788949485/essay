import { Download, Folder, FolderOpen, Lock, Upload } from "lucide-react";
import type { AppSettings } from "../../shared/types";

type SettingsModalProps = {
  settings: AppSettings | null;
  settingsSaving: boolean;
  hotkeyDraft: string;
  hotkeyStatus: string;
  onHotkeyRecord: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onHotkeyFocus: () => void;
  onSettingsChange: (updater: (current: AppSettings) => AppSettings) => void;
  currentPrivacyPinDraft: string;
  onCurrentPrivacyPinChange: (value: string) => void;
  privacyPinDraft: string;
  onPrivacyPinChange: (value: string) => void;
  clearPrivacyPin: boolean;
  onClearPrivacyPinChange: (checked: boolean) => void;
  dataActionStatus: string;
  onBackupAll: () => void;
  onEncryptedBackup: () => void;
  onRestoreBackup: () => void;
  onImportEncrypted: () => void;
  onImportMarkdown: () => void;
  onOpenDataFolder: () => void;
  onChangeDataFolder: () => void;
  onClose: () => void;
  onSave: () => void;
};

export function SettingsModal(props: SettingsModalProps) {
  const {
    settings,
    settingsSaving,
    hotkeyDraft,
    hotkeyStatus,
    onHotkeyRecord,
    onHotkeyFocus,
    onSettingsChange,
    currentPrivacyPinDraft,
    onCurrentPrivacyPinChange,
    privacyPinDraft,
    onPrivacyPinChange,
    clearPrivacyPin,
    onClearPrivacyPinChange,
    dataActionStatus,
    onBackupAll,
    onEncryptedBackup,
    onRestoreBackup,
    onImportEncrypted,
    onImportMarkdown,
    onOpenDataFolder,
    onChangeDataFolder,
    onClose,
    onSave
  } = props;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-busy={settingsSaving}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-kicker">偏好与数据</span>
          <h2>设置</h2>
          <p className="modal-description">统一管理快捷键、隐私保护和本地数据目录。</p>
        </div>
        <fieldset className="settings-layout" disabled={settingsSaving}>
          <section className="settings-group" aria-label="基础偏好">
            <div className="settings-group-header">
              <div>
                <span className="settings-group-kicker">基础</span>
                <h3>偏好</h3>
                <p>先处理窗口呼出方式和日常使用习惯。</p>
              </div>
            </div>
            <div className="settings-group-grid">
              <label className="settings-field settings-field-wide">
                <span>全局快捷键</span>
                <input value={hotkeyDraft} readOnly onKeyDown={onHotkeyRecord} onFocus={onHotkeyFocus} />
                {hotkeyStatus ? <small className="setting-hint">{hotkeyStatus}</small> : null}
              </label>
              <label className="settings-toggle">
                <div className="settings-toggle-copy">
                  <strong>启动后隐藏到托盘</strong>
                  <small>减少启动时对桌面的打断。</small>
                </div>
                <input
                  type="checkbox"
                  checked={settings?.startHidden ?? false}
                  onChange={(event) =>
                    onSettingsChange((current) => ({ ...current, startHidden: event.target.checked }))
                  }
                />
              </label>
              <label className="settings-toggle">
                <div className="settings-toggle-copy">
                  <strong>开机自动启动</strong>
                  <small>系统登录后自动待命。</small>
                </div>
                <input
                  type="checkbox"
                  checked={settings?.launchAtLogin ?? false}
                  onChange={(event) =>
                    onSettingsChange((current) => ({ ...current, launchAtLogin: event.target.checked }))
                  }
                />
              </label>
              <label className="settings-toggle">
                <div className="settings-toggle-copy">
                  <strong>深色模式</strong>
                  <small>切换整体界面主题。</small>
                </div>
                <input
                  type="checkbox"
                  checked={settings?.theme === "dark"}
                  onChange={(event) =>
                    onSettingsChange((current) => ({ ...current, theme: event.target.checked ? "dark" : "light" }))
                  }
                />
              </label>
            </div>
          </section>

          <section className="settings-group" aria-label="排版">
            <div className="settings-group-header">
              <div>
                <span className="settings-group-kicker">排版</span>
                <h3>阅读体验</h3>
                <p>调整正文字号、行宽与行高，立即作用于编辑区。</p>
              </div>
            </div>
            <div className="settings-group-grid">
              <label className="settings-field">
                <span>正文字号（{settings?.fontSize ?? 16}px）</span>
                <input
                  type="range"
                  min={13}
                  max={24}
                  step={1}
                  value={settings?.fontSize ?? 16}
                  onChange={(event) =>
                    onSettingsChange((current) => ({ ...current, fontSize: Number(event.target.value) }))
                  }
                />
              </label>
              <label className="settings-field">
                <span>行宽（{settings?.lineWidth ?? 1120}px）</span>
                <input
                  type="range"
                  min={640}
                  max={1600}
                  step={20}
                  value={settings?.lineWidth ?? 1120}
                  onChange={(event) =>
                    onSettingsChange((current) => ({ ...current, lineWidth: Number(event.target.value) }))
                  }
                />
                <small className="setting-hint">全屏或大屏下可调宽，减少两侧留白。</small>
              </label>
              <label className="settings-field">
                <span>行高（{(settings?.lineHeight ?? 1.72).toFixed(2)}）</span>
                <input
                  type="range"
                  min={1.35}
                  max={2.2}
                  step={0.02}
                  value={settings?.lineHeight ?? 1.72}
                  onChange={(event) =>
                    onSettingsChange((current) => ({ ...current, lineHeight: Number(event.target.value) }))
                  }
                />
              </label>
            </div>
          </section>

          <section className="settings-group settings-group-security" aria-label="安全与隐私">
            <div className="settings-group-header">
              <div>
                <span className="settings-group-kicker">安全</span>
                <h3>隐私保护</h3>
                <p>把锁屏、PIN 和本地加密放在一个清晰的区域里。</p>
              </div>
              <span className={settings?.storageEncrypted ? "settings-status-pill is-active" : "settings-status-pill"}>
                {settings?.storageEncrypted ? "已加密" : "未加密"}
              </span>
            </div>
            <div className="settings-group-grid">
              <label className="settings-toggle settings-field-wide">
                <div className="settings-toggle-copy">
                  <strong>隐藏后重新打开时保护内容</strong>
                  <small>窗口再次显示前先进入隐私锁界面。</small>
                </div>
                <input
                  type="checkbox"
                  checked={settings?.lockOnHide ?? true}
                  onChange={(event) =>
                    onSettingsChange((current) => ({ ...current, lockOnHide: event.target.checked }))
                  }
                />
              </label>
              <label className="settings-field">
                <span>闲置自动锁定（分钟）</span>
                <input
                  type="number"
                  min={0}
                  max={240}
                  value={settings?.idleLockMinutes ?? 0}
                  onChange={(event) =>
                    onSettingsChange((current) => ({
                      ...current,
                      idleLockMinutes: Math.min(Math.max(Number(event.target.value) || 0, 0), 240)
                    }))
                  }
                />
                <small className="setting-hint">`0` 表示关闭；开启后达到时长会自动进入锁定态。</small>
              </label>
              <label className="settings-field">
                <span>{settings?.hasPrivacyPin ? "当前隐私密码" : "备份解密密码"}</span>
                <input
                  type="password"
                  value={currentPrivacyPinDraft}
                  onChange={(event) => onCurrentPrivacyPinChange(event.target.value)}
                  placeholder={
                    settings?.hasPrivacyPin
                      ? "关闭加密、更换 PIN、加密导出/导入时需要"
                      : "恢复或导入加密文件时输入对应密码"
                  }
                />
                <small className="setting-hint">
                  {settings?.hasPrivacyPin
                    ? "敏感操作会要求再次验证当前 PIN。"
                    : "仅在恢复备份、导出或导入加密文件时使用。"}
                </small>
              </label>
              <label className="settings-field settings-field-wide">
                <span>{settings?.hasPrivacyPin ? "更换隐私密码" : "设置隐私密码"}</span>
                <input
                  type="password"
                  value={privacyPinDraft}
                  onChange={(event) => onPrivacyPinChange(event.target.value)}
                  placeholder={
                    settings?.hasPrivacyPin ? "留空则不修改；开启加密时可在此重新输入" : "可选，开启加密前需要先输入"
                  }
                />
                <small className="setting-hint">PIN 只保存在你的会话里，用来解锁和派生本地加密密钥。</small>
              </label>
              <label className="settings-toggle settings-field-wide">
                <div className="settings-toggle-copy">
                  <strong>使用隐私密码加密本地数据库和历史备份</strong>
                  <small>会加密 `suiji.db`、历史版本和整库备份；单篇和批量导出会先让你选择明文或加密。</small>
                </div>
                <input
                  type="checkbox"
                  checked={settings?.storageEncrypted ?? false}
                  disabled={!settings?.hasPrivacyPin && !privacyPinDraft.trim()}
                  onChange={(event) =>
                    onSettingsChange((current) => ({ ...current, storageEncrypted: event.target.checked }))
                  }
                />
              </label>
              {settings?.hasPrivacyPin ? (
                <label className="settings-toggle settings-toggle-danger settings-field-wide">
                  <div className="settings-toggle-copy">
                    <strong>移除隐私密码</strong>
                    <small>关闭后会一并取消本地加密保护。</small>
                  </div>
                  <input
                    type="checkbox"
                    checked={clearPrivacyPin}
                    onChange={(event) => {
                      onClearPrivacyPinChange(event.target.checked);
                      if (event.target.checked) {
                        onSettingsChange((current) => ({ ...current, storageEncrypted: false }));
                      }
                    }}
                  />
                </label>
              ) : null}
            </div>
          </section>

          <section className="settings-group" aria-label="数据与备份">
            <div className="settings-group-header">
              <div>
                <span className="settings-group-kicker">数据</span>
                <h3>历史与文件</h3>
                <p>控制本地历史副本，并集中放置备份与目录操作。</p>
              </div>
            </div>
            <div className="settings-group-grid">
              <label className="settings-toggle settings-field-wide">
                <div className="settings-toggle-copy">
                  <strong>保留自动历史版本</strong>
                  <small>保存笔记时自动保留可恢复的本地版本。</small>
                </div>
                <input
                  type="checkbox"
                  checked={settings?.backupHistoryEnabled ?? true}
                  onChange={(event) =>
                    onSettingsChange((current) => ({ ...current, backupHistoryEnabled: event.target.checked }))
                  }
                />
              </label>
              <label className="settings-field">
                <span>历史版本最多保留份数</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={settings?.backupHistoryLimit ?? 80}
                  disabled={!(settings?.backupHistoryEnabled ?? true)}
                  onChange={(event) =>
                    onSettingsChange((current) => ({
                      ...current,
                      backupHistoryLimit: Math.min(Math.max(Number(event.target.value) || 1, 1), 200)
                    }))
                  }
                />
                <small className="setting-hint">关闭历史版本后会停止生成本地副本，并清空已有版本记录。</small>
              </label>
              <section className="data-tools settings-field settings-field-wide" aria-label="数据管理">
                <h3>数据管理</h3>
                <div className="data-tool-grid">
                  <button type="button" onClick={onBackupAll}>
                    <Download size={16} />
                    备份全部
                  </button>
                  <button type="button" onClick={onEncryptedBackup}>
                    <Lock size={16} />
                    加密备份
                  </button>
                  <button type="button" onClick={onRestoreBackup}>
                    <Upload size={16} />
                    恢复备份
                  </button>
                  <button type="button" onClick={onImportEncrypted}>
                    <Lock size={16} />
                    导入加密
                  </button>
                  <button type="button" onClick={onImportMarkdown}>
                    <Upload size={16} />
                    导入 MD
                  </button>
                  <button type="button" onClick={onOpenDataFolder}>
                    <FolderOpen size={16} />
                    数据目录
                  </button>
                  <button type="button" onClick={onChangeDataFolder}>
                    <Folder size={16} />
                    修改目录
                  </button>
                </div>
                {dataActionStatus && !settingsSaving ? (
                  <p className="settings-status-text">{dataActionStatus}</p>
                ) : null}
              </section>
            </div>
          </section>
        </fieldset>
        {settingsSaving ? (
          <p className="settings-status-text settings-save-status is-busy" role="status">
            {dataActionStatus || "正在保存设置..."}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={settingsSaving}>
            取消
          </button>
          <button type="button" className="primary" onClick={onSave} disabled={settingsSaving}>
            {settingsSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
