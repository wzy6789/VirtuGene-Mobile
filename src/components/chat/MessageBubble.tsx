import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Message } from '../../db/index';
import { Avatar } from '../ui/Avatar';
import { ipc } from '../../lib/ipc-client';

interface Props {
  message: Message;
  avatar: string;
  animate?: boolean;
  /** 是否为会话最新一条消息（触发一次性光晕扫过） */
  isLatest?: boolean;
  onQuote?: (message: Message) => void;
  onDelete?: (message: Message) => void;
  onRetry?: (message: Message) => void;
}

export function MessageBubble({ message, avatar, animate, isLatest, onQuote, onDelete, onRetry }: Props) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  useEffect(() => {
    if (!menu) return;
    const handler = () => {
      setMenu(null);
      setConfirmDelete(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [menu]);

  const handleCopy = async () => {
    if (copied) return;
    await ipc.clipboard.writeText(message.content);
    setCopied(true);
    setMenu(null);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <div className={`group flex items-start gap-2 mb-4 ${isUser ? 'flex-row-reverse' : 'flex-row'} ${
      animate ? 'animate-message-in' : ''
    }`}>
      <Avatar avatar={avatar} size="sm" />
      {isUser && message.failed && (
        <button
          onClick={() => onRetry?.(message)}
          title="发送失败，点击重发"
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </button>
      )}
      <div className="relative max-w-[75%]">
        <div
          onContextMenu={handleContextMenu}
          className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words transition-shadow ${
            isLatest && !isUser ? 'animate-message-sweep' : ''
          } ${
            isUser
              ? 'bg-gradient-to-br from-gene-purple to-[#5B4BD4] text-white rounded-br-md shadow-[0_4px_16px_rgba(108,92,231,0.30)]'
              : 'bg-msgai text-msgaitxt rounded-bl-md border-l-2 border-life-cyan shadow-[0_2px_10px_rgba(0,206,201,0.08)]'
          }`}
        >
          {message.replyToContent && (
            <div
              className={`text-xs mb-1.5 line-clamp-1 border-l-2 pl-2 ${
                isUser ? 'border-white/40 text-white/70' : 'border-gray-300 text-gray-500'
              }`}
            >
              {message.replyToContent}
            </div>
          )}
          {message.image && (
            <img
              src={message.image}
              alt="图片"
              onClick={(e) => {
                e.stopPropagation();
                setPreviewImage(message.image!);
              }}
              className={`max-w-[220px] max-h-[260px] rounded-xl object-cover cursor-zoom-in ${
                message.content ? 'mb-2' : ''
              }`}
            />
          )}
          {message.content}
        </div>
        <button
          onClick={handleCopy}
          title={copied ? '已复制' : '复制'}
          className={`absolute top-1.5 ${
            isUser ? 'right-full mr-1.5' : 'left-full ml-1.5'
          } flex items-center justify-center w-6 h-6 rounded-md bg-panel border border-line text-gray-400 hover:text-ink transition-all opacity-0 group-hover:opacity-100 ${
            copied ? 'opacity-100 !text-life-cyan' : ''
          }`}
        >
          {copied ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>

      {/* Context menu — rendered via portal so position:fixed is relative to the viewport,
          not the virtualized row's transform container */}
      {menu &&
        createPortal(
          <div
            className="fixed z-[60] min-w-[140px] py-1.5 glass-card rounded-xl shadow-2xl"
            style={{ left: menu.x + 4, top: menu.y + 4 }}
            onClick={(e) => e.stopPropagation()}
          >
            {confirmDelete ? (
              <div className="px-4 py-2">
                <p className="text-sm text-sub mb-1">删除这条消息？</p>
                <p className="text-xs text-gray-500 mb-3">这段基因序列将被永久抹除</p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => {
                      setConfirmDelete(false);
                      setMenu(null);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:bg-surface transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      onDelete?.(message);
                      setMenu(null);
                      setConfirmDelete(false);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                  >
                    删除
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  onClick={handleCopy}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  📋 复制
                </button>
                <button
                  onClick={() => {
                    onQuote?.(message);
                    setMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  💬 引用
                </button>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  🗑️ 删除
                </button>
              </>
            )}
          </div>,
          document.body,
        )}

      {/* 全屏图片预览 */}
      {previewImage &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center"
            onClick={() => setPreviewImage(null)}
          >
            <img src={previewImage} alt="预览" className="max-w-full max-h-full object-contain" />
            <button className="absolute top-[max(env(safe-area-inset-top),16px)] right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white text-xl hover:bg-white/20 transition-colors">
              ✕
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
