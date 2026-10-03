# 生活助理二次元形象

十款原创 AI 拟人头像：五种性格 × 女性／男性。采用 ChatGPT、DeepSeek 娘化形象所代表的二次元 AI 拟人方向，用发色、制服、表情和 DNA 配饰体现 VirtuGene 助理的性格。

使用内置 image_gen 工具逐张生成；未使用 CLI/API 备用模式。PNG 原图保存在此目录。角色资料存储 `secretary-avatar:<personality>:<appearance>`，运行时解析到打包资产，备份不会保存随版本变化的资源哈希地址。

应用加载同名 WebP 文件，十款合计约 2.15 MB。`node scripts/prepare-secretary-avatars.cjs` 将 PNG 导出为 WebP（质量 0.92，保留原始画幅与像素尺寸，不裁切）；已有输出不会覆盖。PNG 原图不进入 Vite 应用包。

完整预览位于 `scripts/verify/secretary-avatars.html`，截图为 `scripts/verify/secretary-avatars.png`；`node scripts/verify/preview-secretary-avatars.cjs` 可重新生成预览截图。

## 共用提示词

Use case: stylized-concept. Make ONE square 1024x1024 anime avatar for VirtuGene's personified AI personal assistant. Strong 2D Japanese anime / Chinese AI gijinka character-design style, similar in spirit to popular ChatGPT-chan and DeepSeek-chan anthropomorphic AI fan characters. ORIGINAL character, expressive adult young professional age 24-28. Clear cel-shaded illustration, crisp delicate outlines, large luminous anime eyes, distinctly stylized colored hair, beautifully designed tasteful futuristic uniform, one small luminous double-helix shaped hair accessory or collar brooch as a shared series motif. NOT realistic human portrait, NOT photograph, NOT chibi. Bust portrait centered from shoulders up, head fully visible and margin for circular crop. Light simple pastel gradient backdrop with two or three tiny geometric light specks. Soft even lighting, readable silhouette and expression at tiny avatar size. All clothing fully covered, dignified working companion. No text, no logos, no watermark, no frames, no extra people, no props held, no hands. Female and male counterparts use same style and palette.

## 每款头像的补充提示词

- **professional-male.png**: Male cool professional butler archetype. Silver-white short neatly parted hair, ice blue eyes, slim navy futuristic butler jacket with silver trim, blue helix collar brooch. Reserved attentive expression, subtly softened confident mouth, sophisticated serious presence. Slate-blue backdrop.
- **professional-female.png**: Female cool professional butler archetype. Long silver-white hair in a neat low ponytail, ice blue eyes, navy futuristic secretary uniform with silver trim, blue helix hair clip. Reserved attentive expression, subtly softened confident mouth, sophisticated serious presence. Slate-blue backdrop.
- **balanced-male.png**: Male reliable teammate archetype. Short layered teal-black hair, turquoise eyes, white futuristic smart casual jacket with teal piping and a small helix collar pin. Relaxed confident gentle smile, straight brows, practical dependable energy. Soft mint backdrop.
- **balanced-female.png**: Female reliable teammate archetype. Chin-length teal-black bob, turquoise eyes, white futuristic smart casual uniform with teal piping and a small helix hair clip. Relaxed confident gentle smile, straight brows, practical dependable energy. Soft mint backdrop.
- **gentle-male.png**: Male gentle patient listener archetype. Soft fluffy lavender-silver short hair, warm violet eyes, ivory soft-knit high-neck top with lavender futuristic shoulder panel and a tiny helix collar brooch. Reassuring small smile, empathetic attentive gaze. Warm lilac backdrop.
- **gentle-female.png**: Female gentle patient listener archetype. Long softly flowing lavender-silver hair, warm violet eyes, ivory soft-knit high-neck top with lavender futuristic shoulder panel and a tiny helix hair clip. Reassuring small smile, empathetic attentive gaze. Warm lilac backdrop.
- **energetic-male.png**: Male energetic motivational buddy archetype. Tousled apricot-orange short hair with a small teal streak, bright amber eyes, coral futuristic sporty jacket with white collar and a tiny helix collar pin. Cheerful open smile and upbeat sparkling expression. Peach sunshine backdrop.
- **energetic-female.png**: Female energetic motivational buddy archetype. Apricot-orange hair in a lively high ponytail with a small teal streak, bright amber eyes, coral futuristic sporty jacket with white collar and a tiny helix hair clip. Cheerful open smile and upbeat sparkling expression. Peach sunshine backdrop.
- **playful-male.png**: Male sharp tongue but soft heart archetype. Short slightly asymmetric deep indigo hair with muted magenta highlights, plum eyes, dark plum futuristic casual jacket with lavender trim and a tiny helix collar pin. One slightly raised eyebrow, witty mischievous half-smile with warm caring eyes. Mauve backdrop.
- **playful-female.png**: Female sharp tongue but soft heart archetype. Shoulder-length wavy deep indigo hair with muted magenta highlights, plum eyes, dark plum futuristic casual uniform with lavender trim and a tiny helix hair clip. One slightly raised eyebrow, witty mischievous half-smile with warm caring eyes. Mauve backdrop.

