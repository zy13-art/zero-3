# 剪辑脚本与参数留档

当前成片为v5制作流程，对外版本1.4.0。脚本用于复核制作方法，不是包含全部素材的开箱即用工程。

- `render_intro_v4.py`：从四段原片进行一次光流插帧、曲线变速、原生钟体轮廓扩散、字幕与水波收尾。
- `render_intro_v5.py`：复用v4阶段文件，将流光线稿显现延长至3秒；水波和拉远保持不变。
- `extract_clean_audio_v5.py`：从原片重新制作不含合成冲击声的对白/背景音乐。
- `mix_zio_audio_v5.py`：混入 `assets/zio-clock.mp3`，保留原音速度、音高和自然包络；不循环、不加混响或时针声。
- `clock_contour_effect.py`：只沿当帧可见钟体边缘产生扩散轮廓与粒子。
- `intro_effect_v3.py`：首秒像素故障与装饰窗口。
- `render_intro_v2.py`、`render_intro_v3.py`：旧阶段及共用函数来源；它们的历史主入口不代表当前成片。
- `verify_v4.py`、`verify_v5.py`：阶段影片的规格、画面差异与音频/视频完整性检查。

依赖Python 3、NumPy、Pillow、FFmpeg/FFprobe，以及Windows相应字体。高规格编码路径使用NVIDIA `h264_nvenc` / `hevc_nvenc`；不同FFmpeg构建的滤镜和编解码支持可能不同。

公开版本通过下列环境变量配置工具，不包含制作者的电脑路径：

| 环境变量 | 含义 | 默认 |
| --- | --- | --- |
| `KURUMI_SOURCE_DIR` | 原始四段素材目录 | `tools/source-material/` |
| `KURUMI_FFMPEG` | 带所需CPU滤镜的FFmpeg | PATH中的`ffmpeg` |
| `KURUMI_FFPROBE` | FFprobe | PATH中的`ffprobe` |
| `KURUMI_ENCODER_FFMPEG` | 支持所用NVENC编码的FFmpeg | 与`KURUMI_FFMPEG`一致 |

v5需要 `tools/v4renders/` 中的光流原片、轮廓、字幕、水波等中间文件。仓库只提供最终影片和脚本，不包含原始参考录屏、私人聊天视频、全部中间渲染文件或第三方FFmpeg发行包。应先核对各脚本输入和阶段完成标记，再按需重新生成；不要把仓库根目录的成片误当作中间文件。
