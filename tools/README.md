# 剪辑脚本与参数留档

当前公开版本1.6.0，成片使用原片超分、4K RIFE与4K特效流程，详见根目录README和docs/validation-v1.6.0.json。下列脚本为1.5.0及更早的历史制作留档，不代表当前1.6.0的完整处理流程。脚本用于复核方法，不是包含全部素材的开箱即用工程。

## 历史1.5.0清晰度修正

- `clarity_v2_luma.py`：仅对1～6秒已有亮度细节做宽尺度高通增强；保护首秒、末两秒和底部1/6字幕区，限定每像素亮度差±10并受原5×5邻域范围钳制。
- `clarity_v2_native.cpp`：同一算法的可选Windows/OpenMP加速实现。Python中有NumPy回退，运行启动动画不需要这些制作依赖。
- `test_clarity_v2_luma.py`：软边增强、硬边/平坦场、时段保护、差值上限、局部范围与裁切的行为测试。
- `fidelity_luma.py`：先前的微增强算法，仅用于设置 `CLARITY_TEST_BASELINE=1` 后复现软边回归失败，不是当前影片处理方法。

默认测试：`python tools/test_clarity_v2_luma.py`（需要NumPy）。可选加速库在Visual Studio x64 Developer Command Prompt运行：

```cmd
cl /nologo /O2 /fp:strict /openmp /LD /MT /Fe:tools\clarity_v2_native.dll /Fo:tools\clarity_v2_native.obj tools\clarity_v2_native.cpp
```

滤镜输入是原尺寸uint8亮度平面与时间秒数，色度由调用者原样保留。生产处理以1.4.0成片为基准，不能把当前1.5.0影片再反复增强。仓库不包含完整FFV1核验母版或私人渲染目录；四片独立核验摘要在 `docs/validation-v1.5.0.json`。

## 原八秒剪辑流程

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
