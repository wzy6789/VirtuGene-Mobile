/** Deliberately narrow: unrecognised language still uses full planning. No second model call. */
export function lightConversation(request: string): boolean {
  const text = request.normalize('NFKC').trim().replace(/[。!！?？]+$/u, '');
  return /^(?:你好|早上好|下午好|晚上好|晚安|早安|谢谢你|谢谢|我在|今天好累|今天很累|我好累|我有点累|我好困|我有点困|今天心情很好|今天心情不好|陪我聊聊天|陪我聊会儿)$/u.test(text);
}
