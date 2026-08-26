/**
 * MemoryService - Quản lý Trí nhớ cho dự án HuyDongVon
 */

const HUY_DONG_VON_MEMORY_KEY = 'hdv_session_memory_v1';

export class MemoryService {
  static getSessionMemory() {
    try {
      const raw = localStorage.getItem(HUY_DONG_VON_MEMORY_KEY);
      if (!raw) return this.getDefaultMemory();
      return JSON.parse(raw);
    } catch (e) {
      console.error('[MemoryService HuyDongVon] Lỗi đọc Session Memory:', e);
      return this.getDefaultMemory();
    }
  }

  static getDefaultMemory() {
    return {
      activeCampaignId: '',
      activeBranch: '',
      lastSearchQuery: '',
      updatedAt: new Date().toISOString()
    };
  }

  static saveSessionMemory(partialState) {
    try {
      const current = this.getSessionMemory();
      const updated = {
        ...current,
        ...partialState,
        updatedAt: new Date().toISOString()
      };
      localStorage.setItem(HUY_DONG_VON_MEMORY_KEY, JSON.stringify(updated));
      return updated;
    } catch (e) {
      console.error('[MemoryService HuyDongVon] Lỗi lưu Session Memory:', e);
      return null;
    }
  }
}
